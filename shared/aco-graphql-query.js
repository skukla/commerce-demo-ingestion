/**
 * ACO GraphQL Query Utilities (Updated with correct headers)
 * 
 * Uses the correct AC-* headers for ACO GraphQL queries.
 * This fixes the "No index found" error by using proper ACO headers.
 * 
 * @module utils/aco-graphql-query
 */

import axios from 'axios';
import { getAccessToken } from './oauth-token-manager.js';
import logger from './logger.js';
import { promises as fs } from 'fs';

/**
 * Get ACO configuration
 */
async function getACOConfig() {
  const configData = await fs.readFile('./config/aco-config.json', 'utf-8');
  return JSON.parse(configData);
}

/**
 * Execute GraphQL query against ACO with correct headers
 * 
 * Uses AC-* headers (not Magento-* headers) which are required for ACO.
 * 
 * @param {string} query - GraphQL query string
 * @param {Object} [variables={}] - Query variables
 * @param {string} [accessToken] - Optional OAuth access token
 * @returns {Promise<Object>} Query response data
 */
export async function executeACOGraphQLQuery(query, variables = {}, accessToken = null) {
  const config = await getACOConfig();
  const endpoint = `https://${config.region}${config.environment === 'sandbox' ? '-sandbox' : ''}.api.commerce.adobe.com/${config.tenantId}/graphql`;
  
  if (!accessToken) {
    accessToken = await getAccessToken();
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'AC-Environment-Id': config.tenantId,
    'AC-Source-Locale': 'en-US'
    // Optional headers (uncomment if needed):
    // 'AC-View-Id': 'your-view-id',
    // 'AC-Price-Book-Id': 'your-price-book-id'
  };
  
  logger.debug('Executing ACO GraphQL query:', {
    endpoint,
    queryLength: query.length,
    variables: Object.keys(variables)
  });
  
  try {
    const response = await axios.post(
      endpoint,
      { query, variables },
      { headers }
    );
    
    if (response.data.errors) {
      const errorMessages = response.data.errors.map(e => e.message).join(', ');
      throw new Error(`GraphQL query returned errors: ${errorMessages}`);
    }
    
    logger.debug('ACO GraphQL query successful');
    return response.data.data;
  } catch (error) {
    logger.error('ACO GraphQL query failed:', {
      message: error.message,
      endpoint,
      status: error.response?.status,
      responseData: error.response?.data
    });
    throw new Error(`ACO GraphQL query failed: ${error.message}`);
  }
}

/**
 * Query all products from ACO (with pagination)
 * 
 * Uses phrase=" " (space) which returns all products.
 * Handles pagination automatically.
 * 
 * @param {Object} options - Query options
 * @param {number} [options.pageSize=200] - Results per page
 * @param {number} [options.maxProducts=1000] - Maximum products to retrieve
 * @param {string} [accessToken] - Optional OAuth access token
 * @returns {Promise<Array>} Array of all product objects
 * 
 * @example
 * const products = await queryAllProducts();
 * console.log(`Found ${products.length} products`);
 * products.forEach(p => console.log(p.sku, p.name));
 */
export async function queryAllProducts(options = {}, accessToken = null) {
  const { pageSize = 200, maxProducts = 1000 } = options;
  
  let allProducts = [];
  let currentPage = 1;
  let totalPages = 1;
  
  do {
    const query = `
      query Q($page_size: Int, $current_page: Int) {
        productSearch(phrase: " ", page_size: $page_size, current_page: $current_page) {
          total_count
          page_info {
            current_page
            total_pages
            page_size
          }
          items {
            productView {
              __typename
              id
              sku
              name
            }
          }
        }
      }
    `;
    
    const variables = {
      page_size: pageSize,
      current_page: currentPage
    };
    
    logger.debug(`Fetching page ${currentPage} of products...`);
    
    const data = await executeACOGraphQLQuery(query, variables, accessToken);
    const productSearch = data.productSearch;
    const items = productSearch?.items || [];
    
    items.forEach(item => {
      if (item.productView) {
        allProducts.push(item.productView);
      }
    });
    
    if (productSearch?.page_info) {
      totalPages = productSearch.page_info.total_pages;
      logger.debug(`Page ${currentPage}/${totalPages}: Retrieved ${items.length} products`);
    }
    
    currentPage++;
    
    // Safety limit
    if (allProducts.length >= maxProducts) {
      logger.warn(`Reached maxProducts limit (${maxProducts}), stopping pagination`);
      break;
    }
    
  } while (currentPage <= totalPages);
  
  logger.info(`Retrieved ${allProducts.length} total products from ACO`);
  return allProducts;
}

/**
 * Query products by SKUs
 * 
 * @param {Array<string>} skus - Array of SKUs to retrieve
 * @param {string} [accessToken] - Optional OAuth access token
 * @returns {Promise<Array>} Array of product objects
 * 
 * @example
 * const products = await queryProductsBySKU(['SKU-001', 'SKU-002']);
 * console.log(products[0].name);
 */
export async function queryProductsBySKU(skus, accessToken = null) {
  const query = `
    query GetProducts($skus: [String!]!) {
      products(skus: $skus) {
        sku
        name
      }
    }
  `;
  
  const data = await executeACOGraphQLQuery(query, { skus }, accessToken);
  return data.products || [];
}

/**
 * Get total product count in ACO
 * 
 * @param {string} [accessToken] - Optional OAuth access token
 * @returns {Promise<number>} Total product count
 * 
 * @example
 * const count = await getProductCount();
 * console.log(`ACO has ${count} products`);
 */
export async function getProductCount(accessToken = null) {
  const query = `
    query Q {
      productSearch(phrase: " ", page_size: 1) {
        total_count
      }
    }
  `;
  
  const data = await executeACOGraphQLQuery(query, {}, accessToken);
  return data.productSearch?.total_count || 0;
}

export default {
  executeACOGraphQLQuery,
  queryAllProducts,
  queryProductsBySKU,
  getProductCount
};








