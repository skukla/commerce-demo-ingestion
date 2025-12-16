/**
 * Adobe Commerce Optimizer (ACO) Client Wrapper
 *
 * Official SDK-based client for Adobe Commerce Optimizer with automatic authentication,
 * retry logic, and error handling. Uses the @adobe-commerce/aco-ts-sdk for all operations.
 *
 * @module utils/aco-client
 *
 * @example
 * import { getACOClient } from './utils/aco-client.js';
 *
 * const client = getACOClient();
 *
 * // Create products
 * const response = await client.createProducts(products);
 *
 * // Create metadata
 * await client.createProductMetadata(attributes);
 *
 * @example
 * // With custom configuration
 * const customClient = createACOClient({
 *   credentials: { clientId: 'xxx', clientSecret: 'yyy' },
 *   tenantId: 'tenant-123',
 *   region: 'na1',
 *   environment: 'sandbox'
 * });
 */

import { createClient, consoleLogger, LogLevel } from '@adobe-commerce/aco-ts-sdk';
import dotenv from 'dotenv';
import logger from './logger.js';

// Load environment variables
dotenv.config();

/**
 * Singleton ACO client instance
 * @type {Object|null}
 */
let clientInstance = null;

/**
 * Creates and configures an ACO SDK client
 *
 * @param {Object} customConfig - Optional custom configuration
 * @param {Object} customConfig.credentials - IMS credentials
 * @param {string} customConfig.credentials.clientId - Adobe IMS Client ID
 * @param {string} customConfig.credentials.clientSecret - Adobe IMS Client Secret
 * @param {string} customConfig.tenantId - ACO Instance/Tenant ID
 * @param {string} customConfig.region - Deployment region (e.g., 'na1')
 * @param {string} customConfig.environment - Environment type ('sandbox' or 'production')
 * @param {number} [customConfig.timeoutMs=10000] - HTTP timeout in milliseconds
 * @returns {Object} Configured ACO SDK client
 * @throws {Error} If required configuration is missing
 *
 * @example
 * const client = createACOClient();
 * await client.createProducts([...]);
 */
export function createACOClient(customConfig = null) {
  // Use custom config or load from environment
  const config = customConfig || {
    credentials: {
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET
    },
    tenantId: process.env.TENANT_ID,
    region: process.env.REGION || 'na1',
    environment: process.env.ENVIRONMENT || 'sandbox',
    timeoutMs: parseInt(process.env.TIMEOUT_MS || '10000', 10)
  };

  // Validate required fields
  const missingFields = [];
  if (!config.credentials?.clientId) missingFields.push('CLIENT_ID');
  if (!config.credentials?.clientSecret) missingFields.push('CLIENT_SECRET');
  if (!config.tenantId) missingFields.push('TENANT_ID');

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required ACO configuration: ${missingFields.join(', ')}. ` +
      'Please check your .env file or provide customConfig parameter.'
    );
  }

  // Log configuration (without secrets) - debug only
  logger.debug('Creating ACO client with configuration:', {
    tenantId: config.tenantId,
    region: config.region,
    environment: config.environment,
    timeoutMs: config.timeoutMs,
    endpoint: constructEndpoint(config)
  });

  // Create and return SDK client with WARN-level logging to suppress verbose DEBUG logs
  try {
    const client = createClient({
      ...config,
      logger: consoleLogger(LogLevel.WARN) // Only show warnings and errors
    });
    logger.debug('ACO client created successfully');
    return client;
  } catch (error) {
    logger.error('Failed to create ACO client:', error);
    throw new Error(`ACO client initialization failed: ${error.message}`);
  }
}

/**
 * Gets the singleton ACO client instance
 *
 * Creates a new instance on first call, then returns the cached instance.
 * Uses environment variables for configuration.
 *
 * @returns {Object} Singleton ACO SDK client
 * @throws {Error} If required configuration is missing
 *
 * @example
 * import { getACOClient } from './utils/aco-client.js';
 *
 * const client = getACOClient();
 * await client.createProducts(products);
 */
export function getACOClient() {
  if (!clientInstance) {
    clientInstance = createACOClient();
  }
  return clientInstance;
}

/**
 * Resets the singleton client instance
 *
 * Useful for testing or when switching between different ACO instances.
 *
 * @example
 * resetACOClient(); // Force recreation on next getACOClient() call
 */
export function resetACOClient() {
  clientInstance = null;
  logger.debug('ACO client instance reset');
}

/**
 * Constructs the base endpoint URL for logging purposes
 *
 * @param {Object} config - Client configuration
 * @returns {string} Base endpoint URL
 * @private
 */
function constructEndpoint(config) {
  const envSuffix = config.environment === 'sandbox' ? '-sandbox' : '';
  return `https://${config.region}${envSuffix}.api.commerce.adobe.com/${config.tenantId}/v1/catalog`;
}

