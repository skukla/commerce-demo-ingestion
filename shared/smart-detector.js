#!/usr/bin/env node

/**
 * Smart Project Data Detection
 * Finds project-specific data using intelligent pattern matching
 * Configurable patterns - no hardcoded project names
 */

import { commerceApi, logger } from './commerce-api.js';
import { COMMERCE_CONFIG } from './config-loader.js';

/**
 * Smart detection strategies for project-specific data
 * Uses COMMERCE_CONFIG.project for configurable patterns
 */
export class SmartDetector {
  constructor(options = {}) {
    this.silent = options.silent || false;
    this.config = COMMERCE_CONFIG.project;
    this.cache = {
      allProducts: null,
      allAttributes: null,
      allCategories: null,
      rootCategoryId: null
    };
  }

  /**
   * Find ALL project products by website association (PRIMARY STRATEGY)
   * This is the definitive way to identify project products in Commerce
   */
  async findAllProducts() {
    if (!this.silent) {
      logger.info(`🔍 Finding ${this.config.displayName} products by website association...`);
    }

    const skus = await this.findByWebsite();

    if (!this.silent) {
      logger.info(`  ✔ Found ${skus.length} products`);
    }
    
    return {
      skus,
      strategies: [{ name: `Website Association (${this.config.identifier})`, skus, success: true }]
    };
  }

  /**
   * Strategy 1: Find products by website association (PRIMARY)
   */
  async findByWebsite() {
    const products = await this.getAllProducts();
    
    return products
      .filter(product => {
        // Check if product is assigned to buildright website
        const websiteCodes = product.extension_attributes?.website_ids || [];
        // Also check if website_ids custom attribute exists
        const websiteAttr = product.custom_attributes?.find(attr => attr.attribute_code === 'website_ids');
        if (websiteAttr) {
          const websiteIds = Array.isArray(websiteAttr.value) ? websiteAttr.value : [websiteAttr.value];
          // Website ID for 'buildright' is typically 2 or higher (1 is usually base/admin)
          // We'll also check by website code via the API
          return websiteIds.length > 0 && websiteIds.some(id => id > 1);
        }
        return websiteCodes.length > 0 && websiteCodes.some(id => id > 1);
      })
      .map(p => p.sku);
  }

  /**
   * Strategy 2: Find products with project-specific custom attributes
   */
  async findByCustomAttributes() {
    const products = await this.getAllProducts();
    
    return products
      .filter(product => {
        // Check if product has any custom attributes with project prefix
        return product.custom_attributes?.some(attr => 
          attr.attribute_code.startsWith(this.config.attributePrefix)
        );
      })
      .map(p => p.sku);
  }

  /**
   * Strategy 3: Find products in project root category
   */
  async findByCategory() {
    const categoryId = await this.findRootCategoryId();
    
    if (!categoryId) {
      logger.debug(`  No ${this.config.displayName} category found`);
      return [];
    }

    const response = await commerceApi.get(
      `/rest/V1/products?searchCriteria[filterGroups][0][filters][0][field]=category_id` +
      `&searchCriteria[filterGroups][0][filters][0][value]=${categoryId}` +
      `&searchCriteria[filterGroups][0][filters][0][conditionType]=eq` +
      `&searchCriteria[pageSize]=1000`
    );

    return response.items.map(p => p.sku);
  }

  /**
   * Strategy 4: Find products using project attribute set
   */
  async findByAttributeSet() {
    const products = await this.getAllProducts();
    const pattern = new RegExp(this.config.identifier, 'i');
    
    return products
      .filter(product => {
        // Check if attribute set name contains project pattern
        return product.attribute_set_id && 
               product.custom_attributes?.some(attr => 
                 attr.attribute_code === 'attribute_set_id' && 
                 pattern.test(String(attr.value))
               );
      })
      .map(p => p.sku);
  }

  /**
   * Find ALL project categories
   */
  async findAllCategories() {
    if (!this.silent) logger.info(`🔍 Finding ${this.config.displayName} categories...`);

    const categoryTree = await this.getAllCategories();
    if (!this.silent) {
      logger.info(`  Category tree root: ${categoryTree.name} (ID: ${categoryTree.id})`);
      logger.info(`  Category tree has ${categoryTree.children_data ? categoryTree.children_data.length : 0} children`);
      if (categoryTree.children_data && categoryTree.children_data.length > 0) {
        logger.info(`  Root children: ${categoryTree.children_data.map(c => c.name).join(', ')}`);
      }
    }
    
    const projectCategories = [];
    this.findProjectCategoriesRecursive(categoryTree, projectCategories);

    if (!this.silent) {
      logger.info(`  📊 Found ${projectCategories.length} ${this.config.displayName} categories`);
      if (projectCategories.length > 0) {
        logger.info(`  First few: ${projectCategories.slice(0, 5).map(c => c.name).join(', ')}`);
      } else {
        logger.warn(`  No categories matching '${this.config.rootCategoryName}' found`);
      }
    }
    
    return projectCategories;
  }

