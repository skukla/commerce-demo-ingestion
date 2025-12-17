/**
 * ACO Ingestion Helpers
 * Common utilities to reduce code duplication across ACO ingestion scripts
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import logger from '../../shared/logger.js';

/**
 * Load JSON file from data repository
 * 
 * @param {string} filename - Relative path within generated/aco/ directory
 * @param {string} dataRepo - Path to data repository
 * @param {string} label - Label for logging (e.g., 'products', 'variants')
 * @returns {Promise<any>} Parsed JSON data
 */
export async function loadJSON(filename, dataRepo, label = 'data') {
  const filePath = join(dataRepo, 'generated/aco', filename);
  logger.debug(`Loading ${label} from: ${filePath}`);
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    logger.debug(`Loaded ${Array.isArray(data) ? data.length : 'N/A'} ${label}`);
    return data;
  } catch (error) {
    throw new Error(`Failed to load ${label} from ${filePath}: ${error.message}`);
  }
}

/**
 * Validate items and log errors
 * 
 * @param {Array} items - Items to validate
 * @param {Function} validateFn - Validation function that returns array of errors
 * @param {Function} getItemId - Function to get item identifier for logging
 * @param {string} label - Label for logging (e.g., 'product', 'variant')
 * @returns {boolean} True if validation passed, false if errors found
 */
export function validateItems(items, validateFn, getItemId, label = 'item') {
  let hasErrors = false;
  
  items.forEach((item, index) => {
    const errors = validateFn(item);
    if (errors.length > 0) {
      const id = getItemId(item) || `index ${index}`;
      logger.error(`${label.charAt(0).toUpperCase() + label.slice(1)} ${id}: ${errors.join(', ')}`);
      hasErrors = true;
    }
  });
  
  if (hasErrors) {
    throw new Error(`${label.charAt(0).toUpperCase() + label.slice(1)} validation failed`);
  }
  
  return true;
}

/**
 * Create batches from an array
 * 
 * @param {Array} items - Items to batch
 * @param {number} batchSize - Size of each batch
 * @returns {Array<Array>} Array of batches
 */
export function createBatches(items, batchSize) {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Process batches with logging and error handling
 * 
 * @param {Array<Array>} batches - Batches to process
 * @param {Function} processFn - Function to process each batch
 * @param {string} label - Label for logging (e.g., 'metadata items')
 * @param {Object} options - Options
 * @param {boolean} options.continueOnError - Continue processing remaining batches on error
 * @returns {Promise<void>}
 */
export async function processBatches(batches, processFn, label = 'items', options = {}) {
  const { continueOnError = false } = options;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    
    try {
      logger.info(`Processing batch ${batchNum}/${batches.length} (${batch.length} ${label})...`);
      await processFn(batch, batchNum);
      logger.info(`✓ Batch ${batchNum} complete`);
    } catch (error) {
      logger.error(`✖ Batch ${batchNum} failed: ${error.message}`);
      if (!continueOnError) {
        throw error;
      }
    }
  }
}

/**
 * Filter existing items from a list
 * Creates a map of existing items by key for O(1) lookup
 * 
 * @param {Array} items - All items to check
 * @param {Array} existingItems - Items that already exist
 * @param {Function} getItemKey - Function to get unique key from item
 * @param {Function} getExistingKey - Function to get unique key from existing item (defaults to getItemKey)
 * @returns {Object} { newItems: Array, existingCount: number }
 */
export function filterExisting(items, existingItems, getItemKey, getExistingKey = null) {
  const keyFn = getExistingKey || getItemKey;
  const existingMap = new Map();
  
  existingItems.forEach(item => {
    existingMap.set(keyFn(item), item);
  });
  
  const newItems = items.filter(item => !existingMap.has(getItemKey(item)));
  
  return {
    newItems,
    existingCount: items.length - newItems.length
  };
}

