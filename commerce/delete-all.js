#!/usr/bin/env node

/**
 * Delete BuildRight Data from Commerce
 * Removes ALL BuildRight data for a clean re-import
 * 
 * Deletion order (reverse of import order):
 * 8. Demo Customers
 * 7. Customer Attributes (ACO context: aco_catalog_view_id, aco_price_book_id)
 * 6. Bundle Products
 * 5. Product Images (deleted with products)
 * 4. Simple Products (including configurables)
 * 3. Categories
 * 2. Product Attributes (42 custom attributes)
 * 1. Customer Groups (4 BuildRight groups)
 * 0. Stores (BuildRight website/store/view)
 * 
 * Usage:
 *   npm run delete:data                    # Delete products and bundles only (safe)
 *   npm run delete:data -- --all           # Delete everything except stores
 *   npm run delete:data -- --full          # Delete EVERYTHING including stores
 *   npm run delete:data -- --dry-run       # Preview what would be deleted
 *   npm run delete:data -- --yes           # Skip confirmation prompt
 *   npm run delete:data -- --concurrency=N # Set parallel processing limit
 */

import chalk from 'chalk';
import { commerceApi, logger } from '#shared/commerce-api';
import { COMMERCE_CONFIG } from '#config/commerce-config';
import { formatDuration, BaseImporter } from '#shared/base-importer';
import { getStateTracker } from '#shared/state-tracker';
import SmartDetector from '#shared/smart-detector';
import { format, withSpinner, updateLine, finishLine } from '#shared/format';

const DEFAULT_CONCURRENCY = 5;
const ATTRIBUTE_CONCURRENCY = 10;
const CATEGORY_BATCH_SIZE = 10;

const detector = new SmartDetector({ silent: true });
const helper = new BaseImporter('Delete Helper', { silent: true });

// Parse arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const deleteFull = args.includes('--full'); // Delete EVERYTHING including stores
const deleteAll = args.includes('--all') || deleteFull; // Delete all data except stores
const deleteCategories = args.includes('--categories') || deleteAll;
const deleteAttributes = args.includes('--attributes') || deleteAll;
const deleteCustomerGroups = args.includes('--customer-groups') || deleteAll;
const deleteCustomers = args.includes('--customers') || deleteAll;
const deleteCustomerAttrs = args.includes('--customer-attributes') || deleteAll;
const deleteStores = deleteFull;
const skipConfirm = args.includes('--yes') || args.includes('-y');
const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1]) : DEFAULT_CONCURRENCY;

if (isDryRun) {
  process.env.DRY_RUN = 'true';
  COMMERCE_CONFIG.dryRun = true;
}

/**
 * Find project products using smart detection
 * Always queries Commerce to ensure we're deleting what's actually there
 */
async function findProjectProducts() {
  const result = await detector.findAllProducts();
  return result.skus;
}

/**
 * Delete products by SKU using parallel processing
 */
async function deleteProducts(skus) {
  if (skus.length === 0) {
    return { deleted: 0, failed: 0 };
  }
  
  return await deleteProductsParallel(skus);
}

/**
 * Delete products using bulk API (for large deletes)
 */
async function deleteProductsBulk(skus) {
  logger.info(`\n🗑️  Using BULK API to delete ${skus.length} products...`);
  
  if (isDryRun) {
    logger.info('[DRY RUN] Would use bulk API to delete products');
    return { deleted: skus.length, failed: 0 };
  }
  
  try {
    const bulkApi = createBulkApi();
    const result = await bulkApi.bulkDeleteProducts(skus);
    
    // Count successes and failures
    let deleted = 0;
    let failed = 0;
    
    for (const op of result.operations) {
      if (op.status === 'complete') {
        deleted += op.skuCount || 0;
      } else if (op.status === 'partial') {
        const opSuccesses = op.operations_list?.filter(o => o.status === 'complete').length || 0;
        deleted += opSuccesses;
        failed += (op.skuCount || 0) - opSuccesses;
      } else {
        failed += op.skuCount || 0;
      }
    }
    
    logger.info(`✔ Bulk delete complete: ${deleted} deleted, ${failed} failed`);
    
    return { deleted, failed };
    
  } catch (error) {
    logger.error(`Bulk delete failed: ${error.message}`);
    logger.info('Falling back to parallel processing...');
    return await deleteProductsParallel(skus);
  }
}

