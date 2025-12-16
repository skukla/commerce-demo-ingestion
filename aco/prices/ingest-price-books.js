#!/usr/bin/env node
/**
 * Ingest Price Books to Adobe Commerce Optimizer
 * 
 * Ingests price books in hierarchical order (parents before children).
 * Supports 4-level hierarchy: Base → Regional → Tier → Promotional
 * 
 * Features:
 * - Progress bars for visibility
 * - Auto-retry with exponential backoff
 * - State tracking for idempotency
 * - Standardized output (matches Commerce format)
 * 
 * @module scripts/ingest-price-books
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';
import { loadJSON } from '../../shared/aco-helpers.js';
import { getStateTracker } from '../../shared/aco-state-tracker.js';
import logger from '../../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data repository path (required)
const DATA_REPO = process.env.DATA_REPO_PATH;
if (!DATA_REPO) {
  throw new Error('DATA_REPO_PATH environment variable is required. Please set it in your .env file.');
}

/**
 * Sort price books by hierarchy level (parents before children)
 */
function sortByHierarchy(priceBooks) {
  const levelMap = new Map();

  function calculateLevel(priceBook) {
    if (levelMap.has(priceBook.priceBookId)) {
      return levelMap.get(priceBook.priceBookId);
    }

    // Base level (no parent)
    if (!priceBook.parentId) {
      levelMap.set(priceBook.priceBookId, 1);
      return 1;
    }

    // Find parent
    const parent = priceBooks.find(pb => pb.priceBookId === priceBook.parentId);
    if (!parent) {
      logger.warn(`Parent not found for price book ${priceBook.priceBookId}: ${priceBook.parentId}`);
      levelMap.set(priceBook.priceBookId, 1);
      return 1;
    }

    // Level = parent level + 1
    const level = calculateLevel(parent) + 1;
    levelMap.set(priceBook.priceBookId, level);
    return level;
  }

  // Calculate levels for all price books
  priceBooks.forEach(pb => calculateLevel(pb));

  // Sort by level (ascending)
  return priceBooks.sort((a, b) => {
    const levelA = levelMap.get(a.priceBookId);
    const levelB = levelMap.get(b.priceBookId);
    return levelA - levelB;
  });
}

/**
 * Validate price book structure
 */
function validatePriceBook(priceBook) {
  const errors = [];
  
  if (!priceBook.priceBookId) {
    errors.push('Missing priceBookId');
  }
  if (!priceBook.name) {
    errors.push('Missing name');
  }
  
  return errors;
}

/**
 * Price Book Ingester Class
 */
class PriceBookIngester extends BaseIngester {
  constructor(options = {}) {
    super('Price Books', options);
  }
  
  async ingest() {
    // Load price books
    const priceBooks = await loadJSON('price-books.json', DATA_REPO, 'price books');
    
    // Sort by hierarchy
    const sorted = sortByHierarchy(priceBooks);
    this.logger.info('Sorted by hierarchy (parents first)');
    
    // Validate price books
    this.logger.info('Validating price book structure...');
    let hasErrors = false;
    sorted.forEach((priceBook, index) => {
      const errors = validatePriceBook(priceBook);
      if (errors.length > 0) {
        this.logger.error(`Price Book ${index} (${priceBook.priceBookId || 'NO_ID'}): ${errors.join(', ')}`);
        hasErrors = true;
      }
    });
    
    if (hasErrors) {
      throw new Error('Price book validation failed');
    }
    
    this.logger.info('✅ Validation passed');
    
    if (this.isDryRun) {
      this.logger.info('[DRY RUN] Would ingest:', {
        priceBooks: sorted.length
      });
      sorted.forEach(pb => this.results.addSkipped(pb, 'dry-run'));
      return;
    }
    
    // Load state tracker
    const stateTracker = getStateTracker();
    await stateTracker.load();
    
    // Filter already-ingested (idempotency)
    const toIngest = sorted.filter(pb => !stateTracker.hasPriceBook(pb.priceBookId));
    const alreadyIngested = sorted.length - toIngest.length;
    
    if (alreadyIngested > 0) {
      this.logger.info(`Skipping ${alreadyIngested} already-ingested price books`);
      sorted.filter(pb => stateTracker.hasPriceBook(pb.priceBookId)).forEach(pb => {
        this.results.addExisting({ id: pb.priceBookId, name: pb.name });
      });
    }
    
    if (toIngest.length === 0) {
      this.logger.info('All price books already ingested (idempotent)');
      return;
    }
    
    this.logger.info(`Ingesting ${toIngest.length} price books...`);
    
    // Initialize ACO client
    const client = await this.getClient();
    
    // Ingest each price book (must be sequential due to hierarchy)
    for (const priceBook of toIngest) {
      try {
        await withRetry(async () => {
          await client.createPriceBooks([priceBook]); // ACO expects array
          stateTracker.addPriceBook(priceBook.priceBookId);
        }, {
          name: `Ingest price book ${priceBook.priceBookId}`
        });
        
        this.results.addCreated({ id: priceBook.priceBookId, name: priceBook.name });
      } catch (error) {
        this.logger.error(`Failed to ingest price book ${priceBook.priceBookId}: ${error.message}`);
        this.results.addFailed({ id: priceBook.priceBookId, name: priceBook.name }, error);
      }
    }
    
    // Save state
    await stateTracker.save();
    
    if (this.results.failed.length > 0) {
      throw new Error(`${this.results.failed.length} price books failed to ingest`);
    }
  }
}

/**
 * Export function for orchestrator
 */
export async function ingestPriceBooks(options = {}) {
  const ingester = new PriceBookIngester(options);
  return ingester.run();
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const dryRun = process.argv.includes('--dry-run');
  ingestPriceBooks({ dryRun })
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export helper functions for testing
export { sortByHierarchy, validatePriceBook };
