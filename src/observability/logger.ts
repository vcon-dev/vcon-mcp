/**
 * Pino Logger Configuration with OpenTelemetry Integration
 *
 * Provides structured logging with automatic trace context injection
 * and MCP-compliant stderr output.
 */

import { context, trace } from '@opentelemetry/api';
import pino from 'pino';

/**
 * Mixin to automatically inject OpenTelemetry trace context into logs
 */
const traceContextMixin = (): Record<string, any> => {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();

  if (spanContext) {
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  }
  return {};
};

/**
 * Create root Pino logger instance
 */
function createRootLogger() {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

  const baseConfig: pino.LoggerOptions = {
    level: logLevel,

    // Inject OpenTelemetry trace context
    mixin: traceContextMixin,

    // Base fields for all logs (includes build metadata from CI/CD)
    base: {
      service: 'vcon-mcp-server',
      version: process.env.VCON_MCP_VERSION || 'dev',
      git_commit: process.env.VCON_MCP_GIT_COMMIT || 'unknown',
      build_time: process.env.VCON_MCP_BUILD_TIME || undefined,
    },

    // Timestamp in ISO format
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Development: Pretty printing
  if (isDevelopment) {
    return pino(
      {
        ...baseConfig,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            messageFormat: '{component} - {msg}',
            singleLine: false,
          },
        },
      },
      pino.destination(2) // stderr for MCP
    );
  }

  // Production: JSON to stderr
  return pino(baseConfig, pino.destination(2));
}

/**
 * Root logger instance
 */
export const logger = createRootLogger();

/**
 * Create a child logger with component context
 *
 * @param component - Component name (e.g., 'queries', 'cache', 'plugins')
 * @returns Child logger with component context
 *
 * @example
 * const logger = createLogger('queries');
 * logger.info({ vcon_uuid: 'abc' }, 'Cache hit');
 */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}

/**
 * Backward compatibility: Wrapper for existing logWithContext calls
 *
 * @deprecated Use logger.info/warn/error directly instead
 */
export function logWithContext(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  attributes?: Record<string, any>
): void {
  const logMethod = logger[level].bind(logger);
  logMethod(attributes || {}, message);
}

/**
 * Log levels for reference
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Helper to log errors with full stack traces
 *
 * @param logger - Logger instance
 * @param error - Error object
 * @param message - Log message
 * @param context - Additional context
 */
export function logError(
  logger: pino.Logger,
  error: unknown,
  message: string,
  context?: Record<string, any>
): void {
  logger.error(
    {
      err: error,
      ...context,
    },
    message
  );
}