async function deleteProductsParallel(skus) {
  let deleted = 0;
  let failed = 0;
  const failureDetails = [];
  
  if (isDryRun) {
    return { deleted: skus.length, failed: 0 };
  }
  
  updateLine('🗑️  Deleting products...');
  
  await helper.processWithProgress(
    skus,
    async (sku) => {
      try {
        await commerceApi.deleteProduct(sku);
        deleted++;
      } catch (error) {
        // Treat "No such entity" as success (product already deleted)
        if (error.message?.includes('No such entity')) {
          logger.debug(`Product ${sku} already deleted`);
          deleted++;
        } else {
          logger.debug(`  Failed to delete ${sku}: ${error.message}`);
          failureDetails.push({ sku, error: error.message });
          failed++;
        }
      }
    },
    { concurrency, label: 'products' }
  );
  
  if (failureDetails.length > 0 && failureDetails.length <= 5) {
    console.log(chalk.yellow(`⚠ ${failureDetails.length} product deletion(s) failed:`));
    failureDetails.forEach(({ sku, error }) => {
      // Clean up Commerce's broken error message placeholders
      const cleanError = error
        .replace(/The "%1" product/, "Product")
        .replace(/couldn't be removed/, "couldn't be deleted");
      console.log(chalk.yellow(`  • ${sku}: ${cleanError}`));
    });
  } else if (failureDetails.length > 5) {
    console.log(chalk.yellow(`⚠ ${failureDetails.length} product deletions failed (showing first 5):`));
    failureDetails.slice(0, 5).forEach(({ sku, error }) => {
      const cleanError = error
        .replace(/The "%1" product/, "Product")
        .replace(/couldn't be removed/, "couldn't be deleted");
      console.log(chalk.yellow(`  • ${sku}: ${cleanError}`));
    });
  }
  
  return { deleted, failed, failureDetails };
}

/**
 * Delete project categories using smart detection
 */
async function deleteProjectCategories() {
  try {
    const categoryIds = await detector.findAllCategories();
    
    if (categoryIds.length === 0) {
      return { deleted: 0, failed: 0 };
    }
    
    logger.debug(`Found ${categoryIds.length} categories`);
    logger.debug(`First to delete: ${categoryIds[0]?.name} (ID: ${categoryIds[0]?.id})`);
    logger.debug(`Last to delete: ${categoryIds[categoryIds.length - 1]?.name} (ID: ${categoryIds[categoryIds.length - 1]?.id})`);
    
    let deleted = 0;
    let failed = 0;
    const failureDetails = [];
    
    updateLine('🗑️  Deleting categories...');
    
    await helper.processWithProgress(
      categoryIds,
      async ({ id, name }) => {
        try {
          if (isDryRun) {
            deleted++;
          } else {
            logger.debug(`Attempting to delete category: ${name} (ID: ${id})`);
            await commerceApi.deleteCategory(id);
            deleted++;
            logger.debug(`Successfully deleted category: ${name} (ID: ${id})`);
          }
        } catch (error) {
          // Treat "No such entity" as success (category already deleted)
          if (error.message?.includes('No such entity')) {
            logger.debug(`Category '${name}' (ID: ${id}) already deleted`);
            deleted++;
          } else {
            logger.debug(`  Failed to delete category '${name}' (ID: ${id}): ${error.message}`);
            failureDetails.push({ name, id, error: error.message });
            failed++;
          }
        }
      },
      {
        concurrency: 5,
        label: 'categories',
        batchSize: CATEGORY_BATCH_SIZE
      }
    );
    
    if (failureDetails.length > 0 && failureDetails.length <= 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} category deletion(s) failed:`));
      failureDetails.forEach(({ name, id, error }) => {
        // Clean up Commerce's broken error message placeholders
        const cleanError = error.replace(/with id %1/, `(ID: ${id})`);
        console.log(chalk.yellow(`  • ${name} (ID: ${id}): ${cleanError}`));
      });
    } else if (failureDetails.length > 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} category deletions failed (showing first 5):`));
      failureDetails.slice(0, 5).forEach(({ name, id, error }) => {
        const cleanError = error.replace(/with id %1/, `(ID: ${id})`);
        console.log(chalk.yellow(`  • ${name} (ID: ${id}): ${cleanError}`));
      });
    }
    
    return { deleted, failed, failureDetails };
    
  } catch (error) {
    logger.debug(`Failed to get categories: ${error.message}`);
    return { deleted: 0, failed: 1 };
  }
}

