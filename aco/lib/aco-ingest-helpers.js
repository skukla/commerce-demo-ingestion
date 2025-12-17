/**
 * ACO Ingestion Helper Utilities
 * 
 * Standardized utilities for ACO ingestion that mirror Commerce patterns:
 * - Progress tracking
 * - Duration formatting
 * 
 * @module utils/aco-ingest-helpers
 */

import cliProgress from 'cli-progress';
import logger from '../../shared/logger.js';

/**
 * Format duration in seconds to human-readable format
 */
export function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

/**
 * Create a standardized progress bar
 */
export function createProgressBar(total, label = 'Processing') {
  return new cliProgress.SingleBar({
    format: `${label} |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
}

/**
 * Log standardized ingestion summary
 */
export function logIngestionSummary(name, stats, duration) {
  logger.info('');
  logger.info('═══════════════════════════════════════════════');
  logger.info(`${name} Summary`);
  logger.info('═══════════════════════════════════════════════');
  logger.info(`Created: ${stats.created || 0}`);
  logger.info(`Already Existing: ${stats.existing || 0}`);
  if (stats.skipped > 0) {
    logger.info(`Skipped: ${stats.skipped}`);
  }
  logger.info(`Failed: ${stats.failed || 0}`);
  logger.info(`Duration: ${formatDuration(duration / 1000)}`);
  logger.info('═══════════════════════════════════════════════');
  logger.info('');
}

