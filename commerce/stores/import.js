#!/usr/bin/env node

/**
 * Import Stores to Commerce
 * Reads from committed datapack: accs_stores.json
 * 
 * Uses BaseImporter for standardized patterns
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { BaseImporter } from '#shared/base-importer';
import { COMMERCE_CONFIG } from '#config/commerce-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to committed datapack stores file
const DATAPACK_STORES_PATH = resolve(__dirname, '../output/buildright-datapack/data/accs/accs_stores.json');

class StoreImporter extends BaseImporter {
  constructor(options = {}) {
    super('Stores', options);
    this.websiteIds = [];
    this.storeIds = [];
  }
  
  /**
   * Load stores from datapack
   */
  loadStores() {
    this.logger.info(`Loading stores from datapack: ${DATAPACK_STORES_PATH}`);
    const data = JSON.parse(readFileSync(DATAPACK_STORES_PATH, 'utf-8'));
    return data; // Array of store objects
  }
  
  async import() {
    // Load stores from datapack
    const stores = this.loadStores();
    
    this.logger.info(`Stores to process: ${stores.length}`);
    
    // For locked demo, test if store API is accessible
    // If not, skip store import (stores should already exist)
    try {
      const websites = await this.api.get('/rest/V1/store/websites');
    
      // Validate response is actually an array
      if (!Array.isArray(websites)) {
        throw new Error('Store API returned invalid response (not an array)');
      }
      
      this.logger.info(`Store API accessible. Found ${websites.length} existing websites.`);
    
      // Check if the required store already exists
      const existingStore = websites.find(w => w.code === stores[0].site_code);
      if (existingStore) {
        this.logger.info(`Store '${stores[0].site_code}' already exists. Skipping store creation.`);
        this.results.addExisting({ type: 'store', code: stores[0].site_code });
      } else {
        // Process each store configuration
        for (const storeData of stores) {
          await this.processStore(storeData);
  }
      }
    } catch (error) {
      // If API access fails, assume stores already exist (expected for locked demo)
      const errorMsg = error.message || '';
      if (errorMsg.includes('<!doctype html>') || errorMsg.includes('Invalid response') || errorMsg.includes('not an array') || error.status === 404) {
        this.logger.info(`Store management API not accessible (normal for locked demos).`);
        this.logger.info(`Assuming store structure already exists in Commerce.`);
        this.results.addSkipped({ store: 'all' }, 'Store API not accessible - assuming stores already configured');
      } else {
        throw error;
    }
    }
    
    return {
      total: stores.length,
      created: this.results.created.length,
      existing: this.results.existing.length,
      failed: this.results.failed.length,
      skipped: this.results.skipped.length,
      websiteIds: this.websiteIds,
      storeIds: this.storeIds
    };
  }
  
  /**
   * Ensure project root category exists
   * This is called BEFORE checking for website/store/store view
   * So users can select it when manually creating the store structure
   */
  async ensureRootCategory(categoryName) {
    try {
      // Search for the category
      const response = await this.api.get('/categories', {
        searchCriteria: {
          filterGroups: [{
            filters: [{
              field: 'name',
              value: categoryName,
              conditionType: 'eq'
            }]
          }]
        }
      });
      
      if (response.items && response.items.length > 0) {
        this.logger.info(`Root category '${categoryName}' already exists (ID: ${response.items[0].id})`);
        return response.items[0].id;
      }
      
      // Category doesn't exist - create it under Default Category (ID 2)
      this.logger.info(`Creating root category '${categoryName}'...`);
      const category = await this.api.post('/categories', {
        category: {
          parent_id: 2, // Default Category
          name: categoryName,
          is_active: true,
          include_in_menu: true
        }
      });
      
      this.logger.info(`Created root category '${categoryName}' (ID: ${category.id})`);
      return category.id;
      
    } catch (error) {
      this.logger.warn(`Failed to ensure root category '${categoryName}': ${error.message}`);
      this.logger.warn('Users will need to create this category manually or use "Default Category"');
      // Don't throw - this shouldn't block the rest of the process
      return null;
    }
  }
  
  async processStore(storeConfig) {
    try {
      // Create or get website
      const websiteId = await this.ensureWebsite(storeConfig);
      this.websiteIds.push(websiteId);
      
      // Create or get store group
      const storeId = await this.ensureStoreGroup(storeConfig, websiteId);
      this.storeIds.push(storeId);
      
      // Create or get store view
      await this.ensureStoreView(storeConfig, websiteId, storeId);
      
      this.results.addCreated();
      
    } catch (error) {
      // If website doesn't exist, this is a critical error - don't catch it
      if (error.message.includes('not found - manual setup required')) {
        throw error;
      }
      
      // Other errors can be logged as failures
      this.results.addFailed();
      this.logger.error(`Failed to process store ${storeConfig.site_code}: ${error.message}`);
    }
  }
  
  async ensureWebsite(config) {
    // Check if website exists using the correct REST API endpoint
    const websites = await this.api.get('/rest/V1/store/websites');
    const existing = websites.find(w => w.code === config.site_code);
    
    if (existing) {
      this.logger.debug(`Website '${config.site_code}' already exists (ID: ${existing.id})`);
      this.results.addExisting({ type: 'website', code: config.site_code });
      return existing.id;
    }
    
    // Website doesn't exist - create root category first, then show instructions
    const availableCodes = websites.map(w => w.code).join(', ');
    this.logger.error(`${config.site_name || COMMERCE_CONFIG.project.displayName + ' Website'} doesn't exist yet...`);
    this.logger.error(`Creating the ${config.store_root_category} root category...`);
    this.logger.error('');
    
    // Create or ensure root category exists
    await this.ensureRootCategory(config.store_root_category);
    
    this.logger.error('');
    this.logger.error(`Website '${config.site_code}' not found in Commerce.`);
    this.logger.error('');
    this.logger.error('Adobe Commerce does not support website creation via REST API.');
    this.logger.error('You must create the website structure manually in Commerce Admin:');
    this.logger.error('');
    this.logger.error('📋 Required Setup (Commerce Admin → Stores → All Stores):');
    this.logger.error('');
    this.logger.error('1. Create Website:');
    this.logger.error(`   - Code: ${config.site_code}`);
    this.logger.error(`   - Name: ${config.site_name || COMMERCE_CONFIG.project.displayName + ' Website'}`);
    this.logger.error('');
    this.logger.error('2. Create Store (Store Group):');
    this.logger.error(`   - Website: ${config.site_name || COMMERCE_CONFIG.project.displayName + ' Website'}`);
    this.logger.error(`   - Code: ${config.store_code}`);
    this.logger.error(`   - Name: ${config.store_name || COMMERCE_CONFIG.project.displayName + ' Store'}`);
    this.logger.error(`   - Root Category: ${config.store_root_category} (already created for you)`);
    this.logger.error('');
    this.logger.error('3. Create Store View:');
    this.logger.error(`   - Code: ${config.store_view_code}`);
    this.logger.error(`   - Name: ${config.view_name || COMMERCE_CONFIG.project.displayName + ' US'}`);
    this.logger.error('   - Status: Enabled');
    this.logger.error('');
    this.logger.error(`Available websites: ${availableCodes}`);
    this.logger.error('');
    
    throw new Error(`Website '${config.site_code}' not found - manual setup required (see instructions above)`);
  }
  
  async ensureStoreGroup(config, websiteId) {
    try {
      // Check if store group exists
      const groups = await this.api.get('/store/storeGroups');
      const existing = groups.find(g => g.code === config.store_code);
      
    if (existing) {
      return existing.id;
    }
    
      // Need to get root category ID
      const rootCategoryId = await this.findRootCategory(config.store_root_category);
      
      // Create store group
      const group = await this.api.post('/store/storeGroups', {
        group: {
          website_id: websiteId,
          code: config.store_code,
      name: config.store_name,
          root_category_id: rootCategoryId,
          default_store_id: 0
        }
      });
      
      return group.id;
    } catch (error) {
      throw new Error(`Failed to ensure store group: ${error.message}`);
    }
  }
  
  async ensureStoreView(config, websiteId, storeId) {
    try {
      // Check if store view exists
      const views = await this.api.get('/store/storeViews');
      const existing = views.find(v => v.code === config.store_view_code);
      
    if (existing) {
      return existing.id;
    }
    
      // Create store view
      const view = await this.api.post('/store/storeViews', {
        storeView: {
          code: config.view_name,
      name: config.view_name,
          website_id: websiteId,
          store_group_id: storeId,
          is_active: config.view_is_active === 'Y' ? 1 : 0
        }
      });
      
      return view.id;
    } catch (error) {
      throw new Error(`Failed to ensure store view: ${error.message}`);
    }
  }
  
  async findRootCategory(categoryName) {
    try {
      const response = await this.api.get('/categories', {
        searchCriteria: {
          filterGroups: [{
            filters: [{
              field: 'name',
              value: categoryName,
              conditionType: 'eq'
            }]
          }]
        }
      });
      
      if (response.items && response.items.length > 0) {
        return response.items[0].id;
      }
      
      // Default to root category ID 1 if not found
      return 1;
    } catch (error) {
      // Default to root category ID 1
      return 1;
    }
  }
}

/**
 * Main import function
 */
export async function importStores(options = {}) {
  const importer = new StoreImporter(options);
  return await importer.import();
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importStores()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