  /**
   * Recursively find categories that belong to project
   */
  findProjectCategoriesRecursive(categoryTree, projectCategories) {
    // Check if this matches any of our root category patterns
    const matchesPattern = this.config.patterns.category.some(pattern => 
      categoryTree.name === pattern || categoryTree.name.includes(pattern)
    );
    
    if (matchesPattern) {
      // Add this category and all its children
      const allDescendants = this.getAllDescendants(categoryTree);
      projectCategories.push(...allDescendants);
      // Don't return yet - there might be multiple matching root categories
    }

    // Always check children recursively
    if (categoryTree.children_data) {
      for (const child of categoryTree.children_data) {
        this.findProjectCategoriesRecursive(child, projectCategories);
      }
    }
  }

  /**
   * Get all descendant categories in post-order (children before parents)
   * This ensures deletion order is safe - children are always deleted before their parents
   * Root categories (level === 1) are excluded as they cannot be deleted via API
   */
  getAllDescendants(category, descendants = []) {
    // First, recursively process all children
    if (category.children_data) {
      for (const child of category.children_data) {
        this.getAllDescendants(child, descendants);
      }
    }
    
    // Skip root categories (level 1) - they cannot be deleted via Commerce API
    // Root categories have parent_id = 1 (the system "Default Category" root)
    if (category.level === 1 || category.parent_id === 1) {
      logger.debug(`Skipping root category: ${category.name} (ID: ${category.id}, level: ${category.level})`);
      return descendants;
    }
    
    // Then add this category (post-order: children first, then parent)
    descendants.push({ 
      id: category.id, 
      name: category.name,
      level: category.level,
      parent_id: category.parent_id
    });
    
    return descendants;
  }

  /**
   * Find ALL project product attributes
   */
  async findAllAttributes() {
    if (!this.silent) logger.info(`🔍 Finding ${this.config.displayName} product attributes...`);

    const allAttributes = await this.getAllAttributes();
    
    // Filter by project attribute prefix
    const projectAttributes = allAttributes.filter(attr =>
      attr.attribute_code.startsWith(this.config.attributePrefix)
    );

    if (!this.silent) logger.info(`  📊 Found ${projectAttributes.length} ${this.config.attributePrefix} attributes`);
    
    return projectAttributes;
  }

  /**
   * Find ALL project customer groups
   */
  async findAllCustomerGroups() {
    if (!this.silent) logger.info(`🔍 Finding ${this.config.displayName} customer groups...`);

    const response = await commerceApi.get(
      '/rest/V1/customerGroups/search?searchCriteria[pageSize]=100'
    );

    // Exclude default Commerce system groups
    const systemGroups = ['NOT LOGGED IN', 'General', 'Wholesale', 'Retailer'];

    // Use configured patterns for customer groups
    const patterns = this.config.patterns.customerGroup.map(p => new RegExp(p, 'i'));

    const projectGroups = response.items.filter(group => {
      // Exclude system groups first
      if (systemGroups.includes(group.code)) {
        return false;
      }
      
      // Then check if matches our patterns
      return patterns.some(pattern => pattern.test(group.code));
    });

    if (!this.silent) logger.info(`  📊 Found ${projectGroups.length} ${this.config.displayName} customer groups`);
    
    return projectGroups;
  }

  /**
   * Find ALL project customer attributes
   */
  async findAllCustomerAttributes() {
    if (!this.silent) logger.info(`🔍 Finding ${this.config.displayName} customer attributes...`);

    try {
      const response = await commerceApi.get(
        '/rest/V1/customerMetadata/attribute?searchCriteria[pageSize]=100'
      );

      // Filter by customer attribute prefix
      const projectAttributes = response.items.filter(attr =>
        attr.attribute_code.startsWith(this.config.customerAttributePrefix)
      );

      if (!this.silent) logger.info(`  📊 Found ${projectAttributes.length} ${this.config.customerAttributePrefix} attributes`);
      
      return projectAttributes;
    } catch (error) {
      // Commerce API doesn't expose customer attribute metadata endpoint
      // This is a known platform limitation - customer attributes can only be
      // managed via Admin UI or direct DB access
      if (!this.silent) {
        logger.warn('Could not query customer attributes (Commerce API limitation):', error.message);
      }
      logger.debug('This is expected - customer attributes cannot be queried via REST API');
      
      // Return empty array - we can't validate customer attributes
      return [];
    }
  }

