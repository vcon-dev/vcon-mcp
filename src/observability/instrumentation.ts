/**
 * OpenTelemetry Instrumentation Utilities
 * 
 * Helper functions for creating spans, recording metrics, and structured logging
 */

import { 
  context, 
  trace, 
  Span, 
  SpanStatusCode, 
  Attributes,
  Counter,
  Histogram,
  UpDownCounter
} from '@opentelemetry/api';
import { getTracer, getMeter, isObservabilityEnabled, onMetricInstrumentsReset } from './config.js';
import { ATTR_ERROR_TYPE, ATTR_ERROR_MESSAGE } from './attributes.js';
import { logger } from './logger.js';

/**
 * Metric cache to avoid recreating instruments
 */
const metricCache = new Map<string, Counter | Histogram | UpDownCounter>();
onMetricInstrumentsReset(() => metricCache.clear());

/**
 * Wrap an async function with a span
 * 
 * @param name - Span name
 * @param fn - Async function to execute within the span
 * @param attributes - Optional span attributes
 * @returns Result of the function
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  if (!isObservabilityEnabled()) {
    // If observability is disabled, just run the function
    const dummySpan = trace.getSpan(context.active()) || trace.wrapSpanContext({
      traceId: '',
      spanId: '',
      traceFlags: 0
    });
    return fn(dummySpan as Span);
  }
  
  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      attachErrorToSpan(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap a synchronous function with a span
 * 
 * @param name - Span name
 * @param fn - Synchronous function to execute within the span
 * @param attributes - Optional span attributes
 * @returns Result of the function
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Attributes
): T {
  if (!isObservabilityEnabled()) {
    const dummySpan = trace.getSpan(context.active()) || trace.wrapSpanContext({
      traceId: '',
      spanId: '',
      traceFlags: 0
    });
    return fn(dummySpan as Span);
  }
  
  return getTracer().startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      attachErrorToSpan(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Attach error information to a span
 * 
 * @param span - The span to attach error to
 * @param error - The error object
 */
export function attachErrorToSpan(span: Span, error: unknown, messageOverride?: string): void {
  // Once per span. The first caller sees the underlying error; withSpan then sees the wrapped one the
  // handler rethrows, and must not add a second event or overwrite the class.
  if (errorRecorded.has(span)) return;
  errorRecorded.add(span);

  const errorType = errorClassOf(error);
  const message = sanitizeErrorMessage(messageOverride ?? errorTextOf(error));

  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.setAttributes({
    [ATTR_ERROR_TYPE]: errorType,
    [ATTR_ERROR_MESSAGE]: message,
  });
  // Not span.recordException(error): it copies the raw message and the stack, which can carry
  // tokens, query text and file paths. Record the class and the sanitized message only.
  span.addEvent('exception', {
    'exception.type': errorType,
    'exception.message': message,
  });
}

const errorRecorded = new WeakSet<Span>();

/**
 * A class for the span. Store errors are plain objects, so use their short code (for example PGRST116)
 * when they have one, and a fixed name otherwise, never 'object'.
 */
function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.constructor.name;
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code;
    return 'UnknownError';
  }
  return typeof error;
}

function errorTextOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    return 'unknown error object';
  }
  return String(error);
}

const MAX_ERROR_MESSAGE_LENGTH = 200;

