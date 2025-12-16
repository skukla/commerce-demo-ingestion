#!/usr/bin/env node

/**
 * Generate Prices Simple Script
 * Creates SIMPLIFIED pricing data for demo purposes
 *
 * Simplified Model:
 * - 184 products × 10 price books = 1,840 base prices
 * - Volume tiers only for high-volume products (~20%) = ~70 tier prices
 * - TOTAL: ~1,910 prices (vs 29,953 in complex model)
 *
 * Still demonstrates:
 * ✓ Hierarchical price books (10 books across 3 levels)
 * ✓ Tier-based pricing (Commercial-Tier2 gets 5% better pricing)
 * ✓ Volume discounts (for lumber and high-volume items)
 *
 * Removes:
 * ✗ Complex multi-tier pricing per price book
 * ✗ Regional price adjustments
 * ✗ Excessive volume breakpoints
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../shared/logger.js';
import { SeededRandom } from '../../shared/random-seed.js';
import { DATA_REPO_PATH as DATA_REPO } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger('generate-prices-simple');

/**
 * Price book tier discounts (applied to base price)
 */
const TIER_DISCOUNTS = {
  // Level 1: Base (no discount)
  'US-Retail': 0.00,
  'US-Contract': 0.00,

  // Level 2: Segment (no additional discount - inherit from parent)
  'Retail-Consumer': 0.00,
  'Contract-Commercial': 0.00,
  'Contract-Residential': 0.00,
  'Contract-Pro': 0.00,

  // Level 3: Volume Tiers (reward high-volume customers)
  'Commercial-Tier1': 0.03,    // 3% discount
  'Commercial-Tier2': 0.05,    // 5% discount (best)
  'Residential-Builder': 0.02, // 2% discount
  'Pro-Specialty': 0.03        // 3% discount
};

/**
 * Determine if product should have volume tiers
 * Only high-volume products (lumber, fasteners) get volume pricing
 */
function shouldHaveVolumeTiers(product) {
  // Bundles don't get volume tiers
  if (product.type === 'BUNDLE' || product.type === 'bundle') {
    return false;
  }

  // Services don't get volume tiers
  if (product.type === 'SERVICE' || product.type === 'service') {
    return false;
  }

  // Lumber products get volume tiers
  if (product.sku && product.sku.startsWith('LBR-')) {
    return true;
  }

  // Fasteners get volume tiers
  if (product.sku && product.sku.startsWith('FAST-')) {
    return true;
  }

  // Concrete products get volume tiers
  if (product.sku && product.sku.startsWith('CONC-')) {
    return true;
  }

  return false;
}

/**
 * Generate base price for a product
 */
function generateBasePrice(product, random) {
  if (product.basePrice) {
    return product.basePrice;
  }

  // Default price ranges by SKU prefix
  const skuPrefix = product.sku ? product.sku.split('-')[0] : 'MISC';

  const priceRanges = {
    'LBR': { min: 5, max: 50 },      // Lumber: $5-$50
    'CONC': { min: 8, max: 30 },     // Concrete: $8-$30
    'FAST': { min: 2, max: 25 },     // Fasteners: $2-$25
    'WIN': { min: 150, max: 800 },   // Windows: $150-$800
    'DOOR': { min: 200, max: 1200 }, // Doors: $200-$1200
    'ROOF': { min: 30, max: 150 },   // Roofing: $30-$150
    'PPE': { min: 5, max: 100 },     // Safety: $5-$100
    'SVC': { min: 50, max: 500 },    // Services: $50-$500
    'BUNDLE': { min: 200, max: 2000 }// Bundles: $200-$2000
  };

  const range = priceRanges[skuPrefix] || { min: 10, max: 100 };
  return random.nextFloat(range.min, range.max);
}

/**
 * Format price to 2 decimal places
 */
function formatPrice(price) {
  return Math.round(price * 100) / 100;
}

/**
 * Generate simplified prices
 */
export function generatePricesSimple(products, priceBooks, randomSeed = 12345) {
  const prices = [];
  const random = new SeededRandom(randomSeed);

  // Generate consistent base prices for all products
  const productBasePrices = new Map();
  products.forEach(product => {
    productBasePrices.set(product.sku, generateBasePrice(product, random));
  });

  logger.info(`Generating simplified prices for ${products.length} products across ${priceBooks.length} price books...`);

  // For each price book
  priceBooks.forEach(priceBook => {
    const tierDiscount = TIER_DISCOUNTS[priceBook.id] || 0;

    // For each product
    products.forEach(product => {
      const basePrice = productBasePrices.get(product.sku);

      // Apply tier discount
      const finalPrice = basePrice * (1 - tierDiscount);

      // Build price entry
      const priceEntry = {
        sku: product.sku,
        priceBookId: priceBook.priceBookId,
        regular: formatPrice(finalPrice)
      };

      // Add volume tiers ONLY for eligible products
      // AND only in base price book (to avoid duplication)
      if (priceBook.priceBookId === 'US-Contract' && shouldHaveVolumeTiers(product)) {
        priceEntry.tierPrices = [
          {
            qty: 100,
            price: formatPrice(finalPrice * 0.97) // 3% additional discount
          },
          {
            qty: 500,
            price: formatPrice(finalPrice * 0.92) // 8% additional discount
          }
        ];
      }

      prices.push(priceEntry);
    });
  });

  logger.info(`Generated ${prices.length} price entries`);

  // Calculate breakdown
  const basePrices = prices.filter(p => !p.tierPrices).length;
  const tierPrices = prices.filter(p => p.tierPrices).length;
  const totalTiers = prices.reduce((sum, p) => sum + (p.tierPrices?.length || 0), 0);

  logger.info(`  - Base prices (no tiers): ${basePrices}`);
  logger.info(`  - Prices with volume tiers: ${tierPrices}`);
  logger.info(`  - Total tier definitions: ${totalTiers}`);

  return prices;
}

/**
 * Main execution
 */
async function main() {
  try {
    const dataDir = path.join(DATA_REPO, 'generated/aco');

    // Load products
    logger.info('Loading products...');
    const productsPath = path.join(dataDir, 'products.json');
    const variantsPath = path.join(dataDir, 'variants.json');
    const bundlesPath = path.join(dataDir, 'bundles.json');

    let products = [];

    if (fs.existsSync(productsPath)) {
      products = products.concat(JSON.parse(fs.readFileSync(productsPath, 'utf-8')));
    }

    if (fs.existsSync(variantsPath)) {
      products = products.concat(JSON.parse(fs.readFileSync(variantsPath, 'utf-8')));
    }

    if (fs.existsSync(bundlesPath)) {
      products = products.concat(JSON.parse(fs.readFileSync(bundlesPath, 'utf-8')));
    }

    logger.info(`Loaded ${products.length} products`);

    // Load price books
    logger.info('Loading price books...');
    const priceBookPath = path.join(dataDir, 'price-books.json');
    const priceBooks = JSON.parse(fs.readFileSync(priceBookPath, 'utf-8'));
    logger.info(`Loaded ${priceBooks.length} price books`);

    // Generate simplified prices
    const randomSeed = process.env.SEED ? parseInt(process.env.SEED, 10) : 12345;
    const prices = generatePricesSimple(products, priceBooks, randomSeed);

    // Write to file
    const outputPath = path.join(dataDir, 'prices.json');
    fs.writeFileSync(outputPath, JSON.stringify(prices, null, 2));

    logger.info(`✅ Successfully generated ${prices.length} simplified price entries`);
    logger.info(`   Saved to: ${outputPath}`);

  } catch (error) {
    logger.error('Error generating simplified prices:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