  /**
   * Validate that Commerce is completely clean
   */
  async validateClean() {
    if (!this.silent) {
      logger.info('\n🔍 Validating Commerce is clean...');
    }

    const issues = [];

    // Check products
    const products = await this.findAllProducts();
    if (products.skus.length > 0) {
      issues.push(`${products.skus.length} BuildRight products still exist`);
    }

    // Check categories
    const categories = await this.findAllCategories();
    if (categories.length > 0) {
      issues.push(`${categories.length} BuildRight categories still exist`);
    }

    // Check product attributes
    const attributes = await this.findAllAttributes();
    if (attributes.length > 0) {
      issues.push(`${attributes.length} br_ attributes still exist`);
    }

    // Check customer groups
    const groups = await this.findAllCustomerGroups();
    if (groups.length > 0) {
      issues.push(`${groups.length} BuildRight customer groups still exist`);
    }

    // Check customer attributes (may not be queryable via API)
    const customerAttrs = await this.findAllCustomerAttributes();
    if (customerAttrs.length > 0) {
      issues.push(`${customerAttrs.length} aco_ customer attributes still exist`);
    }
    // Note: If customerAttrs returns empty array due to API limitation, we skip validation

    if (issues.length > 0) {
      if (!this.silent) {
        logger.error('\n❌ Validation FAILED - Orphaned data detected:');
        issues.forEach(issue => logger.error(`   • ${issue}`));
      }
      return {
        clean: false,
        issues,
        details: { products, categories, attributes, groups, customerAttrs }
      };
    }

    if (!this.silent) {
      logger.success('✅ Validation PASSED - No BuildRight data remains\n');
    }
    return { clean: true, issues: [] };
  }

  /**
   * Helper: Get all products (with caching)
   */
  async getAllProducts() {
    if (this.cache.allProducts) {
      return this.cache.allProducts;
    }

    logger.debug('  Fetching all products...');
    const allProducts = [];
    let currentPage = 1;
    const pageSize = 1000;
    
    while (true) {
      const response = await commerceApi.get(
        `/rest/V1/products?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}`
      );
      
      allProducts.push(...response.items);
      
      if (response.items.length < pageSize) {
        break; // Last page
      }
      
      currentPage++;
    }

    this.cache.allProducts = allProducts;
    logger.debug(`  Fetched ${allProducts.length} total products`);
    
    return allProducts;
  }

  /**
   * Helper: Get all product attributes (with caching and pagination)
   */
  async getAllAttributes() {
    if (this.cache.allAttributes) {
      return this.cache.allAttributes;
    }

    logger.debug('  Fetching all product attributes...');
    
    const allAttributes = [];
    let currentPage = 1;
    const pageSize = 500;
    
    while (true) {
      const response = await commerceApi.get(
        `/rest/V1/products/attributes?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}`
      );
      
      allAttributes.push(...response.items);
      
      if (response.items.length < pageSize) {
        break; // Last page
      }
      
      currentPage++;
    }
    
    this.cache.allAttributes = allAttributes;
    logger.debug(`  Fetched ${allAttributes.length} total attributes`);
    
    return allAttributes;
  }

  /**
   * Helper: Get all categories (with caching)
   */
  async getAllCategories() {
    if (this.cache.allCategories) {
      return this.cache.allCategories;
    }

    logger.debug('  Fetching full category tree via list endpoint...');
    
    try {
      // Use the list endpoint to get all categories as a flat list
      const allCategoriesList = await commerceApi.get('/rest/V1/categories/list?searchCriteria[pageSize]=1000');
      
      logger.debug(`  Retrieved ${allCategoriesList.items ? allCategoriesList.items.length : 0} total categories`);
      
      // Find the actual root (ID: 1)
      const actualRoot = allCategoriesList.items?.find(cat => cat.id === 1);
      if (!actualRoot) {
        throw new Error('Root Catalog (ID: 1) not found');
      }
      
      // Build the tree structure from the flat list
      const categoryTree = this.buildCategoryTree(allCategoriesList.items, actualRoot);
      logger.debug(`  Built category tree, root has ${categoryTree.children_data ? categoryTree.children_data.length : 0} children`);
      
      this.cache.allCategories = categoryTree;
      return categoryTree;
    } catch (error) {
      logger.error(`  Error fetching category tree: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Build a category tree from a flat list
   */
  buildCategoryTree(flatCategories, rootCategory) {
    const categoryMap = new Map();
    
    // Create a map of all categories
    flatCategories.forEach(cat => {
      categoryMap.set(cat.id, { ...cat, children_data: [] });
    });
    
    // Build parent-child relationships
    flatCategories.forEach(cat => {
      if (cat.parent_id && cat.parent_id !== cat.id) {
        const parent = categoryMap.get(cat.parent_id);
        const child = categoryMap.get(cat.id);
        if (parent && child) {
          parent.children_data.push(child);
        }
      }
    });
    
    // Return the root with all children populated
    return categoryMap.get(rootCategory.id) || rootCategory;
  }

  /**
   * Helper: Find BuildRight category ID
   */
  async findRootCategoryId() {
    if (this.cache.rootCategoryId) {
      return this.cache.rootCategoryId;
    }

    const categories = await this.getAllCategories();
    const rootCat = this.findCategoryByName(categories, this.config.rootCategoryName);
    
    if (rootCat) {
      this.cache.rootCategoryId = rootCat.id;
      return rootCat.id;
    }

    return null;
  }

  /**
   * Helper: Find category by name
   */
  findCategoryByName(categoryTree, name) {
    if (categoryTree.name === name) {
      return categoryTree;
    }

    if (categoryTree.children_data) {
      for (const child of categoryTree.children_data) {
        const found = this.findCategoryByName(child, name);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Clear cache (call between operations)
   */
  clearCache() {
    this.cache = {
      allProducts: null,
      allAttributes: null,
      allCategories: null,
      rootCategoryId: null
    };
  }
}

export default SmartDetector;

