/**
 * ACO Validation Checkpoints
 * 
 * Pre and post-operation validation checks for ACO ingestion.
 * Modeled after Commerce validation pattern for consistency.
 * 
 * @module utils/aco-validation
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Validation check result
 * @typedef {Object} ValidationResult
 * @property {boolean} passed - Whether the check passed
 * @property {string} message - Human-readable result message
 * @property {*} [data] - Optional data for further inspection
 */

/**
 * Check if data file exists
 */
async function dataFileExists(filename) {
  const filepath = join(__dirname, '..', 'data', 'buildright', filename);
  
  try {
    await fs.access(filepath);
    return {
      passed: true,
      message: `Data file exists: ${filename}`
    };
  } catch (error) {
    return {
      passed: false,
      message: `Data file missing: ${filename}`
    };
  }
}

/**
 * Check if data file is valid JSON with expected structure
 */
async function dataFileValidJson(filename) {
  const filepath = join(__dirname, '..', 'data', 'buildright', filename);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const data = JSON.parse(content);
    
    if (!Array.isArray(data)) {
      return {
        passed: false,
        message: `${filename} is not an array`
      };
    }
    
    return {
      passed: true,
      message: `${filename} is valid JSON with ${data.length} items`,
      data: { count: data.length, items: data }
    };
  } catch (error) {
    return {
      passed: false,
      message: `${filename} is not valid JSON: ${error.message}`
    };
  }
}

/**
 * Check if entity count is within expected range
 */
function entityCountInRange(count, min, max, entityType) {
  if (count < min || count > max) {
    return {
      passed: false,
      message: `${entityType} count ${count} outside expected range ${min}-${max}`
    };
  }
  
  return {
    passed: true,
    message: `${entityType} count: ${count} (within ${min}-${max})`
  };
}

/**
 * Pre-ingestion validation checks
 */
export async function preIngestionChecks() {
  logger.info('🔍 Running pre-ingestion validation...');
  
  const checks = [];
  
  // Check products.json
  const productsExist = await dataFileExists('products.json');
  checks.push({ name: 'Products file exists', ...productsExist });
  
  if (productsExist.passed) {
    const productsValid = await dataFileValidJson('products.json');
    checks.push({ name: 'Products JSON valid', ...productsValid });
    
    if (productsValid.passed) {
      const productsCount = entityCountInRange(
        productsValid.data.count,
        1,
        500,
        'Products'
      );
      checks.push({ name: 'Products count', ...productsCount });
    }
  }
  
  // Check variants.json
  const variantsExist = await dataFileExists('variants.json');
  checks.push({ name: 'Variants file exists', ...variantsExist });
  
  if (variantsExist.passed) {
    const variantsValid = await dataFileValidJson('variants.json');
    checks.push({ name: 'Variants JSON valid', ...variantsValid });
    
    if (variantsValid.passed) {
      const variantsCount = entityCountInRange(
        variantsValid.data.count,
        1,
        1000,
        'Variants'
      );
      checks.push({ name: 'Variants count', ...variantsCount });
    }
  }
  
  // Check metadata.json
  const metadataExist = await dataFileExists('metadata.json');
  checks.push({ name: 'Metadata file exists', ...metadataExist });
  
  if (metadataExist.passed) {
    const metadataValid = await dataFileValidJson('metadata.json');
    checks.push({ name: 'Metadata JSON valid', ...metadataValid });
    
    if (metadataValid.passed) {
      const metadataCount = entityCountInRange(
        metadataValid.data.count,
        1,
        100,
        'Attributes'
      );
      checks.push({ name: 'Metadata count', ...metadataCount });
    }
  }
  
  // Check price-books.json
  const priceBooksExist = await dataFileExists('price-books.json');
  checks.push({ name: 'Price books file exists', ...priceBooksExist });
  
  if (priceBooksExist.passed) {
    const priceBooksValid = await dataFileValidJson('price-books.json');
    checks.push({ name: 'Price books JSON valid', ...priceBooksValid });
  }
  
  // Check prices.json
  const pricesExist = await dataFileExists('prices.json');
  checks.push({ name: 'Prices file exists', ...pricesExist });
  
  if (pricesExist.passed) {
    const pricesValid = await dataFileValidJson('prices.json');
    checks.push({ name: 'Prices JSON valid', ...pricesValid });
    
    if (pricesValid.passed) {
      const pricesCount = entityCountInRange(
        pricesValid.data.count,
        1,
        5000,
        'Prices'
      );
      checks.push({ name: 'Prices count', ...pricesCount });
    }
  }
  
  // Report results
  const allPassed = checks.every(check => check.passed);
  
  checks.forEach(check => {
    if (check.passed) {
      logger.info(`  ✓ ${check.name}: ${check.message}`);
    } else {
      logger.error(`  ✗ ${check.name}: ${check.message}`);
    }
  });
  
  if (!allPassed) {
    logger.error('\n❌ Pre-ingestion validation FAILED');
    throw new Error('Pre-ingestion validation failed');
  }
  
  logger.info('✅ Pre-ingestion validation PASSED\n');
  
  return { passed: true, checks };
}

/**
 * Post-ingestion validation checks
 * 
 * Note: This is a placeholder for future GraphQL-based validation
 * Currently, ACO doesn't have reliable count queries via GraphQL
 */
export async function postIngestionChecks() {
  logger.info('🔍 Running post-ingestion validation...');
  
  // Future: Query ACO to verify entity counts match expectations
  // Currently limited by ACO GraphQL capabilities
  
  logger.info('  ℹ️  Post-ingestion validation not yet implemented');
  logger.info('  (ACO GraphQL queries limited for count verification)');
  logger.info('✅ Post-ingestion validation SKIPPED\n');
  
  return { passed: true, skipped: true };
}

/**
 * Run validation checks based on phase
 */
export async function runValidationChecks(phase) {
  switch (phase) {
    case 'pre-ingest':
      return await preIngestionChecks();
    
    case 'post-ingest':
      return await postIngestionChecks();
    
    default:
      throw new Error(`Unknown validation phase: ${phase}`);
  }
}

export default {
  preIngestionChecks,
  postIngestionChecks,
  runValidationChecks
};

