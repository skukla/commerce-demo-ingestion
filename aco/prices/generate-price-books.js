#!/usr/bin/env node

/**
 * Generate Price Books Script
 * Creates persona-driven price books for BuildRight ACO
 * 
 * Structure:
 * - 1 base price book (US-Retail)
 * - 4 customer tier price books (Production-Builder, Trade-Professional, Wholesale-Reseller, Retail-Registered)
 * 
 * Each customer tier provides different discount levels off retail pricing.
 * Volume tier pricing (quantity-based discounts) is handled in the price generation phase.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../shared/logger.js';
import { DATA_REPO_PATH as DATA_REPO } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger('generate-price-books');

/**
 * Price book structure configuration
 * @constant {Object}
 */
const PRICE_BOOK_STRUCTURE = {
  // Base price book (has currency)
  base: {
    priceBookId: 'US-Retail',
    name: 'US Retail Catalog Pricing',
    currency: 'USD',
    description: 'Base retail pricing for all products'
  },

  // Customer tier price books (have parentId)
  tiers: [
    {
      priceBookId: 'Production-Builder',
      name: 'Production Builder Pricing',
      parentId: 'US-Retail',
      description: 'Volume pricing for production home builders (120+ homes/year)',
      discount: 0.15, // 15% off retail
      persona: 'Sarah Martinez - Production Builder'
    },
    {
      priceBookId: 'Trade-Professional',
      name: 'Trade Professional Pricing',
      parentId: 'US-Retail',
      description: 'Professional pricing for licensed contractors and remodelers',
      discount: 0.10, // 10% off retail
      persona: 'Marcus Johnson (GC), Lisa Chen (Remodeler)'
    },
    {
      priceBookId: 'Wholesale-Reseller',
      name: 'Wholesale Reseller Pricing',
      parentId: 'US-Retail',
      description: 'Wholesale pricing for retail stores buying for resale',
      discount: 0.25, // 25% off retail (cost-based)
      persona: 'Kevin Rodriguez - Store Manager'
    },
    {
      priceBookId: 'Retail-Registered',
      name: 'Registered Customer Pricing',
      parentId: 'US-Retail',
      description: 'Loyalty pricing for registered DIY customers',
      discount: 0.05, // 5% loyalty discount
      persona: 'David Thompson - Pro Homeowner (optional - can use base retail)'
    }
  ]
};

/**
 * Generates price books for BuildRight persona-driven pricing.
 *
 * ACO Price Book Schema:
 *   PriceBookBase:
 *     - priceBookId {string} - Unique identifier (required)
 *     - name {string} - Human-readable name (required)
 *     - currency {string} - ISO currency code (required)
 *
 *   PriceBookChild:
 *     - priceBookId {string} - Unique identifier (required)
 *     - name {string} - Human-readable name (required)
 *     - parentId {string} - References parent price book (required)
 *     - NO currency field (inherited from parent)
 *
 * @returns {Array<Object>} Array of price book objects matching ACO FeedPricebook schema
 */
export function generatePriceBooks() {
  const priceBooks = [];

  // Add base price book
  priceBooks.push({
    priceBookId: PRICE_BOOK_STRUCTURE.base.priceBookId,
    name: PRICE_BOOK_STRUCTURE.base.name,
    currency: PRICE_BOOK_STRUCTURE.base.currency
  });

  // Add customer tier price books
  PRICE_BOOK_STRUCTURE.tiers.forEach(tier => {
    priceBooks.push({
      priceBookId: tier.priceBookId,
      name: tier.name,
      parentId: tier.parentId
    });
  });

  return priceBooks;
}

/**
 * Validates price book structure for ACO compliance.
 *
 * @param {Array<Object>} priceBooks - Array of price books to validate
 * @returns {Object} Validation result containing:
 *   - valid {boolean} - True if validation passes, false otherwise
 *   - errors {Array<string>} - Array of validation error messages
 */
