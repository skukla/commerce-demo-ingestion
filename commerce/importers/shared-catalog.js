#!/usr/bin/env node

/**
 * Assign Categories and Products to Public Shared Catalog
 *
 * After importing categories and products, they must be assigned to the public shared catalog
 * for them to be visible via GraphQL API and ACO's Catalog Service. This step automates what
 * would otherwise be a manual operation in the Commerce Admin.
 *
 * B2B Shared Catalog Architecture:
 * - Public Catalog (type=1): Default catalog visible to all guests and non-company customers
 * - Custom Catalog (type=0): Assigned to specific B2B companies
 *
 * IMPORTANT: Adobe Commerce B2B requires BOTH category AND product assignment:
 * - POST /V1/sharedCatalog/:id/assignCategories - makes categories visible
 * - POST /V1/sharedCatalog/:id/assignProducts - makes products purchasable
 *
 * Without product assignment, guests get "PERMISSION_DENIED" when adding to cart.
 */

import { BaseImporter } from '../../shared/base-importer.js';
import { COMMERCE_CONFIG } from '../../shared/config-loader.js';

class SharedCatalogImporter extends BaseImporter {
  constructor(options = {}) {
    super('Shared Catalog Categories', options);
    this.categoryMap = options.categoryMap || {};
  }

  async import() {
    // Step 1: Find the public shared catalog
    const publicCatalog = await this.findPublicSharedCatalog();
    if (!publicCatalog) {
      this.logger.warn('No public shared catalog found. B2B may not be enabled.');
      return { assigned: 0, skipped: 'no-public-catalog' };
    }

    this.logger.info(`Found public shared catalog: "${publicCatalog.name}" (ID: ${publicCatalog.id})`);

    // Step 2: Get all category IDs from Commerce
    const allCategories = await this.getAllCategories();
    if (allCategories.length === 0) {
      this.logger.warn('No categories found to assign');
      return { assigned: 0, skipped: 'no-categories' };
    }

    // Step 3: Get currently assigned categories
    const assignedCategoryIds = await this.getAssignedCategories(publicCatalog.id);
    this.logger.info(`Currently assigned: ${assignedCategoryIds.length} categories`);

    // Step 4: Find categories that need to be assigned
    const categoriesToAssign = allCategories.filter(cat => !assignedCategoryIds.includes(cat.id));

    if (categoriesToAssign.length === 0) {
      this.logger.info('All categories already assigned to public catalog');
      for (const cat of allCategories) {
        this.results.addExisting({ id: cat.id, name: cat.name });
      }
      return { assigned: 0, existing: allCategories.length };
    }

    this.logger.info(`Assigning ${categoriesToAssign.length} new categories to public catalog...`);

    // Step 5: Assign categories to shared catalog
    const assignedCount = await this.assignCategories(publicCatalog.id, categoriesToAssign);

    return {
      assigned: assignedCount,
      existing: assignedCategoryIds.length,
      publicCatalogId: publicCatalog.id
    };
  }

