#!/usr/bin/env node

/**
 * Retry Utility
 * Implements intelligent retry logic with exponential backoff
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Configurable retry limits
 * - Transient error detection
 */

import { logger } from './commerce-api.js';

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,      // 1 second
  maxDelay: 30000,         // 30 seconds
  backoffMultiplier: 2,
  jitterFactor: 0.2,       // 20% jitter
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'socket hang up',
    '429',                   // Too many requests
    '500',                   // Internal server error
    '502',                   // Bad gateway
    '503',                   // Service unavailable
    '504',                   // Gateway timeout
  ]
};

/**
 * Retry utility class
 */
export class RetryUtil {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute function with retry logic
   */
  async execute(fn, context = {}) {
    const { name = 'operation', onRetry = null } = context;
    let lastError;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Max retries reached
        if (attempt >= this.config.maxRetries) {
          throw new RetryError(
            `Failed after ${attempt + 1} attempts: ${error.message}`,
            error,
            attempt + 1
          );
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);

        logger.warn(
          `${name} failed (attempt ${attempt + 1}/${this.config.maxRetries + 1}): ${error.message}`
        );
        logger.info(`Retrying in ${(delay / 1000).toFixed(1)}s...`);

        // Call retry callback if provided
        if (onRetry) {
          await onRetry(attempt + 1, delay, error);
        }

        // Wait before retry
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error) {
    const message = error.message || '';
    const code = error.code || '';
    const statusCode = error.statusCode || error.status || '';

    // Check against retryable error patterns
    return this.config.retryableErrors.some(pattern => {
      return (
        message.includes(pattern) ||
        code.includes(pattern) ||
        String(statusCode).includes(pattern)
      );
    });
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  calculateDelay(attempt) {
    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    const exponentialDelay = this.config.initialDelay * 
      Math.pow(this.config.backoffMultiplier, attempt);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);

    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
    
    return Math.max(0, cappedDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Custom error for retry failures
 */
export class RetryError extends Error {
  constructor(message, originalError, attempts) {
    super(message);
    this.name = 'RetryError';
    this.originalError = originalError;
    this.attempts = attempts;
  }
}

/**
 * Global retry utility instance
 */
let globalRetryUtil = null;

export function getRetryUtil(config) {
  if (!globalRetryUtil) {
    globalRetryUtil = new RetryUtil(config);
  }
  return globalRetryUtil;
}

/**
 * Convenience function for retrying operations
 */
export async function withRetry(fn, context) {
  const retry = getRetryUtil();
  return retry.execute(fn, context);
}

export default RetryUtil;