export function validatePriceBooks(priceBooks) {
  const errors = [];
  const priceBookIds = new Set(priceBooks.map(pb => pb.priceBookId));

  // Check for unique priceBookIds
  if (priceBookIds.size !== priceBooks.length) {
    errors.push('Validation error: Duplicate price book IDs detected');
  }

  // Validate required fields for each price book
  priceBooks.forEach(pb => {
    if (!pb.priceBookId) {
      errors.push(`Missing required field 'priceBookId' in price book`);
    }
    if (!pb.name) {
      errors.push(`Missing required field 'name' in price book ${pb.priceBookId}`);
    }

    // Base book validation (no parentId)
    if (!pb.parentId) {
      if (!pb.currency) {
        errors.push(`Missing required field 'currency' in base price book ${pb.priceBookId}`);
      }
    } else {
      // Child book validation (has parentId)
      if (pb.currency) {
        errors.push(`Child price book ${pb.priceBookId} should not have 'currency' field (inherited from parent)`);
      }

      // Validate parent reference exists
      if (!priceBookIds.has(pb.parentId)) {
        errors.push(`Invalid parent reference in ${pb.priceBookId}: parent '${pb.parentId}' does not exist`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get pricing strategy metadata for documentation
 * @returns {Object} Pricing strategy details
 */
export function getPricingStrategy() {
  return {
    structure: '2-level hierarchy (base → customer tier)',
    totalPriceBooks: 1 + PRICE_BOOK_STRUCTURE.tiers.length,
    customerTiers: PRICE_BOOK_STRUCTURE.tiers.map(tier => ({
      id: tier.priceBookId,
      name: tier.name,
      discount: `${(tier.discount * 100).toFixed(0)}%`,
      persona: tier.persona,
      description: tier.description
    })),
    volumeTiers: {
      note: 'Volume tier pricing (quantity-based discounts) is defined in price generation phase',
      tiers: [
        { range: '1-99 units', discount: '0% (base tier price)' },
        { range: '100-293 units', discount: '3% volume discount' },
        { range: '294+ units', discount: '8% pallet discount' }
      ],
      applicableProducts: 'High-volume products (lumber, fasteners, common materials)'
    }
  };
}

/**
 * Main execution function
 * Generates price books and writes them to the output file
 */
async function main() {
  logger.info('Starting price book generation...');
  logger.info('Strategy: Persona-driven customer tier pricing with volume discounts');

  try {
    // Generate price books
    logger.info('Generating price books...');
    const priceBooks = generatePriceBooks();
    logger.info(`Generated ${priceBooks.length} price books`);

    // Validate structure
    logger.info('Validating price book structure...');
    const validation = validatePriceBooks(priceBooks);

    if (!validation.valid) {
      logger.error('Price book validation failed:', validation.errors);
      process.exit(1);
    }

    logger.info('Price book validation passed');

    // Log pricing strategy
    const strategy = getPricingStrategy();
    logger.info('Pricing Strategy:', {
      structure: strategy.structure,
      totalPriceBooks: strategy.totalPriceBooks
    });

    logger.info('Customer Tiers:');
    strategy.customerTiers.forEach((tier, idx) => {
      logger.info(`  ${idx + 1}. ${tier.name} (${tier.discount} off retail)`);
      logger.info(`     Persona: ${tier.persona}`);
    });

    logger.info('Volume Tier Pricing:');
    strategy.volumeTiers.tiers.forEach(tier => {
      logger.info(`  - ${tier.range}: ${tier.discount}`);
    });

    // Ensure output directory exists
    const outputDir = path.join(DATA_REPO, 'generated/aco');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      logger.info(`Created output directory: ${outputDir}`);
    }
    
    // Write to file
    const outputPath = path.join(outputDir, 'price-books.json');
    fs.writeFileSync(outputPath, JSON.stringify(priceBooks, null, 2));
    logger.info(`Price books written to ${outputPath}`);

    // Log summary
    logger.info('');
    logger.info('Price book generation complete:');
    logger.info(`  Total price books: ${priceBooks.length}`);
    logger.info(`  Structure: ${strategy.structure}`);
    logger.info(`  Base book: 1 (US-Retail)`);
    logger.info(`  Customer tiers: ${PRICE_BOOK_STRUCTURE.tiers.length}`);
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Run generate-prices-simple.js to create volume-tiered pricing');
    logger.info('  2. Run ingest-price-books.js to ingest to ACO');
    logger.info('  3. Run ingest-prices.js to ingest prices to ACO');

  } catch (error) {
    logger.error('Error generating price books:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
