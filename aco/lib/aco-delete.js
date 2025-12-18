/**
 * ACO Delete Utilities
 * 
 * Modular utilities for deleting data from Adobe Commerce Optimizer.
 * Handles batch processing, referential integrity, and error handling.
 * 
 * @module utils/aco-delete
 */

import { getACOClient } from './aco-client.js';
import logger from '../../shared/logger.js';

/**
 * Delete prices by SKUs and price book IDs
 * 
 * Deletes all price combinations for given SKUs and price books.
 * Handles batch processing according to ACO API limits.
 * 
 * @param {Array<string>} skus - SKUs to delete prices for
 * @param {Array<string>} priceBookIds - Price book IDs
 * @param {Object} options - Delete options
 * @param {number} [options.batchSize=100] - Prices per batch
 * @param {boolean} [options.dryRun=false] - Dry run mode
 * @returns {Promise<Object>} Deletion results
 * 
 * @example
 * const result = await deletePricesBySKUs(
 *   ['SKU-001', 'SKU-002'],
 *   ['US-Retail', 'Production-Builder']
 * );
 * console.log(`Deleted ${result.deleted} prices`);
 */
export async function deletePricesBySKUs(skus, priceBookIds, options = {}) {
  const { batchSize = 100, dryRun = false } = options;
  
  logger.debug('Delete Prices Operation', {
    skuCount: skus.length,
    priceBookCount: priceBookIds.length,
    totalPrices: skus.length * priceBookIds.length,
    dryRun
  });
  
  // Generate all price delete requests (SKU x priceBookId combinations)
  const priceDeletes = [];
  for (const sku of skus) {
    for (const priceBookId of priceBookIds) {
      priceDeletes.push({ sku, priceBookId });
    }
  }
  
  logger.debug(`Generated ${priceDeletes.length} price delete requests`);
  
  if (dryRun) {
    logger.debug('[DRY-RUN] Would delete prices in batches of', batchSize);
    return { deleted: 0, total: priceDeletes.length, dryRun: true };
  }
  
  // Process in batches
  const client = getACOClient();
  
  // Import progress utility for single-line updates
  const { updateLine, finishLine, formatProgressBar } = await import('../../shared/progress.js');
  
  logger.debug(`Deleting ${priceDeletes.length} prices across ${Math.ceil(priceDeletes.length / batchSize)} batches...`);
  
  let deletedCount = 0;
  const errors = [];
  
  // Don't show progress bar - too fast and causes flickering
  // The withProgress spinner will handle the UI
  
  for (let i = 0; i < priceDeletes.length; i += batchSize) {
    const batch = priceDeletes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(priceDeletes.length / batchSize);
    
    try {
      const response = await client.deletePrices(batch);
      const accepted = response.data?.acceptedCount || 0;
      deletedCount += accepted;
      
    } catch (error) {
      logger.error(`Batch ${batchNum} failed:`, error.message);
      errors.push({
        batch: batchNum,
        error: error.message,
        items: batch.length
      });
    }
  }
  logger.debug(`Price deletion complete: ${deletedCount}/${priceDeletes.length} deleted`);
  
  return {
    deleted: deletedCount,
    total: priceDeletes.length,
    errors,
    success: errors.length === 0
  };
}

/**
 * Delete all prices for specific price books
 * 
 * Queries all SKUs from ACO, then deletes all prices for the given price books.
 * This is useful when resetting price books.
 * 
 * @param {Array<string>} priceBookIds - Price book IDs to delete prices for
 * @param {Object} options - Delete options
 * @param {Array<string>} [options.skus] - Optional SKU list (queries ACO if not provided)
 * @param {number} [options.batchSize=100] - Prices per batch
 * @param {boolean} [options.dryRun=false] - Dry run mode
 * @returns {Promise<Object>} Deletion results
 * 
 * @example
 * // Delete all prices for specific price books
 * const result = await deleteAllPricesForPriceBooks(['US-Retail', 'Production-Builder']);
 */
export async function deleteAllPricesForPriceBooks(priceBookIds, options = {}) {
  const { skus: providedSKUs, batchSize = 100, dryRun = false } = options;
  
  logger.debug('Deleting all prices for price books:', priceBookIds);
  
  // Get SKUs if not provided
  let skus = providedSKUs;
  if (!skus) {
    const { getAllProductSKUs } = await import('./aco-query.js');
    skus = await getAllProductSKUs();
  }
  
  logger.debug(`Will delete prices for ${skus.length} SKUs across ${priceBookIds.length} price books`);
  
  // Delete prices
  return await deletePricesBySKUs(skus, priceBookIds, { batchSize, dryRun });
}

