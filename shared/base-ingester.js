/**
 * Base Ingester for ACO
 * Provides common patterns and utilities for all ACO ingestion scripts
 * Mirrors Commerce BaseImporter for consistency
 */

import logger from './logger.js';
import { formatDuration } from './aco-ingest-helpers.js';
import { getACOClient } from './aco-client.js';

/**
 * Standard result structure for all ingesters
 */
export class IngestionResults {
  constructor() {
    this.created = [];
    this.existing = [];
    this.failed = [];
    this.skipped = [];
    this.startTime = Date.now();
    this.endTime = null;
  }
  
  /** Record a successful creation */
  addCreated(item) {
    this.created.push({ ...item, timestamp: Date.now() });
  }
  
  /** Record an existing item (no action needed) */
  addExisting(item) {
    this.existing.push({ ...item, timestamp: Date.now() });
  }
  
  /** Record a failed operation */
  addFailed(item, error) {
    this.failed.push({ ...item, error: error?.message || error, timestamp: Date.now() });
  }
  
  /** Record a skipped item */
  addSkipped(item, reason) {
    this.skipped.push({ ...item, reason, timestamp: Date.now() });
  }
  
  /** Finalize results and calculate duration */
  finalize() {
    this.endTime = Date.now();
    return this;
  }
  
  /** Get duration in seconds */
  get durationSeconds() {
    const end = this.endTime || Date.now();
    return Math.round((end - this.startTime) / 1000);
  }
  
  /** Get total items processed */
  get totalProcessed() {
    return this.created.length + this.existing.length + this.failed.length + this.skipped.length;
  }
  
  /** Check if ingestion was successful (no failures) */
  get success() {
    return this.failed.length === 0;
  }
  
  /** Convert to plain object for JSON serialization */
  toJSON() {
    return {
      created: this.created,
      existing: this.existing,
      failed: this.failed,
      skipped: this.skipped,
      duration: this.durationSeconds,
      success: this.success
    };
  }
}

/**
 * Base class for all ACO ingesters
 */
export class BaseIngester {
  constructor(name, options = {}) {
    this.name = name;
    this.results = new IngestionResults();
    this.silent = options.silent || false;
    this.dryRun = options.dryRun || false;
    this.client = null;
  }
  
  /** Get the logger (respects silent mode) */
  get logger() {
    if (this.silent) {
      // Return a no-op logger in silent mode
      return {
        info: () => {},
        warn: () => {},
        error: (...args) => logger.error(...args), // Still log errors
        success: () => {},
        debug: () => {}
      };
    }
    return logger;
  }
  
  /** Get the ACO client */
  async getClient() {
    if (!this.client) {
      this.client = await getACOClient();
    }
    return this.client;
  }
  
  /** Check if running in dry-run mode */
  get isDryRun() {
    return this.dryRun;
  }
  
  /** Log ingestion header */
  logHeader() {
    if (!this.silent) {
      logger.info(`=== Ingesting ${this.name} ===`);
      logger.info(`Mode: ${this.isDryRun ? 'DRY RUN' : 'LIVE'}`);
    }
  }
  
  /** Log ingestion summary */
  logSummary() {
    if (this.silent) return;
    
    logger.info(`\n=== ${this.name} Summary ===`);
    logger.info(`Created: ${this.results.created.length}`);
    logger.info(`Already Existing: ${this.results.existing.length}`);
    if (this.results.skipped.length > 0) {
      logger.info(`Skipped: ${this.results.skipped.length}`);
    }
    logger.info(`Failed: ${this.results.failed.length}`);
    logger.info(`Duration: ${formatDuration(this.results.durationSeconds)}`);
    
    if (this.results.failed.length > 0) {
      logger.warn('\nFailed items:');
      this.results.failed.slice(0, 10).forEach(f => {
        const id = f.code || f.sku || f.name || f.id;
        logger.warn(`  - ${id}: ${f.error}`);
      });
      if (this.results.failed.length > 10) {
        logger.warn(`  ... and ${this.results.failed.length - 10} more`);
      }
    }
  }
  
  /**
   * Main ingestion method - override in subclasses
   */
  async ingest() {
    throw new Error('ingest() must be implemented by subclass');
  }
  
  /**
   * Run the full ingestion workflow
   */
  async run() {
    this.logHeader();
    
    try {
      await this.ingest();
      this.results.finalize();
      this.logSummary();
      
      return {
        success: this.results.success,
        results: this.results,
        created: this.results.created.length,
        existing: this.results.existing.length,
        failed: this.results.failed.length,
        duration: this.results.durationSeconds
      };
    } catch (error) {
      this.logger.error(`Fatal error during ${this.name} ingestion:`, error.message);
      this.results.finalize();
      
      return {
        success: false,
        results: this.results,
        error: error.message,
        duration: this.results.durationSeconds
      };
    }
  }
}