/**
 * Make an error message safe to put on a span: strips URL query strings, JWTs, bearer values,
 * email addresses and long opaque tokens, and caps the length.
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(https?:\/\/[^\s?#"']*)[?#][^\s"']*/gi, '$1')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/\b(bearer|basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    // Phone numbers keep their last four digits: international (+...), grouped (555-123-4567,
    // (555) 123 4567) and bare runs of 10 to 15 digits. Dates and short ids are left alone.
    .replace(/\+\d[\d\s().-]{6,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,15}\b/g, (m) => `***${m.replace(/\D/g, '').slice(-4)}`)
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

/**
 * Get or create a counter metric
 * 
 * @param name - Metric name
 * @param description - Metric description
 * @returns Counter instance
 */
function getCounter(name: string, description: string): Counter {
  const cached = metricCache.get(name);
  if (cached) {
    return cached as Counter;
  }
  
  const counter = getMeter().createCounter(name, { description });
  metricCache.set(name, counter);
  return counter;
}

/**
 * Get or create a histogram metric
 * 
 * @param name - Metric name
 * @param description - Metric description
 * @returns Histogram instance
 */
function getHistogram(name: string, description: string): Histogram {
  const cached = metricCache.get(name);
  if (cached) {
    return cached as Histogram;
  }
  
  const histogram = getMeter().createHistogram(name, { description });
  metricCache.set(name, histogram);
  return histogram;
}

/**
 * Get or create an up-down counter metric
 * 
 * @param name - Metric name
 * @param description - Metric description
 * @returns UpDownCounter instance
 */
function getUpDownCounter(name: string, description: string): UpDownCounter {
  const cached = metricCache.get(name);
  if (cached) {
    return cached as UpDownCounter;
  }
  
  const upDownCounter = getMeter().createUpDownCounter(name, { description });
  metricCache.set(name, upDownCounter);
  return upDownCounter;
}

/**
 * Record a counter metric
 * 
 * @param name - Metric name
 * @param value - Value to add (default: 1)
 * @param attributes - Optional metric attributes
 * @param description - Metric description
 */
export function recordCounter(
  name: string,
  value: number = 1,
  attributes?: Attributes,
  description?: string
): void {
  if (!isObservabilityEnabled()) {
    return;
  }
  
  const counter = getCounter(name, description || name);
  counter.add(value, attributes);
}

/**
 * Record a histogram metric
 * 
 * @param name - Metric name
 * @param value - Value to record
 * @param attributes - Optional metric attributes
 * @param description - Metric description
 */
export function recordHistogram(
  name: string,
  value: number,
  attributes?: Attributes,
  description?: string
): void {
  if (!isObservabilityEnabled()) {
    return;
  }
  
  const histogram = getHistogram(name, description || name);
  histogram.record(value, attributes);
}

/**
 * Record an up-down counter metric
 * 
 * @param name - Metric name
 * @param value - Value to add (can be negative)
 * @param attributes - Optional metric attributes
 * @param description - Metric description
 */
export function recordUpDownCounter(
  name: string,
  value: number,
  attributes?: Attributes,
  description?: string
): void {
  if (!isObservabilityEnabled()) {
    return;
  }
  
  const upDownCounter = getUpDownCounter(name, description || name);
  upDownCounter.add(value, attributes);
}

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured logging with trace context
 * 
 * @param level - Log level
 * @param message - Log message
 * @param attributes - Additional structured attributes
 */
export function logWithContext(
  level: LogLevel,
  message: string,
  attributes?: Record<string, any>
): void {
  // Through pino, which writes to stderr and adds the active trace and span ids. The attributes are
  // not copied onto the span: span events leave the process, log lines stay with the operator.
  logger[level](attributes ?? {}, message);
}

/**
 * Measure execution time and record as histogram
 * 
 * @param metricName - Name of the duration metric
 * @param fn - Async function to measure
 * @param attributes - Optional metric attributes
 * @returns Result of the function
 */
export async function measureDuration<T>(
  metricName: string,
  fn: () => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    recordHistogram(metricName, duration, attributes, `Duration of ${metricName} in milliseconds`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordHistogram(
      metricName, 
      duration, 
      { ...attributes, success: false }, 
      `Duration of ${metricName} in milliseconds`
    );
    throw error;
  }
}

/**
 * Create a child span from the current context
 * 
 * @param name - Span name
 * @param attributes - Optional span attributes
 * @returns Span instance
 */
export function createSpan(name: string, attributes?: Attributes): Span {
  if (!isObservabilityEnabled()) {
    return trace.wrapSpanContext({
      traceId: '',
      spanId: '',
      traceFlags: 0
    }) as Span;
  }
  
  return getTracer().startSpan(name, { attributes }, context.active());
}

/**
 * Get current trace ID for logging correlation
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}

/**
 * Get current span ID for logging correlation
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().spanId;
}

