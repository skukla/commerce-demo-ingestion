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
import { getStateTracker } from '../lib/aco-state-tracker.js';
import { SmartDetector } from '../lib/smart-detector.js';
import { PollingProgress } from '../../shared/progress.js';
import { loadJSON, validateItems } from '../lib/aco-helpers.js';
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
    
    // Ingest in batches (ACO supports up to 100 products per request)
    const BATCH_SIZE = 100;
    const totalBatches = Math.ceil(toIngest.length / BATCH_SIZE);
    
    // Show progress bar if not silent
    const progress = !this.silent ? new PollingProgress('Ingesting products', toIngest.length) : null;
    let ingestedCount = 0;
    
    for (let i = 0; i < toIngest.length; i += BATCH_SIZE) {
      const batch = toIngest.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      
      try {
        await withRetry(async () => {
          await client.createProducts(batch);
        }, {
          name: `Ingest product batch ${batchNum}/${totalBatches}`
        });
        
        // Track all products in batch
        batch.forEach(product => {
          this.results.addCreated({ sku: product.sku, name: product.name });
        });
        
        ingestedCount += batch.length;
        if (progress) {
          progress.update(ingestedCount, batchNum, totalBatches);
        }
        
      } catch (error) {
        this.logger.error(`Failed to ingest batch ${batchNum}/${totalBatches}: ${error.message}`);
        // Mark all products in failed batch as failed
        batch.forEach(product => {
          this.results.addFailed({ sku: product.sku, name: product.name }, error);
        });
      }
    }
    
    if (progress) {
      progress.finish(ingestedCount, true);
    }
    
    // Poll ACO to verify ingestion
    if (this.results.created.length > 0) {
      // Always show progress bar (even in silent mode) - it's the actual operation progress
      if (!this.silent) {
        this.logger.info('Polling ACO to verify ingestion (waiting for indexing to start)...');
      }
      
      const detector = new SmartDetector({ silent: this.silent });
      const skusToVerify = this.results.created.map(p => p.sku);
      
      const progress = new PollingProgress('Verifying products', skusToVerify.length);
      const maxAttempts = 120; // 10 minutes max (120 * 5s = 600s)
      const pollInterval = 5000; // 5 seconds (faster polling for smoother progress)
      let attempt = 0;
      let verifiedCount = 0;
      let indexingStarted = false;
      let remainingSkus = [...skusToVerify];
      let verifiedSkus = new Set();
      
      // Helper: Check SKUs in batches (without progress updates during batching)
      const checkInBatches = async (skusToCheck) => {
        const BATCH_SIZE = 50;
        const found = [];
        
        for (let i = 0; i < skusToCheck.length; i += BATCH_SIZE) {
          const batch = skusToCheck.slice(i, i + BATCH_SIZE);
          const batchFound = await detector.queryACOProductsBySKUs(batch, true);
          found.push(...batchFound);
        }
        
        return found;
      };
      
      while (attempt < maxAttempts && verifiedCount < skusToVerify.length) {
        attempt++;
        
        // Check remaining SKUs in batches
        const foundProducts = await checkInBatches(remainingSkus);
        
        // Update verified SKUs and count (once per poll)
        foundProducts.forEach(p => verifiedSkus.add(p.sku));
        verifiedCount = verifiedSkus.size;
        remainingSkus = skusToVerify.filter(sku => !verifiedSkus.has(sku));
        
        // Detect when indexing starts (first movement)
        if (!indexingStarted && verifiedCount > 0) {
          indexingStarted = true;
        }
        
        // Update progress bar once per poll
        progress.update(verifiedCount, attempt, maxAttempts);
        
        // Wait before next poll (unless we're done)
        if (verifiedCount < skusToVerify.length) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
        if (verifiedCount === skusToVerify.length) {
          progress.finish(verifiedCount, true);
          
          // Final sanity check: Query both Catalog Service and Live Search counts
          const [catalogCount, liveSearchCount] = await Promise.all([
            detector.getCatalogCount(skusToVerify),
            detector.getLiveSearchCount()
          ]);
          
          if (catalogCount === skusToVerify.length && liveSearchCount === skusToVerify.length) {
            console.log(`✅ Catalog verified: ${catalogCount} products`);
            console.log(`✅ Live Search verified: ${liveSearchCount} products`);
          } else {
            if (catalogCount !== skusToVerify.length) {
              console.log(`⚠️  Catalog Service mismatch: expected ${skusToVerify.length}, found ${catalogCount}`);
            }
            if (liveSearchCount !== skusToVerify.length) {
              console.log(`⚠️  Live Search mismatch: expected ${skusToVerify.length}, found ${liveSearchCount}`);
            }
          }
          
          break;
        }
      }
      
      if (verifiedCount < skusToVerify.length) {
        progress.finish(verifiedCount, false);
        if (!indexingStarted) {
          this.logger.warn(`Indexing has not started yet. Products ingested but not yet searchable.`);
        } else {
          this.logger.warn(`Only ${verifiedCount}/${skusToVerify.length} products verified in ACO`);
        }
        this.logger.error(`❌ Verification incomplete`);
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
