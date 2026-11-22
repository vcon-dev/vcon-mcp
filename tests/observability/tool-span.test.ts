/**
 * A tool span carries tenant.id when the request has a tenant, and the tenant never becomes a
 * metric attribute.
 */

import { metrics, trace } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { InMemoryMetricReader } from './in-memory-reader.js';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLaneContext } from '../../src/lane/context.js';
import { fakeStore, storeAnswer, tenantJwt, TENANT_A } from '../lane/helpers.js';
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

const ctx = (tenantId?: string) =>
  ({ telemetryTenantId: tenantId ? () => tenantId : undefined }) as unknown as ToolHandlerContext;
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
    expect(span.attributes['error.type']).toBe('BoomError');
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

class StoreReadHandler extends BaseToolHandler {
  readonly toolName = 'echo_tool';
  protected async execute(_args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    await context.supabase.from('vcons').select('uuid');
    return this.createSuccessResponse({ ok: true });
  }
}

describe('lane tenant.id is set only after the store accepts the token', () => {
  const URL_ = 'http://lane-store.invalid';
  // The stub store stands in for PostgREST's signature check: a token signed ".forged" is refused.
  const store = () => {
    const s = fakeStore();
    s.override = (r) =>
      r.headers.get('authorization')?.endsWith('.forged') ? storeAnswer(401, { message: 'JWT invalid' }) : undefined;
    return s;
  };
  const forged = () => tenantJwt('forged-tenant').split('.').slice(0, 2).join('.') + '.forged';

  it('puts no tenant.id on the span for a forged token', async () => {
    const lane = createLaneContext(forged(), { url: URL_, fetch: store().fetch }, 'forged-tenant');
    await new StoreReadHandler().handle({}, lane).catch(() => undefined);
    expect(toolSpan()).toBeDefined();
    expect(toolSpan()?.attributes).not.toHaveProperty('tenant.id');
    expect(JSON.stringify(exporter.getFinishedSpans().map((sp) => sp.attributes))).not.toContain('forged-tenant');
  });

  it('puts tenant.id on the span for a token the store accepts', async () => {
    const lane = createLaneContext(tenantJwt(TENANT_A), { url: URL_, fetch: store().fetch }, TENANT_A);
    await new StoreReadHandler().handle({}, lane);
    expect(toolSpan()?.attributes['tenant.id']).toBe(TENANT_A);
  });

  it('names the context field for telemetry, not authorization', () => {
    const lane = createLaneContext(tenantJwt(TENANT_A), { url: URL_, fetch: store().fetch }, TENANT_A);
    expect(lane).not.toHaveProperty('tenantId');
    expect(lane.telemetryTenantId?.()).toBeUndefined(); // before any store call
  });
});

describe('a failed tool span records the error once', () => {
  class BoomError extends Error {}
  class Failing extends EchoHandler {
    protected async execute(): Promise<ToolResponse> {
      throw new BoomError('storage fell over');
    }
  }
  it('has one exception event and the underlying error class', async () => {
    await new Failing().handle({}, ctx()).catch(() => undefined);
    const span = toolSpan()!;
    expect(span.events.filter((e) => e.name === 'exception')).toHaveLength(1);
    expect(span.attributes['error.type']).toBe('BoomError');
  });

  it('has one exception event for an McpError thrown by the handler', async () => {
    class Bad extends EchoHandler {
      protected async execute(): Promise<ToolResponse> {
        const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
        throw new McpError(ErrorCode.InvalidParams, 'nope');
      }
    }
    await new Bad().handle({}, ctx()).catch(() => undefined);
    expect(toolSpan()!.events.filter((e) => e.name === 'exception')).toHaveLength(1);
  });
});
