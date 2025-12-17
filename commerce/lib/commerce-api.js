/**
 * Commerce REST API Client
 * Handles authentication and API requests to Adobe Commerce
 */

import { COMMERCE_CONFIG } from '../../shared/config-loader.js';

/**
 * Logger utility
 */
export const logger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  success: (msg, ...args) => console.log(`[SUCCESS] ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (COMMERCE_CONFIG.verbose) {
      console.log(`[DEBUG] ${msg}`, ...args);
    }
  }
};

// Cache for generated admin token
let cachedAdminToken = null;
let tokenExpiresAt = null;
const TOKEN_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours (Commerce default is ~4 hours)

/**
 * Build API URL
 */
function buildUrl(endpoint) {
  const base = COMMERCE_CONFIG.baseUrl.replace(/\/$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

/**
 * Generate admin token from username/password
 */
async function generateAdminToken() {
  const { baseUrl, adminUsername, adminPassword, api } = COMMERCE_CONFIG;
  
  if (!adminUsername || !adminPassword) {
    throw new Error('Commerce admin credentials not provided. Set COMMERCE_ADMIN_USERNAME and COMMERCE_ADMIN_PASSWORD in .env');
  }
  
  const tokenUrl = `${baseUrl}/rest/${api.version}${api.paths.adminToken}`;
  
  logger.debug('Generating Commerce admin token...');
  logger.debug(`Token URL: ${tokenUrl}`);
  
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: adminUsername,
        password: adminPassword
      })
    });
    
    if (!response.ok) {
      let errorDetails = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        errorDetails += ` - ${errorBody}`;
      } catch (e) {
        // Use status if can't read error body
      }
      throw new Error(`Token request failed: ${errorDetails}`);
    }
    
    const token = await response.json();
    // Commerce returns token with quotes, clean them
    const cleanToken = typeof token === 'string' ? token.replace(/"/g, '') : token;
    
    // Cache the token
    cachedAdminToken = cleanToken;
    tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
    
    logger.debug('Admin token generated successfully');
    return cleanToken;
  } catch (error) {
    logger.error('Failed to generate admin token:', error.message);
    throw error;
  }
}

/**
 * Get admin token (from cache, config, or generate new)
 */
async function getAdminToken() {
  // Check if we have a pre-configured token
  if (COMMERCE_CONFIG.adminToken) {
    return COMMERCE_CONFIG.adminToken;
  }
  
  // Check cached token validity
  if (cachedAdminToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedAdminToken;
  }
  
  // Generate new token
  return await generateAdminToken();
}

/**
 * Get authorization headers
 */
async function getAuthHeaders() {
  const token = await getAdminToken();
  
  if (!token) {
    throw new Error('Unable to obtain admin token. Check your credentials in .env');
  }
  
  return {
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Make API request
 */
async function apiRequest(method, endpoint, body = null, options = {}) {
  const url = buildUrl(endpoint);
  
  const authHeaders = await getAuthHeaders();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...authHeaders,
    ...options.headers
  };
  
  const fetchOptions = {
    method,
    headers
  };
  
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    fetchOptions.body = JSON.stringify(body);
  }
  
  if (COMMERCE_CONFIG.dryRun && method !== 'GET') {
    logger.info(`[DRY RUN] ${method} ${url}`);
    if (body) {
      logger.debug('Request body:', JSON.stringify(body, null, 2));
    }
    return { dryRun: true, method, url, body };
  }
  
  // Only log on verbose mode
  if (COMMERCE_CONFIG.verbose) {
    logger.debug(`${method} ${url}`);
  }
  
  try {
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      
      const error = new Error(errorData.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = errorData;
      throw error;
    }
    
    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return null;
    }
    
    return JSON.parse(text);
  } catch (error) {
    if (error.status) {
      throw error;
    }
    throw new Error(`API request failed: ${error.message}`);
  }
}

/**
 * Commerce API Methods
 */
export const commerceApi = {
  // ==================== Customer Groups ====================
  
  async getCustomerGroups() {
    return apiRequest('GET', '/rest/V1/customerGroups/search?searchCriteria[pageSize]=100');
  },
  
  async createCustomerGroup(group) {
    return apiRequest('POST', '/rest/V1/customerGroups', { group });
  },
  
  async getCustomerGroupByCode(code) {
    const groups = await this.getCustomerGroups();
    return groups.items?.find(g => g.code === code);
  },
  
  // ==================== Product Attributes ====================
  
  async getProductAttributes() {
    return apiRequest('GET', '/rest/V1/products/attributes?searchCriteria[pageSize]=500');
  },
  
  async getProductAttribute(attributeCode) {
    try {
      return await apiRequest('GET', `/rest/V1/products/attributes/${attributeCode}`);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  
  async createProductAttribute(attribute) {
    return apiRequest('POST', '/rest/V1/products/attributes', { attribute });
  },
  
  async addAttributeOption(attributeCode, option) {
    return apiRequest('POST', `/rest/V1/products/attributes/${attributeCode}/options`, { option });
  },
  
  // ==================== Categories ====================
  
  async getCategories() {
    return apiRequest('GET', '/rest/V1/categories');
  },
  
  async getCategoryByName(name, parentId = null) {
    const categories = await apiRequest('GET', '/rest/V1/categories/list?searchCriteria[pageSize]=500');
    return categories.items?.find(c => 
      c.name === name && (parentId === null || c.parent_id === parentId)
    );
  },
  
  async createCategory(category) {
    return apiRequest('POST', '/rest/V1/categories', { category });
  },
  
  async deleteCategory(categoryId) {
    return apiRequest('DELETE', `/rest/V1/categories/${categoryId}`);
  },
  
  // ==================== Products ====================
  
  async searchProducts(options = {}) {
    const { pageSize = 100, currentPage = 1 } = options;
    const params = new URLSearchParams({
      'searchCriteria[pageSize]': pageSize,
      'searchCriteria[currentPage]': currentPage
    });
    return apiRequest('GET', `/rest/V1/products?${params.toString()}`);
  },
  
  /**
   * Get all existing product SKUs (for bulk existence checking)
   * Returns a Set of SKUs for O(1) lookup
   */
  async getAllProductSkus() {
    const skus = new Set();
    let currentPage = 1;
    const pageSize = 300;
    let hasMore = true;
    
    while (hasMore) {
      const result = await this.searchProducts({ pageSize, currentPage });
      if (result?.items) {
        for (const product of result.items) {
          skus.add(product.sku);
        }
        hasMore = result.items.length === pageSize;
        currentPage++;
      } else {
        hasMore = false;
      }
    }
    
    return skus;
  },
  
  async getProduct(sku) {
    try {
      return await apiRequest('GET', `/rest/V1/products/${encodeURIComponent(sku)}`);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  
  async createProduct(product) {
    return apiRequest('POST', '/rest/V1/products', { product });
  },
  
  async updateProduct(sku, product) {
    return apiRequest('PUT', `/rest/V1/products/${encodeURIComponent(sku)}`, { product });
  },
  
  async deleteProduct(sku) {
    return apiRequest('DELETE', `/rest/V1/products/${encodeURIComponent(sku)}`);
  },
  
  async addProductMedia(sku, media, storeScope = 'all') {
    // Use store-scoped endpoint: 'all' for all stores, 'default' for default, or specific store code
    const endpoint = `/rest/${storeScope}/V1/products/${encodeURIComponent(sku)}/media`;
    return apiRequest('POST', endpoint, { entry: media });
  },
  
  // ==================== Multi-Source Inventory (MSI) ====================
  
  /**
   * Assign product to inventory source(s)
   * Required when MSI is enabled in Commerce
   */
  async assignSourceItems(sourceItems) {
    return apiRequest('POST', '/rest/V1/inventory/source-items', { sourceItems });
  },
  
  /**
   * Assign a single product to a source with quantity
   */
  async assignProductToSource(sku, sourceCode = 'default', quantity = 100, status = 1) {
    return this.assignSourceItems([{
      sku,
      source_code: sourceCode,
      quantity,
      status
    }]);
  },
  
  // ==================== Bundle Products ====================
  
  async addBundleOption(sku, option) {
    return apiRequest('POST', `/rest/V1/bundle-products/${encodeURIComponent(sku)}/options/add`, { option });
  },
  
  async addBundleLink(sku, optionId, link) {
    return apiRequest('POST', `/rest/V1/bundle-products/${encodeURIComponent(sku)}/links/${optionId}`, { linkedProduct: link });
  },
  
  // ==================== Customers ====================
  
  async getCustomer(email) {
    try {
      const result = await apiRequest('GET', `/rest/V1/customers/search?searchCriteria[filterGroups][0][filters][0][field]=email&searchCriteria[filterGroups][0][filters][0][value]=${encodeURIComponent(email)}`);
      return result.items?.[0] || null;
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  
  async createCustomer(customer, password) {
    return apiRequest('POST', '/rest/V1/customers', { customer, password });
  },
  
  async updateCustomer(customerId, customer) {
    return apiRequest('PUT', `/rest/V1/customers/${customerId}`, { customer });
  },
  
  // ==================== Customer Attributes ====================
  
  async getCustomerAttributes() {
    return apiRequest('GET', '/rest/V1/attributeMetadata/customer');
  },
  
  async getCustomerAttribute(attributeCode) {
    try {
      return await apiRequest('GET', `/rest/V1/attributeMetadata/customer/attribute/${attributeCode}`);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  
  async createCustomerAttribute(attribute) {
    // Customer custom attributes endpoint
    return apiRequest('POST', '/rest/V1/customerCustomAttributes', { attribute });
  },
  
  // ==================== Websites & Stores ====================
  
  async getWebsites() {
    return apiRequest('GET', '/rest/V1/store/websites');
  },
  
  async getWebsiteByCode(code) {
    const websites = await this.getWebsites();
    return websites.find(w => w.code === code);
  },
  
  async createWebsite(website) {
    return apiRequest('POST', '/rest/V1/store/websites', { website });
  },
  
  async getStoreGroups() {
    return apiRequest('GET', '/rest/V1/store/storeGroups');
  },
  
  async getStoreGroupByCode(code) {
    const groups = await this.getStoreGroups();
    return groups.find(g => g.code === code);
  },
  
  async createStoreGroup(storeGroup) {
    return apiRequest('POST', '/rest/V1/store/storeGroups', { storeGroup });
  },
  
  async getStoreViews() {
    return apiRequest('GET', '/rest/V1/store/storeViews');
  },
  
  async getStoreViewByCode(code) {
    const views = await this.getStoreViews();
    return views.find(v => v.code === code);
  },
  
  async createStoreView(storeView) {
    return apiRequest('POST', '/rest/V1/store/storeViews', { storeView });
  },
  
  async getRootCategories() {
    // Get all categories at level 1 (root categories)
    const result = await apiRequest('GET', '/rest/V1/categories?rootCategoryId=1&depth=1');
    return result.children_data || [];
  },
  
  // ==================== Utility ====================
  
  /**
   * Generic GET request
   */
  async get(endpoint) {
    return apiRequest('GET', endpoint);
  },
  
  /**
   * Generic POST request
   */
  async post(endpoint, body = null) {
    return apiRequest('POST', endpoint, body);
  },
  
  /**
   * Generic PUT request
   */
  async put(endpoint, body = null) {
    return apiRequest('PUT', endpoint, body);
  },
  
  /**
   * Generic DELETE request
   */
  async delete(endpoint) {
    return apiRequest('DELETE', endpoint);
  },
  
  async testConnection() {
    try {
      await apiRequest('GET', '/rest/V1/store/storeConfigs');
      return true;
    } catch (error) {
      logger.error('Connection test failed:', error.message);
      return false;
    }
  }
};

/**
 * Batch processing utility
 */
export async function processBatch(items, processFn, options = {}) {
  const { batchSize = COMMERCE_CONFIG.batchSize, delayMs = 100 } = options;
  const results = { success: [], failed: [] };
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);
    
    logger.info(`Processing batch ${batchNum}/${totalBatches} (${batch.length} items)`);
    
    for (const item of batch) {
      try {
        const result = await processFn(item);
        results.success.push({ item, result });
      } catch (error) {
        logger.error(`Failed to process item:`, error.message);
        results.failed.push({ item, error: error.message });
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

/**
 * Resolve website code to ID
 * Used when stores import doesn't provide IDs (e.g., stores already exist)
 */
export async function resolveWebsiteId(websiteCode) {
  try {
    logger.debug(`Resolving website code '${websiteCode}' to ID...`);
    const websites = await commerceApi.get('/rest/V1/store/websites');
    
    if (!Array.isArray(websites)) {
      logger.warn('Store API returned invalid response, defaulting to website ID 1');
      return 1;
    }
    
    const website = websites.find(w => w.code === websiteCode);
    if (website) {
      logger.debug(`Resolved '${websiteCode}' to website ID ${website.id}`);
      return website.id;
    }
    
    logger.warn(`Website '${websiteCode}' not found, defaulting to website ID 1`);
    return 1;
  } catch (error) {
    logger.warn(`Failed to resolve website ID for '${websiteCode}': ${error.message}`);
    logger.debug('Defaulting to website ID 1');
    return 1;
  }
}

/**
 * Export token generation for manual use
 */
export { generateAdminToken, getAdminToken };

export default commerceApi;

