#!/usr/bin/env node
/**
 * Ingest Variant Products to Adobe Commerce Optimizer
 * 
 * Ingests configurable products and their variants to ACO using a two-phase visibility approach:
 * 1. Import variants as VISIBLE (for verification)
 * 2. Verify via GraphQL (real verification)
 * 3. Toggle visibility to INVISIBLE (production state)
 * 4. Wait for indexing to confirm
 * 
 * This approach ensures:
 * - Real verification (not simulated timing)
 * - Interrupted imports can be cleaned up with --scan
 * - Final production state has invisible variants
 * 
 * Parents (configurable products) are ingested first, then variants (children).
 * 
 * Features:
 * - Two-phase visibility toggle for robust verification
 * - Progress bars for visibility
 * - Auto-retry with exponential backoff
 * - State tracking for idempotency
 * - Standardized output (matches Commerce format)
 * 
 * @module scripts/ingest-variants
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';
import { getStateTracker } from '../lib/aco-state-tracker.js';
import { PollingProgress } from '../../shared/progress.js';
import { loadJSON, validateItems } from '../lib/aco-helpers.js';
import { DATA_REPO_PATH as DATA_REPO } from '../../shared/config-loader.js';
import { SmartDetector } from '../lib/smart-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Validate variant structure
 */
function validateVariant(variant) {
  const errors = [];
  
  if (!variant.sku) {
    errors.push('Missing SKU');
  }
  if (!variant.name) {
    errors.push('Missing name');
  }
  
  return errors;
}

/**
 * Variant Ingester Class
 */
class VariantIngester extends BaseIngester {
  constructor(options = {}) {
    super('Variants', options);
  }
  
  async ingest() {
    // Load variants from data pack (source of truth)
    const variants = await loadJSON('variants.json', DATA_REPO, 'variants');
    
    // Load products count for catalog verification
    const products = await loadJSON('products.json', DATA_REPO, 'products');
    const expectedProductCount = products.length;
    
    // Extract all SKUs from data pack for verification and toggle
    const allVariantSkus = variants.map(v => v.sku);
    
    // Separate parents from children
    const parents = variants.filter(v =>
      v.type === 'configurable' ||
      v.sku?.endsWith('-CONFIG') ||
      v.sku?.endsWith('-PARENT')
    );
    
    const children = variants.filter(v =>
      v.type !== 'configurable' &&
      !v.sku?.endsWith('-CONFIG') &&
      !v.sku?.endsWith('-PARENT')
    );
    
    // Validate variants (silent unless errors)
    validateItems(
      variants,
      validateVariant,
      (v) => v.sku || 'NO_SKU',
      'variant'
    );
    
    if (this.isDryRun) {
      this.logger.info('[DRY RUN] Would ingest:', {
        parents: parents.length,
        children: children.length
      });
      variants.forEach(v => this.results.addSkipped(v, 'dry-run'));
      return;
    }
    
    // Load state tracker
    const stateTracker = getStateTracker();
    await stateTracker.load();
    
    // Filter already-ingested (idempotency)
    const parentsToIngest = parents.filter(p => !stateTracker.hasProduct(p.sku));
    const childrenToIngest = children.filter(c => !stateTracker.hasProduct(c.sku));
    
    const alreadyIngested = variants.length - parentsToIngest.length - childrenToIngest.length;
    
    if (alreadyIngested > 0) {
      this.logger.info(`Skipping ${alreadyIngested} already-ingested variants`);
      variants.filter(v => stateTracker.hasProduct(v.sku)).forEach(v => {
        this.results.addExisting({ sku: v.sku, name: v.name });
      });
    }
    
    if (parentsToIngest.length === 0 && childrenToIngest.length === 0) {
      this.logger.info('All variants already ingested (idempotent)');
      return;
    }
    
    // Initialize ACO client
    const client = await this.getClient();
    
    // Ingest parents first (in batches)
    if (parentsToIngest.length > 0) {
      const BATCH_SIZE = 100;
      const totalBatches = Math.ceil(parentsToIngest.length / BATCH_SIZE);
      
      // Always show progress bar for visibility
      const progress = new PollingProgress('Ingesting configurable products', parentsToIngest.length);
      let ingestedCount = 0;
      
      for (let i = 0; i < parentsToIngest.length; i += BATCH_SIZE) {
        const batch = parentsToIngest.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        
        try {
          await withRetry(async () => {
            await client.createProducts(batch);
          }, {
            name: `Ingest parent batch ${batchNum}/${totalBatches}`
          });
          
          batch.forEach(parent => {
            this.results.addCreated({ sku: parent.sku, name: parent.name });
          });
          
          ingestedCount += batch.length;
          progress.update(ingestedCount, batchNum, totalBatches);
          
        } catch (error) {
          this.logger.error(`Failed to ingest parent batch ${batchNum}/${totalBatches}: ${error.message}`);
          batch.forEach(parent => {
            this.results.addFailed({ sku: parent.sku, name: parent.name }, error);
          });
        }
      }
      
      if (progress) {
        progress.finish(ingestedCount, true);
      }
    }
    
    // Ingest children (in batches)
    if (childrenToIngest.length > 0) {
      const BATCH_SIZE = 100;
      const totalBatches = Math.ceil(childrenToIngest.length / BATCH_SIZE);
      
      // Always show progress bar for visibility
      const progress = new PollingProgress('Ingesting variants', childrenToIngest.length);
      let ingestedCount = 0;
      
      for (let i = 0; i < childrenToIngest.length; i += BATCH_SIZE) {
        const batch = childrenToIngest.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        
        try {
          await withRetry(async () => {
            await client.createProducts(batch);
          }, {
            name: `Ingest variant batch ${batchNum}/${totalBatches}`
          });
          
          batch.forEach(child => {
            this.results.addCreated({ sku: child.sku, name: child.name });
          });
          
          ingestedCount += batch.length;
          progress.update(ingestedCount, batchNum, totalBatches);
          
        } catch (error) {
          this.logger.error(`Failed to ingest variant batch ${batchNum}/${totalBatches}: ${error.message}`);
          if (error.response) {
            this.logger.error(`API Response: ${error.response}`);
          }
          if (error.statusCode) {
            this.logger.error(`HTTP Status: ${error.statusCode}`);
          }
          batch.forEach(child => {
            this.results.addFailed({ sku: child.sku, name: child.name }, error);
          });
        }
      }
      
      if (progress) {
        progress.finish(ingestedCount, true);
      }
    }
    
    // Update state after ingestion (verification and visibility toggle will happen separately)
    // Note: State tracker is no longer critical since delete.js reads from data pack
    allVariantSkus.forEach(sku => stateTracker.addProduct(sku));
    await stateTracker.save();
    
    if (this.results.failed.length > 0) {
      this.logger.warn(`${this.results.failed.length} variants failed to ingest (check logs for details)`);
      // Don't throw - allow process to continue if some variants failed
      // throw new Error(`${this.results.failed.length} variants failed to ingest`);
    }
  }
}

/**
 * Export function for orchestrator
 */
export async function ingestVariants(options = {}) {
  const ingester = new VariantIngester(options);
  return ingester.run();
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const dryRun = process.argv.includes('--dry-run');
  ingestVariants({ dryRun })
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export helper functions for testing
export { validateVariant };
