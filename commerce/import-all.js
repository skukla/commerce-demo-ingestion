#!/usr/bin/env node

/**
 * Import All Data to Commerce
 * Orchestrates the complete import process in dependency order
 *
 * Order:
 * 0. Stores (website, store group, store view, root category)
 * 1. Customer Groups (required for tier pricing)
 * 2. Product Attributes (required before products)
 * 3. Categories (required before products)
 * 3.5. Shared Catalog Categories (assigns categories to public B2B catalog for ACO)
 * 4. Simple Products (with tier pricing)
 * 5. Product Images (optional, requires products)
 * 6. Customer Attributes (required before customers with ACO context)
 * 7. Demo Customers (requires customer groups + customer attributes)
 */

import ora from 'ora';
import chalk from 'chalk';
import { resolve } from 'path';
import { commerceApi, logger, resolveWebsiteId } from './lib/commerce-api.js';
import { COMMERCE_CONFIG, DATA_REPO_PATH } from '../shared/config-loader.js';
import { formatDuration } from '../shared/base-importer.js';
import { format, withSpinner, updateLine, finishLine } from '../shared/format.js';
import { importStores } from './importers/stores.js';
import { importCustomerGroups } from './importers/customer-groups.js';
import { importAttributes } from './importers/attributes.js';
import { importCategories } from './importers/categories.js';
import { assignSharedCatalogCategories } from './importers/shared-catalog.js';
import { importProducts } from './importers/products.js';
import { importImages } from './importers/images.js';
import { importCustomerAttributes } from './importers/customer-attributes.js';
import { importCustomers } from './importers/customers.js';
import { getStateTracker } from './lib/state-tracker.js';
import { 
  runValidation,
  checkDatapackExists,
  checkProductCount,
  checkAttributeDefinitions,
  checkCommerceConnectivity,
  checkCommerceProductCount,
  checkStateConsistency
} from '../shared/validation-checkpoint.js';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const skipImages = args.includes('--skip-images');
const skipCustomers = args.includes('--skip-customers');
const verbose = args.includes('--verbose') || args.includes('-v');

// Apply configuration
if (isDryRun) {
  process.env.DRY_RUN = 'true';
  COMMERCE_CONFIG.dryRun = true;
}
if (verbose) {
  COMMERCE_CONFIG.verbose = true;
}

/**
 * Test Commerce API connection
 */
async function testConnection() {
  if (COMMERCE_CONFIG.dryRun) {
    console.log('[DRY RUN] Skipping connection test');
    return true;
  }
  
  const connected = await withSpinner('Testing Commerce API connection...', async () => {
    return await commerceApi.testConnection();
  });
  
  if (!connected) {
    console.log(format.error('Failed to connect to Commerce API'));
    return false;
  }
  console.log(chalk.green('✔ Testing Commerce API connection'));
  return true;
}

/**
 * Execute an import step with single-line updates
 */
async function executeImportStep(stepName, importFn, options = {}) {
  const { context = {}, showProgress = false } = options;
  
  updateLine(`📦 Importing ${stepName.toLowerCase()}...`);
  
  // Add silent flag to context to suppress verbose logs
  const contextWithSilent = { ...context, silent: true };
  
  const result = await importFn(contextWithSilent);
  
  // Extract counts from result
  const created = result?.results?.created?.length || result?.created || 0;
  const existing = result?.results?.existing?.length || result?.existing || 0;
  const failed = result?.results?.failed?.length || result?.failed || 0;
  const skipped = result?.results?.skipped?.length || result?.skipped || 0;
  const duration = result?.results?.durationSeconds || result?.duration || 0;
  
  // Format message based on whether there were failures or skipped items
  let message;
  if (failed > 0) {
    message = `⚠ Importing ${stepName.toLowerCase()} (${created} created, ${existing} existing, ${failed} failed`;
    if (skipped > 0) message += `, ${skipped} skipped`;
    if (duration > 5) {
      message += ` in ${formatDuration(duration)}`;
    }
    message += ')';
    updateLine(chalk.yellow(message));
  } else if (skipped > 0) {
    message = `⚠ Importing ${stepName.toLowerCase()} (${created} created, ${existing} existing, ${skipped} skipped`;
    if (duration > 5) {
      message += ` in ${formatDuration(duration)}`;
    }
    message += ')';
    updateLine(chalk.yellow(message));
  } else {
    message = `✔ Importing ${stepName.toLowerCase()} (${created} created, ${existing} existing`;
    if (duration > 5) {
      message += ` in ${formatDuration(duration)}`;
    }
    message += ')';
    updateLine(chalk.green(message));
  }
  finishLine();
  
  // Log failed items if any
  if (failed > 0 && result?.results?.failed) {
    result.results.failed.forEach(item => {
      console.log(chalk.yellow(`  ⚠ Failed: ${item.sku || item.code} - ${item.error || item.reason || 'Unknown error'}`));
    });
  }
  
  // Log skipped items if any
  if (skipped > 0 && result?.results?.skipped) {
    result.results.skipped.forEach(item => {
      console.log(chalk.gray(`  ℹ Skipped: ${item.sku || item.code} - ${item.reason || 'Skipped'}`));
    });
  }
  
  return {
    created,
    existing,
    failed,
    skipped,
    duration,
    ...result // Include full result for downstream use
  };
}

