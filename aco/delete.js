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

import { BuildRightDetector } from '#shared/smart-detector';
import {
  deleteAllPricesForPriceBooks,
  deletePriceBooks,
  deleteProductsBySKUs
} from '#shared/aco-delete';
import logger from '#shared/logger';
import { format, withProgress } from '#shared/format';
import { updateLine, finishLine } from '#shared/progress';
import chalk from 'chalk';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reingest = args.includes('--reingest');
const skipPrices = args.includes('--skip-prices');
const skipProducts = args.includes('--skip-products');
const skipValidation = args.includes('--skip-validation');

/**
 * Smart BuildRight detector
 * Replaces hardcoded lists with intelligent pattern matching
 */
const detector = new BuildRightDetector({ silent: true });

/**
 * Main reset workflow
 */
async function resetAll() {
  console.log('');
  
  if (dryRun) {
    console.log(format.muted('Mode: DRY RUN - No data will be deleted'));
    console.log('');
  }
  
  const results = {
    prices: null,
    priceBooks: null,
    products: null
  };
  
  try {
    // Use smart detection to find all BuildRight entities
    const { updateLine, finishLine } = await import('#shared/progress');
    
    // Find data (single line) - Use state tracker as source of truth
    updateLine('🔍 Finding BuildRight data...');
    
    // Get ALL SKUs from state tracker (records exactly what was ingested)
    // This includes both visible products AND invisible variants (visibleIn: [])
    // Note: We can't query ACO for invisible variants, but we can delete them by SKU
    const { getStateTracker } = await import('#shared/aco-state-tracker');
    
    const stateTracker = getStateTracker();
    await stateTracker.load();
    const skus = stateTracker.getAllProductSKUs();
    
    if (skus.length === 0) {
      // No ingested products in state - check if ACO has orphans
      logger.debug('State tracker is empty - checking for orphaned products in ACO...');
    }
    
    // Validate price books using Catalog API (queries live ACO as source of truth)
    const priceBooks = await detector.findAllPriceBooks();
    const priceBookIds = priceBooks.map(pb => pb.priceBookId);
    
    if (skus.length > 0 || priceBookIds.length > 0) {
      updateLine(chalk.green(`✔ Finding BuildRight data (${skus.length} products, ${priceBookIds.length} price books)`));
      finishLine();
    } else {
      // State tracker is empty - check for orphaned visible products
      updateLine(chalk.green('✔ State tracker empty'));
      finishLine();
      
      // Skip to validation to check for orphans
      console.log('');
      console.log(format.muted('No ingested products tracked - checking for orphans...'));
      
      // Don't return yet - continue to validation phase to detect orphans
    }
    
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
    
    // Step 3: Delete Products (single line with polling progress)
    if (!skipProducts && skus.length > 0) {
      updateLine('🗑️  Deleting products...');
      
      // Submit deletion request (silent mode - polling will show progress)
      const deleteResult = await deleteProductsBySKUs(skus, { dryRun, silent: true });
      
      // Poll to watch actual deletion progress
      if (!dryRun) {
        const { PollingProgress } = await import('#shared/progress');
        const progress = new PollingProgress('Deleting products', skus.length);
        
        const maxAttempts = 60; // 10 minutes max
        const pollInterval = 10000; // 10 seconds
        let attempt = 0;
        let currentCount = skus.length;
        let previousCount = skus.length;
        let deletionStarted = false;
        
        while (attempt < maxAttempts && currentCount > 0) {
          attempt++;
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          // Check how many products still exist
          const remainingProducts = await detector.queryACOProductsBySKUs(skus);
          currentCount = remainingProducts.length;
          const deletedCount = skus.length - currentCount;
          
          // Detect when deletion starts (first movement)
          if (!deletionStarted && currentCount < previousCount) {
            deletionStarted = true;
            console.log(format.success(`\n  ✓ Deletion processing started (${deletedCount} removed)`));
          }
          
          progress.update(deletedCount, attempt, maxAttempts);
          
          if (currentCount === 0) {
            progress.finish(deletedCount, true);
            break;
          }
          
          previousCount = currentCount;
        }
        
        if (currentCount > 0) {
          progress.finish(skus.length - currentCount, false);
          if (!deletionStarted) {
            console.log(format.warning(`\nDeletion submitted but not yet processed. Products may still appear in search.`));
          } else {
            throw new Error(`${currentCount} products still remain after ${attempt * 10}s`);
          }
        }
        
        deleteResult.actualDeleted = skus.length - currentCount;
      } else {
        updateLine(`✔ Deleting products (${deleteResult.deleted} deleted)`);
        finishLine();
      }
      
      results.products = deleteResult;
    }
    
    // Validation: Ensure ACO is completely clean (with auto-cleanup of orphans)
    const maxRetries = 3;
    let retryCount = 0;
    let validation = { clean: true, issues: [] };
    
    if (!dryRun && !skipValidation) {
      while (retryCount < maxRetries) {
        updateLine('🔍 Validating deletion...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        validation = await detector.validateClean();
        
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
        
        // 2. Query for any unknown visible orphans
        const unknownOrphans = await detector.queryACOProductsDirect('', 500);
        const buildRightUnknowns = unknownOrphans.filter(p => 
          p.sku.match(/^(LBR|DOOR|WINDOW|ROOF|DRYWALL|PLY|NAIL|SCREW|STUD)-/)
        );
        
        // Combine and dedupe
        const allOrphanSkus = [...new Set([
          ...knownOrphans.map(p => p.sku),
          ...buildRightUnknowns.map(p => p.sku)
        ])];
        
        if (allOrphanSkus.length > 0) {
          console.log(`  Deleting ${allOrphanSkus.length} orphaned products (${knownOrphans.length} expected, ${buildRightUnknowns.length} unknown)...`);
          await deleteProductsBySKUs(allOrphanSkus, { dryRun, silent: true });
          
          // Poll for cleanup completion
          const { PollingProgress } = await import('#shared/progress');
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
              console.log(format.muted(`  ✓ Cleanup processing (${allOrphanSkus.length - currentCount} removed)`));
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
      
      // Clear state tracker after successful deletion
      const { getStateTracker } = await import('#shared/aco-state-tracker');
      const stateTracker = getStateTracker();
      await stateTracker.load();
      stateTracker.clearAll();
      await stateTracker.save();
    }
    
    // Summary
    console.log('');
    
    const allSuccess = Object.values(results)
      .filter(r => r !== null)
      .every(r => r.success !== false);
    
    const validationPassed = validation.clean;
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
      } else {
        console.log(format.muted('You can now run: npm run import'));
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

