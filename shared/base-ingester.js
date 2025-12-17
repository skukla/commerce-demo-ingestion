/**
 * Base Ingester for ACO
 * Provides common patterns and utilities for all ACO ingestion scripts
 * Mirrors Commerce BaseImporter for consistency
 */

import logger from './logger.js';
import { formatDuration } from '../aco/lib/aco-ingest-helpers.js';
import { getACOClient } from '../aco/lib/aco-client.js';
import { withRetry } from './retry-util.js';

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
 * Progress tracker for batch operations with single-line updates
 */
export class ProgressTracker {
  constructor(total, label = 'items') {
    this.total = total;
    this.current = 0;
    this.label = label;
    this.startTime = Date.now();
    this.isInProgress = false;
  }
  
  /** Start progress tracking */
  start() {
    this.isInProgress = true;
  }
  
  /** Increment progress */
  increment(logEvery = 10) {
    this.current++;
    if (this.current % logEvery === 0 || this.current === this.total) {
      this.log();
    }
  }
  
  /** Log current progress with in-place update */
  log() {
    const pct = Math.round((this.current / this.total) * 100);
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    
    let rate = '0.0';
    if (this.current > 0 && elapsed > 0) {
      const calcRate = this.current / elapsed;
      rate = calcRate > 999 ? '999+' : calcRate.toFixed(1);
    }
    
    let remaining = '?';
    if (elapsed > 0 && this.current > 0) {
      const calcRemaining = Math.round((this.total - this.current) / (this.current / elapsed));
      if (isFinite(calcRemaining) && calcRemaining >= 0) {
        remaining = calcRemaining.toString();
      }
    }
    
    // Progress bar
    const barWidth = 30;
    const filledWidth = Math.round((this.current / this.total) * barWidth);
    const bar = '█'.repeat(filledWidth) + '░'.repeat(barWidth - filledWidth);
    
    const progressLine = `  [${bar}] ${this.current}/${this.total} ${this.label} (${pct}%) - ${rate}/sec - ~${remaining}s remaining`;
    
    if (process.stdout.isTTY && this.isInProgress) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(progressLine);
    } else if (process.stdout.isTTY) {
      process.stdout.write('\n' + progressLine);
      this.isInProgress = true;
    } else {
      console.log(progressLine);
    }
  }
  
  /** Finish progress (clear lines) */
  finish() {
    if (process.stdout.isTTY && this.isInProgress) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.moveCursor(0, -1);
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }
  }
  
  /** Log completion summary */
  complete() {
    this.finish();
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    logger.info(`  Completed ${this.total} ${this.label} in ${elapsed}s`);
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
   * Generic pre-fetch optimization pattern
   * Fetches existing items, separates new vs existing, and returns only new items to process
   * 
   * @param {Object} config - Configuration object
   * @param {Function} config.loadItems - () => Array of items to import
   * @param {Function} config.fetchExisting - () => Promise<Array> of existing items from ACO
   * @param {Function} config.getItemKey - (item) => unique identifier string
   * @param {Function} config.getExistingKey - (existingItem) => unique identifier string (defaults to getItemKey)
   * @param {Function} config.processNewItem - (item) => Promise - process a single new item
   * @param {Function} config.onExisting - (item, existingItem) => void - handle existing items (optional)
   * @param {string} config.itemLabel - Label for logging (e.g., 'products', 'variants')
   * @param {boolean} config.useProgressBar - Whether to show progress bar for new items (default: false)
   */
  async optimizedImport(config) {
    const {
      loadItems,
      fetchExisting,
      getItemKey,
      getExistingKey = getItemKey,
      processNewItem,
      onExisting,
      itemLabel = 'items',
      useProgressBar = false
    } = config;
    
    // 1. Load items from datapack
    const items = loadItems();
    this.logger.info(`${itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)} to process: ${items.length}`);
    
    // 2. Pre-fetch existing items from ACO
    this.logger.info(`Pre-fetching existing ${itemLabel}...`);
    const existingItems = await fetchExisting();
    const existingMap = new Map();
    existingItems.forEach(item => {
      existingMap.set(getExistingKey(item), item);
    });
    
    this.logger.info(`Found ${existingItems.length} existing ${itemLabel}\n`);
    
    // 3. Separate new vs existing
    const newItems = [];
    for (const item of items) {
      const key = getItemKey(item);
      const existing = existingMap.get(key);
      
      if (existing) {
        // Handle existing item
        if (onExisting) {
          onExisting(item, existing);
        } else {
          this.results.addExisting({ ...item });
        }
      } else {
        newItems.push(item);
      }
    }
    
    this.logger.info(`Existing: ${items.length - newItems.length}, New to create: ${newItems.length}\n`);
    
    // 4. Early return if nothing new
    if (newItems.length === 0) {
      return;
    }
    
    // 5. Process new items with optional progress bar
    if (useProgressBar && newItems.length > 5) {
      const progress = new ProgressTracker(newItems.length, itemLabel);
      progress.start();
      
      for (const item of newItems) {
        try {
          await processNewItem(item);
          progress.increment(Math.ceil(newItems.length / 10));
        } catch (error) {
          this.results.addFailed({ ...item }, error);
        }
      }
      
      progress.finish();
    } else {
      // Process without progress bar
      for (const item of newItems) {
        try {
          await processNewItem(item);
        } catch (error) {
          this.results.addFailed({ ...item }, error);
        }
      }
    }
  }
  
  /**
   * Process items in parallel with concurrency control, progress tracking, and optional batching
   * 
   * @param {Object} config - Configuration object
   * @param {Array} config.items - Items to process
   * @param {Function} config.processItem - (item) => Promise - process function
   * @param {string} config.itemLabel - Label for logging (e.g., 'products')
   * @param {number} config.concurrency - Max parallel operations (default: 5)
   * @param {number} config.batchSize - Items per batch before delay (optional)
   * @param {number} config.batchDelay - Delay between batches in ms (optional)
   * @param {boolean} config.showProgress - Show progress bar (default: true)
   * @param {boolean} config.stopOnError - Stop processing on first error (default: false)
   */
  async processInParallel(config) {
    const {
      items,
      processItem,
      itemLabel = 'items',
      concurrency = 5,
      batchSize,
      batchDelay = 0,
      showProgress = true,
      stopOnError = false
    } = config;
    
    if (items.length === 0) {
      this.logger.info(`No ${itemLabel} to process`);
      return;
    }
    
    let progress = null;
    if (showProgress) {
      progress = new ProgressTracker(items.length, itemLabel);
      progress.start();
    }
    
    let processedCount = 0;
    let activePromises = [];
    let shouldStop = false;
    
    for (let i = 0; i < items.length; i++) {
      if (shouldStop) break;
      
      const item = items[i];
      const promise = withRetry(() => processItem(item), {
        maxAttempts: 3,
        delayMs: 1000,
        backoffMultiplier: 2
      }).then(() => {
        processedCount++;
        if (progress) progress.increment(Math.ceil(items.length / 20));
      }).catch(error => {
        this.results.addFailed({ ...item }, error);
        if (stopOnError) {
          shouldStop = true;
        }
      });
      
      activePromises.push(promise);
      
      // Control concurrency
      if (activePromises.length >= concurrency) {
        await Promise.race(activePromises);
        activePromises = activePromises.filter(p => {
          let isPending = true;
          p.then(() => { isPending = false; }).catch(() => { isPending = false; });
          return isPending;
        });
      }
      
      // Handle batching
      if (batchSize && (i + 1) % batchSize === 0 && i < items.length - 1) {
        await Promise.all(activePromises);
        activePromises = [];
        if (batchDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
      }
    }
    
    // Wait for remaining promises
    await Promise.all(activePromises);
    
    if (progress) {
      progress.finish();
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