/**
 * Main import orchestrator
 */
async function importAll() {
  const startTime = Date.now();
  const stateTracker = getStateTracker();
  
  console.log('');
  console.log(format.muted(`Mode: ${COMMERCE_CONFIG.dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`));
  console.log(format.muted(`Target: ${COMMERCE_CONFIG.baseUrl}`));
  console.log('');
  
  // Pre-import validation
  const datapackPath = resolve(DATA_REPO_PATH, 'generated/commerce/data/accs');
  const preValidation = await withSpinner('Pre-import validation...', async () => {
    return await runValidation('Pre-Import Validation', [
      checkDatapackExists(resolve(datapackPath, 'accs_products.json')),
      checkProductCount(resolve(datapackPath, 'accs_products.json'), 1, 500),
      checkAttributeDefinitions(resolve(datapackPath, 'accs_product_attributes.json')),
      checkCommerceConnectivity(commerceApi)
    ], { stopOnFailure: true, silent: true });
  });
  
  if (!preValidation.passed) {
    console.log(format.error('Pre-import validation failed. Aborting import.'));
    return { success: false, error: 'Pre-import validation failed' };
  }
  console.log(chalk.green('✔ Pre-import validation passed'));
  
  // Results storage
  const results = {
    stores: null,
    customerGroups: null,
    attributes: null,
    categories: null,
    sharedCatalog: null,
    products: null,
    images: null,
    customerAttributes: null,
    customers: null
  };
  
  // Context data passed between steps
  let storeIds = {};
  let customerGroupIds = {};
  let categoryMap = {};
  let productSkuMap = {};
  let attributeOptionMap = {};
  
  const totalSteps = 8; // Reduced from 9 (removed bundles)

try {
    // Step 0: Stores (CRITICAL - must succeed or abort)
    let storesResult;
    try {
      storesResult = await executeImportStep('stores', importStores, { context: {} });
      results.stores = storesResult;
      storeIds = storesResult.storeIds || {};
    } catch (error) {
      // Store import failure is critical - website structure must exist
      console.log('');
      console.log(chalk.red.bold('✖ Import aborted: Website structure not found'));
      console.log('');
      throw error;
    }
    
    // Step 1: Customer Groups
    const customerGroupsResult = await executeImportStep('customer groups', importCustomerGroups, { context: {} });
    results.customerGroups = customerGroupsResult;
    customerGroupIds = customerGroupsResult.groupIdMap || {};
    
    // Step 2: Product Attributes
    const attributesResult = await executeImportStep('product attributes', importAttributes, { context: {} });
    results.attributes = attributesResult;
    attributeOptionMap = attributesResult.attributeOptionMap || {};
    
    // Step 3: Categories
    const categoriesResult = await executeImportStep(
      'categories',
      importCategories,
      {
        context: { rootCategoryId: storeIds.rootCategoryId }
      }
    );
    results.categories = categoriesResult;
    categoryMap = categoriesResult.categoryMap || {};

    // Step 3.5: Assign categories to public shared catalog (B2B)
    // This ensures categories are visible in ACO Catalog Service
    const sharedCatalogResult = await executeImportStep(
      'shared catalog categories',
      assignSharedCatalogCategories,
      {
        context: { categoryMap }
      }
    );
    results.sharedCatalog = sharedCatalogResult;

    // Step 4: Simple Products
    // Resolve website ID if stores import didn't provide it
    let websiteIds = [];
    if (storeIds.websiteIds && storeIds.websiteIds.length > 0) {
      websiteIds = storeIds.websiteIds;
      logger.debug(`Using website IDs from stores import: ${websiteIds.join(', ')}`);
    } else {
      // Fallback: resolve website code to ID
      const websiteId = await resolveWebsiteId(COMMERCE_CONFIG.websiteCode);
      websiteIds = [websiteId];
    }
    
    const productsResult = await executeImportStep(
      'products', 
      importProducts, 
      { 
        context: {
          categoryMap,
          attributeOptionMap,
          websiteIds
        }
      }
    );
    results.products = productsResult;
    productSkuMap = productsResult.productSkuMap || {};
    
    // Step 5: Product Images
    if (skipImages) {
      updateLine('📦 Importing product images...');
      updateLine(chalk.green('✔ Importing product images (skipped)'));
      finishLine();
      results.images = { results: { skipped: true } };
    } else {
      const productSkus = Object.values(productSkuMap).flatMap(obj => Object.values(obj));
      const imagesResult = await executeImportStep(
        'product images', 
        importImages, 
        { 
          context: {
            productSkus,
            storeScope: 'all'
          }
        }
      );
      results.images = imagesResult;
    }
    
    // Step 6: Customer Attributes (for ACO persona context)
    if (skipCustomers) {
      updateLine('📦 Importing customer attributes...');
      updateLine(chalk.green('✔ Importing customer attributes (skipped)'));
      finishLine();
      results.customerAttributes = { results: { skipped: true } };
    } else {
      const customerAttrsResult = await executeImportStep('customer attributes', importCustomerAttributes, { context: {} });
      results.customerAttributes = customerAttrsResult;
    }
    
    // Step 7: Demo Customers
    if (skipCustomers) {
      updateLine('📦 Importing demo customers...');
      updateLine(chalk.green('✔ Importing demo customers (skipped)'));
      finishLine();
      results.customers = { results: { skipped: true } };
    } else {
      const customersResult = await executeImportStep(
        'demo customers', 
        importCustomers, 
        { 
          context: {
            customerGroupIds,
            websiteIds: storeIds.websiteId ? [storeIds.websiteId] : [],
            storeId: storeIds.storeViewId
          }
        }
      );
      results.customers = customersResult;
    }
    
  } catch (error) {
    console.log('');
    console.log(format.error(`Import process failed: ${error.message}`));
    return { success: false, error: error.message, results };
  }
  
  // Post-import validation
  if (!COMMERCE_CONFIG.dryRun) {
    const postValidation = await withSpinner('Post-import validation...', async () => {
      return await runValidation('Post-Import Validation', [
        checkCommerceProductCount(commerceApi, 1, 500, 'LBR%'),
        checkStateConsistency(commerceApi)
      ], { stopOnFailure: false, silent: true });
    });
    
    if (postValidation.passed) {
      console.log(chalk.green('✔ Post-import validation passed'));
    } else {
      console.log(chalk.yellow('⚠ Post-import validation had warnings'));
    }
  }
  
  // Save state
  stateTracker.saveState();
  
  console.log('');
  console.log(format.success('Data import complete!'));
  console.log('');
  
  return {
    success: true,
    results
  };
}

// CLI usage info
function printUsage() {
  console.log(`
Usage: npm run import:all [options]

Options:
  --dry-run        Simulate import without making changes
  --skip-images    Skip product image upload
  --skip-customers Skip demo customer creation
  --verbose, -v    Enable verbose logging

Examples:
  npm run import:all                    # Full import
  npm run import:all -- --dry-run       # Test run
  npm run import:all -- --skip-images   # Skip images
`);
}

// Handle --help
if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

// Run
importAll()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });

export { importAll };
