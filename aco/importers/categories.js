#!/usr/bin/env node
/**
 * Ingest Categories to Adobe Commerce Optimizer
 * 
 * Ingests category hierarchy with parent-child relationships.
 * Categories must be ingested BEFORE products since products reference them via categoryCodes.
 * 
 * Features:
 * - Progress bars for visibility
 * - Auto-retry with exponential backoff
 * - State tracking for idempotency
 * - Hierarchical ingestion (parents before children)
 * - Standardized output (matches Commerce format)
 * 
 * @module aco/importers/categories
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseIngester } from '../../shared/base-ingester.js';
import { withRetry } from '../../shared/retry-util.js';
import { getStateTracker } from '../lib/aco-state-tracker.js';
import { loadJSON, createBatches, processBatches } from '../lib/aco-helpers.js';
import { createCategories } from '../lib/aco-client.js';
import { DATA_REPO_PATH as DATA_REPO } from '../../shared/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BATCH_SIZE = 50; // Recommended batch size for category ingestion

/**
 * Category Ingester
 * Ingests categories in hierarchical order (parents before children)
 */
class CategoryIngester extends BaseIngester {
  constructor(options = {}) {
    super('ACO Categories', options);
    this.stateTracker = getStateTracker();
    this.categoriesFile = join(DATA_REPO, 'generated/aco/categories.json');
  }

  async ingest() {
    const startTime = Date.now();

    try {
      // Load state tracker
      await this.stateTracker.load();

      // Load categories from generated file
      this.logger.info(`Loading categories from: ${this.categoriesFile}`);
      const allCategories = await loadJSON('categories.json', DATA_REPO, 'categories');

      if (!allCategories || allCategories.length === 0) {
        this.logger.warn('No categories found to ingest');
        return {
          success: true,
          created: 0,
          existing: 0,
          failed: 0,
          duration: (Date.now() - startTime) / 1000
        };
      }

      this.logger.info(`Loaded ${allCategories.length} categories`);

      // Filter out already-ingested categories
      const categoriesToIngest = allCategories.filter(cat => 
        !this.stateTracker.hasCategory(cat.slug)
      );

      if (categoriesToIngest.length === 0) {
        this.logger.info('All categories already ingested (skipping)');
        return {
          success: true,
          created: 0,
          existing: allCategories.length,
          failed: 0,
          duration: (Date.now() - startTime) / 1000
        };
      }

      this.logger.info(`Ingesting ${categoriesToIngest.length} new categories (${allCategories.length - categoriesToIngest.length} already exist)`);

      // Sort categories by hierarchy level (parents before children)
      const sortedCategories = this.sortByHierarchy(categoriesToIngest);

      // Create batches
      const batches = createBatches(sortedCategories, BATCH_SIZE);
      this.logger.info(`Created ${batches.length} batches of up to ${BATCH_SIZE} categories`);

      // Ingest categories in batches
      const results = {
        created: [],
        existing: [],
        failed: []
      };

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;

        this.logger.info(`Processing batch ${batchNum}/${batches.length} (${batch.length} categories)`);

        try {
          // Call ACO API with retry
          await withRetry(
            async () => {
              const response = await createCategories(batch);
              
              // Track successful ingestion
              for (const category of batch) {
                this.stateTracker.addCategory(category.slug);
                results.created.push(category.slug);
              }
              
              this.logger.debug(`Batch ${batchNum} ingested successfully`);
            },
            {
              name: `Ingest category batch ${batchNum}`,
              maxRetries: 3,
              initialDelay: 1000
            }
          );
        } catch (error) {
          this.logger.error(`Batch ${batchNum} failed: ${error.message}`);
          
          // Track failed categories
          for (const category of batch) {
            results.failed.push({
              slug: category.slug,
              error: error.message
            });
          }
        }
      }

      // Save state
      await this.stateTracker.save();

      const duration = (Date.now() - startTime) / 1000;
      this.logger.info(`Category ingestion complete: ${results.created.length} created, ${results.existing.length} existing, ${results.failed.length} failed in ${duration}s`);

      return {
        success: results.failed.length === 0,
        created: results.created.length,
        existing: allCategories.length - categoriesToIngest.length,
        failed: results.failed.length,
        results,
        duration
      };

    } catch (error) {
      this.logger.error(`Category ingestion failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sort categories by hierarchy level (parents before children)
   * Categories without parentId come first, then children in order
   */
  sortByHierarchy(categories) {
    const sorted = [];
    const remaining = [...categories];
    const ingested = new Set();

    // First pass: Add all root categories (no parentId)
    const roots = remaining.filter(cat => !cat.parentId);
    sorted.push(...roots);
    roots.forEach(cat => ingested.add(cat.slug));

    // Remove roots from remaining
    remaining.splice(0, remaining.length, ...remaining.filter(cat => cat.parentId));

    // Subsequent passes: Add categories whose parents have been added
    let maxIterations = 100; // Prevent infinite loops
    let iteration = 0;

    while (remaining.length > 0 && iteration < maxIterations) {
      const batch = [];
      
      for (const cat of remaining) {
        // Check if parent has been ingested
        if (ingested.has(cat.parentId)) {
          batch.push(cat);
          ingested.add(cat.slug);
        }
      }

      if (batch.length === 0) {
        // No progress made - orphaned categories
        this.logger.warn(`${remaining.length} categories have missing parents, adding them anyway`);
        sorted.push(...remaining);
        break;
      }

      sorted.push(...batch);
      remaining.splice(0, remaining.length, ...remaining.filter(cat => !ingested.has(cat.slug)));
      iteration++;
    }

    return sorted;
  }
}

/**
 * Main ingestion function
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Ingestion results
 */
export async function ingestCategories(context = {}) {
  const ingester = new CategoryIngester({
    silent: context.silent || false,
    dryRun: context.dryRun || false
  });
  
  return await ingester.ingest();
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestCategories({ silent: false })
    .then(result => {
      console.log(`\n✔ Category ingestion complete!`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Existing: ${result.existing}`);
      console.log(`  Failed: ${result.failed}`);
      console.log(`  Duration: ${result.duration}s\n`);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error(`\n✖ Category ingestion failed: ${error.message}\n`);
      process.exit(1);
    });
}

