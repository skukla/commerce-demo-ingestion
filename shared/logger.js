/**
 * Logger Utility
 *
 * Winston-based logging with sensitive data sanitization and file output.
 * Provides structured logging with different levels and automatic redaction of sensitive information.
 *
 * @module utils/logger
 *
 * Features:
 * - Multiple log levels: debug, info, warn, error
 * - Automatic sanitization of sensitive fields (API_KEY, TOKEN, PASSWORD, etc.)
 * - File-based logging with separate error.log and combined.log
 * - Optional console output with colorized formatting
 * - JSON format for file logs, human-readable format for console
 *
 * @example
 * import { createLogger } from './logger.js';
 *
 * const logger = createLogger({
 *   level: 'info',
 *   logDir: './logs',
 *   enableConsole: true
 * });
 *
 * logger.info('Application started');
 * logger.error('An error occurred', { details: 'More info' });
 *
 * // Sensitive data is automatically redacted
 * logger.info({ API_KEY: 'secret' }); // Logs: { API_KEY: '[REDACTED]' }
 */

import winston from 'winston';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

/**
 * Sensitive field patterns that should be redacted from logs
 */
const SENSITIVE_PATTERNS = [
  'API_KEY',
  'TOKEN',
  'PASSWORD',
  'SECRET',
  'CREDENTIAL'
];

/**
 * Sanitizes sensitive data from log objects
 *
 * Recursively searches through objects and arrays, redacting any fields that match
 * sensitive patterns (API_KEY, TOKEN, PASSWORD, SECRET, CREDENTIAL).
 *
 * @param {*} data - Data to sanitize (can be object, array, primitive, null, or undefined)
 * @returns {*} Sanitized data with sensitive fields replaced with '[REDACTED]'
 *
 * @example
 * const data = {
 *   username: 'john',
 *   API_KEY: 'secret-key-123',
 *   config: {
 *     TOKEN: 'bearer-xyz',
 *     endpoint: 'https://api.example.com'
 *   }
 * };
 *
 * const sanitized = sanitizeLogData(data);
 * // Result: {
 * //   username: 'john',
 * //   API_KEY: '[REDACTED]',
 * //   config: {
 * //     TOKEN: '[REDACTED]',
 * //     endpoint: 'https://api.example.com'
 * //   }
 * // }
 */
export function sanitizeLogData(data) {
  // Handle null/undefined
  if (data == null) {
    return data;
  }

  // Handle primitives
  if (typeof data !== 'object') {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeLogData(item));
  }

  // Handle objects
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    // Check if key matches sensitive patterns
    const isSensitive = SENSITIVE_PATTERNS.some(pattern =>
      key.toUpperCase().includes(pattern)
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Custom format that sanitizes sensitive data
 */
const sanitizingFormat = winston.format((info) => {
  // Sanitize message if it's an object
  if (info.message && typeof info.message === 'object') {
    info.message = sanitizeLogData(info.message);
  }

  // Sanitize any additional metadata properties (but keep Winston internals)
  const protectedKeys = ['level', 'message', 'timestamp', 'label'];
  for (const key in info) {
    if (!protectedKeys.includes(key) && typeof info[key] === 'object') {
      info[key] = sanitizeLogData(info[key]);
    }
  }

  return info;
});

/**
 * Creates a Winston logger instance with configured transports
 *
 * Automatically creates the log directory if it doesn't exist.
 * Configures three transports:
 * 1. Console (optional): Colorized, human-readable format
 * 2. Error file: JSON format, errors only (error.log)
 * 3. Combined file: JSON format, all levels (combined.log)
 *
 * @param {Object} [options={}] - Logger configuration options
 * @param {string} [options.level='info'] - Minimum log level (debug|info|warn|error)
 * @param {string} [options.logDir='./logs'] - Directory for log files (created if missing)
 * @param {boolean} [options.enableConsole=true] - Enable colorized console output
 *
 * @returns {winston.Logger} Configured logger instance with info(), warn(), error(), debug() methods
 *
 * @example
 * // Create logger with defaults (info level, console enabled)
 * const logger = createLogger();
 * logger.info('Application started');
 *
 * @example
 * // Create logger with custom settings
 * const logger = createLogger({
 *   level: 'debug',
 *   logDir: '/var/log/myapp',
 *   enableConsole: false
 * });
 *
 * logger.debug('Debugging info');
 * logger.error('Critical error', { code: 500 });
 */
export function createLogger(options = {}) {
  const {
    level = 'info',
    logDir = join(process.cwd(), 'logs'),
    enableConsole = true
  } = options;

  // Ensure log directory exists
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const transports = [];

  // Console transport
  if (enableConsole) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf((info) => {
            const { timestamp, level, message, ...meta } = info;

            const msg = typeof message === 'object'
              ? JSON.stringify(message, null, 2)
              : message;

            // Include all metadata if present
            const metaStr = Object.keys(meta).length > 0
              ? '\n' + JSON.stringify(meta, null, 2)
              : '';

            return `${timestamp} [${level}]: ${msg}${metaStr}`;
          })
        )
      })
    );
  }

  // File transport for errors only
  transports.push(
    new winston.transports.File({
      filename: join(logDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );

  // File transport for all logs
  transports.push(
    new winston.transports.File({
      filename: join(logDir, 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );

  const logger = winston.createLogger({
    level,
    format: winston.format.combine(
      sanitizingFormat(),
      winston.format.timestamp()
    ),
    transports
  });

  return logger;
}

// Create and export the default logger instance
const logger = createLogger();
export default logger;
