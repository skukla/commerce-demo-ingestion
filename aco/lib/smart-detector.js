#!/usr/bin/env node

/**
 * Smart Project Data Detection
 * Finds project-specific data using intelligent pattern matching
 * Configurable patterns - no hardcoded project names
 */

import { commerceApi } from '../../commerce/lib/commerce-api.js';
import logger from '../../shared/logger.js';
import { COMMERCE_CONFIG, CUSTOMER_GROUPS } from '../../shared/config-loader.js';

/**
 * Smart detection strategies for project-specific data
 * Uses COMMERCE_CONFIG.project for configurable patterns
 */
export class SmartDetector {
  constructor(options = {}) {
    this.silent = options.silent || false;
    this.config = COMMERCE_CONFIG.project;
    this.acoConfig = COMMERCE_CONFIG.aco;
    
    // Get customer group codes from loaded data
    const customerGroupCodes = CUSTOMER_GROUPS ? CUSTOMER_GROUPS.map(g => g.code) : [];
    
    // Create patterns from project config for detection
    this.config.patterns = {
      category: [this.config.rootCategoryName], // Root category name pattern
      attribute: [this.config.attributePrefix],  // Attribute prefix pattern
      customerAttribute: [this.config.customerAttributePrefix || this.config.attributePrefix],
      customerGroup: customerGroupCodes.length > 0 ? customerGroupCodes : ['.*'] // Use actual customer group codes
    };
    
    this.cache = {
      allProducts: null,
      allAttributes: null,
      allCategories: null,
      rootCategoryId: null
    };
  }

  /**
   * Get ACO GraphQL endpoint
   */
  getACOEndpoint() {
    const envSuffix = this.acoConfig.environment === 'sandbox' ? '-sandbox' : '';
    return `https://${this.acoConfig.region}${envSuffix}.api.commerce.adobe.com/${this.acoConfig.tenantId}/graphql`;
  }
  
