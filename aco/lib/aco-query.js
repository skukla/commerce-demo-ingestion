/**
 * ACO Query Utilities
 * 
 * Modular utilities for querying data from Adobe Commerce Optimizer.
 * These functions use the fixed GraphQL queries and can be composed
 * for various use cases.
 * 
 * @module utils/aco-query
 */

import { queryProductsBySKU, queryProducts } from './aco-graphql-query.js';
import logger from '../../shared/logger.js';

/**
 * Get all product SKUs from local data files
 * 
 * Reads products.json, variants.json, and bundles.json to get all SKUs.
 * This is more reliable than querying ACO's GraphQL (which requires search index).
 * 
 * @param {Object} options - Query options
 * @param {string} [options.dataDir='./data/buildright'] - Data directory path
 * @returns {Promise<Array<string>>} Array of all SKUs
 * 
 * @example
 * const allSKUs = await getAllProductSKUs();
 * console.log(`Found ${allSKUs.length} products`);
 */
export async function getAllProductSKUs(options = {}) {
  const { dataDir = './data/buildright' } = options;
  
  logger.info('Reading product SKUs from local data files...');
  
  const { promises: fs } = await import('fs');
  const allSKUs = [];
  
  // Read all product types (no bundles - ACO-only feature removed)
  const files = ['products.json', 'variants.json'];
  
  for (const file of files) {
    try {
      const path = `${dataDir}/${file}`;
      const data = await fs.readFile(path, 'utf-8');
      const products = JSON.parse(data);
      const skus = products.map(p => p.sku);
      allSKUs.push(...skus);
      logger.debug(`${file}: ${skus.length} SKUs`);
    } catch (error) {
      logger.warn(`Could not read ${file}:`, error.message);
    }
  }
  
  logger.info(`✅ Found ${allSKUs.length} total SKUs in local data`);
  return allSKUs;
}

/**
 * Validate if SKUs exist in ACO
 * 
 * Checks if a list of SKUs exist in ACO by querying them in batches.
 * 
 * @param {Array<string>} skus - SKUs to validate
 * @param {Object} options - Validation options
 * @param {number} [options.batchSize=100] - SKUs per batch query
 * @returns {Promise<Object>} Validation results with found/missing SKUs
 * 
 * @example
 * const result = await validateSKUsExist(['SKU-001', 'SKU-002']);
 * console.log(`Found: ${result.found.length}, Missing: ${result.missing.length}`);
 */
export async function validateSKUsExist(skus, options = {}) {
  const { batchSize = 100 } = options;
  
  logger.info(`Validating ${skus.length} SKUs in ACO...`);
  
  const found = [];
  const missing = [];
  
  // Process in batches
  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);
    
    try {
      const products = await queryProductsBySKU(batch);
      const foundSKUs = products.map(p => p.sku);
      
      found.push(...foundSKUs);
      
      // Find missing SKUs in this batch
      const batchMissing = batch.filter(sku => !foundSKUs.includes(sku));
      missing.push(...batchMissing);
      
    } catch (error) {
      logger.error(`Failed to validate batch:`, error.message);
      missing.push(...batch);
    }
  }
  
  logger.info(`Validation complete: ${found.length} found, ${missing.length} missing`);
  
  return {
    found,
    missing,
    total: skus.length,
    foundCount: found.length,
    missingCount: missing.length
  };
}

/**
 * Get detailed product information for SKUs
 * 
 * @param {Array<string>} skus - SKUs to retrieve
 * @param {Object} options - Query options
 * @param {number} [options.batchSize=100] - SKUs per batch
 * @returns {Promise<Array>} Array of product objects
 * 
 * @example
 * const products = await getProductsBySKUs(['SKU-001', 'SKU-002']);
 * products.forEach(p => console.log(p.name));
 */
export async function getProductsBySKUs(skus, options = {}) {
  const { batchSize = 100 } = options;
  
  logger.info(`Retrieving ${skus.length} products from ACO...`);
  
  const allProducts = [];
  
  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);
    
    try {
      const products = await queryProductsBySKU(batch);
      allProducts.push(...products);
    } catch (error) {
      logger.error(`Failed to retrieve batch:`, error.message);
    }
  }
  
  logger.info(`Retrieved ${allProducts.length} products`);
  return allProducts;
}

export default {
  getAllProductSKUs,
  validateSKUsExist,
  getProductsBySKUs
};

