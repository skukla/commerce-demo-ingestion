#!/usr/bin/env node

/**
 * Import B2B Companies to Commerce
 * Reads from committed datapack: accs_companies.json
 *
 * Creates companies and assigns customers as company admins.
 * Must run AFTER customers are imported (needs customer IDs for super_user_id).
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

// Path to committed datapack companies file
const DATAPACK_COMPANIES_PATH = resolve(DATA_REPO_PATH, 'generated/commerce/data/accs/accs_companies.json');

class CompanyImporter extends BaseImporter {
  constructor(options = {}) {
    super('Companies', options);
    this.customerEmailToIdMap = options.customerEmailToIdMap || {};
    this.groupCodeToIdMap = {}; // Maps group codes to IDs
  }

  /**
   * Load companies from datapack
   */
  loadCompanies() {
    this.logger.info(`Loading companies from datapack: ${DATAPACK_COMPANIES_PATH}`);
    const data = JSON.parse(readFileSync(DATAPACK_COMPANIES_PATH, 'utf-8'));
    return data.companies || [];
  }

  /**
   * Fetch customer groups and build code→id map
   * This allows using group_code in the datapack instead of brittle group_id
   */
  async fetchGroupCodeToIdMap() {
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
   * Fetch all customers and build email→id map
   * This allows linking customers to companies as admins
   */
  async fetchCustomerEmailToIdMap() {
    try {
      const response = await this.api.get('/rest/V1/customers/search?searchCriteria[pageSize]=1000');
      const customers = response.items || [];
      const map = {};
      for (const customer of customers) {
        map[customer.email.toLowerCase()] = customer.id;
      }
      this.logger.info(`Loaded ${customers.length} customers for email→id resolution`);
      return map;
    } catch (error) {
      this.logger.warn(`Could not fetch customers: ${error.message}`);
      return {};
    }
  }

  /**
   * Fetch existing companies
   */
  async fetchExistingCompanies() {
    try {
      const response = await this.api.get('/rest/V1/company?searchCriteria[pageSize]=1000');
      return response.items || [];
    } catch (error) {
      this.logger.warn(`Could not fetch existing companies: ${error.message}`);
      return [];
    }
  }

  async import() {
    const companies = this.loadCompanies();

    if (companies.length === 0) {
      this.logger.info('No companies to import');
      return {
        total: 0,
        created: 0,
        existing: 0,
        failed: 0,
        results: this.results
      };
    }

    // Fetch customer email→id map for company admin assignment
    this.customerEmailToIdMap = await this.fetchCustomerEmailToIdMap();

    // Fetch group code→id map for dynamic resolution
    this.groupCodeToIdMap = await this.fetchGroupCodeToIdMap();

    await this.optimizedImport({
      loadItems: () => companies,
      fetchExisting: async () => {
        return await this.fetchExistingCompanies();
      },
      getItemKey: (company) => company.company.company_name.toLowerCase(),
      getExistingKey: (existing) => existing.company_name.toLowerCase(),
      onExisting: (companyData, existing) => {
        this.results.addExisting({
          name: companyData.company.company_name,
          id: existing.id
        });
        this.logger.debug(`Company ${companyData.company.company_name} already exists (ID: ${existing.id})`);
      },
      processNewItem: async (companyData) => {
        try {
          const result = await this.createCompany(companyData);
          this.results.addCreated({
            name: companyData.company.company_name,
            id: result.id
          });
        } catch (error) {
          this.results.addFailed({ name: companyData.company.company_name }, error);
          this.logger.error(`Failed to create company ${companyData.company.company_name}: ${error.message}`);
        }
      },
      itemLabel: 'companies'
    });

    return {
      total: companies.length,
      created: this.results.created.length,
      existing: this.results.existing.length,
      failed: this.results.failed.length,
      results: this.results
    };
  }

  async createCompany(companyData) {
    const company = companyData.company;

    // Find the admin customer ID from the company email domain
    // Convention: company admin email matches company_email domain
    const companyEmail = company.company_email;
    const companyDomain = companyEmail.split('@')[1];

    // Find a customer with matching email domain to be the company admin
    let superUserId = null;
    for (const [email, id] of Object.entries(this.customerEmailToIdMap)) {
      if (email.includes(companyDomain.replace('.example.com', ''))) {
        superUserId = id;
        this.logger.debug(`Found company admin for ${company.company_name}: customer ID ${id} (${email})`);
        break;
      }
    }

    if (!superUserId) {
      this.logger.warn(`No admin customer found for company ${company.company_name} (domain: ${companyDomain})`);
    }

    // Resolve customer_group_code to customer_group_id dynamically
    let customerGroupId = 1; // Default to General
    if (company.customer_group_code && this.groupCodeToIdMap[company.customer_group_code]) {
      customerGroupId = this.groupCodeToIdMap[company.customer_group_code];
      this.logger.debug(`Resolved group_code "${company.customer_group_code}" → group_id ${customerGroupId}`);
    } else if (company.customer_group_id) {
      // Fallback to hardcoded ID if provided (legacy support)
      customerGroupId = company.customer_group_id;
    }

    const payload = {
      company: {
        company_name: company.company_name,
        company_email: company.company_email,
        legal_name: company.legal_name,
        vat_tax_id: company.vat_tax_id,
        reseller_id: company.reseller_id,
        comment: company.comment,
        status: company.status || 1,
        street: company.street,
        city: company.city,
        country_id: company.country_id,
        region: company.region,
        region_id: company.region_id,
        postcode: company.postcode,
        telephone: company.telephone,
        customer_group_id: customerGroupId,
        super_user_id: superUserId
      }
    };

    const response = await this.api.post('/rest/V1/company', payload);
    return response;
  }
}

/**
 * Main import function
 */
export async function importCompanies(options = {}) {
  const importer = new CompanyImporter(options);
  return await importer.import();
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importCompanies()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
