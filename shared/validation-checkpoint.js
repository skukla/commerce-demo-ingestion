#!/usr/bin/env node

/**
 * Validation Utilities
 * Simple validation functions for pre/post import checks
 */

import logger from './logger.js';
import { getStateTracker } from '../commerce/lib/state-tracker.js';

/**
 * Run a set of validation checks
 * 
 * @param {string} name - Checkpoint name
 * @param {Array} checks - Array of validation functions
 * @param {Object} options - Options (stopOnFailure)
 * @returns {Object} - { passed, results }
 */
export async function runValidation(name, checks, options = {}) {
  const { stopOnFailure = true, silent = false } = options;
  
  if (!silent) {
    logger.info(`\n🔍 Validation: ${name}`);
    logger.info(`Running ${checks.length} checks...\n`);
  }

  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (const check of checks) {
    try {
      const result = await check();
      
      if (!silent) {
        const status = result.passed ? '✔' : '✗';
        const color = result.passed ? '\x1b[32m' : '\x1b[31m';
        const reset = '\x1b[0m';
        
        logger.info(`  ${color}${status}${reset} ${result.name}`);
        
        if (result.message) {
          logger.info(`    ${result.message}`);
        }
      }

      results.push(result);

      if (result.passed) {
        passCount++;
      } else {
        failCount++;
        if (stopOnFailure) break;
      }

    } catch (error) {
      logger.error(`  ✗ ${check.name || 'Unknown check'}`);
      logger.error(`    Error: ${error.message}`);
      
      results.push({
        name: check.name || 'Unknown',
        passed: false,
        error: error.message
      });
      
      failCount++;
      if (stopOnFailure) break;
    }
  }

  // Summary
  if (!silent) {
    logger.info('');
    logger.info(`Validation Summary:`);
    logger.info(`  ✔ Passed: ${passCount}`);
    if (failCount > 0) logger.info(`  ✗ Failed: ${failCount}`);
    logger.info('');
  }

  return {
    passed: failCount === 0,
    passCount,
    failCount,
    results
  };
}

/**
 * Check if datapack file exists
 */
export function checkDatapackExists(filePath) {
  return async () => {
    const { existsSync } = await import('fs');
    const exists = existsSync(filePath);
    
    return {
      name: 'Datapack file exists',
      passed: exists,
      message: exists ? `Found: ${filePath}` : `Missing: ${filePath}`
    };
  };
}

/**
 * Check datapack product count
 */
export function checkProductCount(filePath, minCount, maxCount) {
  return async () => {
    const { readFileSync } = await import('fs');
    
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      // Handle multiple possible structures
      const count = data.products?.length || 
                    data.source?.items?.length ||
                    data.source?.length ||
                    0;
      
      const inRange = count >= minCount && count <= maxCount;
      
      return {
        name: 'Datapack product count',
        passed: inRange,
        message: `${count} products (expected ${minCount}-${maxCount})`
      };
    } catch (error) {
      return {
        name: 'Datapack product count',
        passed: false,
        message: `Failed to read datapack: ${error.message}`
      };
    }
  };
}

/**
 * Check attribute definitions
 */
export function checkAttributeDefinitions(filePath) {
  return async () => {
    const { existsSync, readFileSync } = await import('fs');
    
    if (!existsSync(filePath)) {
      return {
        name: 'Attribute definitions',
        passed: false,
        message: `Metadata file not found: ${filePath}`
      };
    }

    try {
      const metadata = JSON.parse(readFileSync(filePath, 'utf8'));
      // Handle array format (ACCS) or object format with attributes key
      const count = Array.isArray(metadata) ? metadata.length : (metadata.attributes?.length || 0);
      
      return {
        name: 'Attribute definitions',
        passed: count > 0,
        message: `${count} attributes defined`
      };
    } catch (error) {
      return {
        name: 'Attribute definitions',
        passed: false,
        message: `Failed to parse metadata: ${error.message}`
      };
    }
  };
}

/**
 * Check Commerce API connectivity
 */
export function checkCommerceConnectivity(commerceApi) {
  return async () => {
    try {
      await commerceApi.get('/rest/V1/store/storeViews');
      
      return {
        name: 'Commerce API connectivity',
        passed: true,
        message: 'API connection successful'
      };
    } catch (error) {
      return {
        name: 'Commerce API connectivity',
        passed: false,
        message: `API connection failed: ${error.message}`
      };
    }
  };
}

/**
 * Check imported product count in Commerce
 */
export function checkCommerceProductCount(commerceApi, minCount, maxCount, skuPattern = null) {
  return async () => {
    try {
      const searchCriteria = skuPattern
        ? `searchCriteria[filterGroups][0][filters][0][field]=sku&searchCriteria[filterGroups][0][filters][0][value]=${encodeURIComponent(skuPattern)}&searchCriteria[filterGroups][0][filters][0][conditionType]=like`
        : '';
      
      const response = await commerceApi.get(`/rest/V1/products?${searchCriteria}`);
      const count = response.total_count || 0;
      
      const inRange = count >= minCount && count <= maxCount;
      
      return {
        name: 'Commerce product count',
        passed: inRange,
        message: `${count} products found (expected ${minCount}-${maxCount})`
      };
    } catch (error) {
      return {
        name: 'Commerce product count',
        passed: false,
        message: `Failed to count products: ${error.message}`
      };
    }
  };
}

/**
 * Check state consistency (sample)
 */
export function checkStateConsistency(commerceApi, sampleSize = 10) {
  return async () => {
    try {
      const stateTracker = getStateTracker();
      const trackedProducts = Array.from(stateTracker.state.products);
      
      if (trackedProducts.length === 0) {
        return {
          name: 'State consistency',
          passed: true,
          message: 'No products tracked yet'
        };
      }

      const samples = trackedProducts.slice(0, Math.min(sampleSize, trackedProducts.length));
      const issues = [];

      for (const sku of samples) {
        try {
          await commerceApi.getProduct(sku);
        } catch (error) {
          if (error.message.includes('404')) {
            issues.push(sku);
          }
        }
      }

      return {
        name: 'State consistency',
        passed: issues.length === 0,
        message: issues.length === 0
          ? `All ${samples.length} sampled products consistent`
          : `${issues.length}/${samples.length} products missing from Commerce`
      };
    } catch (error) {
      return {
        name: 'State consistency',
        passed: false,
        message: `State validation failed: ${error.message}`
      };
    }
  };
}

export default {
  runValidation,
  checkDatapackExists,
  checkProductCount,
  checkAttributeDefinitions,
  checkCommerceConnectivity,
  checkCommerceProductCount,
  checkStateConsistency
};
