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
import { tracer, meter, isObservabilityEnabled } from './config.js';
import { ATTR_ERROR_TYPE, ATTR_ERROR_MESSAGE, ATTR_ERROR_STACK } from './attributes.js';

/**
 * Metric cache to avoid recreating instruments
 */
const metricCache = new Map<string, Counter | Histogram | UpDownCounter>();

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
  
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
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
  
  return tracer.startActiveSpan(name, { attributes }, (span) => {
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
export function attachErrorToSpan(span: Span, error: unknown): void {
  span.setStatus({ 
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error)
  });
  
  if (error instanceof Error) {
    span.setAttributes({
      [ATTR_ERROR_TYPE]: error.constructor.name,
      [ATTR_ERROR_MESSAGE]: error.message,
      [ATTR_ERROR_STACK]: error.stack || '',
    });
    span.recordException(error);
  } else {
    span.setAttributes({
      [ATTR_ERROR_TYPE]: typeof error,
      [ATTR_ERROR_MESSAGE]: String(error),
    });
  }
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
  
  const counter = meter.createCounter(name, { description });
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
  
  const histogram = meter.createHistogram(name, { description });
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
  
  const upDownCounter = meter.createUpDownCounter(name, { description });
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
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  
  const logData: Record<string, any> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...attributes,
  };
  
  // Add trace context if available
  if (spanContext) {
    logData.trace_id = spanContext.traceId;
    logData.span_id = spanContext.spanId;
    logData.trace_flags = spanContext.traceFlags;
  }
  
  // Output as structured JSON
  const logLine = JSON.stringify(logData);
  
  // Write to stderr (MCP servers use stdout for protocol)
  console.error(logLine);
  
  // Also add event to current span if available
  if (span && isObservabilityEnabled()) {
    span.addEvent(message, attributes);
  }
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
  
  return tracer.startSpan(name, { attributes }, context.active());
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

