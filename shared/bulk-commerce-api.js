/**
 * Bulk Commerce API Wrapper
 * 
 * Provides high-performance bulk and asynchronous operations for Adobe Commerce.
 * Uses Commerce's /async/bulk/ endpoints for 10x faster imports/deletes.
 * 
 * References:
 * - https://developer.adobe.com/commerce/webapi/rest/use-rest/bulk-endpoints/
 * - https://experienceleague.adobe.com/docs/commerce-admin/systems/web-api/bulk-endpoints.html
 */

import { commerceApi, logger } from './commerce-api.js';

/**
 * Bulk operation status values
 */
export const BulkStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
  FAILED: 'failed',
  RETRIABLE_ERROR: 'retriable_error'
};

/**
 * Default configuration for bulk operations
 */
const DEFAULT_CONFIG = {
  chunkSize: 100,           // Products per bulk request (Commerce recommendation)
  maxWaitSeconds: 300,      // Max time to wait for bulk operation
  pollInterval: 2000,       // Poll status every 2 seconds
  retryAttempts: 3          // Retry failed operations
};

/**
 * Split array into chunks
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Bulk Commerce API Class
 */
export class BulkCommerceApi {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.api = commerceApi;
  }
  
  /**
   * Create products in bulk using async API
   * 
   * @param {Array} products - Array of product objects
   * @returns {Promise<Object>} Bulk operation results
   */
  async bulkCreateProducts(products) {
    logger.info(`🚀 Starting bulk product creation (${products.length} products)...`);
    
    // Split into chunks
    const chunks = chunkArray(products, this.config.chunkSize);
    logger.info(`  Split into ${chunks.length} chunks of ${this.config.chunkSize} products`);
    
    const operations = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.info(`  Submitting chunk ${i + 1}/${chunks.length} (${chunk.length} products)...`);
      
      try {
        const bulkUuid = await this.submitBulkProductCreate(chunk);
        operations.push({
          chunkIndex: i,
          bulkUuid,
          productCount: chunk.length,
          status: 'submitted'
        });
        logger.success(`  ✔ Chunk ${i + 1} submitted (UUID: ${bulkUuid})`);
      } catch (error) {
        logger.error(`  ✗ Chunk ${i + 1} failed: ${error.message}`);
        operations.push({
          chunkIndex: i,
          productCount: chunk.length,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    logger.info(`✔ All chunks submitted. Waiting for completion...`);
    
    // Wait for all operations to complete
    const results = await this.waitForAllOperations(operations);
    
    return {
      total: products.length,
      chunks: chunks.length,
      operations: results
    };
  }
  
  /**
   * Submit a bulk product create operation
   * 
   * @param {Array} products - Chunk of products
   * @returns {Promise<string>} Bulk operation UUID
   */
  async submitBulkProductCreate(products) {
    // Commerce bulk API expects array of product objects
    const bulkPayload = products.map(product => ({
      product: this.transformToBulkFormat(product)
    }));
    
    const response = await this.api.post('/async/bulk/V1/products', bulkPayload);
    
    // Response contains bulk_uuid
    return response.data.bulk_uuid;
  }
  
  /**
   * Transform product to bulk API format
   */
  transformToBulkFormat(product) {
    // The bulk API expects the same format as individual product API
    // but we need to ensure custom_attributes are properly formatted
    const bulkProduct = {
      sku: product.sku,
      name: product.name,
      attribute_set_id: 4, // Default
      price: product.price || 0,
      status: product.status || 1,
      visibility: product.visibility || 4,
      type_id: product.product_type || product.type_id || 'simple',
      weight: product.weight || 1,
      extension_attributes: {
        website_ids: [1],
        stock_item: {
          qty: product.qty || 100,
          is_in_stock: true,
          manage_stock: true
        }
      },
      custom_attributes: []
    };
    
    // Add custom attributes
    const customAttrFields = ['br_brand', 'uom', 'br_construction_phase', 'br_quality_tier'];
    for (const field of customAttrFields) {
      if (product[field]) {
        bulkProduct.custom_attributes.push({
          attribute_code: field,
          value: product[field]
        });
      }
    }
    
    // Add categories if present
    if (product.categories) {
      bulkProduct.custom_attributes.push({
        attribute_code: 'category_ids',
        value: product.categories
      });
    }
    
    return bulkProduct;
  }
  
  /**
   * Delete products in bulk
   * 
   * @param {Array<string>} skus - Array of product SKUs to delete
   * @returns {Promise<Object>} Bulk operation results
   */
  async bulkDeleteProducts(skus) {
    logger.info(`🗑️  Starting bulk product deletion (${skus.length} products)...`);
    
    // Split into chunks
    const chunks = chunkArray(skus, this.config.chunkSize);
    logger.info(`  Split into ${chunks.length} chunks of ${this.config.chunkSize} SKUs`);
    
    const operations = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.info(`  Submitting chunk ${i + 1}/${chunks.length} (${chunk.length} SKUs)...`);
      
      try {
        const bulkUuid = await this.submitBulkProductDelete(chunk);
        operations.push({
          chunkIndex: i,
          bulkUuid,
          skuCount: chunk.length,
          status: 'submitted'
        });
        logger.success(`  ✔ Chunk ${i + 1} submitted (UUID: ${bulkUuid})`);
      } catch (error) {
        logger.error(`  ✗ Chunk ${i + 1} failed: ${error.message}`);
        operations.push({
          chunkIndex: i,
          skuCount: chunk.length,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    logger.info(`✔ All chunks submitted. Waiting for completion...`);
    
    // Wait for all operations to complete
    const results = await this.waitForAllOperations(operations);
    
    return {
      total: skus.length,
      chunks: chunks.length,
      operations: results
    };
  }
  
  /**
   * Submit bulk delete operation
   */
  async submitBulkProductDelete(skus) {
    // Bulk delete endpoint expects array of operations
    const bulkPayload = skus.map(sku => ({
      sku: sku
    }));
    
    const response = await this.api.delete('/async/bulk/V1/products/bySku', {
      data: bulkPayload
    });
    
    return response.data.bulk_uuid;
  }
  
  /**
   * Wait for all bulk operations to complete
   */
  async waitForAllOperations(operations) {
    const results = [];
    
    for (const op of operations) {
      if (op.status === 'failed') {
        results.push(op);
        continue;
      }
      
      logger.info(`  Waiting for chunk ${op.chunkIndex + 1} (${op.bulkUuid})...`);
      
      try {
        const status = await this.waitForBulkCompletion(op.bulkUuid);
        results.push({
          ...op,
          ...status,
          status: status.operations_list.some(o => o.status === 'failed') ? 'partial' : 'complete'
        });
        
        const successCount = status.operations_list.filter(o => o.status === 'complete').length;
        logger.success(`  ✔ Chunk ${op.chunkIndex + 1}: ${successCount}/${status.operations_list.length} succeeded`);
      } catch (error) {
        logger.error(`  ✗ Chunk ${op.chunkIndex + 1} failed: ${error.message}`);
        results.push({
          ...op,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return results;
  }
  
  /**
   * Check bulk operation status
   * 
   * @param {string} bulkUuid - Bulk operation UUID
   * @returns {Promise<Object>} Operation status
   */
  async getBulkStatus(bulkUuid) {
    const response = await this.api.get(`/bulk/${bulkUuid}/status`);
    return response.data;
  }
  
  /**
   * Wait for bulk operation to complete
   * 
   * @param {string} bulkUuid - Bulk operation UUID
   * @returns {Promise<Object>} Final operation status
   */
  async waitForBulkCompletion(bulkUuid) {
    const startTime = Date.now();
    let lastStatus = null;
    
    while (true) {
      const status = await this.getBulkStatus(bulkUuid);
      lastStatus = status;
      
      // Check if operation is complete
      const allDone = status.operations_list.every(op => 
        ['complete', 'failed', 'not_started'].includes(op.status)
      );
      
      if (allDone) {
        return status;
      }
      
      // Check timeout
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > this.config.maxWaitSeconds) {
        throw new Error(`Bulk operation timeout after ${elapsed}s`);
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, this.config.pollInterval));
    }
  }
  
  /**
   * Get detailed results for a bulk operation
   */
  async getBulkDetails(bulkUuid) {
    try {
      const response = await this.api.get(`/bulk/${bulkUuid}/detailed-status`);
      return response.data;
    } catch (error) {
      logger.warn(`Could not get detailed status: ${error.message}`);
      return await this.getBulkStatus(bulkUuid);
    }
  }
}

/**
 * Create a bulk API instance
 */
export function createBulkApi(config) {
  return new BulkCommerceApi(config);
}

export default {
  BulkCommerceApi,
  BulkStatus,
  createBulkApi
};

