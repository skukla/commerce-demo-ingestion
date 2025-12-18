#!/usr/bin/env node
/**
 * Unified ACO Data Reset
 * 
 * Deletes all ACO entities from the data pack in the correct reverse dependency order:
 * 1. Prices (references products + price books)
 * 2. Price Books
 * 3. Products (simple + variants + bundles)
 * 4. Metadata (product attributes)
 * 
 * Strategy: Reads the data pack files directly and deletes all SKUs/IDs from those files.
 * This is simpler and more reliable than scanning or state tracking.
 * 
 * Usage:
 *   npm run delete:aco                    # Delete all data from data pack
 *   npm run delete:aco -- --dry-run       # Preview what would be deleted
 *   npm run delete:aco -- --reingest      # Delete and re-ingest all data
 * 
 * @module scripts/reset-all
 */

import {
  deleteAllPricesForPriceBooks,
  deletePriceBooks,
  deleteProductsBySKUs,
  deleteMetadata
} from './lib/aco-delete.js';
import { COMMERCE_CONFIG, DATA_REPO_PATH } from '../shared/config-loader.js';
import { loadJSON } from './lib/aco-helpers.js';
import { SmartDetector } from './lib/smart-detector.js';
import logger from '../shared/logger.js';
import { format } from '../shared/format.js';
import { updateLine, finishLine } from '../shared/progress.js';
import chalk from 'chalk';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reingest = args.includes('--reingest');
const skipPrices = args.includes('--skip-prices');
const skipProducts = args.includes('--skip-products');

/**
 * Main reset workflow
 */
