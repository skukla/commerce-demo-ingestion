#!/usr/bin/env node
/**
 * Reset Price Books in ACO
 * 
 * Deletes all prices and price books from ACO, then optionally re-ingests clean data.
 * Uses modular utilities for querying and deleting ACO entities.
 * 
 * Usage:
 *   node scripts/reset-price-books.js              # Reset all price books
 *   node scripts/reset-price-books.js --dry-run    # Preview what would be deleted
 *   node scripts/reset-price-books.js --reingest   # Reset and re-ingest clean data
 * 
 * @module scripts/reset-price-books
 */

import { getAllProductSKUs } from '../../shared/aco-query.js';
import { deleteAllPricesForPriceBooks, deletePriceBooks } from '../../shared/aco-delete.js';
import logger from '../../shared/logger.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data repository path (required)
const DATA_REPO = process.env.DATA_REPO_PATH;
if (!DATA_REPO) {
  throw new Error('DATA_REPO_PATH environment variable is required. Please set it in your .env file.');
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reingest = args.includes('--reingest');

/**
 * Get all price book IDs from local data file
 */
async function getLocalPriceBookIds() {
  try {
    const data = await fs.readFile(join(DATA_REPO, 'generated/aco/price-books.json'), 'utf-8');
    const priceBooks = JSON.parse(data);
    return priceBooks.map(pb => pb.priceBookId);
  } catch (error) {
    logger.warn('Could not read local price-books.json:', error.message);
    return [];
  }
}

/**
 * Get all known price book IDs (local + hardcoded legacy ones)
 */
async function getAllKnownPriceBookIds() {
  const localIds = await getLocalPriceBookIds();
  
  // Add any legacy/old price book IDs that might exist in ACO
  const legacyIds = [
    'east-region-contract',
    'east-commercial-contract',
    'east-residential-contract',
    'west-region-contract',
    'west-commercial-contract',
    'west-residential-contract',
    'us-base-retail',
    'east-region-retail',
    'west-region-retail',
    'US_COMMERCIAL',
    'US_CONTRACTOR',
    'US_RETAIL',
    'US_WHOLESALE'
  ];
  
  // Combine and deduplicate
  const allIds = [...new Set([...localIds, ...legacyIds])];
  return allIds;
}

/**
 * Main reset function
 */
async function resetPriceBooks() {
  logger.info('='.repeat(70));
  logger.info('ACO Price Books Reset');
  logger.info('='.repeat(70));
  
  if (dryRun) {
    logger.info('🔍 DRY RUN MODE - No changes will be made');
  }
  
  logger.info('');
  
  try {
    // Step 1: Get all price book IDs
    logger.info('Step 1: Identifying price books to delete...');
    const priceBookIds = await getAllKnownPriceBookIds();
    logger.info(`Found ${priceBookIds.length} price book IDs (local + legacy)`);
    logger.info('Price books:', priceBookIds);
    logger.info('');
    
    // Step 2: Get all product SKUs from ACO
    logger.info('Step 2: Querying all product SKUs from ACO...');
    const skus = await getAllProductSKUs();
    logger.info(`Found ${skus.length} products in ACO`);
    logger.info('');
    
    // Step 3: Delete all prices for these price books
    logger.info('Step 3: Deleting all prices...');
    logger.info(`This will delete ${skus.length} SKUs × ${priceBookIds.length} price books = ${skus.length * priceBookIds.length} potential price entries`);
    
    const priceResult = await deleteAllPricesForPriceBooks(priceBookIds, {
      skus,
      dryRun
    });
    
    logger.info(`Prices: ${priceResult.deleted}/${priceResult.total} deleted`);
    logger.info('');
    
    // Step 4: Delete price books
    logger.info('Step 4: Deleting price books...');
    const priceBookResult = await deletePriceBooks(priceBookIds, { dryRun });
    logger.info(`Price books: ${priceBookResult.deleted}/${priceBookResult.total} deleted`);
    logger.info('');
    
    // Summary
    logger.info('='.repeat(70));
    logger.info('Reset Summary');
    logger.info('='.repeat(70));
    logger.info(`Prices deleted: ${priceResult.deleted}/${priceResult.total}`);
    logger.info(`Price books deleted: ${priceBookResult.deleted}/${priceBookResult.total}`);
    logger.info(`Errors: ${(priceResult.errors?.length || 0) + (priceBookResult.errors?.length || 0)}`);
    logger.info('');
    
    const success = (priceResult.success !== false) && (priceBookResult.success !== false);
    
    if (success && !dryRun) {
      logger.info('✅ Price book reset complete!');
      
      if (reingest) {
        logger.info('');
        logger.info('Re-ingesting clean price data...');
        // Import and run ingestion (dynamically to avoid circular deps)
        const { execSync } = await import('child_process');
        execSync('npm run ingest:price-books && npm run ingest:prices', {
          stdio: 'inherit',
          cwd: process.cwd()
        });
      } else {
        logger.info('');
        logger.info('Next steps:');
        logger.info('1. Re-ingest price books: npm run ingest:price-books');
        logger.info('2. Re-ingest prices: npm run ingest:prices');
        logger.info('');
        logger.info('Or run with --reingest flag to do this automatically');
      }
    } else if (dryRun) {
      logger.info('🔍 Dry run complete - no changes were made');
      logger.info('Run without --dry-run to perform actual deletion');
    } else {
      logger.warn('⚠️  Reset completed with errors - check logs above');
    }
    
    return {
      success,
      priceResult,
      priceBookResult
    };
    
  } catch (error) {
    logger.error('Price book reset failed:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await resetPriceBooks();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    logger.error('Fatal error during reset');
    process.exit(1);
  }
}

export default resetPriceBooks;
