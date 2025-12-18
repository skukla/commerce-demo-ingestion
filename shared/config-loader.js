/**
 * Config Loader
 * Loads project configuration from data repository
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env from project root
config({ path: resolve(process.cwd(), '.env') });

const DATA_REPO_PATH = process.env.DATA_REPO_PATH;
if (!DATA_REPO_PATH) {
  throw new Error('DATA_REPO_PATH environment variable is required. Please set it in your .env file.');
}

const DATA_REPO = DATA_REPO_PATH;
const DEFINITIONS_PATH = resolve(DATA_REPO, 'definitions');

/**
 * Load project configuration from data repository
 */
function loadProjectConfig() {
  const projectJsonPath = resolve(DEFINITIONS_PATH, 'project.json');
  try {
    const projectJson = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
    return projectJson;
  } catch (error) {
    console.error(`Failed to load project configuration from ${projectJsonPath}`);
    console.error(`Error: ${error.message}`);
    console.error(`\nMake sure DATA_REPO_PATH is set correctly in your .env file.`);
    throw error;
  }
}

/**
 * Load JSON file from definitions
 */
function loadDefinition(filename) {
  const filePath = resolve(DEFINITIONS_PATH, filename);
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Failed to load ${filename} from ${filePath}`);
    console.error(`Error: ${error.message}`);
    return null;
  }
}

// Export validated DATA_REPO_PATH for use by all scripts
export { DATA_REPO_PATH };

// Load and export project configuration
export const PROJECT_CONFIG = loadProjectConfig();

// Load data definitions
export const CATEGORY_TREE = loadDefinition('categories/category-tree.json');
export const PRODUCT_ATTRIBUTES = loadDefinition('attributes/product-attributes.json');
export const CUSTOMER_ATTRIBUTES = loadDefinition('attributes/customer-attributes.json');
export const CUSTOMER_GROUPS = loadDefinition('customers/customer-groups.json');
export const DEMO_CUSTOMERS = loadDefinition('customers/demo-customers.json');

// Export convenience values
export const COMMERCE_CONFIG = {
  project: PROJECT_CONFIG,
  
  // Store structure
  websiteCode: PROJECT_CONFIG.websiteCode,
  storeCode: PROJECT_CONFIG.storeCode,
  storeViewCode: PROJECT_CONFIG.storeViewCode,
  
  // Attribute prefixes
  attributePrefix: PROJECT_CONFIG.attributePrefix,
  customerAttributePrefix: PROJECT_CONFIG.customerAttributePrefix,
  
  // Category
  ROOT_CATEGORY_NAME: PROJECT_CONFIG.rootCategoryName,
  
  // Commerce API Configuration (from .env)
  baseUrl: process.env.COMMERCE_BASE_URL,
  adminUsername: process.env.COMMERCE_ADMIN_USERNAME,
  adminPassword: process.env.COMMERCE_ADMIN_PASSWORD,
  adminToken: process.env.COMMERCE_ADMIN_TOKEN, // Optional: if provided, skips token generation
  verbose: process.env.VERBOSE === 'true' || process.env.COMMERCE_DEBUG === 'true',
  
  // API paths
  api: {
    version: 'V1',
    paths: {
      adminToken: '/integration/admin/token'
    }
  },
  
  // Data paths (relative to data repo)
  dataPaths: {
    commerce: resolve(DATA_REPO, 'generated/commerce'),
    aco: resolve(DATA_REPO, 'generated/aco')
  },
  
  // ACO API Configuration (from .env)
  aco: {
    tenantId: process.env.ACO_TENANT_ID,
    region: process.env.ACO_REGION || 'na1',
    environment: process.env.ACO_ENVIRONMENT || 'sandbox',
    clientId: process.env.ACO_CLIENT_ID,
    clientSecret: process.env.ACO_CLIENT_SECRET,
    catalogViewId: process.env.ACO_CATALOG_VIEW_ID,
    websiteCode: process.env.ACO_WEBSITE_CODE || PROJECT_CONFIG.websiteCode,
    timeoutMs: parseInt(process.env.ACO_TIMEOUT_MS || '10000', 10)
  }
};