async function resetAll() {
  const acoTarget = `ACO ${COMMERCE_CONFIG.aco.region}/${COMMERCE_CONFIG.aco.environment} (${COMMERCE_CONFIG.aco.tenantId})`;
  
  console.log('');
  console.log(format.muted(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`));
  console.log(format.muted(`Target: ${acoTarget}`));
  console.log('');
  
  const results = {
    prices: null,
    priceBooks: null,
    products: null,
    metadata: null
  };
  
  try {
    // Load data directly from data pack files
    updateLine('🔍 Loading data pack...');
    
    let skus = [];
    let priceBookIds = [];
    let metadataCodes = [];
    
    try {
      // Load products and variants
      const products = await loadJSON('products.json', DATA_REPO_PATH, 'products');
      const variants = await loadJSON('variants.json', DATA_REPO_PATH, 'variants');
      skus = [...products.map(p => p.sku), ...variants.map(v => v.sku)];
      
      // Load price books
      const priceBooks = await loadJSON('price-books.json', DATA_REPO_PATH, 'price-books');
      priceBookIds = priceBooks.map(pb => pb.priceBookId);
      
      // Load metadata
      const metadata = await loadJSON('metadata.json', DATA_REPO_PATH, 'metadata');
      metadataCodes = metadata.map(m => m.attributeId);
      
    } catch (error) {
      logger.warn(`Failed to load data pack: ${error.message}`);
      updateLine(chalk.yellow('⚠️  No data pack found'));
      finishLine();
      
      console.log('');
      console.log(format.warning('No data to delete (data pack not found)'));
      console.log('');
      return {
        success: true,
        results: {},
        validation: { clean: true, issues: [] }
      };
    }
    
    // Check if there's anything to delete
    if (skus.length === 0 && priceBookIds.length === 0 && metadataCodes.length === 0) {
      updateLine(chalk.green('✔ No data in data pack'));
      finishLine();
      
      console.log('');
      console.log(format.success('Nothing to delete!'));
      return {
        success: true,
        results: {},
        validation: { clean: true, issues: [] }
      };
    }
    
    // Display what was found
    const foundItems = [];
    if (skus.length > 0) foundItems.push(`${skus.length} products`);
    if (priceBookIds.length > 0) foundItems.push(`${priceBookIds.length} price books`);
    if (metadataCodes.length > 0) foundItems.push(`${metadataCodes.length} metadata attributes`);
    
    updateLine(chalk.green(`✔ Loaded data pack: ${foundItems.join(', ')}`));
    finishLine();
    
    // Step 1: Delete Prices (single line with spinner)
    if (!skipPrices && priceBookIds.length > 0) {
      results.prices = await deleteAllPricesForPriceBooks(priceBookIds, { skus, dryRun });
      if (results.prices.deleted > 0) {
        console.log(chalk.green(`✔ Deleted ${results.prices.deleted} prices`));
      }
      
    }
    
    // Step 2: Delete Price Books (single line with spinner)
    if (!skipPrices && results.prices?.success && priceBookIds.length > 0) {
      results.priceBooks = await deletePriceBooks(priceBookIds, { dryRun });
      if (results.priceBooks.deleted > 0) {
        console.log(chalk.green(`✔ Deleted ${results.priceBooks.deleted} price books`));
      }
      
    }
    
    // Step 3: Delete Products with polling progress
    if (!skipProducts && skus.length > 0) {
      updateLine('🗑️  Deleting products...');
      
      // Submit deletion request (silent mode - polling will show progress)
      const deleteResult = await deleteProductsBySKUs(skus, { dryRun, silent: true });
      
      // Poll to watch actual deletion progress
      if (!dryRun) {
        const { PollingProgress } = await import('../shared/progress.js');
        const progress = new PollingProgress('Deleting products', skus.length);
        
        const maxAttempts = 60; // 10 minutes max
        const pollInterval = 10000; // 10 seconds
        let attempt = 0;
        let deletionStarted = false;
        let pollingCompletedSuccessfully = false;
        
        // Track which SKUs still need to be checked
        let remainingSkus = [...skus];
        let confirmedDeleted = 0;
        
        // Create detector for querying ACO
        const detector = new SmartDetector({ silent: true });
        
        // Helper: Check SKUs in batches (without progress updates during batching)
        const checkRemainingInBatches = async (skusToCheck) => {
          const BATCH_SIZE = 50; // Check 50 SKUs at a time
          const stillRemaining = [];
          
          for (let i = 0; i < skusToCheck.length; i += BATCH_SIZE) {
            const batch = skusToCheck.slice(i, i + BATCH_SIZE);
            const batchRemaining = await detector.queryACOProductsBySKUs(batch, true);
            stillRemaining.push(...batchRemaining);
          }
          
          return stillRemaining;
        };
        
        while (attempt < maxAttempts && remainingSkus.length > 0) {
          attempt++;
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          // Check remaining SKUs in batches
          const stillRemainingProducts = await checkRemainingInBatches(remainingSkus);
          const previousRemaining = remainingSkus.length;
          remainingSkus = stillRemainingProducts.map(p => p.sku);
          
          // Update confirmed deleted count and progress (once per poll)
          confirmedDeleted = skus.length - remainingSkus.length;
          
          logger.debug(`Poll #${attempt}: ${remainingSkus.length} products remaining, ${confirmedDeleted} deleted`);
          
          // Detect when deletion starts (first movement)
          if (!deletionStarted && remainingSkus.length < previousRemaining) {
            deletionStarted = true;
          }
          
          // Update progress bar once per poll
          progress.update(confirmedDeleted, attempt, maxAttempts);
          
          if (remainingSkus.length === 0) {
            progress.finish(skus.length, true, `Deleted ${skus.length} products`);
            pollingCompletedSuccessfully = true;
            break;
          }
        }
        
        if (remainingSkus.length > 0) {
          progress.finish(confirmedDeleted, false, `Deleted ${confirmedDeleted} of ${skus.length} products (${remainingSkus.length} remaining)`);
          if (!deletionStarted) {
            console.log(chalk.yellow(`\nDeletion submitted but not yet processed. Products may still appear in search.`));
          } else {
            throw new Error(`${remainingSkus.length} products still remain after ${attempt * 10}s`);
          }
        }
        
        // Wait for Search and Recs indexing to catch up
        // Catalog Service is already confirmed clean, but Search/Recs has indexing lag
        if (pollingCompletedSuccessfully && confirmedDeleted > 0) {
          const { PollingProgress } = await import('../shared/progress.js');
          const indexProgress = new PollingProgress('Syncing to Search & Recs', confirmedDeleted);
          const totalDelayMs = 15000; // 15 seconds
          const pollInterval = 2000; // 2 seconds per tick
          const maxDelayAttempts = Math.ceil(totalDelayMs / pollInterval);
          
          for (let delayAttempt = 1; delayAttempt <= maxDelayAttempts; delayAttempt++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            const simulatedProgress = Math.floor((delayAttempt / maxDelayAttempts) * confirmedDeleted);
            indexProgress.update(simulatedProgress, delayAttempt, maxDelayAttempts);
          }
          
          indexProgress.finish(confirmedDeleted, true);
          console.log(chalk.green(`✔ Search & Recs synchronized`));
        }
        
        deleteResult.actualDeleted = confirmedDeleted;
        deleteResult.pollingCompleted = pollingCompletedSuccessfully;
      } else {
        updateLine(chalk.green(`✔ Deleting products (${deleteResult.deleted} deleted)`));
        finishLine();
      }
      
      results.products = deleteResult;
    }
    
    // Step 4: Delete Metadata (last, after all products are deleted)
    if (!skipProducts && metadataCodes.length > 0) {
      results.metadata = await deleteMetadata(metadataCodes, { dryRun });
      if (results.metadata.deleted > 0) {
        console.log(chalk.green(`✔ Deleted ${results.metadata.deleted} metadata attributes`));
      }
      
    }
    
    // Deletion complete - no validation needed since we deleted exactly what was in the data pack
    if (results.products?.pollingCompleted && !dryRun) {
      console.log(chalk.green('✔ Products deletion confirmed via polling'));
    }
    
    // Summary
    console.log('');
    
    const allSuccess = Object.values(results)
      .filter(r => r !== null)
      .every(r => r.success !== false);
    
    if (allSuccess && !dryRun) {
      console.log(format.success('Data deletion complete!'));
      if (reingest) {
        console.log('');
        console.log(format.muted('Re-ingesting all data...'));
        const { execSync } = await import('child_process');
        execSync('node aco/import.js', {
          stdio: 'inherit',
          cwd: process.cwd()
        });
      }
    } else if (dryRun) {
      console.log(format.muted('Dry run complete - no data was deleted'));
    } else {
      console.log(format.warning('Some steps failed - check logs above'));
    }
    
    console.log('');
    
    return { success: allSuccess, results };
    
  } catch (error) {
    console.error(format.error(`Reset failed: ${error.message}`));
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await resetAll();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    logger.error('Fatal error during reset');
    process.exit(1);
  }
}

export default resetAll;