/**
 * Gets the GraphQL endpoint URL
 *
 * @returns {string} GraphQL endpoint URL
 * @throws {Error} If required configuration is missing
 *
 * @example
 * const endpoint = getGraphQLEndpoint();
 * // Returns: https://na1-sandbox.api.commerce.adobe.com/tenant-123/graphql
 */
export function getGraphQLEndpoint() {
  const region = process.env.REGION || 'na1';
  const environment = process.env.ENVIRONMENT || 'sandbox';
  const tenantId = process.env.TENANT_ID;

  if (!tenantId) {
    throw new Error('TENANT_ID is required to construct GraphQL endpoint');
  }

  const envSuffix = environment === 'sandbox' ? '-sandbox' : '';
  return `https://${region}${envSuffix}.api.commerce.adobe.com/${tenantId}/graphql`;
}

/**
 * Gets the ACO UI URL for instance management
 *
 * @returns {string} ACO UI URL
 * @throws {Error} If TENANT_ID is missing
 *
 * @example
 * const uiUrl = getACOUIUrl();
 * // Returns: https://experience.adobe.com/#/@demosystem/in:tenant-123/commerce-optimizer-studio
 */
export function getACOUIUrl() {
  const tenantId = process.env.TENANT_ID;

  if (!tenantId) {
    throw new Error('TENANT_ID is required to construct ACO UI URL');
  }

  return `https://experience.adobe.com/#/@demosystem/in:${tenantId}/commerce-optimizer-studio`;
}

/**
 * Batch processor wrapper for ACO operations
 *
 * Handles automatic batching according to ACO API limits:
 * - Products: 100 per batch
 * - Prices: 100 per batch
 * - Metadata: 50 per batch (recommended)
 * - Categories: 50 per batch (recommended)
 *
 * @param {Array} items - Items to process
 * @param {Function} operation - Async operation to perform on each batch
 * @param {number} batchSize - Items per batch
 * @param {string} entityType - Entity type for logging
 * @returns {Promise<Object>} Summary of results
 *
 * @example
 * const client = getACOClient();
 * const results = await batchProcess(
 *   products,
 *   (batch) => client.createProducts(batch),
 *   100,
 *   'products'
 * );
 */
export async function batchProcess(items, operation, batchSize, entityType) {
  const totalItems = items.length;
  const batches = Math.ceil(totalItems / batchSize);
  const results = {
    total: totalItems,
    processed: 0,
    failed: 0,
    errors: []
  };

  logger.info(`Processing ${totalItems} ${entityType} in ${batches} batches of ${batchSize}`);

  for (let i = 0; i < totalItems; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      logger.info(`Processing batch ${batchNum}/${batches} (${batch.length} ${entityType})`);
      await operation(batch);
      results.processed += batch.length;
      logger.info(`Batch ${batchNum}/${batches} completed successfully`);
    } catch (error) {
      results.failed += batch.length;
      results.errors.push({
        batch: batchNum,
        error: error.message,
        items: batch.length
      });
      logger.error(`Batch ${batchNum}/${batches} failed:`, error);
    }
  }

  logger.info(`Batch processing complete: ${results.processed}/${results.total} succeeded, ${results.failed} failed`);
  return results;
}

// Export default client getter for convenience
export default getACOClient;
