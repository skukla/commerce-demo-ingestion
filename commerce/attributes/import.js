#!/usr/bin/env node

/**
 * Import Product Attributes to Commerce
 * Reads from committed datapack: accs_product_attributes.json
 * 
 * Uses BaseImporter for standardized patterns
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { BaseImporter, ProgressTracker } from '../../shared/base-importer.js';
import { getStateTracker } from '../../shared/state-tracker.js';
import { DATA_REPO_PATH } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to committed datapack attributes file
const DATAPACK_ATTRIBUTES_PATH = resolve(DATA_REPO_PATH, 'generated/commerce/data/accs/accs_product_attributes.json');

class AttributeImporter extends BaseImporter {
  constructor(options = {}) {
    super('Product Attributes', options);
    this.attributeIdMap = {};
    this.attributeOptionMap = {};
    this.stateTracker = getStateTracker();
  }
  
  loadAttributes() {
    this.logger.info(`Loading attributes from datapack: ${DATAPACK_ATTRIBUTES_PATH}`);
    const data = JSON.parse(readFileSync(DATAPACK_ATTRIBUTES_PATH, 'utf-8'));
    return data.map(item => item.attribute);
  }
  
  async import() {
    await this.optimizedImport({
      loadItems: () => this.loadAttributes(),
      fetchExisting: async () => {
        try {
          const response = await this.api.get('/rest/V1/products/attributes?searchCriteria[pageSize]=1000');
          return response.items || [];
        } catch (error) {
          this.logger.warn(`Could not fetch existing attributes: ${error.message}`);
          return [];
        }
      },
      getItemKey: (attr) => attr.attribute_code,
      onExisting: (attr, existingAttr) => {
        this.results.addExisting({ code: attr.attribute_code });
        this.stateTracker.addAttribute(attr.attribute_code);
        // Build option map for product attribute dropdowns
        if (existingAttr && existingAttr.options) {
          existingAttr.options.forEach(opt => {
            const key = `${existingAttr.attribute_code}:${opt.label.toLowerCase()}`;
            this.attributeOptionMap[key] = opt.value;
          });
        }
      },
      processNewItem: async (attr) => {
        await this.processAttribute(attr);
      },
      itemLabel: 'attributes',
      useProgressBar: true
    });
    
    return { 
      total: this.results.totalProcessed,
      created: this.results.created.length,
      existing: this.results.existing.length,
      failed: this.results.failed.length,
      attributeOptionMap: this.attributeOptionMap
    };
  }
  
  async processAttribute(attrDef) {
    try {
      const attributeCode = attrDef.attribute_code;
      
      this.logger.debug(`Creating attribute: ${attributeCode}`);
      const created = await this.createAttribute(attrDef);
      this.logger.debug(`Created attribute: ${attributeCode} with ID: ${created}`);
      this.results.addCreated({ code: attributeCode });
      this.stateTracker.addAttribute(attributeCode);
      
    } catch (error) {
      this.results.addFailed({ code: attrDef.attribute_code }, error);
      let errorMsg = error.message;
      if (error.data && error.data.message) {
        errorMsg = error.data.message;
      }
      if (error.data && error.data.parameters) {
        errorMsg += ` | Parameters: ${JSON.stringify(error.data.parameters)}`;
      }
      if (error.data && error.data.trace) {
        errorMsg += ` | First trace line: ${error.data.trace.split('\n')[0]}`;
      }
      
      this.logger.error(`Failed to process attribute ${attrDef.attribute_code}: ${errorMsg}`);
      
      // For debugging: log the full error object for the first failure only
      if (this.results.failed.length === 1 && error.data) {
        this.logger.debug('Full error data:', JSON.stringify(error.data, null, 2));
      }
    }
  }
  
  async createAttribute(attrDef) {
    const payload = { attribute: attrDef };
    
    const response = await this.api.post('/rest/V1/products/attributes', payload);
    
    const attributeCode = attrDef.attribute_code;
    this.attributeIdMap[attributeCode] = response.attribute_id;
    
    // Build option map for newly created attribute
    if (response.options && response.options.length > 0) {
      this.attributeOptionMap[attributeCode] = {};
      response.options.forEach(opt => {
        if (opt.label && opt.value) {
          this.attributeOptionMap[attributeCode][opt.label] = opt.value;
              }
      });
    }
    
    return response.attribute_id;
  }
}

/**
 * Main import function
 */
export async function importAttributes(options = {}) {
  const importer = new AttributeImporter(options);
  return await importer.import();
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importAttributes()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
