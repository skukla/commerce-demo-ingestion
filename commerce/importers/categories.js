#!/usr/bin/env node

/**
 * Import Categories to Commerce
 * Creates the project category tree
 * 
 * Uses BaseImporter for standardized patterns
 */

import { BaseImporter } from '../../shared/base-importer.js';
import { CATEGORY_TREE, COMMERCE_CONFIG } from '../../shared/config-loader.js';
import { getStateTracker } from '../lib/state-tracker.js';

class CategoryImporter extends BaseImporter {
  constructor(options = {}) {
    super('Categories', options);
    this.categoryMap = {};
    this.rootCategoryId = options.rootCategoryId || null;
    this.stateTracker = getStateTracker();
    this.allCategories = null; // Cache for all categories
    this.rootCategoryUrlKey = this.generateUrlKey(CATEGORY_TREE.name);
  }
  
  generateUrlKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  
  async import() {
    // Count total categories (parent + children)
    const totalCategories = 1 + this.countCategories(CATEGORY_TREE.children || []);
    
    // Pre-fetch all categories once for fast lookups
    await this.preFetchCategories();
    
    // Determine root category
    const rootId = await this.getRootCategoryId();
    
    // Start progress bar
    const { BatchProgress } = await import('../../shared/progress.js');
    this.progress = new BatchProgress('Importing categories', totalCategories);
    
    // Create/find project root category
    const parentId = await this.ensureProjectRootCategory(rootId);
    
    // Create child categories recursively
    if (CATEGORY_TREE.children) {
      await this.createCategoryTree(CATEGORY_TREE.children, parentId);
    }
    
    // Clear progress bar (orchestrator will show the summary)
    if (this.progress) {
      const { updateLine } = await import('../../shared/format.js');
      updateLine(''); // Clear the progress bar line
    }
    
    return { 
      categoryMap: this.categoryMap,
      rootCategoryId: parentId
    };
  }
  
  async preFetchCategories() {
    try {
      const response = await this.api.get('/rest/V1/categories/list?searchCriteria[pageSize]=1000');
      this.allCategories = response.items || [];
      this.logger.info(`Found ${this.allCategories.length} existing categories\n`);
    } catch (error) {
      this.logger.warn(`Could not pre-fetch categories: ${error.message}`);
      this.allCategories = [];
    }
  }
  
  findCategoryByName(name, parentId) {
    if (!this.allCategories) return null;
    return this.allCategories.find(cat => cat.name === name && cat.parent_id === parentId);
  }
  
  countCategories(categories) {
    let count = 0;
    for (const cat of categories) {
      count++;
      if (cat.children?.length > 0) {
        count += this.countCategories(cat.children);
      }
    }
    return count;
  }
  
  async getRootCategoryId() {
    // Project root category should be at Magento root level (parent_id: 1)
    // This makes it a peer of "Default Category", not a child
    this.logger.debug(`${CATEGORY_TREE.name} will be created at Magento root level (parent_id: 1)`);
    return 1; // Magento root - makes project catalog a top-level root category
  }
  
  async ensureProjectRootCategory(rootId) {
    this.logger.debug(`Setting up root category: ${CATEGORY_TREE.name}`);
    
    // Check if exists using cached categories
    const existing = this.findCategoryByName(CATEGORY_TREE.name, rootId);
    if (existing) {
      this.categoryMap[CATEGORY_TREE.name] = existing.id;
      this.categoryMap[this.rootCategoryUrlKey] = existing.id;
      this.results.addExisting({ name: CATEGORY_TREE.name, id: existing.id });
      this.stateTracker.addCategory(existing.id);
      if (this.progress) this.progress.increment('existing');
      return existing.id;
    }
    
    // Create root category
    const parent = {
      parent_id: rootId,
      name: CATEGORY_TREE.name,
      is_active: true,
      include_in_menu: true,
      custom_attributes: [
        { attribute_code: 'url_key', value: this.rootCategoryUrlKey }
      ]
    };
    
    try {
      const created = await this.api.createCategory(parent);
      
      if (this.isDryRun) {
        this.categoryMap[CATEGORY_TREE.name] = 'dry-run-parent';
        this.categoryMap[this.rootCategoryUrlKey] = 'dry-run-parent';
        this.results.addCreated({ name: CATEGORY_TREE.name, id: 'dry-run' });
        if (this.progress) this.progress.increment('created');
        return 'dry-run-parent';
      }
      
      this.categoryMap[CATEGORY_TREE.name] = created.id;
      this.categoryMap[this.rootCategoryUrlKey] = created.id;
      this.results.addCreated({ name: CATEGORY_TREE.name, id: created.id, urlKey: this.rootCategoryUrlKey });
      this.stateTracker.addCategory(created.id);
      if (this.progress) this.progress.increment('created');
      
      // Add to cache for subsequent lookups
      if (this.allCategories) {
        this.allCategories.push(created);
      }
      
      return created.id;
    } catch (error) {
      this.logger.error(`  Failed to create root category: ${error.message}`);
      this.results.addFailed({ name: CATEGORY_TREE.name }, error);
      if (this.progress) this.progress.increment('failed');
      throw error;
    }
  }
  
  async createCategoryTree(categories, parentId, depth = 0) {
    const indent = '  '.repeat(depth);
    
    for (const catDef of categories) {
      
      // Check if exists under this parent using cached categories
      let categoryId;
      const existing = this.findCategoryByName(catDef.name, parentId);
      
      if (existing) {
        categoryId = existing.id;
        this.results.addExisting({ name: catDef.name, id: categoryId, urlKey: catDef.urlKey });
        this.stateTracker.addCategory(categoryId);
        if (this.progress) this.progress.increment('existing');
      } else {
        // Create category
        try {
          const category = {
            parent_id: parentId,
            name: catDef.name,
            is_active: true,
            include_in_menu: true,
            custom_attributes: []
          };
          
          if (catDef.urlKey) {
            category.custom_attributes.push({
              attribute_code: 'url_key',
              value: catDef.urlKey
            });
          }
          
          const created = await this.api.createCategory(category);
          
          if (this.isDryRun) {
            categoryId = `dry-run-${catDef.urlKey}`;
          } else {
            categoryId = created.id;
            // Add to cache for subsequent lookups
            if (this.allCategories) {
              this.allCategories.push(created);
            }
          }
          
          this.results.addCreated({ name: catDef.name, id: categoryId, urlKey: catDef.urlKey });
          this.stateTracker.addCategory(categoryId);
          if (this.progress) this.progress.increment('created');
        } catch (error) {
          this.logger.error(`${indent}  Failed to create ${catDef.name}: ${error.message}`);
          this.results.addFailed({ name: catDef.name }, error);
          if (this.progress) this.progress.increment('failed');
          continue; // Skip children if parent failed
        }
      }
      
      // Store in map
      if (catDef.urlKey) {
        this.categoryMap[catDef.urlKey] = categoryId;
      }
      this.categoryMap[catDef.name] = categoryId;
      
      // Process children recursively
      if (catDef.children?.length > 0) {
        await this.createCategoryTree(catDef.children, categoryId, depth + 1);
      }
    }
  }
}

/**
 * Main import function (for use by import-all.js)
 */
export async function importCategories(options = {}) {
  const importer = new CategoryImporter(options);
  return importer.run();
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  importCategories()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { CategoryImporter };
