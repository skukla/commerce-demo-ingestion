#!/usr/bin/env node
/**
 * ACO Data Import - Clean Orchestrator
 * Ultra-clean, single-line updates matching Commerce and kukla-integration-service style
 */

import { updateLine, finishLine } from '../shared/progress.js';
import { format } from '../shared/format.js';
import { formatDuration } from '../shared/aco-ingest-helpers.js';

// Import ingestion functions
import { ingestMetadata } from './attributes/ingest-metadata.js';
import { ingestProducts } from './products/ingest-products.js';
import { ingestVariants } from './products/ingest-variants.js';
import { ingestPriceBooks } from './prices/ingest-price-books.js';
import { ingestPrices } from './prices/ingest-prices.js';
import { getStateTracker } from '../shared/aco-state-tracker.js';

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
  
  updateLine(message);
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
  
  console.log('');
  console.log(format.muted(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`));
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
    // Step 1: Metadata
    results.metadata = await executeIngestionStep('metadata', ingestMetadata, { context: {} });
    if (!results.metadata.success) {
      console.log('');
      console.log(format.error('Metadata ingestion failed - aborting workflow'));
      return { success: false, results };
    }
    
    // Step 2: Products
    results.products = await executeIngestionStep('products', ingestProducts, { context: {} });
    if (!results.products.success) {
      console.log('');
      console.log(format.error('Product ingestion failed - aborting workflow'));
      return { success: false, results };
    }
    
    // Step 3: Variants
    results.variants = await executeIngestionStep('variants', ingestVariants, { context: {} });
    
    // Step 4: Price Books
    results.priceBooks = await executeIngestionStep('price books', ingestPriceBooks, { context: {} });
    
    // Step 5: Prices
    if (results.priceBooks.success) {
      results.prices = await executeIngestionStep('prices', ingestPrices, { context: { skipValidation: true } });
    }
    
  } catch (error) {
    console.log('');
    console.log(format.error(`Ingestion process failed: ${error.message}`));
    return { success: false, error: error.message, results };
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
