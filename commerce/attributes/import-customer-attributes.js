#!/usr/bin/env node

/**
 * Import Customer Attributes to Commerce
 * Creates custom customer attributes for ACO persona context
 * 
 * These attributes store:
 * - aco_catalog_view_id: The ACO catalog view ID for this customer
 * - aco_price_book_id: The ACO price book ID for this customer
 * 
 * This aligns with Adobe's recommended pattern: Commerce as source of truth for persona mapping
 */

import { BaseImporter } from '#shared/base-importer';
import { CUSTOMER_ATTRIBUTES } from '#config/commerce-config';

class CustomerAttributeImporter extends BaseImporter {
  constructor(options = {}) {
    super('Customer Attributes', options);
  }
  
  async import() {
    this.logger.info(`Customer attributes to process: ${CUSTOMER_ATTRIBUTES.length}`);
    
    for (const attrDef of CUSTOMER_ATTRIBUTES) {
      await this.processAttribute(attrDef);
    }
    
    return {
      created: this.results.created.length,
      existing: this.results.existing.length,
      failed: this.results.failed.length,
      skipped: this.results.skipped.length
    };
  }
  
  async processAttribute(attrDef) {
    const { attributeCode, frontendLabel } = attrDef;
    
    
    // Check if already exists
    try {
      const existing = await this.api.getCustomerAttribute(attributeCode);
      
      if (existing) {
        this.results.addExisting({ code: attributeCode, label: frontendLabel });
        return;
      }
    } catch (error) {
      // 404 means doesn't exist, which is fine
      if (error.status !== 404) {
        this.logger.warn(`  Error checking attribute: ${error.message}`);
      }
    }
    
    // Create attribute
    try {
      const attribute = {
        attribute_code: attrDef.attributeCode,
        frontend_input: attrDef.frontendInput || 'text',
        frontend_labels: [
          { store_id: 0, label: attrDef.frontendLabel }
        ],
        is_required: attrDef.isRequired || false,
        is_user_defined: true,
        is_visible: attrDef.isVisible !== false,
        sort_order: attrDef.sortOrder || 0,
        used_in_forms: ['adminhtml_customer'],
        is_used_in_grid: attrDef.isUsedInGrid || false,
        is_filterable_in_grid: attrDef.isFilterableInGrid || false,
        is_searchable_in_grid: attrDef.isSearchableInGrid || false
      };
      
      if (this.isDryRun) {
        this.results.addCreated({ code: attributeCode, label: frontendLabel });
      } else {
        await this.api.createCustomerAttribute(attribute);
        this.results.addCreated({ code: attributeCode, label: frontendLabel });
      }
    } catch (error) {
      // Customer attributes API may not be available in all Commerce versions
      if (error.message?.includes('does not match any route')) {
        this.logger.warn(`  Customer attribute '${attributeCode}' cannot be created via REST API`);
        this.logger.warn(`  This attribute may need to be created manually in Commerce Admin:`);
        this.logger.warn(`  Stores → Attributes → Customer`);
        this.results.addSkipped({ code: attributeCode }, 'REST API not available - requires manual creation');
      } else {
        this.logger.error(`  Failed to create attribute ${attributeCode}: ${error.message}`);
        if (error.data) {
          this.logger.debug(`  Error details: ${JSON.stringify(error.data)}`);
        }
        this.results.addFailed({ code: attributeCode }, error);
      }
    }
  }
}

/**
 * Main import function (for use by import-all.js)
 */
export async function importCustomerAttributes(options = {}) {
  const importer = new CustomerAttributeImporter(options);
  return importer.run();
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  importCustomerAttributes()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { CustomerAttributeImporter };

