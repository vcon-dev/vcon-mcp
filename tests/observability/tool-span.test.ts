/**
 * A tool span carries tenant.id when the request has a tenant, and the tenant never becomes a
 * metric attribute.
 */

import { metrics, trace } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { InMemoryMetricReader } from './in-memory-reader.js';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSpan } from '../../src/observability/instrumentation.js';
import { initializeObservability } from '../../src/observability/config.js';
import { BaseToolHandler, type ToolHandlerContext, type ToolResponse } from '../../src/tools/handlers/base.js';

const exporter = new InMemorySpanExporter();
const reader = new InMemoryMetricReader();

class EchoHandler extends BaseToolHandler {
  readonly toolName = 'echo_tool';
  protected async execute(): Promise<ToolResponse> {
    return this.createSuccessResponse({ ok: true });
  }
}

beforeAll(async () => {
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_TYPE = 'console';
  process.env.OTEL_LOG_LEVEL = 'error';
  const tracerProvider = new BasicTracerProvider();
  tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  await initializeObservability();
});

beforeEach(() => exporter.reset());

const ctx = (tenantId?: string) => ({ tenantId }) as unknown as ToolHandlerContext;
const toolSpan = () => exporter.getFinishedSpans().find((s) => s.name === 'mcp.tool.echo_tool');

describe('tool span tenant', () => {
  it('sets tenant.id when the request has a tenant', async () => {
    await new EchoHandler().handle({}, ctx('tenant-a'));
    expect(toolSpan()?.attributes['tenant.id']).toBe('tenant-a');
  });

  it('leaves tenant.id off when the request has none', async () => {
    await new EchoHandler().handle({}, ctx());
    expect(toolSpan()).toBeDefined();
    expect(toolSpan()?.attributes).not.toHaveProperty('tenant.id');
  });

  it('never puts the tenant on a metric', async () => {
    await new EchoHandler().handle({}, ctx('tenant-a'));
    const { resourceMetrics } = await reader.collect();
    const points = resourceMetrics.scopeMetrics.flatMap((s) => s.metrics).flatMap((m) => m.dataPoints);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(Object.keys(p.attributes)).not.toContain('tenant.id');
  });
});

describe('error recording on spans', () => {
  it('records the original error class through withSpan', async () => {
    class BoomError extends Error {}
    await withSpan('o7.boom', async () => {
      throw new BoomError('bad https://h.example/p?token=abc123secret');
    }).catch(() => undefined);
    const span = exporter.getFinishedSpans().find((s) => s.name === 'o7.boom')!;
    expect(span.attributes['error.type']).toBe('BoomError');
    expect(String(span.attributes['error.message'])).not.toContain('abc123secret');
  });

  it('keeps the error class and a sanitized message, with no stack', async () => {
    class BoomError extends Error {}
    class Failing extends EchoHandler {
      protected async execute(): Promise<ToolResponse> {
        throw new BoomError('failed calling https://host.example/path?token=abc123secret for bob@example.com with Bearer abcdef');
      }
    }
    await new Failing().handle({}, ctx()).catch(() => undefined);
    const span = toolSpan()!;
    expect(span.attributes['error.type']).toBe('McpError');
    const message = String(span.attributes['error.message']);
    expect(message).not.toContain('abc123secret');
    expect(message).not.toContain('bob@example.com');
    expect(message).not.toContain('abcdef');
    expect(span.attributes).not.toHaveProperty('error.stack');
    for (const event of span.events) {
      expect(JSON.stringify(event.attributes)).not.toMatch(/abc123secret|bob@example|at .*\(.*:\d+:\d+\)/);
    }
  });
});