/**
 * Find project demo customers
 */
async function findProjectCustomers() {
  try {
    const { DEMO_CUSTOMERS } = await import('#config/commerce-config');
    const demoEmails = new Set(DEMO_CUSTOMERS.map(c => c.email.toLowerCase()));
    
    logger.debug(`Looking for ${demoEmails.size} demo customer emails`);
    
    // Get all customers - Commerce search doesn't support OR conditions for emails,
    // so we have to fetch all and filter locally
    const response = await commerceApi.get('/rest/V1/customers/search?searchCriteria[pageSize]=1000');
    const allCustomers = response.items || [];
    
    logger.debug(`Commerce returned ${allCustomers.length} total customers across all websites`);
    
    // Filter by email match
    const foundCustomers = allCustomers.filter(c => demoEmails.has(c.email?.toLowerCase()));
    
    logger.debug(`Found ${foundCustomers.length} matching demo customers`);
    if (foundCustomers.length > 0) {
      logger.debug(`Demo customers: ${foundCustomers.map(c => `${c.email} (Website: ${c.website_id})`).join(', ')}`);
    } else {
      logger.debug(`No demo customers found. Looking for: ${Array.from(demoEmails).slice(0, 3).join(', ')}...`);
    }
    
    return foundCustomers;
  } catch (error) {
    logger.debug(`Error finding customers: ${error.message}`);
    return [];
  }
}

/**
 * Delete demo customers
 */
async function deleteProjectCustomers() {
  try {
    const projectCustomers = await findProjectCustomers();
    
    if (projectCustomers.length === 0) {
      return { deleted: 0, failed: 0 };
    }
    
    // Delete customers
    let deleted = 0;
    let failed = 0;
    const failureDetails = [];
    
    for (const customer of projectCustomers) {
      try {
        if (isDryRun) {
          deleted++;
        } else {
          await commerceApi.delete(`/rest/V1/customers/${customer.id}`);
          deleted++;
        }
      } catch (error) {
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('No such entity')) {
          logger.debug(`Customer ${customer.email} already deleted`);
          deleted++;
        } else {
          logger.debug(`  Failed to delete ${customer.email}: ${error.message}`);
          failureDetails.push({ email: customer.email, id: customer.id, error: error.message });
          failed++;
        }
      }
    }
    
    // Show failure details if any
    if (failureDetails.length > 0 && failureDetails.length <= 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} customer deletion(s) failed:`));
      failureDetails.forEach(({ email, id, error }) => {
        console.log(chalk.yellow(`  • ${email} (ID: ${id}): ${error}`));
      });
    } else if (failureDetails.length > 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} customer deletions failed (showing first 5):`));
      failureDetails.slice(0, 5).forEach(({ email, id, error }) => {
        console.log(chalk.yellow(`  • ${email} (ID: ${id}): ${error}`));
      });
    }
    
    return { deleted, failed, failureDetails };
    
  } catch (error) {
    logger.debug(`Failed to get customers: ${error.message}`);
    return { deleted: 0, failed: 1 };
  }
}

/**
 * Delete BuildRight customer attributes using smart detection
 */
async function deleteProjectCustomerAttributes() {
  let deleted = 0;
  let failed = 0;
  
  try {
    const projectAttrs = await detector.findAllCustomerAttributes();
    
    if (projectAttrs.length === 0) {
      return { deleted: 0, failed: 0 };
    }
    
    for (const attr of projectAttrs) {
      const { attribute_code: attributeCode } = attr;
      
      try {
        if (isDryRun) {
          deleted++;
        } else {
          // Commerce doesn't provide a direct delete endpoint for customer attributes
          // They can only be deleted via admin UI or direct DB access
          failed++;
        }
        
      } catch (error) {
        logger.debug(`  Failed to delete ${attributeCode}: ${error.message}`);
        failed++;
      }
    }
    
    return { deleted, failed };
    
  } catch (error) {
    logger.debug(`Failed to query customer attributes: ${error.message}`);
    return { deleted: 0, failed: 0 };
  }
}

