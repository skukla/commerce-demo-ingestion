/**
 * Base Importer
 * Provides common patterns and utilities for all Commerce import scripts
 */

import { commerceApi, logger } from './commerce-api.js';
import { COMMERCE_CONFIG } from '#config/commerce-config';

/**
 * Standard result structure for all importers
 */
export class ImportResults {
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
  
  /** Check if import was successful (no failures) */
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
    this.lastUpdate = 0;
    this.isInProgress = false;
  }
  
  /** Start progress tracking (marks as in progress for clean output) */
  start() {
    this.isInProgress = true;
  }
  
  /** Increment progress and optionally log */
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
    
    // Calculate rate, handling very fast operations
    let rate = '0.0';
    if (this.current > 0 && elapsed > 0) {
      const calcRate = this.current / elapsed;
      rate = calcRate > 999 ? '999+' : calcRate.toFixed(1);
    }
    
    // Calculate remaining time, handling edge cases
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
    
    // Build progress line
    const progressLine = `  [${bar}] ${this.current}/${this.total} ${this.label} (${pct}%) - ${rate}/sec - ~${remaining}s remaining`;
    
    // Update in place if TTY, otherwise just log normally
    if (process.stdout.isTTY && this.isInProgress) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(progressLine);
    } else if (process.stdout.isTTY) {
      // First update in TTY - start progress bar on new line
      process.stdout.write('\n' + progressLine);
      this.isInProgress = true;
    } else {
      // Non-TTY: just log normally
      console.log(progressLine);
    }
  }
  
  /** Finish progress (clear both the status and progress lines) */
  finish() {
    // Clear the progress bar line AND move up to clear the status line
    // This allows the success message to replace both lines with a single clean line
    if (process.stdout.isTTY && this.isInProgress) {
      // Clear current line (progress bar)
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      // Move up one line and clear it (the "📦 Importing..." line)
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
 * Base Importer class with common patterns
 */
export class BaseImporter {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.results = new ImportResults();
    this.silent = options.silent || false; // Clean output mode
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
  
  /** Get the Commerce API */
  get api() {
    return commerceApi;
  }
  
  /** Check if running in dry-run mode */
  get isDryRun() {
    return COMMERCE_CONFIG.dryRun;
  }
  
  /** Log import header */
  logHeader() {
    if (!this.silent) {
      logger.info(`=== Importing ${this.name} ===`);
      logger.info(`Mode: ${this.isDryRun ? 'DRY RUN' : 'LIVE'}`);
    }
  }
  
  /** Log import summary */
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
   * @param {Function} config.fetchExisting - () => Promise<Array> of existing items from Commerce
   * @param {Function} config.getItemKey - (item) => unique identifier string
   * @param {Function} config.getExistingKey - (existingItem) => unique identifier string (defaults to getItemKey)
   * @param {Function} config.processNewItem - (item) => Promise - process a single new item
   * @param {Function} config.onExisting - (item, existingItem) => void - handle existing items (optional)
   * @param {string} config.itemLabel - Label for logging (e.g., 'products', 'customers')
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
    
    // 2. Pre-fetch existing items from Commerce
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
      this.logger.info(`No new ${itemLabel} to create`);
      return;
    }
    
    // 5. Process new items (with optional progress bar)
    if (useProgressBar) {
      const progress = new ProgressTracker(newItems.length, itemLabel);
      for (const item of newItems) {
        await processNewItem(item);
        progress.increment();
      }
      progress.finish();
    } else {
      for (const item of newItems) {
        await processNewItem(item);
      }
    }
  }
  
  /**
   * Process items in parallel with progress tracking and optional batching
   * Combines parallelProcess with ProgressTracker for common import pattern
   * 
   * @param {Array} items - Items to process
   * @param {Function} processFn - Async function to process each item
   * @param {Object} options - Processing options
   * @param {number} options.concurrency - Number of concurrent operations (default: 5)
   * @param {string} options.label - Label for progress tracker (default: 'items')
   * @param {number} options.batchSize - Process in batches (default: all at once)
   * @param {number} options.batchDelayMs - Delay between batches in ms (default: 0)
   */
  async processWithProgress(items, processFn, options = {}) {
    const {
      concurrency = 5,
      label = 'items',
      batchSize = items.length,  // No batching by default
      batchDelayMs = 0
    } = options;
    
    const progress = new ProgressTracker(items.length, label);
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      await parallelProcess(
        batch,
        async (item) => {
          await processFn(item);
          progress.increment();
        },
        concurrency
      );
      
      // Delay between batches (if configured)
      if (batchDelayMs > 0 && i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }
    
    progress.finish();
  }
  
  /**
   * Process a single item with existence check
   * @param {Object} item - The item to process
   * @param {Object} handlers - Object with checkExists, create, and getIdentifier functions
   */
  async processItem(item, handlers) {
    const { checkExists, create, getIdentifier, transform } = handlers;
    const identifier = getIdentifier(item);
    
    if (!this.silent) {
      logger.info(`Processing: ${identifier}`);
    }
    
    // Check if already exists
    try {
      const existing = await checkExists(item);
      if (existing) {
        if (!this.silent) {
          logger.info(`  Already exists (ID: ${existing.id || existing.attribute_id || 'N/A'})`);
        }
        this.results.addExisting({ 
          ...item, 
          id: existing.id || existing.attribute_id 
        });
        return { action: 'existing', existing };
      }
    } catch (error) {
      // 404 means doesn't exist, which is fine
      if (error.status !== 404) {
        if (!this.silent) {
          logger.warn(`  Error checking existence: ${error.message}`);
        }
      }
    }
    
    // Transform if needed
    const transformedItem = transform ? transform(item) : item;
    
    // Create
    try {
      const created = await create(transformedItem);
      
      if (this.isDryRun) {
        if (!this.silent) {
          logger.success(`  [DRY RUN] Would create: ${identifier}`);
        }
        this.results.addCreated({ ...item, id: 'dry-run' });
      } else {
        const createdId = created?.id || created?.attribute_id || 'N/A';
        if (!this.silent) {
          logger.success(`  Created: ${identifier} (ID: ${createdId})`);
        }
        this.results.addCreated({ ...item, id: createdId });
      }
      
      return { action: 'created', created };
    } catch (error) {
      logger.error(`  Failed to create ${identifier}: ${error.message}`);
      if (error.data) {
        logger.debug(`  Error details: ${JSON.stringify(error.data)}`);
      }
      this.results.addFailed(item, error);
      return { action: 'failed', error };
    }
  }
  
  /**
   * Process multiple items in batches
   * @param {Array} items - Items to process
   * @param {Function} processFn - Async function to process each item
   * @param {Object} options - Batch options
   */
  async processBatch(items, processFn, options = {}) {
    const { 
      batchSize = COMMERCE_CONFIG.batchSize || 10, 
      delayMs = 100,
      logEvery = 10
    } = options;
    
    const progress = new ProgressTracker(items.length, this.name.toLowerCase());
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(items.length / batchSize);
      
      if (!this.silent) {
        logger.info(`Batch ${batchNum}/${totalBatches} (${batch.length} items)`);
      }
      
      for (const item of batch) {
        try {
          await processFn(item);
        } catch (error) {
          // Errors should be handled in processFn, this is a fallback
          logger.error(`Unexpected error processing item: ${error.message}`);
          this.results.addFailed(item, error);
        }
        
        // Only show progress if not silent
        if (!this.silent) {
          progress.increment(logEvery);
        }
      }
      
      // Delay between batches
      if (i + batchSize < items.length && delayMs > 0) {
        await sleep(delayMs);
      }
    }
    
    // Complete progress tracker
    if (!this.silent) {
      progress.complete();
    }
    return this.results;
  }
  
  /**
   * Main import method - override in subclasses
   */
  async import() {
    throw new Error('Subclass must implement import()');
  }
  
  /**
   * Run the import and return standardized results
   */
  async run() {
    this.logHeader();
    
    try {
      const result = await this.import();
      this.results.finalize();
      this.logSummary();
      
      return {
        success: this.results.success,
        results: this.results.toJSON(),
        ...result
      };
    } catch (error) {
      this.results.addFailed({ type: 'fatal' }, error);
      this.results.finalize();
      
      logger.error(`Import failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        results: this.results.toJSON()
      };
    }
  }
}

/**
 * Sleep utility
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process items in parallel with concurrency limit
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to process each item
 * @param {number} concurrency - Max concurrent operations (default: 5)
 */
export async function parallelProcess(items, fn, concurrency = 5) {
  const results = [];
  const executing = new Set();
  
  for (const item of items) {
    const promise = fn(item).then(result => {
      executing.delete(promise);
      return { item, result, success: true };
    }).catch(error => {
      executing.delete(promise);
      return { item, error: error.message, success: false };
    });
    
    executing.add(promise);
    results.push(promise);
    
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

/**
 * Retry utility for transient failures
 */
export async function withRetry(fn, options = {}) {
  const { maxRetries = 3, delayMs = 1000, backoff = 2 } = options;
  
  let lastError;
  let delay = delayMs;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on 4xx errors (client errors)
      if (error.status && error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      if (attempt < maxRetries) {
        logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= backoff;
      }
    }
  }
  
  throw lastError;
}

/**
 * Generate unique identifier
 */
export function generateId(prefix = '', length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix ? `${prefix}-${result}` : result;
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Utility to run importer as standalone script
 */
export function runStandalone(ImporterClass, options = {}) {
  const isMainModule = import.meta.url === `file://${process.argv[1]}`;
  
  if (isMainModule) {
    const importer = new ImporterClass(options);
    importer.run()
      .then(result => process.exit(result.success ? 0 : 1))
      .catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
      });
  }
}

export default BaseImporter;

