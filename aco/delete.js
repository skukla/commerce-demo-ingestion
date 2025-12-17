#!/usr/bin/env node
/**
 * Unified ACO Data Reset
 * 
 * Deletes all ACO entities in the correct reverse dependency order:
 * 1. Prices (references products + price books)
 * 2. Price Books
 * 3. Products (simple + variants + bundles)
 * 4. Categories (optional)
 * 5. Metadata (product attributes)
 * 
 * Features:
 * - Smart detection (no hardcoded lists)
 * - Validation after deletion
 * - Zero orphaned data guarantee
 * 
 * Usage:
 *   npm run delete:aco                    # Delete using state tracker
 *   npm run delete:aco -- --scan          # Force scan ACO directly for orphans
 *   npm run delete:aco -- --dry-run       # Preview what would be deleted
 *   npm run delete:aco -- --reingest      # Delete and re-ingest all data
 * 
 * @module scripts/reset-all
 */

import { SmartDetector } from './lib/smart-detector.js';
import {
  deleteAllPricesForPriceBooks,
  deletePriceBooks,
  deleteProductsBySKUs,
  deleteMetadata
} from './lib/aco-delete.js';
import logger from '../shared/logger.js';
import { format, withProgress } from '../shared/format.js';
import { updateLine, finishLine } from '../shared/progress.js';
import chalk from 'chalk';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reingest = args.includes('--reingest');
const skipPrices = args.includes('--skip-prices');
const skipProducts = args.includes('--skip-products');
const skipValidation = args.includes('--skip-validation');
const forceScan = args.includes('--scan');

/**
 * Smart project detector
 * Replaces hardcoded lists with intelligent pattern matching
 */
const detector = new SmartDetector({ silent: true });

/**
 * Main reset workflow
 */