/**
 * Delete price books
 * 
 * Deletes price books from ACO. Note: Price books with associated prices
 * may fail to delete. Use deleteAllPricesForPriceBooks first if needed.
 * 
 * @param {Array<string>} priceBookIds - Price book IDs to delete
 * @param {Object} options - Delete options
 * @param {number} [options.batchSize=100] - Price books per batch
 * @param {boolean} [options.dryRun=false] - Dry run mode
 * @returns {Promise<Object>} Deletion results
 * 
 * @example
 * const result = await deletePriceBooks(['old-price-book-1', 'old-price-book-2']);
 */
export async function deletePriceBooks(priceBookIds, options = {}) {
  const { batchSize = 100, dryRun = false } = options;
  
  logger.debug('Delete Price Books Operation', {
    count: priceBookIds.length,
    dryRun
  });
  
  if (dryRun) {
    logger.debug('[DRY-RUN] Would delete price books:', priceBookIds);
    return { deleted: 0, total: priceBookIds.length, dryRun: true };
  }
  
  const client = getACOClient();
  const priceBookDeletes = priceBookIds.map(priceBookId => ({ priceBookId }));
  
  // Import progress utility for single-line updates
  const { updateLine, finishLine, formatProgressBar } = await import('../../shared/progress.js');
  
  logger.debug(`Deleting ${priceBookDeletes.length} price books across ${Math.ceil(priceBookDeletes.length / batchSize)} batches...`);
  
  let deletedCount = 0;
  const errors = [];
  
  // Don't show progress bar - too fast and causes flickering
  // The withProgress spinner will handle the UI
  
  // Process in batches
  for (let i = 0; i < priceBookDeletes.length; i += batchSize) {
    const batch = priceBookDeletes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(priceBookDeletes.length / batchSize);
    
    try {
      const response = await client.deletePriceBooks(batch);
      const accepted = response.data?.acceptedCount || 0;
      deletedCount += accepted;
      
    } catch (error) {
      logger.error(`Batch ${batchNum} failed:`, error.message);
      errors.push({
        batch: batchNum,
        error: error.message,
        items: batch.length
      });
    }
  }
  
  logger.debug(`Price book deletion complete: ${deletedCount}/${priceBookIds.length} deleted`);
  
  return {
    deleted: deletedCount,
    total: priceBookIds.length,
    errors,
    success: errors.length === 0
  };
}

/**
 * Delete products by SKUs
 * 
 * @param {Array<string>} skus - SKUs to delete
 * @param {Object} options - Delete options
 * @param {string} [options.locale='en-US'] - Source locale
 * @param {number} [options.batchSize=100] - Products per batch
 * @param {boolean} [options.dryRun=false] - Dry run mode
 * @returns {Promise<Object>} Deletion results
 * 
 * @example
 * const result = await deleteProductsBySKUs(['SKU-001', 'SKU-002']);
 */
export async function deleteProductsBySKUs(skus, options = {}) {
  const { locale = 'en-US', batchSize = 100, dryRun = false, silent = false } = options;
  
  logger.debug('Delete Products Operation', {
    count: skus.length,
    locale,
    dryRun
  });
  
  if (dryRun) {
    logger.debug('[DRY-RUN] Would delete products:', skus.slice(0, 10));
    return { deleted: 0, total: skus.length, dryRun: true };
  }
  
  const client = getACOClient();
  const productDeletes = skus.map(sku => ({
    sku,
    source: { locale }
  }));
  
  // Import progress utility for single-line updates
  const { updateLine, finishLine, formatProgressBar } = await import('../../shared/progress.js');
  
  logger.debug(`Deleting ${productDeletes.length} products across ${Math.ceil(productDeletes.length / batchSize)} batches...`);
  
  let deletedCount = 0;
  const errors = [];
  let lastUpdate = 0;
  const updateThrottle = 100; // Only update display every 100ms
  
  // Process in batches
  for (let i = 0; i < productDeletes.length; i += batchSize) {
    const batch = productDeletes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(productDeletes.length / batchSize);
    
    try {
      const response = await client.deleteProducts(batch);
      const accepted = response.data?.acceptedCount || 0;
      deletedCount += accepted;
      
      // Update progress bar in place (unless silent mode for polling)
      if (!silent) {
        // Throttle updates to prevent flickering
        const now = Date.now();
        const isLastBatch = batchNum === totalBatches;
        if (isLastBatch || now - lastUpdate >= updateThrottle) {
          const bar = formatProgressBar(deletedCount, productDeletes.length, { width: 20 });
          updateLine(`  Deleting products: ${bar} | batch ${batchNum}/${totalBatches}`);
          lastUpdate = now;
        }
      }
      
    } catch (error) {
      if (!silent) {
        finishLine();
      }
      logger.error(`Batch ${batchNum} failed:`, error.message);
      errors.push({
        batch: batchNum,
        error: error.message,
        items: batch.length
      });
    }
  }
  
  if (!silent) {
    finishLine();
  }
  
  const rejectedCount = skus.length - deletedCount;
  if (rejectedCount > 0) {
    logger.warn(`Product deletion: ${deletedCount}/${skus.length} accepted (${rejectedCount} rejected by ACO)`);
    logger.warn(`This may indicate invisible variants (visibleIn: []) that cannot be deleted via API`);
  } else {
    logger.debug(`Product deletion complete: ${deletedCount}/${skus.length} deleted`);
  }
  
  return {
    deleted: deletedCount,
    rejected: rejectedCount,
    total: skus.length,
    errors,
    success: errors.length === 0
  };
}

