#!/usr/bin/env node

/**
 * Import Customers to Commerce
 * Reads from committed datapack: accs_customers.json
 * 
 * Uses BaseImporter for standardized patterns
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { BaseImporter } from '../../shared/base-importer.js';

import { DATA_REPO_PATH } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to committed datapack customers file
const DATAPACK_CUSTOMERS_PATH = resolve(DATA_REPO_PATH, 'generated/commerce/data/accs/accs_customers.json');

class CustomerImporter extends BaseImporter {
  constructor(options = {}) {
    super('Customers', options);
    this.groupIdMap = options.groupIdMap || {};
    this.websiteIds = options.websiteIds || [];
    this.websiteCodeToIdMap = {}; // Maps website codes to IDs
  }

  /**
   * Load customers from datapack
   */
  loadCustomers() {
    this.logger.info(`Loading customers from datapack: ${DATAPACK_CUSTOMERS_PATH}`);
    const data = JSON.parse(readFileSync(DATAPACK_CUSTOMERS_PATH, 'utf-8'));
    return data.source.items; // Array of customer objects in ACCS format
  }

  /**
   * Fetch customer groups and build code→id map
   * This allows using group_code in the datapack instead of brittle group_id
   */
  async fetchGroupIdMap() {
    try {
      const response = await this.api.get('/rest/V1/customerGroups/search?searchCriteria[pageSize]=100');
      const groups = response.items || [];
      const map = {};
      for (const group of groups) {
        map[group.code] = group.id;
      }
      this.logger.info(`Loaded ${groups.length} customer groups for code→id resolution`);
      return map;
    } catch (error) {
      this.logger.warn(`Could not fetch customer groups: ${error.message}`);
      return {};
    }
  }

  /**
   * Fetch websites and build code→id map
   * This allows using _website code in the datapack instead of brittle website_id
   */
  async fetchWebsiteCodeToIdMap() {
    try {
      const response = await this.api.get('/rest/V1/store/websites');
      const websites = response || [];
      const map = {};
      for (const website of websites) {
        map[website.code] = website.id;
        this.logger.debug(`Website mapping: ${website.code} → ${website.id}`);
      }
      this.logger.info(`Loaded ${websites.length} websites for code→id resolution`);
      return map;
    } catch (error) {
      this.logger.warn(`Could not fetch websites: ${error.message}`);
      return {};
    }
  }

  /**
   * Fetch store views and build websiteId→storeCode map
   * CRITICAL: Store-scoped REST API endpoints are required for password setting
   * Without store scope, passwords may not be set correctly for multi-website setups
   */
  async fetchWebsiteIdToStoreCodeMap() {
    try {
      const response = await this.api.get('/rest/V1/store/storeViews');
      const storeViews = response || [];
      const map = {};
      for (const view of storeViews) {
        // Only map if not already set (prefer first/main store view per website)
        if (!map[view.website_id]) {
          map[view.website_id] = view.code;
          this.logger.debug(`Website ID ${view.website_id} → store code '${view.code}'`);
        }
      }
      this.logger.info(`Loaded ${Object.keys(map).length} website→store mappings`);
      return map;
    } catch (error) {
      this.logger.warn(`Could not fetch store views: ${error.message}`);
      return {};
    }
  }

  async import() {
    const customers = this.loadCustomers();

    // Fetch group code→id map for dynamic resolution
    // This allows using group_code in datapack instead of brittle group_id
    this.groupIdMap = await this.fetchGroupIdMap();

    // Fetch website code→id map for dynamic resolution
    // This allows using _website code in datapack instead of brittle website_id
    this.websiteCodeToIdMap = await this.fetchWebsiteCodeToIdMap();

    // Fetch websiteId→storeCode map for store-scoped API calls
    // CRITICAL: Required for password setting in multi-website setups
    this.websiteIdToStoreCodeMap = await this.fetchWebsiteIdToStoreCodeMap();

    if (this.websiteIds && this.websiteIds.length > 0) {
      this.logger.info(`Website scope: ${this.websiteIds.join(', ')}`);
    } else if (Object.keys(this.websiteCodeToIdMap).length > 0) {
      this.logger.info(`Website code→id map loaded for dynamic resolution`);
    } else {
      this.logger.warn(`No website IDs provided - customers may be assigned to wrong website`);
    }
    
    await this.optimizedImport({
      loadItems: () => customers,
      fetchExisting: async () => {
        const emails = customers.map(c => c.email);
        if (!emails || emails.length === 0) return [];
        
        try {
          const params = new URLSearchParams({
            'searchCriteria[pageSize]': 1000,
            'searchCriteria[filterGroups][0][filters][0][field]': 'email',
            'searchCriteria[filterGroups][0][filters][0][conditionType]': 'in',
            'searchCriteria[filterGroups][0][filters][0][value]': emails.join(',')
          });

          if (this.websiteIds && this.websiteIds.length > 0) {
            params.append('searchCriteria[filterGroups][1][filters][0][field]', 'website_id');
            params.append('searchCriteria[filterGroups][1][filters][0][value]', this.websiteIds[0]);
            params.append('searchCriteria[filterGroups][1][filters][0][conditionType]', 'eq');
          }

          const response = await this.api.get(`/rest/V1/customers/search?${params.toString()}`);
          return response.items || [];
        } catch (error) {
          this.logger.warn(`Could not fetch existing customers: ${error.message}`);
          return [];
        }
      },
      getItemKey: (customer) => customer.email.toLowerCase(),
      onExisting: (customerData, existing) => {
        this.results.addExisting({ 
          email: customerData.email, 
          name: `${customerData.firstname} ${customerData.lastname}`,
          websiteId: existing.website_id 
        });
        this.logger.debug(`Customer ${customerData.email} already exists (website ID: ${existing.website_id})`);
      },
      processNewItem: async (customerData) => {
        try {
          const customerPayload = this.transformCustomer(customerData);
          await this.createCustomer(customerPayload);
          this.results.addCreated({ 
            email: customerData.email, 
            name: `${customerData.firstname} ${customerData.lastname}` 
          });
        } catch (error) {
          this.results.addFailed({ email: customerData.email }, error);
          this.logger.error(`Failed to process customer ${customerData.email}: ${error.message}`);
        }
      },
      itemLabel: 'customers'
    });
    
    // Output credentials summary
    this.logCredentialsSummary();
    
    return {
      total: customers.length,
      created: this.results.created.length,
      existing: this.results.existing.length,
      failed: this.results.failed.length,
      results: this.results
    };
  }
  
  transformCustomer(accsData) {
    // Transform ACCS CSV format to Commerce API format

    // Resolve group_code to group_id dynamically (preferred over brittle group_id)
    let groupId = accsData.group_id || 1;
    if (accsData.group_code && this.groupIdMap[accsData.group_code]) {
      groupId = this.groupIdMap[accsData.group_code];
      this.logger.debug(`Resolved group_code "${accsData.group_code}" → group_id ${groupId}`);
    }

    // Resolve _website code to website_id dynamically (preferred over brittle website_id)
    let websiteId = 1; // Default fallback
    if (accsData._website && this.websiteCodeToIdMap[accsData._website]) {
      websiteId = this.websiteCodeToIdMap[accsData._website];
      this.logger.debug(`Resolved _website "${accsData._website}" → website_id ${websiteId}`);
    } else if (accsData.website_id && accsData.website_id !== 0) {
      websiteId = accsData.website_id;
    } else if (this.websiteIds && this.websiteIds.length > 0) {
      websiteId = this.websiteIds[0];
    }

    const customer = {
      email: accsData.email,
      firstname: accsData.firstname,
      lastname: accsData.lastname,
      website_id: websiteId,
      group_id: groupId
    };
    
    // Add optional fields if present
    if (accsData.middlename) customer.middlename = accsData.middlename;
    if (accsData.prefix) customer.prefix = accsData.prefix;
    if (accsData.suffix) customer.suffix = accsData.suffix;
    if (accsData.dob) customer.dob = accsData.dob;
    if (accsData.gender) customer.gender = accsData.gender;
    if (accsData.taxvat) customer.taxvat = accsData.taxvat;
    
    // Build addresses array if address fields are present
    const addresses = [];
    if (accsData._address_street) {
      addresses.push({
        firstname: accsData._address_firstname || accsData.firstname,
        lastname: accsData._address_lastname || accsData.lastname,
        street: [accsData._address_street],
        city: accsData._address_city,
        region: {
          region: accsData._address_region
        },
        postcode: accsData._address_postcode,
        country_id: accsData._address_country_id || 'US',
        telephone: accsData._address_telephone,
        default_billing: accsData._address_default_billing_ === '1',
        default_shipping: accsData._address_default_shipping_ === '1'
      });
    }
    
    return {
      customer,
      password: accsData.password,
      addresses
    };
  }
  
  async createCustomer({ customer, password, addresses }) {
    // Add addresses to customer object before creation
    if (addresses && addresses.length > 0) {
      customer.addresses = addresses;
    }

    const payload = {
      customer,
      password
    };

    // CRITICAL: Use store-scoped endpoint for password setting
    // Without store scope, passwords may not be set correctly for multi-website setups
    const websiteId = customer.website_id || 1;
    const storeCode = this.websiteIdToStoreCodeMap?.[websiteId] || 'all';

    this.logger.debug(`Creating customer ${customer.email} with store scope '${storeCode}'`);
    const response = await this.api.post(`/rest/${storeCode}/V1/customers`, payload);

    return response;
  }
  
  logCredentialsSummary() {
    // Note: In a locked demo, credentials are pre-defined in the datapack
    this.logger.info('\\nDemo customer credentials are defined in the datapack.');
  }
}

/**
 * Main import function
 */
export async function importCustomers(options = {}) {
  const importer = new CustomerImporter(options);
  return await importer.import();
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importCustomers()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}