/**
 * Delete BuildRight product attributes using smart detection
 */
async function deleteProjectProductAttributes() {
  let deleted = 0;
  let failed = 0;
  const failureDetails = [];
  
  try {
    const projectAttrs = await detector.findAllAttributes();
    
    if (projectAttrs.length === 0) {
      return { deleted: 0, failed: 0 };
    }
    
    updateLine('🗑️  Deleting product attributes...');
    
    const attributeCodes = projectAttrs.map(a => a.attribute_code);
    
    await helper.processWithProgress(
      attributeCodes,
      async (attributeCode) => {
        try {
          if (isDryRun) {
            deleted++;
          } else {
            await commerceApi.delete(`/rest/V1/products/attributes/${attributeCode}`);
            deleted++;
          }
        } catch (error) {
          if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('No such entity')) {
            logger.debug(`Attribute ${attributeCode} already deleted`);
            deleted++;
          } else {
            logger.debug(`  Failed to delete ${attributeCode}: ${error.message}`);
            failureDetails.push({ code: attributeCode, error: error.message });
            failed++;
          }
        }
      },
      { concurrency: ATTRIBUTE_CONCURRENCY, label: 'attributes' }
    );
    
    if (failureDetails.length > 0 && failureDetails.length <= 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} attribute deletion(s) failed:`));
      failureDetails.forEach(({ code, error }) => {
        console.log(chalk.yellow(`  • ${code}: ${error}`));
      });
    } else if (failureDetails.length > 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} attribute deletions failed (showing first 5):`));
      failureDetails.slice(0, 5).forEach(({ code, error }) => {
        console.log(chalk.yellow(`  • ${code}: ${error}`));
      });
    }
    
    return { deleted, failed, failureDetails };
    
  } catch (error) {
    logger.debug(`Failed to query product attributes: ${error.message}`);
    return { deleted: 0, failed: 1 };
  }
}

/**
 * Delete BuildRight customer groups using smart detection
 */
