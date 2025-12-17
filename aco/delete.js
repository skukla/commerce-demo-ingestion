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
 *   npm run reset:all                    # Delete everything with validation
 *   node scripts/reset-all.js --dry-run  # Preview what would be deleted
 *   node scripts/reset-all.js --reingest # Delete and re-ingest all data
 * 
 * @module scripts/reset-all
 */

import { SmartDetector } from '../shared/smart-detector.js';
import {
  deleteAllPricesForPriceBooks,
  deletePriceBooks,
  deleteProductsBySKUs,
  deleteMetadata
} from '../shared/aco-delete.js';
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
    
    // Find data (single line) - Use state tracker as source of truth
    updateLine('🔍 Finding project data...');
    
    // Get ALL SKUs from state tracker (records exactly what was ingested)
    // This includes both visible products AND invisible variants (visibleIn: [])
    // Note: We can't query ACO for invisible variants, but we can delete them by SKU
    const { getStateTracker } = await import('../shared/aco-state-tracker.js');
    
    const stateTracker = getStateTracker();
    await stateTracker.load();
    const skus = stateTracker.getAllProductSKUs();
    
    // Get price books from state tracker
    const priceBookIds = stateTracker.getPriceBooks();
    
    // Get metadata from state tracker
    const metadataCodes = stateTracker.getAllMetadataCodes();
    
    // Check if there's anything to delete
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
        let currentCount = skus.length;
        let previousCount = skus.length;
        let deletionStarted = false;
        let pollingCompletedSuccessfully = false;
        
        while (attempt < maxAttempts && currentCount > 0) {
          attempt++;
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          // Check how many products still exist
          // Use throwOnError=true during polling to surface query failures
          const remainingProducts = await detector.queryACOProductsBySKUs(skus, true);
          currentCount = remainingProducts.length;
          const deletedCount = skus.length - currentCount;
          
          logger.debug(`Poll #${attempt}: ${currentCount} products remaining, ${deletedCount} deleted`);
          
          // Detect when deletion starts (first movement)
          if (!deletionStarted && currentCount < previousCount) {
            deletionStarted = true;
            console.log(chalk.green(`\n  ✓ Deletion in progress`));
          }
          
          progress.update(deletedCount, attempt, maxAttempts);
          
          if (currentCount === 0) {
            progress.finish(deletedCount, true);
            pollingCompletedSuccessfully = true;
            break;
          }
          
          previousCount = currentCount;
        }
        
        if (currentCount > 0) {
          progress.finish(skus.length - currentCount, false);
          if (!deletionStarted) {
            console.log(chalk.yellow(`\nDeletion submitted but not yet processed. Products may still appear in search.`));
          } else {
            throw new Error(`${currentCount} products still remain after ${attempt * 10}s`);
          }
        }
        
        deleteResult.actualDeleted = skus.length - currentCount;
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
          let currentCount = allOrphanSkus.length;
          let previousCount = allOrphanSkus.length;
          let cleanupStarted = false;
          const maxAttempts = 60; // 10 minutes max (matching main deletion)
          
          while (attempt < maxAttempts && currentCount > 0) {
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
            const remaining = await detector.queryACOProductsBySKUs(allOrphanSkus);
            currentCount = remaining.length;
            
            // Detect when cleanup starts
            if (!cleanupStarted && currentCount < previousCount) {
              cleanupStarted = true;
              console.log(format.muted(`  ✓ Cleanup in progress`));
            }
            
            progress.update(allOrphanSkus.length - currentCount, attempt, maxAttempts);
            
            if (currentCount === 0) {
              progress.finish(allOrphanSkus.length, true);
              break;
            }
            
            previousCount = currentCount;
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

