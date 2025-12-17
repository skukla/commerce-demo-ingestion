#!/usr/bin/env node

/**
 * State Tracking System
 * Tracks what has been imported/created to enable idempotent operations
 * 
 * Features:
 * - Persistent state across runs
 * - Fast lookups for existence checks
 * - Automatic state updates
 * - State validation and cleanup
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from './commerce-api.js';
import { PROJECT_CONFIG } from '../../shared/config-loader.js';

const STATE_DIR = join(process.cwd(), `.${PROJECT_CONFIG.identifier}-state`);
const STATE_FILE = join(STATE_DIR, 'import-state.json');

/**
 * State Tracker for idempotent operations
 */
export class StateTracker {
  constructor() {
    this.state = this.loadState();
  }

  /**
   * Load state from disk
   */
  loadState() {
    if (!existsSync(STATE_FILE)) {
      return {
        version: '1.0.0',
        lastUpdated: null,
        products: new Set(),
        categories: new Set(),
        attributes: new Set(),
        customerGroups: new Set(),
        customerAttributes: new Set(),
        metadata: {}
      };
    }

    try {
      const raw = readFileSync(STATE_FILE, 'utf8');
      const data = JSON.parse(raw);
      
      // Convert arrays back to Sets for fast lookups
      return {
        ...data,
        products: new Set(data.products || []),
        categories: new Set(data.categories || []),
        attributes: new Set(data.attributes || []),
        customerGroups: new Set(data.customerGroups || []),
        customerAttributes: new Set(data.customerAttributes || []),
      };
    } catch (error) {
      logger.warn(`Failed to load state: ${error.message}`);
      return this.getEmptyState();
    }
  }

  /**
   * Save state to disk
   */
  saveState() {
    try {
      // Ensure directory exists
      if (!existsSync(STATE_DIR)) {
        mkdirSync(STATE_DIR, { recursive: true });
      }

      // Convert Sets to arrays for JSON serialization
      const data = {
        version: this.state.version,
        lastUpdated: new Date().toISOString(),
        products: Array.from(this.state.products),
        categories: Array.from(this.state.categories),
        attributes: Array.from(this.state.attributes),
        customerGroups: Array.from(this.state.customerGroups),
        customerAttributes: Array.from(this.state.customerAttributes),
        metadata: this.state.metadata
      };

      writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      logger.error(`Failed to save state: ${error.message}`);
      return false;
    }
  }

  /**
   * Get empty state structure
   */
  getEmptyState() {
    return {
      version: '1.0.0',
      lastUpdated: null,
      products: new Set(),
      categories: new Set(),
      attributes: new Set(),
      customerGroups: new Set(),
      customerAttributes: new Set(),
      metadata: {}
    };
  }

  /**
   * Check if entity already imported
   */
  hasProduct(sku) {
    return this.state.products.has(sku);
  }

  hasCategory(id) {
    return this.state.categories.has(String(id));
  }

  hasAttribute(code) {
    return this.state.attributes.has(code);
  }

  hasCustomerGroup(id) {
    return this.state.customerGroups.has(String(id));
  }

  hasCustomerAttribute(code) {
    return this.state.customerAttributes.has(code);
  }

  /**
   * Mark entity as imported
   */
  addProduct(sku) {
    this.state.products.add(sku);
  }

  addCategory(id) {
    this.state.categories.add(String(id));
  }

  addAttribute(code) {
    this.state.attributes.add(code);
  }

  addCustomerGroup(id) {
    this.state.customerGroups.add(String(id));
  }

  addCustomerAttribute(code) {
    this.state.customerAttributes.add(code);
  }

  /**
   * Remove entity from state
   */
  removeProduct(sku) {
    this.state.products.delete(sku);
  }

  removeCategory(id) {
    this.state.categories.delete(String(id));
  }

  removeAttribute(code) {
    this.state.attributes.delete(code);
  }

  removeCustomerGroup(id) {
    this.state.customerGroups.delete(String(id));
  }

  removeCustomerAttribute(code) {
    this.state.customerAttributes.delete(code);
  }

  /**
   * Clear all state
   */
  clearAll() {
    this.state = this.getEmptyState();
    this.saveState();
  }

  clearProducts() {
    this.state.products.clear();
    this.saveState();
  }

  clearCategories() {
    this.state.categories.clear();
    this.saveState();
  }

  clearAttributes() {
    this.state.attributes.clear();
    this.saveState();
  }

  /**
   * Get all items as arrays (for deletion)
   */
  getAllProductSKUs() {
    return Array.from(this.state.products);
  }

  getAllCategoryIds() {
    return Array.from(this.state.categories);
  }

  getAllAttributeCodes() {
    return Array.from(this.state.attributes);
  }

  getAllCustomerGroupIds() {
    return Array.from(this.state.customerGroups);
  }

  getAllCustomerAttributeCodes() {
    return Array.from(this.state.customerAttributes);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      products: this.state.products.size,
      categories: this.state.categories.size,
      attributes: this.state.attributes.size,
      customerGroups: this.state.customerGroups.size,
      customerAttributes: this.state.customerAttributes.size,
      lastUpdated: this.state.lastUpdated
    };
  }

  /**
   * Set metadata
   */
  setMetadata(key, value) {
    this.state.metadata[key] = value;
  }

  getMetadata(key) {
    return this.state.metadata[key];
  }

  /**
   * Validate state against Commerce
   */
  async validate(commerceApi) {
    const issues = [];

    // Sample validation: check if tracked products exist in Commerce
    const sampleSize = Math.min(10, this.state.products.size);
    const samples = Array.from(this.state.products).slice(0, sampleSize);

    for (const sku of samples) {
      try {
        await commerceApi.getProduct(sku);
      } catch (error) {
        if (error.message.includes('404')) {
          issues.push({
            type: 'product',
            sku,
            issue: 'Tracked in state but not found in Commerce'
          });
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      sampledCount: sampleSize,
      totalTracked: this.state.products.size
    };
  }

  /**
   * Get state file path
   */
  getStateFilePath() {
    return STATE_FILE;
  }
}

/**
 * Global state tracker instance
 */
let globalTracker = null;

export function getStateTracker() {
  if (!globalTracker) {
    globalTracker = new StateTracker();
  }
  return globalTracker;
}

export default StateTracker;

