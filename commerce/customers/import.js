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
  }
  
  /**
   * Load customers from datapack
   */
  loadCustomers() {
    this.logger.info(`Loading customers from datapack: ${DATAPACK_CUSTOMERS_PATH}`);
    const data = JSON.parse(readFileSync(DATAPACK_CUSTOMERS_PATH, 'utf-8'));
    return data.source.items; // Array of customer objects in ACCS format
  }
  
  async import() {
    const customers = this.loadCustomers();
    
    if (this.websiteIds && this.websiteIds.length > 0) {
      this.logger.info(`Website scope: ${this.websiteIds.join(', ')}`);
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
    const customer = {
      email: accsData.email,
      firstname: accsData.firstname,
      lastname: accsData.lastname,
      website_id: accsData.website_id || (this.websiteIds[0] || 1),
      group_id: accsData.group_id || 1
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
    
    const response = await this.api.post('/rest/V1/customers', payload);
    
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

