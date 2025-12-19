#!/usr/bin/env node
/**
 * ACO Data Import - Clean Orchestrator
 * Ultra-clean, single-line updates matching Commerce and kukla-integration-service style
 */

import { updateLine, finishLine } from '../shared/progress.js';
import { format } from '../shared/format.js';
import { formatDuration } from './lib/aco-ingest-helpers.js';
import { COMMERCE_CONFIG, DATA_REPO_PATH } from '../shared/config-loader.js';
import { loadJSON } from './lib/aco-helpers.js';
import chalk from 'chalk';

// Import ingestion functions
import { ingestCategories } from './importers/categories.js';
import { ingestMetadata } from './importers/metadata.js';
import { ingestProducts } from './importers/products.js';
import { ingestVariants } from './importers/variants.js';
import { ingestPriceBooks } from './importers/price-books.js';
import { ingestPrices } from './importers/prices.js';
import { getStateTracker } from './lib/aco-state-tracker.js';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

/**
 * Execute an ingestion step with single-line updates
 */
async function executeIngestionStep(stepName, ingestFn, options = {}) {
  const { context = {} } = options;
  
  updateLine(`📦 Ingesting ${stepName.toLowerCase()}...`);
  
  // Add silent flag to context to suppress verbose logs
  // Progress bars will still show as they write directly to console
  const contextWithSilent = { ...context, silent: true, dryRun };
  
  const result = await ingestFn(contextWithSilent);
  
  // Extract counts from result
  const created = result?.created || result?.results?.created?.length || 0;
  const existing = result?.existing || result?.results?.existing?.length || 0;
  const duration = result?.duration || result?.results?.durationSeconds || 0;
  
  // Format success message
  let message = `✔ Ingesting ${stepName.toLowerCase()} (${created} created, ${existing} existing`;
  if (duration > 5) {
    message += ` in ${formatDuration(duration)}`;
  }
  message += ')';
  
  updateLine(chalk.green(message));
  finishLine();
  
  return {
    success: result?.success !== false,
    created,
    existing,
    duration,
    ...result
  };
}

/**
 * Main ingestion workflow
 */
