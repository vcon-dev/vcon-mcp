/**
 * Removes query strings from spans before they leave the process.
 *
 * HTTP and undici instrumentation record the request target, and with it any query string: API keys,
 * search text, email and phone filters. Wrapping the exporter covers every span whatever created it.
 *
 * Works on a copy, so a read-only or frozen span is fine and the original is untouched. It never
 * throws: an attribute it cannot clean is dropped, and the batch is always handed on and the result
 * callback always called.
 */

import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

type Attrs = Record<string, unknown>;

/** Attributes that exist only to carry a query string. */
const QUERY_ONLY_KEYS = new Set(['url.query']);

/** Dropped from every event: stacks carry file paths and can carry values. Class and message stay. */
const EVENT_DROP_KEYS = new Set(['exception.stacktrace']);

function stripQuery(value: string): string {
  return value.replace(/[?#].*$/s, '');
}

/** URLs inside longer text lose their query string and fragment. */
function stripEmbeddedUrlQueries(value: string): string {
  return value.replace(/(https?:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, '$1');
}

function cleanString(key: string, value: string): string {
  // http.target and url.path hold a path plus query; the rest may hold URLs inside longer text.
  if (key === 'http.target' || key === 'url.path') return stripQuery(value);
  return stripEmbeddedUrlQueries(value);
}

function cleanValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') return cleanString(key, value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? cleanString(key, v) : v));
  return value;
}

/** A cleaned copy of an attribute bag. An attribute that cannot be read or cleaned is dropped. */
function cleanAttributes(attributes: unknown, drop: Set<string> = QUERY_ONLY_KEYS): Attrs {
  const out: Attrs = {};
  if (!attributes || typeof attributes !== 'object') return out;
  let keys: string[] = [];
  try {
    keys = Object.keys(attributes);
  } catch {
    return out;
  }
  for (const key of keys) {
    try {
      if (drop.has(key) || QUERY_ONLY_KEYS.has(key)) continue;
      out[key] = cleanValue(key, (attributes as Attrs)[key]);
    } catch {
      // drop it
    }
  }
  return out;
}

function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** A cleaned copy of the span: name, attributes, events, links and status message. */
export function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const s = span as any;
  const status = (read(() => s.status, undefined) ?? { code: 0 }) as { code: number; message?: string };
  const copy: Record<string, unknown> = {
    name: stripQuery(String(read(() => s.name, ''))),
    kind: read(() => s.kind, 0),
    spanContext: () => s.spanContext(),
    parentSpanId: read(() => s.parentSpanId, undefined),
    startTime: read(() => s.startTime, [0, 0]),
    endTime: read(() => s.endTime, [0, 0]),
    status: status.message === undefined ? status : { ...status, message: stripEmbeddedUrlQueries(String(status.message)) },
    attributes: cleanAttributes(read(() => s.attributes, {})),
    links: read(() => (s.links as any[]) ?? [], []).map((l) => ({ ...l, attributes: cleanAttributes(l?.attributes) })),
    events: read(() => (s.events as any[]) ?? [], []).map((e) => ({
      ...e,
      name: typeof e?.name === 'string' ? stripEmbeddedUrlQueries(e.name) : e?.name,
      attributes: cleanAttributes(e?.attributes, EVENT_DROP_KEYS),
    })),
    duration: read(() => s.duration, [0, 0]),
    ended: read(() => s.ended, true),
    resource: read(() => s.resource, undefined),
    instrumentationLibrary: read(() => s.instrumentationLibrary, undefined),
    instrumentationScope: read(() => s.instrumentationScope, undefined),
    droppedAttributesCount: read(() => s.droppedAttributesCount, 0),
    droppedEventsCount: read(() => s.droppedEventsCount, 0),
    droppedLinksCount: read(() => s.droppedLinksCount, 0),
  };
  return copy as unknown as ReadableSpan;
}

export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    let cleaned: ReadableSpan[];
    try {
      cleaned = spans.map((span) => {
        try {
          return sanitizeSpan(span);
        } catch {
          // Never export the original: it may still carry a query string. Keep the span's identity only.
          return { ...(sanitizeSpan as (s: ReadableSpan) => ReadableSpan)({ name: '', attributes: {}, spanContext: () => span.spanContext() } as unknown as ReadableSpan) };
        }
      });
    } catch {
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }
    try {
      this.inner.export(cleaned, resultCallback);
    } catch (error) {
      resultCallback({ code: ExportResultCode.FAILED, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