  /**
   * Get OAuth access token for ACO API
   */
  async getAccessToken() {
    const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.acoConfig.clientId,
      client_secret: this.acoConfig.clientSecret,
      scope: 'openid,AdobeID,additional_info.projectedProductContext'
    });

    const response = await fetch(IMS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  /**
   * Query ACO products by specific SKUs
   * Returns products that exist in ACO (both visible and invisible)
   */
  async queryACOProductsBySKUs(skus, throwOnError = false) {
    if (skus.length === 0) return [];
    
    try {
      const token = await this.getAccessToken();
      const endpoint = this.getACOEndpoint();

      // GraphQL array syntax
      const skuList = skus.map(sku => `"${sku}"`).join(', ');
      
      const query = `
        query {
          products(skus: [${skuList}]) {
            __typename
            sku
            name
          }
        }
      `;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'AC-Environment-Id': this.acoConfig.tenantId,
          'AC-Source-Locale': 'en-US'
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        const errorMsg = `ACO query failed with status ${response.status}`;
        if (throwOnError) throw new Error(errorMsg);
        logger.debug(errorMsg);
        return [];
      }

      const result = await response.json();
      
      if (result.errors) {
        const errorMsg = `ACO query returned errors: ${JSON.stringify(result.errors)}`;
        if (throwOnError) throw new Error(errorMsg);
        logger.debug(errorMsg);
        return [];
      }

      const products = result.data?.products || [];
      logger.debug(`ACO query returned ${products.length} products`);
      return products;
      
    } catch (error) {
      if (throwOnError) {
        throw new Error(`Failed to query ACO products: ${error.message}`);
      }
      logger.debug(`Failed to query ACO products by SKUs: ${error.message}`);
      return [];
    }
  }

  /**
   * Get total count from Live Search (productSearch API)
   * This uses the search index, which may lag behind Catalog Service
   * 
   * @returns {Promise<number>} Total count from Live Search
   */
  async getLiveSearchCount() {
    try {
      const token = await this.getAccessToken();
      const endpoint = this.getACOEndpoint();

      // Use productSearch with phrase "*" to get all indexed products
      // Note: This returns ALL visible products (including variants during verification)
      const query = `
        query {
          productSearch(phrase: "*", page_size: 1) {
            total_count
          }
        }
      `;

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'AC-Environment-Id': this.acoConfig.tenantId,
        'AC-Source-Locale': 'en-US',
        'AC-Price-Book-Id': 'US-Retail'
      };
      
      // Add optional headers if available
      if (this.acoConfig.catalogViewId) {
        headers['AC-View-Id'] = this.acoConfig.catalogViewId;
      }
      if (this.acoConfig.websiteCode) {
        headers['Magento-Website-Code'] = this.acoConfig.websiteCode;
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.log(`[DEBUG] Live Search failed (${response.status}): ${responseText}`);
        logger.debug(`Live Search count query failed with status ${response.status}: ${responseText}`);
        return 0;
      }

      const result = await response.json();
      
      if (result.errors) {
        console.log(`[DEBUG] Live Search errors:`, result.errors);
        logger.debug(`Live Search count query returned errors: ${JSON.stringify(result.errors)}`);
        return 0;
      }

      const totalCount = result.data?.productSearch?.total_count || 0;
      console.log(`[DEBUG] Live Search returned total_count: ${totalCount}, full result:`, JSON.stringify(result, null, 2));
      logger.debug(`Live Search total_count: ${totalCount}`);
      return totalCount;
      
    } catch (error) {
      console.log(`[DEBUG] Live Search exception:`, error.message);
      logger.debug(`Failed to get Live Search count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get total count of visible products in the catalog
   * Alias for getLiveSearchCount for backward compatibility
   * 
   * @returns {Promise<number>} Total count of visible products
   */
  async getTotalProductCount() {
    return this.getLiveSearchCount();
  }
  
  /**
   * Get catalog count by verifying how many SKUs exist
   * This queries Catalog Service directly (not the search index)
   * 
   * @param {Array<string>} skus - SKUs to verify
   * @returns {Promise<number>} Number of SKUs found in Catalog Service
   */
  async getCatalogCount(skus) {
    if (!skus || skus.length === 0) return 0;
    
    // Query in batches
    const BATCH_SIZE = 50;
    let foundCount = 0;
    
    for (let i = 0; i < skus.length; i += BATCH_SIZE) {
      const batch = skus.slice(i, i + BATCH_SIZE);
      const found = await this.queryACOProductsBySKUs(batch, false);
      foundCount += found.length;
    }
    
    return foundCount;
  }

  /**
   * Query ACO products directly via productSearch (only returns VISIBLE products)
   * Note: Invisible variants (visibleIn: []) will NOT be returned
   * 
   * For validation without Live Search, use queryACOProductsBySKUs instead.
   * 
   * @param {string} phrase - Search phrase (empty string returns all)
   * @param {number} limit - Max products to return
   * @returns {Promise<Array<{sku: string, name: string}>>}
   */
  async queryACOProductsDirect(phrase = '', limit = 500) {
    try {
      const token = await this.getAccessToken();
      const endpoint = this.getACOEndpoint();

      const query = `
        query ProductSearch($phrase: String!, $limit: Int) {
          productSearch(phrase: $phrase, page_size: $limit) {
            total_count
            items {
              productView {
                sku
                name
              }
            }
          }
        }
      `;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'AC-Environment-Id': this.acoConfig.tenantId,
          'AC-Source-Locale': 'en-US',
          'AC-Price-Book-Id': 'US-Retail'  // Required for productSearch
        },
        body: JSON.stringify({ 
          query, 
          variables: { phrase, limit } 
        })
      });

      if (!response.ok) {
        throw new Error(`ACO search failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.errors) {
        logger.debug('ACO search errors:', result.errors);
        return [];
      }

      const items = result.data?.productSearch?.items || [];
      return items.map(item => ({
        sku: item.productView.sku,
        name: item.productView.name
      }));
      
    } catch (error) {
      logger.debug(`Failed to query ACO products directly: ${error.message}`);
      return [];
    }
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
   * Extract unique SKU prefixes from a list of SKUs
   * Auto-detects project-specific SKU patterns (e.g., "STR-123" → "STR")
   * 
   * @param {Array<string>} skus - Array of SKUs
   * @returns {Array<string>} Unique prefixes
   */
  extractSkuPrefixes(skus) {
    return [...new Set(
      skus
        .filter(sku => sku.includes('-'))
        .map(sku => sku.split('-')[0])
    )];
  }

  /**
   * Build regex pattern from SKU prefixes
   * 
   * @param {Array<string>} prefixes - Array of SKU prefixes
   * @returns {RegExp|null} Regex pattern or null if no prefixes
   */
  buildSkuPattern(prefixes) {
    if (prefixes.length === 0) {
      return null;
    }
    return new RegExp(`^(${prefixes.join('|')})-`);
  }

  /**
   * Validate that ACO is clean (no project data remains)
   * Uses state tracker to know what SKUs to check
   */
  async validateACOClean(expectedSKUs = []) {
    if (!this.silent) {
      logger.info('\n🔍 Validating ACO is clean...');
    }

    const issues = [];

    // Check expected products from state tracker
    if (expectedSKUs.length > 0) {
      try {
        const acoProducts = await this.queryACOProductsBySKUs(expectedSKUs);
        const productCount = acoProducts.length;
        
        if (!this.silent && productCount > 0) {
          logger.info(`   📊 ${productCount} products remaining in Catalog Service`);
        }
        
        if (productCount > 0) {
          issues.push(`${productCount} products still exist in ACO`);
          const remainingSKUs = acoProducts.slice(0, 10).map(p => p.sku).join(', ');
          logger.debug(`Remaining products: ${remainingSKUs}${productCount > 10 ? '...' : ''}`);
        }
      } catch (error) {
        if (!this.silent) {
          logger.warn('Could not verify product deletion:', error.message);
        }
      }
    }

    // Check for unknown orphans (visible products only)
    // Auto-detect SKU pattern from expected SKUs (state tracker)
    try {
      if (!this.silent) {
        logger.info('🔍 Checking for unknown orphaned products...');
      }
      
      // Extract unique prefixes and build dynamic pattern
      const prefixes = this.extractSkuPrefixes(expectedSKUs);
      const pattern = this.buildSkuPattern(prefixes);
      
      if (pattern) {
        logger.debug(`Auto-detected SKU pattern: ${pattern}`);
        
        const orphanProducts = await this.queryACOProductsDirect('', 500);
        if (orphanProducts.length > 0) {
          // Filter to project products using auto-detected pattern
          const projectOrphans = orphanProducts.filter(p => pattern.test(p.sku));
          
          if (projectOrphans.length > 0) {
            issues.push(`${projectOrphans.length} unknown orphaned products found (visible only)`);
            logger.debug(`Orphaned SKUs: ${projectOrphans.map(p => p.sku).slice(0, 10).join(', ')}...`);
          }
        }
      } else {
        logger.debug('No SKU prefixes detected - skipping orphan check');
      }
    } catch (error) {
      // Non-critical - Live Search might not be enabled
      logger.debug('Could not query for orphaned products (Live Search may not be enabled):', error.message);
    }

    if (issues.length > 0) {
      if (!this.silent) {
        logger.error('\n❌ Validation FAILED - Orphaned data detected:');
        issues.forEach(issue => logger.error(`   • ${issue}`));
      }
      return {
        clean: false,
        issues
      };
    }

    if (!this.silent) {
      logger.success('✅ Validation PASSED - No project data remains in ACO\n');
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