async function resetAll() {
  console.log('');
  console.log(format.muted(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`));
  console.log('');
  
  const results = {
    prices: null,
    priceBooks: null,
    products: null,
    metadata: null
  };
  
  try {
    // Use smart detection to find all project entities
    const { updateLine, finishLine} = await import('../shared/progress.js');
    
    // Find data (single line) - Use state tracker as source of truth, unless --scan is used
    updateLine('🔍 Finding project data...');
    
    // Get ALL SKUs from state tracker (records exactly what was ingested)
    // This includes both visible products AND invisible variants (visibleIn: [])
    // Note: We can't query ACO for invisible variants, but we can delete them by SKU
    const { getStateTracker } = await import('./lib/aco-state-tracker.js');
    
    const stateTracker = getStateTracker();
    await stateTracker.load();
    let skus = stateTracker.getAllProductSKUs();
    
    // Get price books from state tracker
    let priceBookIds = stateTracker.getPriceBooks();
    
    // Get metadata from state tracker
    let metadataCodes = stateTracker.getAllMetadataCodes();
    
    // If --scan flag is used OR state is empty, query ACO directly for orphaned products
    const stateIsEmpty = skus.length === 0 && priceBookIds.length === 0 && metadataCodes.length === 0;
    
    if (forceScan || stateIsEmpty) {
      if (forceScan) {
        logger.debug('--scan flag detected, querying ACO directly for all products');
      } else {
        logger.debug('State tracker is empty, querying ACO directly for orphaned products');
      }
      
      // Query ACO for all visible products (productSearch)
      const acoProducts = await detector.queryACOProductsDirect('', 500);
      const acoSKUs = acoProducts.map(p => p.sku);
      
      // Merge with state tracker SKUs (if any) and dedupe
      skus = [...new Set([...skus, ...acoSKUs])];
      
      logger.debug(`Found ${acoSKUs.length} products in ACO, ${skus.length} total after merge with state`);
    }
    
    // Check if there's anything to delete after both state and scan
    if (skus.length === 0 && priceBookIds.length === 0 && metadataCodes.length === 0) {
      updateLine(chalk.green('✔ No project data found'));
      finishLine();
      
      // Clear state tracker even when no data exists (in case of stale state)
      stateTracker.clearAll();
      
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
    
    updateLine(chalk.green(`✔ Found project data: ${foundItems.join(', ')}`));
    finishLine();
    
    // Step 1: Delete Prices (single line with spinner)
    if (!skipPrices && priceBookIds.length > 0) {
      results.prices = await deleteAllPricesForPriceBooks(priceBookIds, { skus, dryRun });
      if (results.prices.deleted > 0) {
        console.log(chalk.green(`✔ Deleted ${results.prices.deleted} prices`));
      }
      
      // Clear state immediately after successful deletion
      if (!dryRun && results.prices?.success) {
        stateTracker.clearPrices();
        await stateTracker.save();
      }
    }
    
    // Step 2: Delete Price Books (single line with spinner)
    if (!skipPrices && results.prices?.success && priceBookIds.length > 0) {
      results.priceBooks = await deletePriceBooks(priceBookIds, { dryRun });
      if (results.priceBooks.deleted > 0) {
        console.log(chalk.green(`✔ Deleted ${results.priceBooks.deleted} price books`));
      }
      
      // Clear state immediately after successful deletion
      if (!dryRun && results.priceBooks?.success) {
        stateTracker.clearPriceBooks();
        await stateTracker.save();
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
        
        deleteResult.actualDeleted = confirmedDeleted;
        deleteResult.pollingCompleted = pollingCompletedSuccessfully;
      } else {
        updateLine(chalk.green(`✔ Deleting products (${deleteResult.deleted} deleted)`));
        finishLine();
      }
      
      results.products = deleteResult;
      
      // Clear state tracker immediately after successful product deletion
      // (Don't wait for validation - that's checking for truly orphaned data)
      if (!dryRun && deleteResult.success) {
        stateTracker.clearProducts();
        await stateTracker.save();
      }
    }
    
    // Step 4: Delete Metadata (last, after all products are deleted)
    if (!skipProducts && metadataCodes.length > 0) {
      results.metadata = await deleteMetadata(metadataCodes, { dryRun });
      if (results.metadata.deleted > 0) {
        console.log(chalk.green(`✔ Deleted ${results.metadata.deleted} metadata attributes`));
      }
      
      // Clear state immediately after successful deletion
      if (!dryRun && results.metadata?.success) {
        stateTracker.clearMetadata();
        await stateTracker.save();
      }
    }
    
    // Validation: Ensure ACO is completely clean (with auto-cleanup of orphans)
    let validation = { clean: true, issues: [] };
    
    // Skip validation if polling already confirmed complete deletion
    // (Validation queries Live Search which has indexing lag causing false positives)
    const skipValidationDueToPolling = results.products?.pollingCompleted === true;
    
    if (skipValidationDueToPolling && !dryRun) {
      console.log(chalk.green('✔ Products deletion confirmed via polling (skipping validation)'));
    }
    
    if (!dryRun && !skipValidation && !skipValidationDueToPolling) {
      const maxRetries = 3;
      let retryCount = 0;
      
      while (retryCount < maxRetries) {
        updateLine('🔍 Validating deletion...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        validation = await detector.validateACOClean(skus);
        
        if (validation.clean) {
          // Success!
          updateLine('✔ Validating deletion (no orphaned data)');
          finishLine();
          break;
        }
        
        // Orphaned data detected - auto-cleanup
        finishLine();
        console.log('');
        console.log(format.warning(`Found orphaned data (attempt ${retryCount + 1}/${maxRetries}), cleaning up...`));
        validation.issues.forEach(issue => console.log(format.muted(`  • ${issue}`)));
        console.log('');
        
        // Find orphaned products (both expected SKUs and unknown orphans)
        // 1. Check our expected SKUs first
        const knownOrphans = await detector.queryACOProductsBySKUs(skus);
        
        // 2. Query for any unknown visible orphans using auto-detected pattern
        const pattern = detector.buildSkuPattern(detector.extractSkuPrefixes(skus));
        
        let patternMatchedOrphans = [];
        if (pattern) {
          const unknownOrphans = await detector.queryACOProductsDirect('', 500);
          patternMatchedOrphans = unknownOrphans.filter(p => pattern.test(p.sku));
        }
        
        // Combine and dedupe
        const allOrphanSkus = [...new Set([
          ...knownOrphans.map(p => p.sku),
          ...patternMatchedOrphans.map(p => p.sku)
        ])];
        
        if (allOrphanSkus.length > 0) {
          console.log(`  Deleting ${allOrphanSkus.length} orphaned products (${knownOrphans.length} expected, ${patternMatchedOrphans.length} unknown)...`);
          await deleteProductsBySKUs(allOrphanSkus, { dryRun, silent: true });
          
          // Poll for cleanup completion
          const { PollingProgress } = await import('../shared/progress.js');
          const progress = new PollingProgress('Cleaning up orphans', allOrphanSkus.length);
          
          let attempt = 0;
          let cleanupStarted = false;
          let remainingOrphanSkus = [...allOrphanSkus];
          let confirmedOrphansDeleted = 0;
          const maxAttempts = 60; // 10 minutes max (matching main deletion)
          
          // Helper: Check SKUs in batches (without progress updates during batching)
          const checkOrphansInBatches = async (skusToCheck) => {
            const BATCH_SIZE = 50;
            const stillRemaining = [];
            
            for (let i = 0; i < skusToCheck.length; i += BATCH_SIZE) {
              const batch = skusToCheck.slice(i, i + BATCH_SIZE);
              const batchRemaining = await detector.queryACOProductsBySKUs(batch, true);
              stillRemaining.push(...batchRemaining);
            }
            
            return stillRemaining;
          };
          
          while (attempt < maxAttempts && remainingOrphanSkus.length > 0) {
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
            const stillRemaining = await checkOrphansInBatches(remainingOrphanSkus);
            const previousRemaining = remainingOrphanSkus.length;
            remainingOrphanSkus = stillRemaining.map(p => p.sku);
            
            // Update confirmed deleted count and progress (once per poll)
            confirmedOrphansDeleted = allOrphanSkus.length - remainingOrphanSkus.length;
            
            // Detect when cleanup starts
            if (!cleanupStarted && remainingOrphanSkus.length < previousRemaining) {
              cleanupStarted = true;
            }
            
            // Update progress bar once per poll
            progress.update(confirmedOrphansDeleted, attempt, maxAttempts);
            
            if (remainingOrphanSkus.length === 0) {
              progress.finish(allOrphanSkus.length, true, `Deleted ${allOrphanSkus.length} orphaned products`);
              break;
            }
          }
        }
        
        retryCount++;
      }
      
      // Final check
      if (!validation.clean) {
        console.log('');
        console.log(format.error('Unable to clean all orphaned data after 3 attempts'));
        validation.issues.forEach(issue => console.log(format.error(`  • ${issue}`)));
        console.log('');
        
        return {
          success: false,
          results,
          validation
        };
      }
      
      // State was already cleared immediately after each successful deletion
    }
    
    // Summary
    console.log('');
    
    const allSuccess = Object.values(results)
      .filter(r => r !== null)
      .every(r => r.success !== false);
    
    // Validation is considered passed if:
    // - It ran and passed (validation.clean === true)
    // - It was skipped due to successful polling (skipValidationDueToPolling === true)
    const validationPassed = validation.clean || skipValidationDueToPolling;
    const overallSuccess = allSuccess && validationPassed;
    
    if (overallSuccess && !dryRun) {
      console.log(format.success('Data deletion complete!'));
      if (reingest) {
        console.log('');
        console.log(format.muted('Re-ingesting all data...'));
        const { execSync } = await import('child_process');
        execSync('node scripts/ingest-all.js', {
          stdio: 'inherit',
          cwd: process.cwd()
        });
      }
    } else if (dryRun) {
      console.log(format.muted('Dry run complete - no data was deleted'));
    } else if (!validationPassed) {
      console.log(format.error('Validation failed - orphaned data detected'));
    } else {
      console.log(format.warning('Some steps failed - check logs above'));
    }
    
    console.log('');
    
    return { success: overallSuccess, results, validation };
    
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

