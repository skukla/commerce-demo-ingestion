#!/usr/bin/env node

/**
 * Import Product Images to Commerce
 * Reads images from generated datapack and uploads via REST API
 * 
 * Uses BaseImporter for standardized patterns
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { BaseImporter } from '../../shared/base-importer.js';
import { DATA_REPO_PATH } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to generated datapack
const DATAPACK_PATH = resolve(DATA_REPO_PATH, 'generated/commerce/data/accs');

class ImageImporter extends BaseImporter {
  constructor(options = {}) {
    super('Images', options);
    this.productImages = []; // Will hold all product-image data from datapack
  }
  
  async import() {
    this.loadProductImages();
    
    if (this.productImages.length === 0) {
      this.logger.warn('No product images found in datapack');
      return {};
    }
    
    this.logger.info(`Product images to process: ${this.productImages.length}`);
    
    this.logger.info('Pre-fetching existing images...');
    const existingMap = await this.fetchExistingImages();
    const productsNeedingImages = [];
    for (const productData of this.productImages) {
      if (existingMap.has(productData.sku)) {
        productData.entries.forEach(() => this.results.addExisting({ sku: productData.sku }));
      } else {
        productsNeedingImages.push(productData);
      }
    }
    
    this.logger.info(`Existing: ${this.productImages.length - productsNeedingImages.length}, New to upload: ${productsNeedingImages.length}\n`);
    
    if (productsNeedingImages.length === 0) {
      this.logger.info('No new images to upload');
      return {};
    }
    await this.processWithProgress(
      productsNeedingImages,
      async (productData) => {
        await this.uploadProductImagesWithoutCheck(productData);
      },
      {
        concurrency: 5,
        label: 'images'
      }
    );
    
    return {};
  }
  
  /**
   * Fetch existing images for all products in batches
   */
  async fetchExistingImages() {
    const existingMap = new Map();
    const checkBatchSize = 10;
    
    for (let i = 0; i < this.productImages.length; i += checkBatchSize) {
      const batch = this.productImages.slice(i, i + checkBatchSize);
      const results = await Promise.all(
        batch.map(async (productData) => {
          const images = await this.getExistingImages(productData.sku);
          return { sku: productData.sku, hasImages: images.length > 0 };
        })
      );
      results.filter(r => r.hasImages).forEach(r => existingMap.set(r.sku, true));
    }
    
    this.logger.info(`Found ${existingMap.size} products with existing images\n`);
    return existingMap;
  }
  
  loadProductImages() {
    if (!existsSync(DATAPACK_PATH)) {
      this.logger.warn(`Datapack path not found: ${DATAPACK_PATH}`);
      return;
    }
    
    const files = readdirSync(DATAPACK_PATH)
      .filter(f => f.startsWith('accs_product_images_') && f.endsWith('.json'))
      .sort();
    
    if (files.length === 0) {
      this.logger.warn('No accs_product_images_*.json files found in datapack');
      return;
    }
    
    this.logger.debug(`Found ${files.length} image JSON files`);
    
    for (const file of files) {
      try {
        const filePath = resolve(DATAPACK_PATH, file);
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item.product && item.product.sku && item.product.media_gallery_entries) {
              this.productImages.push({
                sku: item.product.sku,
                entries: item.product.media_gallery_entries
              });
            }
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to load ${file}: ${error.message}`);
      }
    }
    
    this.logger.info(`Loaded ${this.productImages.length} product-image mappings from datapack`);
  }
  
  async uploadProductImagesWithoutCheck(productData) {
    const { sku, entries } = productData;
    
    try {
      for (const entry of entries) {
        await this.uploadImageEntry(sku, entry);
        this.results.addCreated({ sku });
      }
    } catch (error) {
      this.results.addFailed({ sku }, error);
      this.logger.error(`Failed to upload images for ${sku}: ${error.message}`);
    }
  }
  
  async getExistingImages(sku) {
    try {
      const product = await this.api.get(`/rest/V1/products/${encodeURIComponent(sku)}`);
      return product.media_gallery_entries || [];
    } catch (error) {
      this.logger.debug(`Could not check existing images for ${sku}: ${error.message}`);
      return [];
    }
  }
  
  async uploadImageEntry(sku, entry) {
    const { content, media_type, label, position, disabled, types } = entry;
    
    if (!content || !content.base64_encoded_data) {
      throw new Error('Missing image content');
    }
    
    if (this.isDryRun) {
      this.logger.debug(`[DRY RUN] Would upload image ${content.name} for ${sku} with types: ${types ? types.join(', ') : 'default'}`);
      return;
    }
    const imageTypes = types || ['image', 'small_image', 'thumbnail'];
    const payload = {
      entry: {
        media_type: media_type || 'image',
        label: label || '',
        position: position || 1,
        disabled: disabled || false,
        types: imageTypes,
        content: {
          base64_encoded_data: content.base64_encoded_data,
          type: content.type,
          name: content.name
        }
      }
    };
    
    this.logger.debug(`Uploading ${content.name} for ${sku} with roles: ${imageTypes.join(', ')}`);
    
    try {
      const result = await this.api.post(`/rest/V1/products/${encodeURIComponent(sku)}/media`, payload);
      
      if (result && result.id) {
        this.logger.debug(`Successfully uploaded image for ${sku} (ID: ${result.id})`);
        await this.assignImageRoles(sku, result.file, imageTypes);
      } else {
        this.logger.warn(`Image uploaded for ${sku} but no ID returned from API`);
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Image upload API error for ${sku}: ${error.message}`);
      if (error.response && error.response.data) {
        this.logger.error(`API response: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
  
  async assignImageRoles(sku, imageFile, types) {
    try {
      const product = {};
      
      if (types.includes('image')) {
        product.image = imageFile;
      }
      if (types.includes('small_image')) {
        product.small_image = imageFile;
      }
      if (types.includes('thumbnail')) {
        product.thumbnail = imageFile;
      }
      if (types.includes('swatch_image')) {
        product.swatch_image = imageFile;
      }
      
      await this.api.put(`/rest/V1/products/${encodeURIComponent(sku)}`, { product });
      
      this.logger.debug(`Assigned image roles for ${sku}: ${types.join(', ')}`);
    } catch (error) {
      this.logger.warn(`Failed to assign image roles for ${sku}: ${error.message}`);
    }
  }
}

/**
 * Main import function
 */
export async function importImages(options = {}) {
  const importer = new ImageImporter(options);
  return await importer.run();
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importImages()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