/**
 * Delete metadata (product attributes)
 * 
 * @param {Array<string>} attributeCodes - Attribute codes to delete
 * @param {Object} options - Delete options
 * @param {string} [options.locale='en-US'] - Source locale
 * @param {number} [options.batchSize=50] - Attributes per batch
 * @param {boolean} [options.dryRun=false] - Dry run mode
 * @returns {Promise<Object>} Deletion results
 * 
 * @example
 * const result = await deleteMetadata(['br_product_category', 'br_brand']);
 */
export async function deleteMetadata(attributeCodes, options = {}) {
  const { locale = 'en-US', batchSize = 50, dryRun = false } = options;
  
  logger.debug('Delete Metadata Operation', {
    count: attributeCodes.length,
    locale,
    dryRun
  });
  
  if (dryRun) {
    logger.debug('[DRY-RUN] Would delete metadata:', attributeCodes.slice(0, 10));
    return { deleted: 0, total: attributeCodes.length, dryRun: true };
  }
  
  const client = getACOClient();
  const metadataDeletes = attributeCodes.map(code => ({
    code,
    source: { locale }
  }));
  
  logger.debug(`Deleting ${metadataDeletes.length} metadata attributes across ${Math.ceil(metadataDeletes.length / batchSize)} batches...`);
  
  let deletedCount = 0;
  const errors = [];
  
  // Process in batches
  for (let i = 0; i < metadataDeletes.length; i += batchSize) {
    const batch = metadataDeletes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    
    try {
      const response = await client.deleteProductMetadata(batch);
      const accepted = response.data?.acceptedCount || 0;
      deletedCount += accepted;
      
    } catch (error) {
      logger.error(`Batch ${batchNum} failed:`, error.message);
      errors.push({
        batch: batchNum,
        error: error.message,
        items: batch.length
      });
    }
  }
  
  logger.debug(`Metadata deletion complete: ${deletedCount}/${attributeCodes.length} deleted`);
  
  return {
    deleted: deletedCount,
    total: attributeCodes.length,
    errors,
    success: errors.length === 0
  };
}

/**
 * Delete categories by slugs
 * 
 * @param {string[]} slugs - Array of category slugs to delete
 * @param {Object} options - Delete options
 * @param {string} [options.locale='en-US'] - Locale for deletion
 * @param {number} [options.batchSize=50] - Batch size for deletion
 * @param {boolean} [options.dryRun=false] - Preview mode
 * @returns {Promise<Object>} Deletion result
 * 
 * @example
 * const result = await deleteCategories(['structural-materials', 'roofing']);
 */
export async function deleteCategories(slugs, options = {}) {
  const { locale = 'en-US', batchSize = 50, dryRun = false } = options;
  
  logger.debug('Delete Categories Operation', {
    count: slugs.length,
    locale,
    dryRun
  });
  
  if (dryRun) {
    logger.debug('[DRY-RUN] Would delete categories:', slugs.slice(0, 10));
    return { deleted: 0, total: slugs.length, dryRun: true };
  }
  
  const client = getACOClient();
  const categoryDeletes = slugs.map(slug => ({
    slug,
    source: { locale }
  }));
  
  logger.debug(`Deleting ${categoryDeletes.length} categories across ${Math.ceil(categoryDeletes.length / batchSize)} batches...`);
  
  let deletedCount = 0;
  const errors = [];
  
  // Process in batches
  for (let i = 0; i < categoryDeletes.length; i += batchSize) {
    const batch = categoryDeletes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    
    try {
      const response = await client.deleteCategories(batch);
      const accepted = response.data?.acceptedCount || 0;
      deletedCount += accepted;
      
    } catch (error) {
      logger.error(`Batch ${batchNum} failed:`, error.message);
      errors.push({
        batch: batchNum,
        error: error.message,
        items: batch.length
      });
    }
  }
  
  logger.debug(`Category deletion complete: ${deletedCount}/${slugs.length} deleted`);
  
  return {
    deleted: deletedCount,
    total: slugs.length,
    errors,
    success: errors.length === 0
  };
}

export default {
  deletePricesBySKUs,
  deleteAllPricesForPriceBooks,
  deletePriceBooks,
  deleteProductsBySKUs,
  deleteMetadata,
  deleteCategories
};

