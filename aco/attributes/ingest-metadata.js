#!/usr/bin/env node
/**
 * Ingest Product Attribute Metadata to Adobe Commerce Optimizer
 *
 * Ingests attribute metadata (labels, types, visibility, searchability, etc.)
 * from generated metadata.json to ACO. This MUST be run before ingesting products
 * so that ACO knows how to handle product attributes.
 *
 * @module scripts/ingest-metadata
 *
 * @example
 * # Ingest all metadata
 * npm run ingest:metadata
 *
 * # Dry-run mode (validation only)
 * npm run ingest:metadata:dry-run
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';
import { getStateTracker } from '../../shared/aco-state-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_SIZE = 10; // ACO recommendation

/**
 * Maps BuildRight metadata types to ACO metadata dataTypes
 */
const DATA_TYPE_MAP = {
  text: 'TEXT',
  select: 'TEXT',
  multiselect: 'TEXT',
  number: 'DECIMAL',
  boolean: 'BOOLEAN',
  date: 'DATE',
};

/**
 * Determines which attributes should be visible in which contexts
 */
function getVisibilitySettings(attr) {
  const visibility = ['PRODUCT_DETAIL', 'PRODUCT_LISTING'];
  
  // Core attributes also visible in search results
  if (attr.sortOrder <= 5 || attr.attributeId.includes('category') || attr.attributeId.includes('br_brand')) {
    visibility.push('SEARCH_RESULTS');
  }
  
  return visibility;
}

/**
 * Determines search weight based on attribute importance
 */
function getSearchWeight(attr) {
  // Core identification attributes get highest weight
  if (['sku', 'name', 'br_product_category'].includes(attr.attributeId)) {
    return 5;
  }
  
  // Important discovery attributes get high weight
  if (['br_brand', 'br_project_types'].includes(attr.attributeId)) {
    return 3;
  }
  
  // Standard attributes
  if (attr.sortOrder <= 10) {
    return 2;
  }
  
  // Less important attributes
  return 1;
}

/**
 * Transform BuildRight metadata to ACO Metadata API format
 */
function transformToACOMetadata(metadata) {
  return metadata.map(attr => ({
    code: attr.attributeId,
    source: { locale: 'en-US' },
    label: attr.label,
    dataType: DATA_TYPE_MAP[attr.type] || 'TEXT',
    visibleIn: getVisibilitySettings(attr),
    filterable: attr.type === 'select' || attr.type === 'multiselect' || attr.type === 'boolean',
    sortable: attr.type === 'select' || attr.type === 'number' || attr.type === 'date',
    searchable: true,
    searchWeight: getSearchWeight(attr),
    searchTypes: ['AUTOCOMPLETE'],
  }));
}

/**
 * Validate metadata structure
 */
