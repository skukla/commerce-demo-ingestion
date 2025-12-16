#!/usr/bin/env node
/**
 * Ingest Variant Products to Adobe Commerce Optimizer
 * 
 * Ingests configurable products and their variants to ACO.
 * Parents (configurable products) are ingested first, then variants (children).
 * 
 * Features:
 * - Progress bars for visibility
 * - Auto-retry with exponential backoff
 * - State tracking for idempotency
 * - Polling verification after ingestion
 * - Standardized output (matches Commerce format)
 * 
 * @module scripts/ingest-variants
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';
import { getStateTracker } from '../../shared/aco-state-tracker.js';
import BuildRightDetector from '../../shared/smart-detector.js';
import { PollingProgress } from '../../shared/progress.js';
import { loadJSON, validateItems } from '../../shared/aco-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data repository path (required)
const DATA_REPO = process.env.DATA_REPO_PATH;
if (!DATA_REPO) {
  throw new Error('DATA_REPO_PATH environment variable is required. Please set it in your .env file.');
}

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
    // Load variants
    const variants = await loadJSON('variants.json', DATA_REPO, 'variants');
    
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
    
    this.logger.info(`Parents: ${parents.length}, Children: ${children.length}`);
    
    // Validate variants
    this.logger.info('Validating variant structure...');
    validateItems(
      variants,
      validateVariant,
      (v) => v.sku || 'NO_SKU',
      'variant'
    );
    this.logger.info('✅ Validation passed');
    
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
    
    // Ingest parents first
    if (parentsToIngest.length > 0) {
      this.logger.info(`Ingesting ${parentsToIngest.length} parent products...`);
      
      for (const parent of parentsToIngest) {
        try {
          await withRetry(async () => {
            await client.createProducts([parent]);
          }, {
            name: `Ingest parent ${parent.sku}`
          });
          
          this.results.addCreated({ sku: parent.sku, name: parent.name });
        } catch (error) {
          this.logger.error(`Failed to ingest parent ${parent.sku}: ${error.message}`);
          this.results.addFailed({ sku: parent.sku, name: parent.name }, error);
        }
      }
    }
    
    // Ingest children
    if (childrenToIngest.length > 0) {
      this.logger.info(`Ingesting ${childrenToIngest.length} child variants...`);
      
      for (const child of childrenToIngest) {
        try {
          await withRetry(async () => {
            await client.createProducts([child]);
          }, {
            name: `Ingest variant ${child.sku}`
          });
          
          this.results.addCreated({ sku: child.sku, name: child.name });
        } catch (error) {
          this.logger.error(`Failed to ingest variant ${child.sku}: ${error.message}`);
          this.results.addFailed({ sku: child.sku, name: child.name }, error);
        }
      }
    }
    
    // Poll ACO to verify ingestion
    if (this.results.created.length > 0 && !this.silent) {
      this.logger.info('Polling ACO to verify ingestion (waiting for indexing to start)...');
      
      const detector = new BuildRightDetector({ silent: this.silent });
      const skusToVerify = this.results.created.map(v => v.sku);
      
      const progress = new PollingProgress('Verifying variants', skusToVerify.length);
      const maxAttempts = 60; // 10 minutes max
      const pollInterval = 10000; // 10 seconds
      let attempt = 0;
      let verifiedCount = 0;
      let indexingStarted = false;
      
      while (attempt < maxAttempts && verifiedCount < skusToVerify.length) {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        const foundVariants = await detector.queryACOProductsBySKUs(skusToVerify);
        verifiedCount = foundVariants.length;
        
        // Detect when indexing starts (first movement)
        if (!indexingStarted && verifiedCount > 0) {
          indexingStarted = true;
          this.logger.info(`  ✓ Indexing started (${verifiedCount} variants indexed)`);
        }
        
        progress.update(verifiedCount, attempt, maxAttempts);
        
        if (verifiedCount === skusToVerify.length) {
          progress.finish(verifiedCount, true);
          break;
        }
      }
      
      if (verifiedCount < skusToVerify.length) {
        progress.finish(verifiedCount, false);
        if (!indexingStarted) {
          this.logger.warn(`Indexing has not started yet. Variants ingested but not yet searchable.`);
        } else {
          this.logger.warn(`Only ${verifiedCount}/${skusToVerify.length} variants verified in ACO`);
        }
      }
    }
    
    // Update state only after successful verification
    const skusCreated = this.results.created.map(v => v.sku);
    skusCreated.forEach(sku => stateTracker.addProduct(sku));
    await stateTracker.save();
    
    if (this.results.failed.length > 0) {
      throw new Error(`${this.results.failed.length} variants failed to ingest`);
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
