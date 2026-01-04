#!/usr/bin/env node

/**
 * Import Products to Commerce
 * Reads products from generated datapack JSON files (already transformed from ACO)
 * 
 * Note: Tier pricing is handled by ACO, not stored in Commerce
 * 
 * Optimizations:
 * - Pre-fetches all existing SKUs in a single query (O(1) lookup vs N queries)
 * - Parallel product creation with configurable concurrency
 * - Progress tracking with ETA
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { BaseImporter } from '../../shared/base-importer.js';
import { COMMERCE_CONFIG, DATA_REPO_PATH } from '../../shared/config-loader.js';
import { createBulkApi } from '../lib/bulk-commerce-api.js';
import { getStateTracker } from '../lib/state-tracker.js';
import { withRetry } from '../../shared/retry-util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to generated datapack products file
const DATAPACK_PRODUCTS_PATH = resolve(DATA_REPO_PATH, 'generated/commerce/data/accs/accs_products.json');

// Default concurrency for parallel processing
// Restored to 10 after fixing MSI "Could not save Source Item Configuration" error
// (Previously reduced to 3 as a workaround for inventory conflicts)
const DEFAULT_CONCURRENCY = 10;
const BULK_API_THRESHOLD = 99999;

class ProductImporter extends BaseImporter {
  constructor(options = {}) {
    super('Products', options);
    this.categoryMap = options.categoryMap || {};
    this.websiteIds = options.websiteIds || [];
    this.productSkuMap = {};
    this.concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    this.existingSkus = new Set();
    this.attributeOptionsMap = options.attributeOptionMap || {};
    this.stateTracker = getStateTracker();
  }
  
  /**
   * Fetch all attribute options from Commerce and build a lookup map
   * Only runs if attributeOptionsMap is empty (not provided by import-all)
   */
  async fetchAttributeOptions() {
    if (Object.keys(this.attributeOptionsMap).length > 0) {
      this.logger.info(`Using ${Object.keys(this.attributeOptionsMap).length} pre-loaded attribute option mappings`);
      return;
    }
    
    this.logger.info('Fetching attribute options from Commerce...');
    const startTime = Date.now();
    
    try {
      // Get all product attributes
      const response = await this.api.get('/rest/V1/products/attributes?searchCriteria[pageSize]=200');
      const attributes = response.items;
      
      let optionCount = 0;
      
      for (const attr of attributes) {
        // Only process attributes with options (select/multiselect)
        if (attr.options && attr.options.length > 0 && attr.attribute_code.startsWith('br_')) {
          this.attributeOptionsMap[attr.attribute_code] = {};
          
          for (const option of attr.options) {
            if (option.label && option.value) {
              this.attributeOptionsMap[attr.attribute_code][option.label] = option.value;
              optionCount++;
            }
          }
        }
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.info(`✔ Fetched ${Object.keys(this.attributeOptionsMap).length} attributes with ${optionCount} total options (${duration}s)`);
      
    } catch (error) {
      this.logger.warn(`Failed to fetch attribute options: ${error.message}`);
      this.logger.warn('Will attempt to create products with string values (may fail for select attributes)');
    }
  }
  
  async import() {
    // Load products from generated datapack JSON
    const products = await this.loadProductsFromDatapack();
    this.logger.info(`Loaded ${products.length} products from datapack (${this.countByType(products)})`);
    
    await this.fetchAttributeOptions();
    await this.prefetchExistingSkus();
    
    // Separate new vs existing products
    const newProducts = [];
    const existingProducts = [];
    
    for (const product of products) {
      if (this.existingSkus.has(product.sku)) {
        existingProducts.push(product);
        this.results.addExisting({ sku: product.sku, name: product.name });
        this.addToSkuMap(product);
        this.stateTracker.addProduct(product.sku);
      } else {
        newProducts.push(product);
      }
    }
    
    this.logger.info(`Existing: ${existingProducts.length}, New to create: ${newProducts.length}`);
    
    if (newProducts.length === 0) {
      this.logger.info('No new products to create');
      return { 
        results: this.results, 
        productSkuMap: this.productSkuMap, 
        totalProducts: products.length 
      };
    }
    
    if (newProducts.length >= BULK_API_THRESHOLD) {
      await this.processProductsBulk(newProducts);
    } else {
      await this.processProductsParallel(newProducts);
    }
    
    return { 
      results: this.results, 
      productSkuMap: this.productSkuMap, 
      totalProducts: products.length 
    };
  }
  
  /**
   * Load products from generated datapack JSON file
   */
  async loadProductsFromDatapack() {
    if (!existsSync(DATAPACK_PRODUCTS_PATH)) {
      throw new Error(`Datapack products file not found at: ${DATAPACK_PRODUCTS_PATH}\nPlease run 'npm run generate' first to create the datapack.`);
    }
    
    try {
      const fileContent = readFileSync(DATAPACK_PRODUCTS_PATH, 'utf8');
      const datapack = JSON.parse(fileContent);
      
      // The datapack has the structure: { source: { items: [...] } }
      if (!datapack.source || !datapack.source.items) {
        throw new Error('Invalid datapack format: missing source.items');
      }
      
      // IMPORTANT: Exclude bundle products - they're handled by import-bundles.js
      const products = datapack.source.items.filter(item => item.product_type !== 'bundle');
      
      return products;
    } catch (error) {
      throw new Error(`Failed to load products from datapack: ${error.message}`);
    }
  }
  
  /**
   * Count products by type
   */
  countByType(products) {
    const counts = {};
    for (const product of products) {
      const type = product.product_type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', ');
  }
  
  /**
   * Pre-fetch all existing product SKUs for O(1) lookup
   */
  async prefetchExistingSkus() {
    this.logger.info('Pre-fetching existing SKUs...');
    const startTime = Date.now();
    
    if (COMMERCE_CONFIG.dryRun) {
      this.logger.info('[DRY RUN] Skipping SKU pre-fetch');
      return;
    }
    
    const allSkus = await this.api.getAllProductSkus();
    this.existingSkus = allSkus;
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.info(`✔ Pre-fetched ${allSkus.size} existing SKUs in ${duration}s`);
  }
  
  /**
   * Process products using bulk API (for large imports)
   */
  async processProductsBulk(products) {
    this.logger.info(`\n🚀 Using BULK API for ${products.length} products...`);
    
    if (COMMERCE_CONFIG.dryRun) {
      this.logger.info('[DRY RUN] Would use bulk API to create products');
      products.forEach(p => this.results.addCreated({ sku: p.sku, name: p.name }));
      return;
    }
    
    try {
      const bulkApi = createBulkApi();
      const result = await bulkApi.bulkCreateProducts(products);
      
      // Count successes and failures
      let successCount = 0;
      let failureCount = 0;
      
      for (const op of result.operations) {
        if (op.status === 'complete') {
          successCount += op.productCount || 0;
        } else if (op.status === 'partial') {
          // Count individual operations
          const opSuccesses = op.operations_list?.filter(o => o.status === 'complete').length || 0;
          successCount += opSuccesses;
          failureCount += (op.productCount || 0) - opSuccesses;
        } else {
          failureCount += op.productCount || 0;
        }
      }
      
      this.logger.info(`✔ Bulk import complete: ${successCount} succeeded, ${failureCount} failed`);
      
      // Add to results
      products.forEach(p => {
        this.results.addCreated({ sku: p.sku, name: p.name });
        this.addToSkuMap(p);
      });
      
    } catch (error) {
      this.logger.error(`Bulk import failed: ${error.message}`);
      this.logger.info('Falling back to parallel processing...');
      await this.processProductsParallel(products);
    }
  }
  
  /**
   * Process products in parallel with progress tracking
   */
  async processProductsParallel(products) {
    this.logger.info(`Importing ${products.length} products (concurrency: ${this.concurrency})\n`);
    
    await this.processWithProgress(
      products,
      async (product) => {
        try {
          await this.createProduct(product);
        } catch (error) {
          // Errors logged in createProduct
        }
      },
      {
        concurrency: this.concurrency,
        label: 'products',
        batchSize: 25,
        batchDelayMs: 200
      }
    );
  }
  
  async createProduct(product) {
    const { sku, name } = product;
    
    if (COMMERCE_CONFIG.dryRun) {
      this.logger.debug(`[DRY RUN] Would create product: ${sku} - ${name}`);
      this.results.addCreated({ sku, name });
      this.addToSkuMap(product);
      return { action: 'created', sku };
    }
    
    try {
      const commerceProduct = this.transformToCommerceApi(product);
      
      const result = await withRetry(
        async () => await this.api.createProduct(commerceProduct),
        { name: `Create product ${sku}` }
      );
      
      // Assign to inventory source (MSI) after product creation
      // This prevents "Could not save Source Item Configuration" errors
      try {
        await this.api.assignProductToSource(
          sku, 
          'default',  // Default source code
          product.qty || 100,
          1  // In stock
        );
        this.logger.debug(`Assigned inventory source for: ${sku}`);
      } catch (msiError) {
        // Log but don't fail - MSI might not be enabled or already assigned
        this.logger.debug(`MSI assignment warning for ${sku}: ${msiError.message}`);
      }
      
      this.results.addCreated({ sku, name });
      this.addToSkuMap(product);
      this.stateTracker.addProduct(sku);
      
      this.logger.debug(`Created product: ${sku} - ${name}`);
      return { action: 'created', id: result.id, sku };
    } catch (error) {
      this.logger.error(`Failed to create product ${sku} (${name}): ${error.message}`);
      this.results.addFailed({ sku, name, error: error.message });
      // Don't throw - allow parallel processing to continue
    }
  }
  
  /**
   * Transform datapack product format to Commerce API format
   * The datapack uses ACCS flat format, but the API expects nested structure
   */
  transformToCommerceApi(product) {
    // Generate unique URL key by appending SKU hash
    const urlKey = product.url_key || 
                   `${product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${product.sku.toLowerCase()}`;
    
    return {
      sku: product.sku,
      name: product.name,
      attribute_set_id: 4, // Default attribute set
      price: product.price || 0,
      status: 1,
      visibility: 4, // Catalog, Search
      type_id: product.product_type || 'simple',
      weight: product.weight || 1,
      extension_attributes: {
        category_links: this.getCategoryLinks(product.categories),
        website_ids: this.websiteIds.length > 0 ? this.websiteIds : [1]
        // stock_item removed - inventory is managed via MSI source_items API
        // This prevents "Could not save Source Item Configuration" errors
      },
      custom_attributes: [
        { attribute_code: 'url_key', value: urlKey },
        ...this.extractCustomAttributes(product)
      ]
    };
  }
  
  /**
   * Get category links from category path string
   *
   * ALL products are assigned to the "All Products" category in addition to
   * their specific category. This enables browsing all products via /catalog?category=all-products
   */
  getCategoryLinks(categoryPath) {
    const links = [];

    // Always add "All Products" category first (position 0)
    // This ensures all products appear in the all-products category page
    const allProductsCategoryId = this.categoryMap['all-products'] || this.categoryMap['All Products'];
    if (allProductsCategoryId) {
      links.push({ category_id: allProductsCategoryId, position: 0 });
    }

    if (!categoryPath) return links;

    // categoryPath is like "Root Catalog/Structural Materials"
    // We need to find the category ID from the map
    const categoryId = this.categoryMap[categoryPath] || this.categoryMap[categoryPath.split('/').pop()];

    if (!categoryId) {
      this.logger.warn(`Category not found in map: "${categoryPath}"`);
      this.logger.debug(`Available categories: ${Object.keys(this.categoryMap).join(', ')}`);
    }

    // Add specific category with position 1 (after All Products)
    if (categoryId) {
      links.push({ category_id: categoryId, position: 1 });
    }

    return links;
  }
  
  /**
   * Extract custom attributes from flat product structure
   * Resolves string values to option IDs for select/multiselect attributes
   */
  extractCustomAttributes(product) {
    const customAttributes = [];
    
    // List of custom attribute codes (all with br_ prefix now)
    const attributeCodes = [
      // Core attributes
      'br_persona', 'br_category', 'br_brand',
      // Product characteristics
      'br_product_category', 'br_product_class', 'br_uom',
      // Construction & Building
      'br_construction_phase', 'br_quality_tier', 'br_lumber_grade',
      'br_lumber_treatment', 'br_lumber_species', 'br_drywall_type',
      'br_drywall_thickness', 'br_window_type', 'br_window_glazing',
      'br_window_energy_rating', 'br_door_type', 'br_door_material',
      'br_nail_type', 'br_nail_size', 'br_roof_material',
      'br_roof_color', 'br_roof_warranty', 'br_paint_type',
      'br_paint_finish', 'br_paint_coverage', 'br_concrete_type',
      'br_concrete_psi', 'br_concrete_slump',
      // Electrical & Plumbing
      'br_wire_gauge', 'br_wire_type', 'br_breaker_amps',
      'br_fixture_voltage', 'br_pipe_material', 'br_pipe_diameter',
      'br_pipe_pressure_rating', 'br_fitting_type', 'br_hvac_tonnage',
      'br_hvac_seer_rating', 'br_hvac_fuel_type', 'br_appliance_type',
      'br_appliance_brand', 'br_energy_star_certified',
      // PPE & Safety
      'br_ppe_ansi_standard', 'br_ppe_hard_hat_type', 'br_ppe_hard_hat_class',
      'br_ppe_nrr_rating', 'br_ppe_cut_resistance', 'br_ppe_niosh_rating',
      'br_ppe_hi_vis_class', 'br_ppe_size',
      // Building Components
      'br_sheathing_location', 'br_underlayment_type', 'br_insulation_type',
      'br_insulation_r_value', 'br_light_type', 'br_light_technology',
      'br_fixture_type', 'br_fixture_location'
    ];
    
    for (const code of attributeCodes) {
      if (product[code] !== undefined && product[code] !== null && product[code] !== '') {
        let value = product[code];
        
        // If this is a select/multiselect attribute, resolve the option ID
        if (this.attributeOptionsMap[code]) {
          const optionId = this.attributeOptionsMap[code][value];
          if (optionId) {
            value = optionId; // Use the integer option ID
          } else {
            // Option not found - log warning and skip this attribute
            this.logger.debug(`Warning: Option "${value}" not found for attribute "${code}" on product ${product.sku}`);
            continue; // Skip this attribute rather than sending invalid data
          }
        }
        
        customAttributes.push({
          attribute_code: code,
          value: String(value) // Convert to string (Commerce expects string even for option IDs)
        });
      }
    }
    
    return customAttributes;
  }
  
  /**
   * Add product to SKU map for bundle reference
   */
  addToSkuMap(product) {
    this.productSkuMap[product.sku] = {
      sku: product.sku,
      name: product.name,
      type: product.product_type
    };
  }
}

/**
 * Export import function
 */
export async function importProducts(options = {}) {
  const importer = new ProductImporter(options);
  return await importer.import();
}

// Run standalone if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  if (isDryRun) {
    process.env.DRY_RUN = 'true';
    COMMERCE_CONFIG.dryRun = true;
  }
  if (verbose) {
    COMMERCE_CONFIG.verbose = true;
  }
  
  importProducts()
    .then(result => {
      // Save state after successful import
      const stateTracker = getStateTracker();
      stateTracker.saveState();
      
      console.log(`\n✔ Import complete: ${result.totalProducts} products processed`);
      console.log(`State saved to: ${stateTracker.getStateFilePath()}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n✗ Import failed:', error.message);
      process.exit(1);
    });
}