function validateMetadata(metadata) {
  const errors = [];
  
  if (!Array.isArray(metadata)) {
    errors.push('Metadata must be an array');
    return { valid: false, errors };
  }
  
  metadata.forEach((attr, index) => {
    if (!attr.attributeId) {
      errors.push(`Attribute ${index}: missing attributeId`);
    }
    if (!attr.label) {
      errors.push(`Attribute ${index} (${attr.attributeId}): missing label`);
    }
    if (!attr.type) {
      errors.push(`Attribute ${index} (${attr.attributeId}): missing type`);
    }
    if (!DATA_TYPE_MAP[attr.type]) {
      errors.push(`Attribute ${index} (${attr.attributeId}): invalid type "${attr.type}"`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Metadata Ingester Class
 */
class MetadataIngester extends BaseIngester {
  constructor(options = {}) {
    super('Metadata', options);
    this.batchSize = BATCH_SIZE;
  }
  
  async ingest() {
    // Load metadata JSON
    const metadataPath = path.join(__dirname, '../../output/buildright/metadata.json');
    this.logger.info(`Loading metadata from: ${metadataPath}`);
    
    const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataRaw);
    
    this.logger.info(`Loaded ${metadata.length} attribute definitions`);
    
    // Validate metadata
    this.logger.info('Validating metadata structure...');
    const validation = validateMetadata(metadata);
    
    if (!validation.valid) {
      this.logger.error('Metadata validation failed:', validation.errors);
      throw new Error(`Validation failed: ${validation.errors.length} errors`);
    }
    
    this.logger.info('✅ Validation passed');
    
    // Transform to ACO format
    this.logger.info('Transforming to ACO Metadata API format...');
    const acoMetadata = transformToACOMetadata(metadata);
    
    // Log sample for verification
    if (!this.silent) {
      this.logger.info('Sample transformed metadata (first 3):');
      acoMetadata.slice(0, 3).forEach(meta => {
        this.logger.info(`  - ${meta.code} (${meta.label}): ${meta.dataType}, searchWeight: ${meta.searchWeight}, filterable: ${meta.filterable}`);
      });
    }
    
    if (this.isDryRun) {
      this.logger.info('[DRY RUN] Would ingest:', {
        metadata: acoMetadata.length,
        batches: Math.ceil(acoMetadata.length / this.batchSize)
      });
      // Add as skipped for dry run
      acoMetadata.forEach(meta => this.results.addSkipped(meta, 'dry-run'));
      return;
    }
    
    // Load state tracker
    const stateTracker = getStateTracker();
    await stateTracker.load();
    
    // Check if metadata already ingested (idempotency)
    const toIngest = acoMetadata.filter(m => !stateTracker.hasMetadata(m.code));
    const alreadyIngested = acoMetadata.length - toIngest.length;
    
    if (alreadyIngested > 0) {
      this.logger.info(`Skipping ${alreadyIngested} already-ingested metadata attributes`);
      // Track existing
      acoMetadata.filter(m => stateTracker.hasMetadata(m.code)).forEach(meta => {
        this.results.addExisting({ code: meta.code, label: meta.label });
      });
    }
    
    if (toIngest.length === 0) {
      this.logger.info('All metadata already ingested (idempotent)');
      return;
    }
    
    // Get ACO client
    this.logger.info('Initializing ACO client...');
    const client = await this.getClient();
    
    // Ingest in batches
    const batches = [];
    for (let i = 0; i < toIngest.length; i += this.batchSize) {
      batches.push(toIngest.slice(i, i + this.batchSize));
    }
    
    this.logger.info(`Ingesting ${toIngest.length} metadata definitions in ${batches.length} batches...`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNum = i + 1;
      
      if (!this.silent) {
        this.logger.info(`Batch ${batchNum}/${batches.length} (${batch.length} items)`);
      }
      
      try {
        await withRetry(async () => {
          const response = await client.createProductMetadata(batch);
          
          if (response.data && response.data.status === 'ACCEPTED') {
            const acceptedCount = response.data.acceptedCount || batch.length;
            
            // Track each metadata in state and results
            batch.forEach(meta => {
              stateTracker.addMetadata(meta.code);
              this.results.addCreated({ code: meta.code, label: meta.label });
            });
          } else {
            throw new Error(`Batch ${batchNum} not accepted: ${JSON.stringify(response.data)}`);
          }
        }, {
          name: `Ingest metadata batch ${batchNum}`
        });
      } catch (error) {
        this.logger.error(`Batch ${batchNum} failed: ${error.message}`);
        batch.forEach(meta => {
          this.results.addFailed({ code: meta.code, label: meta.label }, error);
        });
      }
    }
    
    // Save state
    await stateTracker.save();
    
    if (this.results.failed.length > 0) {
      throw new Error(`${this.results.failed.length} metadata items failed to ingest`);
    }
  }
}

/**
 * Export function for orchestrator
 */
export async function ingestMetadata(options = {}) {
  const ingester = new MetadataIngester(options);
  return ingester.run();
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const dryRun = process.argv.includes('--dry-run');
  ingestMetadata({ dryRun })
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export helper functions for testing
export { transformToACOMetadata, validateMetadata };