async function deleteProjectCustomerGroups() {
  let deleted = 0;
  let failed = 0;
  const failureDetails = [];
  
  try {
    const projectGroups = await detector.findAllCustomerGroups();
    
    if (projectGroups.length === 0) {
      return { deleted: 0, failed: 0 };
    }
    
    for (const group of projectGroups) {
      const { code, id } = group;
      
      try {
        if (isDryRun) {
          deleted++;
        } else {
          await commerceApi.delete(`/rest/V1/customerGroups/${id}`);
          deleted++;
        }
        
      } catch (error) {
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('No such entity')) {
          logger.debug(`Customer group ${code} already deleted`);
          deleted++;
        } else {
          logger.debug(`  Failed to delete ${code}: ${error.message}`);
          failureDetails.push({ code, id, error: error.message });
          failed++;
        }
      }
    }
    
    // Show failure details if any
    if (failureDetails.length > 0 && failureDetails.length <= 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} customer group deletion(s) failed:`));
      failureDetails.forEach(({ code, id, error }) => {
        console.log(chalk.yellow(`  • ${code} (ID: ${id}): ${error}`));
      });
    } else if (failureDetails.length > 5) {
      console.log(chalk.yellow(`⚠ ${failureDetails.length} customer group deletions failed (showing first 5):`));
      failureDetails.slice(0, 5).forEach(({ code, id, error }) => {
        console.log(chalk.yellow(`  • ${code} (ID: ${id}): ${error}`));
      });
    }
    
    return { deleted, failed, failureDetails };
    
  } catch (error) {
    logger.debug(`Failed to query customer groups: ${error.message}`);
    return { deleted: 0, failed: 1 };
  }
}

/**
 * Delete BuildRight stores (website, store group, store view)
 */
async function deleteProjectStores() {
  let deleted = 0;
  let failed = 0;
  
  try {
    // 1. Delete store views first
    const storeViews = await commerceApi.getStoreViews();
    const projectViews = storeViews.filter(v => 
      v.code?.includes('buildright') || v.name?.includes('BuildRight')
    );
    
    for (const view of projectViews) {
      try {
        if (isDryRun) {
          deleted++;
        } else {
          await commerceApi.delete(`/rest/V1/store/storeViews/${view.id}`);
          deleted++;
        }
      } catch (error) {
        logger.debug(`  Failed to delete store view ${view.code}: ${error.message}`);
        failed++;
      }
    }
    
    // 2. Delete store groups
    const storeGroups = await commerceApi.getStoreGroups();
    const projectGroups = storeGroups.filter(g => 
      g.code?.includes('buildright') || g.name?.includes('BuildRight')
    );
    
    for (const group of projectGroups) {
      try {
        if (isDryRun) {
          deleted++;
        } else {
          await commerceApi.delete(`/rest/V1/store/storeGroups/${group.id}`);
          deleted++;
        }
      } catch (error) {
        logger.debug(`  Failed to delete store group ${group.code}: ${error.message}`);
        failed++;
      }
    }
    
    // 3. Delete websites
    const websites = await commerceApi.getWebsites();
    const projectWebsites = websites.filter(w => 
      w.code?.includes('buildright') || w.name?.includes('BuildRight')
    );
    
    for (const website of projectWebsites) {
      try {
        if (isDryRun) {
          deleted++;
        } else {
          await commerceApi.delete(`/rest/V1/store/websites/${website.id}`);
          deleted++;
        }
      } catch (error) {
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('No such entity')) {
          logger.debug(`Website ${website.code} already deleted`);
          deleted++;
        } else {
          logger.debug(`  Failed to delete website ${website.code}: ${error.message}`);
          failed++;
        }
      }
    }
    
    return { deleted, failed };
    
  } catch (error) {
    logger.debug(`Failed to delete stores: ${error.message}`);
    return { deleted, failed: 1 };
  }
}

/**
 * Main delete function
 */
/**
 * Perform deletion of BuildRight entities
 * Extracted as reusable function for initial deletion and orphan cleanup
 */
async function performDeletion(detector, options) {
  const {
    deleteCustomers,
    deleteCustomerAttrs,
    deleteCategories,
    deleteAttributes,
    deleteCustomerGroups,
    deleteStores,
    isDryRun,
    silent = false  // Silent mode for orphan cleanup (no console output)
  } = options;
  
  const results = {
    products: { deleted: 0, failed: 0 },
    categories: { deleted: 0, failed: 0 },
    attributes: { deleted: 0, failed: 0, notFound: 0 },
    customerGroups: { deleted: 0, failed: 0, notFound: 0 },
    customers: { deleted: 0, failed: 0 },
    customerAttributes: { deleted: 0, failed: 0, notFound: 0 },
    stores: { deleted: 0, failed: 0, notFound: 0 }
  };
  
  // Find products (single line)
  const productResults = await detector.findAllProducts();
  const skus = productResults.skus;
  
  // Deletion in reverse order of import (single line per step)
  
  // Step 8: Demo Customers
  if (deleteCustomers) {
    results.customers = await deleteProjectCustomers();
    if (!silent && results.customers.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.customers.deleted} demo customers`));
    }
  }
  
  // Step 7: Customer Attributes
  if (deleteCustomerAttrs) {
    results.customerAttributes = await deleteProjectCustomerAttributes();
    if (!silent && results.customerAttributes.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.customerAttributes.deleted} customer attributes`));
    }
  }
  
  // Step 6 & 4: All Products
  if (skus.length > 0) {
    results.products = await deleteProducts(skus);
    if (!silent && results.products.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.products.deleted} products`));
      
      // Small delay to let Commerce's search index catch up
      // Note: We cannot programmatically trigger reindexing via API, so we must wait
      // for Commerce's automatic indexing to process the deletions
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Step 3: Categories
  if (deleteCategories) {
    results.categories = await deleteProjectCategories();
    if (!silent && results.categories.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.categories.deleted} categories`));
    }
  }
  
  // Step 2: Product Attributes
  if (deleteAttributes) {
    results.attributes = await deleteProjectProductAttributes();
    if (!silent && results.attributes.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.attributes.deleted} product attributes`));
    }
  }
  
  // Step 1: Customer Groups
  if (deleteCustomerGroups) {
    results.customerGroups = await deleteProjectCustomerGroups();
    if (!silent && results.customerGroups.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.customerGroups.deleted} customer groups`));
    }
  }
  
  // Step 0: Stores
  if (deleteStores) {
    results.stores = await deleteProjectStores();
    if (results.stores.deleted > 0) {
      finishLine(chalk.green(`✔ Deleted ${results.stores.deleted} stores/websites`));
    }
  }
  
  return results;
}

/**
 * Main deletion workflow
 */
async function main() {
  const startTime = Date.now();
  
  console.log('');
  console.log(format.muted(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`));
  console.log(format.muted(`Target: ${COMMERCE_CONFIG.baseUrl}`));
  console.log('');
  
  // Test connection
  if (!isDryRun) {
    const connected = await withSpinner('Testing Commerce API connection...', async () => {
      return await commerceApi.testConnection();
    });
    if (!connected) {
      console.log(format.error('Failed to connect to Commerce API'));
      process.exit(1);
    }
    console.log(chalk.green('✔ Testing Commerce API connection'));
  }
  
  // Find all BuildRight data
  const discovered = await withSpinner('Scanning for BuildRight data...', async () => {
    // Wait a moment for any pending indexing to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Clear cache to ensure fresh data
    detector.clearCache();
    
    // Find all entity types based on deletion flags
    const products = await findProjectProducts();
    const categories = deleteCategories ? await detector.findAllCategories() : [];
    const attributes = deleteAttributes ? await detector.findAllAttributes() : [];
    const customerGroups = deleteCustomerGroups ? await detector.findAllCustomerGroups() : [];
    const customerAttrs = deleteCustomerAttrs ? await detector.findAllCustomerAttributes() : [];
    const customers = deleteCustomers ? await findProjectCustomers() : [];
    
    return {
      products,
      categories,
      attributes,
      customerGroups,
      customerAttrs,
      customers
    };
  });
  
  const skus = discovered.products;
  const totalEntities = skus.length + 
                        discovered.categories.length + 
                        discovered.attributes.length + 
                        discovered.customerGroups.length + 
                        discovered.customerAttrs.length +
                        discovered.customers.length;
  
  // Show what was found
  if (totalEntities === 0) {
    console.log(chalk.green('✔ No BuildRight data found'));
    
    // Clear state tracker even when no data exists (in case of stale state)
    const stateTracker = getStateTracker();
    stateTracker.clearAll();
    
    console.log('');
    console.log(format.success('Nothing to delete!'));
    return {
      success: true,
      results: {},
      validation: { clean: true, issues: [] }
    };
  }
  
  const foundItems = [];
  if (skus.length > 0) foundItems.push(`${skus.length} products`);
  if (discovered.categories.length > 0) foundItems.push(`${discovered.categories.length} categories`);
  if (discovered.attributes.length > 0) foundItems.push(`${discovered.attributes.length} attributes`);
  if (discovered.customerGroups.length > 0) foundItems.push(`${discovered.customerGroups.length} customer groups`);
  if (discovered.customerAttrs.length > 0) foundItems.push(`${discovered.customerAttrs.length} customer attributes`);
  if (discovered.customers.length > 0) foundItems.push(`${discovered.customers.length} customers`);
  
  console.log(chalk.green(`✔ Found BuildRight data: ${foundItems.join(', ')}`));
  
  // Confirm deletion
  if (!isDryRun && !skipConfirm && totalEntities > 0) {
    console.log('');
    console.log(format.warning('This will permanently delete:'));
    if (skus.length > 0) console.log(format.warning(`  • ${skus.length} products`));
    if (discovered.categories.length > 0) console.log(format.warning(`  • ${discovered.categories.length} categories`));
    if (discovered.attributes.length > 0) console.log(format.warning(`  • ${discovered.attributes.length} attributes`));
    if (discovered.customerGroups.length > 0) console.log(format.warning(`  • ${discovered.customerGroups.length} customer groups`));
    if (discovered.customerAttrs.length > 0) console.log(format.warning(`  • ${discovered.customerAttrs.length} customer attributes`));
    if (discovered.customers.length > 0) console.log(format.warning(`  • ${discovered.customers.length} customers`));
    if (deleteStores) console.log(format.warning(`  • BuildRight stores/websites (if any)`));
    console.log('Run with --dry-run to preview, or --yes to skip this prompt.');
    console.log('');
    
    // In non-interactive mode, require --yes flag
    console.log(format.error('Aborting. Use --yes flag to confirm deletion.'));
    process.exit(1);
  }
  
  // Perform deletion
  const results = await performDeletion(detector, {
    deleteCustomers,
    deleteCustomerAttrs,
    deleteCategories,
    deleteAttributes,
    deleteCustomerGroups,
    deleteStores,
    isDryRun
  });
  
  // Summary
  const duration = formatDuration((Date.now() - startTime) / 1000);
  
  console.log('');
  
  // Check if anything was actually deleted
  const totalDeleted = (results.products?.deleted || 0) + 
                       (results.categories?.deleted || 0) + 
                       (results.attributes?.deleted || 0) + 
                       (results.customerGroups?.deleted || 0) + 
                       (results.customers?.deleted || 0) + 
                       (results.customerAttributes?.deleted || 0) + 
                       (results.stores?.deleted || 0);
  
  // Validation results (used for success determination)
  let validation = null;
  
  if (isDryRun) {
    console.log('This was a DRY RUN. No changes were made.');
    console.log('Run without --dry-run and with --yes to perform deletion.');
  } else if (totalDeleted === 0) {
    // Nothing was deleted (shouldn't happen since we check earlier, but safety check)
    console.log(chalk.dim('No data was deleted, skipping validation.'));
    console.log('');
    console.log(format.success('Data deletion complete!'));
    validation = { clean: true, issues: [] };
  } else {
    // Validate that Commerce is completely clean (with auto-cleanup of orphans)
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      validation = await withSpinner('Validating deletion...', async () => {
        // Wait for indexing to complete before validation
        // First check: wait longer as bulk deletions need more time to index
        // Subsequent checks: shorter wait since we're cleaning up stragglers
        // Note: These delays are necessary because we cannot programmatically reindex.
        // Commerce's search index updates automatically, but needs time to process.
        const waitTime = retryCount === 0 ? 12000 : 6000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        detector.clearCache();
        return await detector.validateClean();
      });
      
      if (validation.clean) {
        // Success!
        console.log(chalk.green('✔ Validating deletion (no orphaned data)'));
        break;
      }
      
      // Orphaned data detected - auto-cleanup
      console.log(format.warning(`Validating deletion (orphans found, cleaning up ${retryCount + 1}/${maxRetries})`));
      
      // Re-run deletion steps to clean up orphans (silent mode)
      const orphanResults = await performDeletion(detector, {
        deleteCustomers,
        deleteCustomerAttrs,
        deleteCategories,
        deleteAttributes,
        deleteCustomerGroups,
        deleteStores,
        isDryRun,
        silent: true  // Suppress individual deletion messages during orphan cleanup
      });
      
      // Show clean summary of what was cleaned up
      const cleanedItems = [];
      if (orphanResults.products.deleted > 0) cleanedItems.push(`${orphanResults.products.deleted} products`);
      if (orphanResults.categories.deleted > 0) cleanedItems.push(`${orphanResults.categories.deleted} categories`);
      if (orphanResults.attributes.deleted > 0) cleanedItems.push(`${orphanResults.attributes.deleted} attributes`);
      if (orphanResults.customers.deleted > 0) cleanedItems.push(`${orphanResults.customers.deleted} customers`);
      
      if (cleanedItems.length > 0) {
        console.log(`  Cleaned: ${cleanedItems.join(', ')}`);
      }
      
      // Track orphan cleanup
      Object.keys(orphanResults).forEach(key => {
        if (orphanResults[key].deleted > 0) {
          results[key].deleted += orphanResults[key].deleted;
        }
      });
      
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
    
    // Clear state after successful deletion AND validation
    const stateTracker = getStateTracker();
    stateTracker.clearAll();
    
    console.log('');
    console.log(format.success('Data deletion complete!'));
  }
  
  // Success is determined by validation passing (if enabled) or no critical failures
  // Note: Initial failures that were cleaned up by orphan cleanup don't count as failures
  const success = isDryRun || (validation && validation.clean);
  
  return {
    success,
    results,
    validation: validation || undefined
  };
}

// Run
main()
  .then(result => process.exit(result.success ? 0 : 1))
  .catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });

