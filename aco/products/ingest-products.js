#!/usr/bin/env node
/**
 * Ingest Products to Adobe Commerce Optimizer
 * 
 * Features:
 * - Progress bars for visibility
 * - Auto-retry with exponential backoff
 * - State tracking for idempotency
 * - Polling verification after ingestion
 * - Standardized output (matches Commerce format)
 * 
 * @module scripts/ingest-products
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';
import { getStateTracker } from '../../shared/aco-state-tracker.js';
import { SmartDetector } from '../../shared/smart-detector.js';
import { PollingProgress } from '../../shared/progress.js';
import { loadJSON, validateItems } from '../../shared/aco-helpers.js';
import { DATA_REPO_PATH as DATA_REPO } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Validate product structure
 */
function validateProduct(product) {
  const errors = [];
  
  if (!product.sku) {
    errors.push('Missing SKU');
  }
  if (!product.name) {
    errors.push('Missing name');
  }
  
  return errors;
}

/**
 * Product Ingester Class
 */
class ProductIngester extends BaseIngester {
  constructor(options = {}) {
    super('Products', options);
  }
  
  async ingest() {
    // Load products
    const products = await loadJSON('products.json', DATA_REPO, 'products');
    
    // Validate products
    this.logger.info('Validating product structure...');
    validateItems(
      products,
      validateProduct,
      (p) => p.sku || 'NO_SKU',
      'product'
    );
    this.logger.info('✅ Validation passed');
    
    if (this.isDryRun) {
      this.logger.info('[DRY RUN] Would ingest:', {
        products: products.length
      });
      products.forEach(p => this.results.addSkipped(p, 'dry-run'));
      return;
    }
    
    // Load state tracker
    const stateTracker = getStateTracker();
    await stateTracker.load();
    
    // Filter already-ingested (idempotency)
    const toIngest = products.filter(p => !stateTracker.hasProduct(p.sku));
    const alreadyIngested = products.length - toIngest.length;
    
    if (alreadyIngested > 0) {
      this.logger.info(`Skipping ${alreadyIngested} already-ingested products`);
      products.filter(p => stateTracker.hasProduct(p.sku)).forEach(p => {
        this.results.addExisting({ sku: p.sku, name: p.name });
      });
    }
    
    if (toIngest.length === 0) {
      this.logger.info('All products already ingested (idempotent)');
      return;
    }
    
    this.logger.info(`Ingesting ${toIngest.length} products...`);
    
    // Initialize ACO client
    const client = await this.getClient();
    
    // Ingest with retry
    for (const product of toIngest) {
      try {
        await withRetry(async () => {
          await client.createProducts([product]); // ACO expects array
        }, {
          name: `Ingest product ${product.sku}`
        });
        
        // Track temporarily (will verify via polling)
        this.results.addCreated({ sku: product.sku, name: product.name });
      } catch (error) {
        this.logger.error(`Failed to ingest ${product.sku}: ${error.message}`);
        this.results.addFailed({ sku: product.sku, name: product.name }, error);
      }
    }
    
    // Poll ACO to verify ingestion
    if (this.results.created.length > 0 && !this.silent) {
      this.logger.info('Polling ACO to verify ingestion (waiting for indexing to start)...');
      
      const detector = new SmartDetector({ silent: this.silent });
      const skusToVerify = this.results.created.map(p => p.sku);
      
      const progress = new PollingProgress('Verifying products', skusToVerify.length);
      const maxAttempts = 60; // 10 minutes max
      const pollInterval = 10000; // 10 seconds
      let attempt = 0;
      let verifiedCount = 0;
      let previousCount = 0;
      let indexingStarted = false;
      
      while (attempt < maxAttempts && verifiedCount < skusToVerify.length) {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        // Use throwOnError=true to surface query failures during polling
        const foundProducts = await detector.queryACOProductsBySKUs(skusToVerify, true);
        verifiedCount = foundProducts.length;
        
        // Detect when indexing starts (first movement)
        if (!indexingStarted && verifiedCount > 0) {
          indexingStarted = true;
          this.logger.info(`  ✓ Indexing in progress`);
        }
        
        progress.update(verifiedCount, attempt, maxAttempts);
        
        if (verifiedCount === skusToVerify.length) {
          progress.finish(verifiedCount, true);
          break;
        }
        
        previousCount = verifiedCount;
      }
      
      if (verifiedCount < skusToVerify.length) {
        progress.finish(verifiedCount, false);
        if (!indexingStarted) {
          this.logger.warn(`Indexing has not started yet. Products ingested but not yet searchable.`);
        } else {
          this.logger.warn(`Only ${verifiedCount}/${skusToVerify.length} products verified in ACO`);
        }
      }
    }
    
    // Update state only after successful verification
    const skusCreated = this.results.created.map(p => p.sku);
    skusCreated.forEach(sku => stateTracker.addProduct(sku));
    await stateTracker.save();
    
    if (this.results.failed.length > 0) {
      throw new Error(`${this.results.failed.length} products failed to ingest`);
    }
  }
}

/**
 * Export function for orchestrator
 */
export async function ingestProducts(options = {}) {
  const ingester = new ProductIngester(options);
  return ingester.run();
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const dryRun = process.argv.includes('--dry-run');
  ingestProducts({ dryRun })
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export helper functions for testing
export { validateProduct };
