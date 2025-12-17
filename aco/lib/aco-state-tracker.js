/**
 * ACO State Tracker
 * 
 * Tracks ingested entities to ACO for:
 * - Idempotency (skip already-ingested items)
 * - Resume capability (continue after failure)
 * - Validation (verify expected vs actual)
 * 
 * Mirrors Commerce state tracker pattern for consistency.
 * 
 * @module utils/aco-state-tracker
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import path from 'path';
import logger from '../../shared/logger.js';
import { PROJECT_CONFIG } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use project identifier from config for multi-project support
const STATE_DIR = join(process.cwd(), `.${PROJECT_CONFIG.identifier}-state`);
const STATE_FILE = path.join(STATE_DIR, 'aco-ingest-state.json');

/**
 * ACO State Tracker
 * Tracks all ingested entities for idempotency and validation
 */
class ACOStateTracker {
  constructor() {
    this.state = {
      categories: new Set(), // All category codes
      products: new Set(), // All product SKUs (simple + variants)
      metadata: new Set(),
      priceBooks: new Set(),
      prices: new Map(), // Map<sku, Set<priceBookId>>
      lastUpdated: null
    };
    
    this.loaded = false;
  }

  /**
   * Load state from disk
   */
  async load() {
    try {
      const data = await fs.readFile(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.state.categories = new Set(parsed.categories || []);
      this.state.products = new Set(parsed.products || []);
      this.state.metadata = new Set(parsed.metadata || []);
      this.state.priceBooks = new Set(parsed.priceBooks || []);
      
      // Reconstruct Map from object
      this.state.prices = new Map();
      if (parsed.prices) {
        Object.entries(parsed.prices).forEach(([sku, priceBookIds]) => {
          this.state.prices.set(sku, new Set(priceBookIds));
        });
      }
      
      this.state.lastUpdated = parsed.lastUpdated;
      this.loaded = true;
      
      logger.debug(`Loaded ACO state: ${this.state.categories.size} categories, ${this.state.products.size} products`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug('No existing ACO state file found (first run)');
      } else {
        logger.warn('Failed to load ACO state:', error.message);
      }
      this.loaded = true;
    }
  }

  /**
   * Save state to disk
   */
  async save() {
    try {
      // Ensure state directory exists
      await fs.mkdir(STATE_DIR, { recursive: true });
      
      // Convert Sets/Maps to serializable format
      const serializable = {
        categories: Array.from(this.state.categories),
        products: Array.from(this.state.products),
        metadata: Array.from(this.state.metadata),
        priceBooks: Array.from(this.state.priceBooks),
        prices: {},
        lastUpdated: new Date().toISOString()
      };
      
      // Convert Map<string, Set> to object
      this.state.prices.forEach((priceBookIds, sku) => {
        serializable.prices[sku] = Array.from(priceBookIds);
      });
      
      await fs.writeFile(STATE_FILE, JSON.stringify(serializable, null, 2));
      
      // Always log state saves (not just debug) so we can verify it's working
      if (this.state.categories.size > 0 || this.state.products.size > 0 || this.state.metadata.size > 0 || this.state.priceBooks.size > 0) {
        logger.debug(`💾 Saved state: ${this.state.categories.size} categories, ${this.state.products.size} products, ${this.state.metadata.size} metadata, ${this.state.priceBooks.size} price books`);
      } else {
        logger.debug('Saved empty ACO state');
      }
    } catch (error) {
      logger.error('Failed to save ACO state:', error.message);
      throw error; // Re-throw so caller knows state wasn't saved
    }
  }

  // Category methods
  addCategory(code) {
    this.state.categories.add(code);
  }

  hasCategory(code) {
    return this.state.categories.has(code);
  }

  getCategoryCount() {
    return this.state.categories.size;
  }

  getAllCategoryCodes() {
    return Array.from(this.state.categories);
  }

  // Product methods
  addProduct(sku) {
    this.state.products.add(sku);
  }

  hasProduct(sku) {
    return this.state.products.has(sku);
  }

  // Metadata methods
  addMetadata(code) {
    this.state.metadata.add(code);
  }

  hasMetadata(code) {
    return this.state.metadata.has(code);
  }

  // Price book methods
  addPriceBook(priceBookId) {
    this.state.priceBooks.add(priceBookId);
  }

  hasPriceBook(priceBookId) {
    return this.state.priceBooks.has(priceBookId);
  }

  // Price methods
  addPrice(sku, priceBookId) {
    if (!this.state.prices.has(sku)) {
      this.state.prices.set(sku, new Set());
    }
    this.state.prices.get(sku).add(priceBookId);
  }

  hasPrice(sku, priceBookId) {
    return this.state.prices.has(sku) && 
           this.state.prices.get(sku).has(priceBookId);
  }

  // Utility methods
  getProductCount() {
    return this.state.products.size;
  }

  getAllProductSKUs() {
    return Array.from(this.state.products);
  }

  markProductIngested(sku) {
    const wasNew = !this.state.products.has(sku);
    this.state.products.add(sku);
    return wasNew;
  }

  getAllMetadataCodes() {
    return Array.from(this.state.metadata);
  }

  getPriceBooks() {
    return Array.from(this.state.priceBooks);
  }

  getPriceBookCount() {
    return this.state.priceBooks.size;
  }

  getPriceCount() {
    let total = 0;
    this.state.prices.forEach(priceBookIds => {
      total += priceBookIds.size;
    });
    return total;
  }

  /**
   * Clear all state
   */
  clearAll() {
    this.state.categories.clear();
    this.state.products.clear();
    this.state.metadata.clear();
    this.state.priceBooks.clear();
    this.state.prices.clear();
    this.state.lastUpdated = null;
  }

  /**
   * Clear only product SKUs
   */
  clearProducts() {
    this.state.products.clear();
  }

  /**
   * Clear only prices
   */
  clearPrices() {
    this.state.prices.clear();
  }

  /**
   * Clear only price books
   */
  clearPriceBooks() {
    this.state.priceBooks.clear();
  }

  /**
   * Clear only metadata
   */
  clearMetadata() {
    this.state.metadata.clear();
  }

  /**
   * Get state file path
   */
  getStateFilePath() {
    return STATE_FILE;
  }
}

// Singleton instance
let stateTrackerInstance = null;

/**
 * Get singleton state tracker instance
 */
export function getStateTracker() {
  if (!stateTrackerInstance) {
    stateTrackerInstance = new ACOStateTracker();
  }
  return stateTrackerInstance;
}

export default ACOStateTracker;