  /**
   * Find the public shared catalog (type=1)
   */
  async findPublicSharedCatalog() {
    try {
      // Search for shared catalogs with type=1 (public)
      const searchUrl = '/rest/V1/sharedCatalog?searchCriteria[filter_groups][0][filters][0][field]=type&searchCriteria[filter_groups][0][filters][0][value]=1&searchCriteria[filter_groups][0][filters][0][condition_type]=eq';
      const response = await this.api.get(searchUrl);

      if (response?.items?.length > 0) {
        return response.items[0];
      }

      // Fallback: try to get all shared catalogs and find public one
      const allCatalogs = await this.api.get('/rest/V1/sharedCatalog?searchCriteria[pageSize]=100');
      if (allCatalogs?.items?.length > 0) {
        return allCatalogs.items.find(cat => cat.type === 1);
      }

      return null;
    } catch (error) {
      // B2B module may not be installed
      if (error.status === 404 || error.message?.includes('Service not found')) {
        this.logger.warn('Shared Catalog API not available. B2B module may not be installed.');
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all categories from Commerce
   */
  async getAllCategories() {
    try {
      const response = await this.api.get('/rest/V1/categories/list?searchCriteria[pageSize]=1000');
      return response?.items || [];
    } catch (error) {
      this.logger.error(`Failed to fetch categories: ${error.message}`);
      return [];
    }
  }

  /**
   * Get categories currently assigned to a shared catalog
   */
  async getAssignedCategories(sharedCatalogId) {
    try {
      const response = await this.api.get(`/rest/V1/sharedCatalog/${sharedCatalogId}/categories`);
      return response || [];
    } catch (error) {
      this.logger.warn(`Failed to get assigned categories: ${error.message}`);
      return [];
    }
  }

  /**
   * Assign categories to shared catalog
   */
  async assignCategories(sharedCatalogId, categories) {
    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would assign ${categories.length} categories to shared catalog ${sharedCatalogId}`);
      categories.forEach(cat => this.results.addCreated({ id: cat.id, name: cat.name }));
      return categories.length;
    }

    // Build the request payload
    const payload = {
      categories: categories.map(cat => ({ id: cat.id }))
    };

    try {
      const result = await this.api.post(`/rest/V1/sharedCatalog/${sharedCatalogId}/assignCategories`, payload);

      // Result is true if successful
      if (result === true) {
        categories.forEach(cat => this.results.addCreated({ id: cat.id, name: cat.name }));
        this.logger.info(`Successfully assigned ${categories.length} categories`);
        return categories.length;
      }

      this.logger.warn(`Unexpected response from assignCategories: ${JSON.stringify(result)}`);
      return 0;
    } catch (error) {
      this.logger.error(`Failed to assign categories: ${error.message}`);
      categories.forEach(cat => this.results.addFailed({ id: cat.id, name: cat.name }, error));
      return 0;
    }
  }

  // ============================================================================
  // PRODUCT ASSIGNMENT METHODS
  // ============================================================================

  /**
   * Get products currently assigned to a shared catalog
   * @param {number} sharedCatalogId - Shared catalog ID
   * @returns {Promise<string[]>} Array of assigned product SKUs
   */
  async getAssignedProducts(sharedCatalogId) {
    try {
      const response = await this.api.get(`/rest/V1/sharedCatalog/${sharedCatalogId}/products`);
      return response || [];
    } catch (error) {
      this.logger.warn(`Failed to get assigned products: ${error.message}`);
      return [];
    }
  }

  /**
   * Assign products to shared catalog in batches
   * @param {number} sharedCatalogId - Shared catalog ID
   * @param {string[]} productSkus - Array of product SKUs to assign
   * @returns {Promise<number>} Number of products successfully assigned
   */
  async assignProducts(sharedCatalogId, productSkus) {
    const BATCH_SIZE = 100;
    let assignedCount = 0;

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would assign ${productSkus.length} products to shared catalog ${sharedCatalogId}`);
      productSkus.forEach(sku => this.results.addCreated({ sku }));
      return productSkus.length;
    }

    const totalBatches = Math.ceil(productSkus.length / BATCH_SIZE);

    for (let i = 0; i < productSkus.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = productSkus.slice(i, i + BATCH_SIZE);
      const payload = { products: batch.map(sku => ({ sku })) };

      try {
        const result = await this.api.post(
          `/rest/V1/sharedCatalog/${sharedCatalogId}/assignProducts`,
          payload
        );

        if (result === true) {
          assignedCount += batch.length;
          batch.forEach(sku => this.results.addCreated({ sku }));
          this.logger.info(`Batch ${batchNum}/${totalBatches}: Assigned ${batch.length} products`);
        } else {
          this.logger.warn(`Batch ${batchNum}/${totalBatches}: Unexpected response: ${JSON.stringify(result)}`);
        }
      } catch (error) {
        this.logger.error(`Batch ${batchNum}/${totalBatches}: Failed to assign products: ${error.message}`);
        batch.forEach(sku => this.results.addFailed({ sku }, error));
      }
    }

    return assignedCount;
  }

  /**
   * Import products to public shared catalog
   * Called by assignSharedCatalogProducts export function
   * @param {Object} productSkuMap - Map of SKU to product info from products import
   * @returns {Promise<Object>} Import results
   */
  async importProducts(productSkuMap) {
    // Reset results for product import (separate from category import)
    this.results = new (await import('../../shared/base-importer.js')).ImportResults();

    // Step 1: Find the public shared catalog
    const publicCatalog = await this.findPublicSharedCatalog();
    if (!publicCatalog) {
      this.logger.warn('No public shared catalog found. B2B may not be enabled.');
      return { assigned: 0, skipped: 'no-public-catalog' };
    }

    this.logger.info(`Found public shared catalog: "${publicCatalog.name}" (ID: ${publicCatalog.id})`);

    // Step 2: Get all SKUs from the product map
    const allSkus = Object.keys(productSkuMap);
    if (allSkus.length === 0) {
      this.logger.warn('No products found to assign');
      return { assigned: 0, skipped: 'no-products' };
    }

    this.logger.info(`Total products to check: ${allSkus.length}`);

    // Step 3: Get currently assigned products
    const assignedSkus = await this.getAssignedProducts(publicCatalog.id);
    this.logger.info(`Currently assigned: ${assignedSkus.length} products`);

    // Step 4: Find products that need to be assigned
    const skusToAssign = allSkus.filter(sku => !assignedSkus.includes(sku));

    if (skusToAssign.length === 0) {
      this.logger.info('All products already assigned to public catalog');
      allSkus.forEach(sku => this.results.addExisting({ sku }));
      return { assigned: 0, existing: allSkus.length };
    }

    this.logger.info(`Assigning ${skusToAssign.length} new products to public catalog...`);

    // Step 5: Assign products to shared catalog (in batches)
    const assignedCount = await this.assignProducts(publicCatalog.id, skusToAssign);

    return {
      assigned: assignedCount,
      existing: assignedSkus.length,
      publicCatalogId: publicCatalog.id
    };
  }
}

/**
 * Main import function for CATEGORIES (for use by import-all.js)
 */
export async function assignSharedCatalogCategories(options = {}) {
  const importer = new SharedCatalogImporter(options);
  return importer.run();
}

/**
 * Main import function for PRODUCTS (for use by import-all.js)
 * Must be called AFTER products are imported to get the productSkuMap
 */
export async function assignSharedCatalogProducts(options = {}) {
  const importer = new SharedCatalogImporter({
    ...options,
    // Override name for logging clarity
  });
  importer.name = 'Shared Catalog Products';

  // Note: executeImportStep extracts context and passes it directly as options
  // So productSkuMap is at options.productSkuMap, not options.context.productSkuMap
  const productSkuMap = options.productSkuMap || {};
  const result = await importer.importProducts(productSkuMap);

  return {
    success: importer.results.failed.length === 0,
    results: importer.results.toJSON(),
    ...result
  };
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  assignSharedCatalogCategories()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { SharedCatalogImporter };
