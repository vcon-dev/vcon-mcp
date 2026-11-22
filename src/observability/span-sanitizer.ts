/**
 * Removes query strings from spans before they leave the process.
 *
 * HTTP and undici instrumentation record the request target, and with it any query string: API keys,
 * search text, email and phone filters. Wrapping the exporter covers every span whatever created it.
 */

import { ExportResult } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/** Attributes that exist only to carry a query string. */
const QUERY_ONLY_KEYS = new Set(['url.query']);

function stripQuery(value: string): string {
  return value.replace(/[?#].*$/s, '');
}

/** Rewrites the span in place: query strings out of attributes and name. */
export function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const attributes = span.attributes as Record<string, unknown>;
  for (const key of Object.keys(attributes)) {
    if (QUERY_ONLY_KEYS.has(key)) {
      delete attributes[key];
      continue;
    }
    const value = attributes[key];
    if (typeof value !== 'string') continue;
    // http.target and url.path hold a path plus query; http.url and url.full hold a full URL.
    if (key === 'http.target' || key === 'url.path' || /^https?:\/\//i.test(value)) {
      attributes[key] = stripQuery(value);
    }
  }
  if (span.name.includes('?')) (span as { name: string }).name = stripQuery(span.name);
  return span;
}

export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans.map(sanitizeSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
