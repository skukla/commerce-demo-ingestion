/**
 * Progress Utilities
 * Single-line updating progress bars and spinners for cleaner output
 */

import chalk from 'chalk';

/**
 * Create a single-line progress bar that updates in place
 * @param {number} current - Current progress value
 * @param {number} total - Total value to reach
 * @param {object} options - Progress bar options
 * @returns {string} Formatted progress bar string
 */
export function formatProgressBar(current, total, options = {}) {
  const {
    width = 40,
    complete = '█',
    incomplete = '░',
    prefix = '',
    suffix = ''
  } = options;

  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = complete.repeat(filled) + incomplete.repeat(empty);
  return `${prefix}[${bar}] ${percentage}% (${current}/${total}) ${suffix}`.trim();
}

/**
 * Update a single line in the terminal (no newline)
 * Uses carriage return for smooth, flicker-free updates
 * @param {string} message - Message to display
 */
export function updateLine(message) {
  if (process.stdout.isTTY) {
    // Use carriage return to move cursor to start of line without clearing
    // Pad the message to ensure we overwrite any previous longer text
    const paddedMessage = message.padEnd(100);
    process.stdout.write(`\r${paddedMessage}`);
  } else {
    // Non-TTY: just print the message normally
    console.log(message);
  }
}

/**
 * Finish a progress line (add newline)
 */
export function finishLine() {
  if (process.stdout.isTTY) {
    process.stdout.write('\n');
  }
}

/**
 * Create a polling progress tracker with dynamic ETA calculation
 * Updates a single line showing: action, progress, time elapsed, ETA
 */
export class PollingProgress {
  constructor(action, expectedCount) {
    this.action = action;
    this.expectedCount = expectedCount;
    this.startTime = Date.now();
    this.attempt = 0;
    this.maxAttempts = 0;
    
    // Track history for rate calculation (last N samples)
    this.history = [];
    this.maxHistorySize = 5; // Use last 5 samples for smoothing
  }
  
  /**
   * Calculate rate of change and ETA
   * @param {number} currentCount - Current count
   * @returns {object} { rate, etaSeconds, etaFormatted }
   */
  calculateETA(currentCount) {
    const now = Date.now();
    
    // Add current sample to history
    this.history.push({ count: currentCount, time: now });
    
    // Keep only last N samples
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
    
    // Need at least 2 samples to calculate rate
    if (this.history.length < 2) {
      return { rate: 0, etaSeconds: null, etaFormatted: '?' };
    }
    
    // Calculate rate from first to last sample in history
    const firstSample = this.history[0];
    const lastSample = this.history[this.history.length - 1];
    const countChange = lastSample.count - firstSample.count;
    const timeChange = (lastSample.time - firstSample.time) / 1000; // seconds
    
    if (timeChange === 0 || countChange === 0) {
      return { rate: 0, etaSeconds: null, etaFormatted: '?' };
    }
    
    const rate = countChange / timeChange; // items per second
    
    // Calculate ETA
    const remaining = this.expectedCount - currentCount;
    if (remaining <= 0 || rate <= 0) {
      return { rate, etaSeconds: 0, etaFormatted: '0s' };
    }
    
    const etaSeconds = Math.ceil(remaining / rate);
    
    // Format ETA nicely
    let etaFormatted;
    if (etaSeconds < 60) {
      etaFormatted = `${etaSeconds}s`;
    } else if (etaSeconds < 3600) {
      const mins = Math.ceil(etaSeconds / 60);
      etaFormatted = `${mins}m`;
    } else {
      const hours = Math.floor(etaSeconds / 3600);
      const mins = Math.ceil((etaSeconds % 3600) / 60);
      etaFormatted = `${hours}h ${mins}m`;
    }
    
    return { rate, etaSeconds, etaFormatted };
  }

  update(currentCount, attempt, maxAttempts) {
    this.attempt = attempt;
    this.maxAttempts = maxAttempts;
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const bar = formatProgressBar(currentCount, this.expectedCount, { width: 20 });
    
    const { rate, etaFormatted } = this.calculateETA(currentCount);
    
    // Build suffix with rate and ETA
    let suffix = `${elapsed}s`;
    if (rate > 0) {
      const rateStr = rate < 1 ? rate.toFixed(2) : rate.toFixed(1);
      suffix += ` | ${rateStr}/s | ETA ~${etaFormatted}`;
    } else {
      suffix += ` | waiting...`;
    }
    
    updateLine(`${this.action} ${bar} | ${suffix}`);
  }

  finish(finalCount, success = true, customMessage = null) {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const bar = formatProgressBar(finalCount, this.expectedCount, { width: 20 });
    
    let message;
    if (customMessage) {
      message = chalk.green(`✔ ${customMessage}`);
    } else {
      const icon = success ? chalk.green('✔') : '⚠️';
      message = `${icon} ${this.action} ${bar} | completed in ${elapsed}s`;
    }
    
    updateLine(message);
    finishLine();
  }
}

/**
 * Create a batch progress tracker for processing items
 */
export class BatchProgress {
  constructor(action, total) {
    this.action = action;
    this.total = total;
    this.processed = 0;
    this.created = 0;
    this.existing = 0;
    this.failed = 0;
    this.startTime = Date.now();
  }

  increment(status) {
    this.processed++;
    
    if (status === 'created') this.created++;
    else if (status === 'existing') this.existing++;
    else if (status === 'failed') this.failed++;
    
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const rate = elapsed > 0 ? (this.processed / elapsed).toFixed(1) : '?';
    const bar = formatProgressBar(this.processed, this.total, { width: 20 });
    
    updateLine(`${this.action} ${bar} | ${rate}/s | ${chalk.green('✔')}${this.created} 🔄${this.existing} ❌${this.failed}`);
  }

  finish() {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const bar = formatProgressBar(this.processed, this.total, { width: 20 });
    
    updateLine(`${chalk.green('✔')} ${this.action} ${bar} | completed in ${elapsed}s | ${chalk.green('✔')}${this.created} 🔄${this.existing} ❌${this.failed}`);
    finishLine();
  }
}

