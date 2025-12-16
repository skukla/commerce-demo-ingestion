#!/usr/bin/env node
/**
 * Ingest Prices to Adobe Commerce Optimizer
 * 
 * Ingests product prices across all price books with batch processing.
 * Supports base prices, tier pricing, and volume discounts.
 * 
 * Features:
 * - Progress bars for visibility
 * - Auto-retry with exponential backoff
 * - Batch processing for performance
 * - Standardized output (matches Commerce format)
 * 
 * @module scripts/ingest-prices
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data repository path (required)
const DATA_REPO = process.env.DATA_REPO_PATH;
if (!DATA_REPO) {
  throw new Error('DATA_REPO_PATH environment variable is required. Please set it in your .env file.');
}

const BATCH_SIZE = 100;

/**
 * Validate price structure
 */
function validatePrice(price) {
  const errors = [];
  
  if (!price.sku) {
    errors.push('Missing SKU');
  }
  if (!price.priceBookId) {
    errors.push('Missing priceBookId');
  }
  if (price.amount === undefined && price.price === undefined) {
    errors.push('Missing price/amount');
  }
  
  return errors;
}

/**
 * Price Ingester Class
 */
class PriceIngester extends BaseIngester {
  constructor(options = {}) {
    super('Prices', options);
    this.batchSize = BATCH_SIZE;
    this.skipValidation = options.skipValidation || false;
  }
  
  async ingest() {
    // Load prices
    const pricesPath = join(DATA_REPO, 'generated/aco/prices.json');
    this.logger.info(`Loading prices from: ${pricesPath}`);
    
    const pricesData = await fs.readFile(pricesPath, 'utf-8');
    const prices = JSON.parse(pricesData);
    
    this.logger.info(`Loaded ${prices.length} prices`);
    
    // Validate prices (unless skipped)
    if (!this.skipValidation) {
      this.logger.info('Validating price structure...');
      let hasErrors = false;
      prices.forEach((price, index) => {
        const errors = validatePrice(price);
        if (errors.length > 0) {
          this.logger.error(`Price ${index} (${price.sku || 'NO_SKU'}): ${errors.join(', ')}`);
          hasErrors = true;
        }
      });
      
      if (hasErrors) {
        throw new Error('Price validation failed');
      }
      
      this.logger.info('✅ Validation passed');
    }
    
    if (this.isDryRun) {
      this.logger.info('[DRY RUN] Would ingest:', {
        prices: prices.length,
        batches: Math.ceil(prices.length / this.batchSize)
      });
      prices.forEach(p => this.results.addSkipped(p, 'dry-run'));
      return;
    }
    
    this.logger.info(`Ingesting ${prices.length} prices in batches of ${this.batchSize}...`);
    
    // Initialize ACO client
    const client = await this.getClient();
    
    // Create batches
    const batches = [];
    for (let i = 0; i < prices.length; i += this.batchSize) {
      batches.push(prices.slice(i, i + this.batchSize));
    }
    
    // Ingest with retry
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNum = i + 1;
      
      if (!this.silent) {
        this.logger.info(`Batch ${batchNum}/${batches.length} (${batch.length} prices)`);
      }
      
      try {
        await withRetry(async () => {
          await client.createPrices(batch);
        }, {
          name: `Ingest price batch ${batchNum}`
        });
        
        // Track each price
        batch.forEach(price => {
          this.results.addCreated({ sku: price.sku, priceBookId: price.priceBookId });
        });
      } catch (error) {
        this.logger.error(`Failed to ingest batch ${batchNum}: ${error.message}`);
        batch.forEach(price => {
          this.results.addFailed({ sku: price.sku, priceBookId: price.priceBookId }, error);
        });
      }
    }
    
    if (this.results.failed.length > 0) {
      throw new Error(`${this.results.failed.length} prices failed to ingest`);
    }
  }
}

/**
 * Export function for orchestrator
 */
export async function ingestPrices(options = {}) {
  const ingester = new PriceIngester(options);
  return ingester.run();
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const dryRun = process.argv.includes('--dry-run');
  const skipValidation = process.argv.includes('--skip-validation');
  ingestPrices({ dryRun, skipValidation })
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export helper functions for testing
export { validatePrice };