async function ingestAll() {
  const startTime = Date.now();
  
  const acoTarget = `ACO ${COMMERCE_CONFIG.aco.region}/${COMMERCE_CONFIG.aco.environment} (${COMMERCE_CONFIG.aco.tenantId})`;
  
  console.log('');
  console.log(format.muted(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`));
  console.log(format.muted(`Target: ${acoTarget}`));
  console.log('');
  
  // Clear state tracker to ensure fresh ingestion (silent)
  if (!dryRun) {
    try {
      const stateTracker = getStateTracker();
      await stateTracker.load();
      const productCount = stateTracker.getProductCount();
      
      if (productCount > 0) {
        stateTracker.clearAll();
        await stateTracker.save();
      }
    } catch (error) {
      // Non-critical, continue
    }
  }
  
  const results = {};
  
  try {
    // Step 1: Categories (must be before products since products reference them)
    results.categories = await executeIngestionStep('categories', ingestCategories, { context: {} });
    if (!results.categories.success) {
      console.log('');
      console.log(format.error('Category ingestion failed - aborting workflow'));
      return { success: false, results };
    }
    
    // Step 2: Metadata
    results.metadata = await executeIngestionStep('metadata', ingestMetadata, { context: {} });
    if (!results.metadata.success) {
      console.log('');
      console.log(format.error('Metadata ingestion failed - aborting workflow'));
      return { success: false, results };
    }
    
    // Step 3: Products
    results.products = await executeIngestionStep('products', ingestProducts, { context: {} });
    if (!results.products.success) {
      console.log('');
      console.log(format.error('Product ingestion failed - aborting workflow'));
      return { success: false, results };
    }
    
    // Step 4: Variants (import visible, verify, toggle to invisible)
    // Note: Variants must be generated as visible (default behavior in generator)
    results.variants = await executeIngestionStep('variants', ingestVariants, { context: {} });
    
    // Step 5: Price Books
    results.priceBooks = await executeIngestionStep('price books', ingestPriceBooks, { context: {} });
    
    // Step 6: Prices
    if (results.priceBooks.success) {
      results.prices = await executeIngestionStep('prices', ingestPrices, { context: { skipValidation: true } });
    }
    
  } catch (error) {
    console.log('');
    console.log(format.error(`Ingestion process failed: ${error.message}`));
    return { success: false, error: error.message, results };
  }
  
  // Final verification: Poll until both Catalog Service and Live Search have the expected counts
  const totalExpected = (results.products?.created || 0) + (results.variants?.created || 0);
  if (totalExpected > 0) {
    console.log('');
    console.log(chalk.blue.bold('📊 Verifying catalog indexing...'));
    
    const { SmartDetector } = await import('./lib/smart-detector.js');
    const { PollingProgress } = await import('../shared/progress.js');
    const detector = new SmartDetector(COMMERCE_CONFIG);
    
    // Load product and variant SKUs for verification
    const products = await loadJSON('products.json', DATA_REPO_PATH, 'products');
    const variants = await loadJSON('variants.json', DATA_REPO_PATH, 'variants');
    const allSkus = [...products.map(p => p.sku), ...variants.map(v => v.sku)];
    
    // Phase 1: Poll Catalog Service until all records are indexed
    const catalogProgress = new PollingProgress('Catalog Service', totalExpected);
    const maxAttempts = 60; // 10 minutes max (10 second intervals)
    const pollInterval = 10000;
    let catalogVerified = false;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const catalogCount = await detector.getCatalogCount(allSkus);
      catalogVerified = catalogCount === totalExpected;
      
      catalogProgress.update(catalogCount, attempt, maxAttempts);
      
      if (catalogVerified) {
        catalogProgress.finish(catalogCount, true);
        break;
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    if (!catalogVerified) {
      catalogProgress.finish(0, false);
      console.log(chalk.yellow('⚠️  Catalog Service indexing incomplete (still processing)'));
      console.log('   Data is ingested but may take a few more minutes to be fully searchable.');
    }
    
    // Phase 2: Poll Live Search (only if Catalog succeeded)
    let liveSearchVerified = false;
    if (catalogVerified) {
      const liveSearchProgress = new PollingProgress('Live Search', totalExpected);
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const liveSearchCount = await detector.getLiveSearchCount();
        liveSearchVerified = liveSearchCount === totalExpected;
        
        liveSearchProgress.update(liveSearchCount, attempt, maxAttempts);
        
        if (liveSearchVerified) {
          liveSearchProgress.finish(liveSearchCount, true);
          break;
        }
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }
      
      if (!liveSearchVerified) {
        liveSearchProgress.finish(0, false);
        console.log(chalk.yellow('⚠️  Live Search indexing incomplete (still processing)'));
        console.log('   Products are in Catalog but may take a few more minutes to be searchable.');
      }
    }
    
    console.log('');
    
    // Toggle variant visibility after verification (make them invisible)
    if (results.variants && results.variants.created > 0 && catalogVerified && liveSearchVerified) {
      updateLine('🔄 Setting variant visibility to invisible...');
      
      const { getACOClient } = await import('./lib/aco-client.js');
      const client = getACOClient();
      
      const variantsToUpdate = variants.map(v => ({
        sku: v.sku,
        source: { locale: 'en-US' },
        visibleIn: [] // Make invisible
      }));
      
      try {
        await client.updateProducts(variantsToUpdate);
        updateLine(chalk.green(`✔ Set ${variants.length} ${variants.length === 1 ? 'variant' : 'variants'} to invisible`));
        finishLine();
      } catch (error) {
        updateLine(chalk.red(`✖ Failed to toggle variant visibility: ${error.message}`));
        finishLine();
      }
    }
  }
  
  console.log('');
  console.log(format.success('Data import complete!'));
  console.log('');
  
  return { success: true, results };
}

// Run
ingestAll()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.log('');
    console.log(format.error(`Fatal error: ${error.message}`));
    process.exit(1);
  });
