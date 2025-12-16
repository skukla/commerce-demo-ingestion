#!/usr/bin/env node

/**
 * Import Customer Groups to Commerce
 * Reads from committed datapack: accs_customer_groups.json
 * 
 * Uses BaseImporter for standardized patterns
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { BaseImporter } from '#shared/base-importer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to committed datapack customer groups file
const DATAPACK_CUSTOMER_GROUPS_PATH = resolve(__dirname, '../output/buildright-datapack/data/accs/accs_customer_groups.json');

class CustomerGroupImporter extends BaseImporter {
  constructor(options = {}) {
    super('Customer Groups', options);
    this.groupIdMap = {};
  }
  
  loadCustomerGroups() {
    this.logger.info(`Loading customer groups from datapack: ${DATAPACK_CUSTOMER_GROUPS_PATH}`);
    const data = JSON.parse(readFileSync(DATAPACK_CUSTOMER_GROUPS_PATH, 'utf-8'));
    return data.map(item => item.customer_group);
  }
  
  async import() {
    await this.optimizedImport({
      loadItems: () => this.loadCustomerGroups(),
      fetchExisting: async () => {
        try {
          const response = await this.api.get('/rest/V1/customerGroups/search?searchCriteria[pageSize]=1000');
          return response.items || [];
        } catch (error) {
          this.logger.warn(`Could not fetch existing customer groups: ${error.message}`);
          return [];
        }
      },
      getItemKey: (group) => group.code,
      onExisting: (group, existing) => {
        this.results.addExisting({ code: group.code });
        this.groupIdMap[group.code] = existing.id;
      },
      processNewItem: async (group) => {
        try {
          const result = await this.createGroup(group);
          this.groupIdMap[group.code] = result.id;
          this.results.addCreated({ code: group.code });
        } catch (error) {
          // Check if error is due to group already existing (race condition)
          if (error.message && error.message.includes('already exists')) {
            this.logger.debug(`Customer group '${group.code}' already exists (detected via create attempt)`);
            this.results.addExisting({ code: group.code });
          } else {
            this.results.addFailed({ code: group.code }, error);
            this.logger.error(`Failed to process group ${group.code}: ${error.message}`);
          }
        }
      },
      itemLabel: 'customer groups'
    });
    
    return {
      total: this.results.totalProcessed,
      created: this.results.created.length,
      existing: this.results.existing.length,
      failed: this.results.failed.length,
      groupIdMap: this.groupIdMap
    };
  }
  
  async createGroup(group) {
    const payload = { group };
    return await this.api.post('/rest/V1/customerGroups', payload);
  }
}

/**
 * Main import function
 */
export async function importCustomerGroups(options = {}) {
  const importer = new CustomerGroupImporter(options);
  return await importer.import();
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importCustomerGroups()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
