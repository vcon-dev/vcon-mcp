/**
 * Custom metrics reach a reader, and the vCon lifecycle counters carry no per-vCon attribute.
 * The meter provider is installed after the application modules are imported, the order production has.
 */

import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { InMemoryMetricReader } from './in-memory-reader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { initializeObservability } from '../../src/observability/config.js';
import { recordCounter } from '../../src/observability/instrumentation.js';
import { VConService } from '../../src/services/vcon-service.js';

const reader = new InMemoryMetricReader();

async function collect(name: string) {
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics.flatMap((s) => s.metrics).filter((m) => m.descriptor.name === name);
}

beforeAll(async () => {
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_TYPE = 'console';
  process.env.OTEL_LOG_LEVEL = 'error';
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  await initializeObservability();
});

describe('custom metrics', () => {
  it('exports a counter recorded through recordCounter', async () => {
    recordCounter('o7.test.count', 2, { source: 'unit' }, 'test counter');
    const found = await collect('o7.test.count');
    expect(found).toHaveLength(1);
    expect(found[0].dataPoints[0].value).toBe(2);
    expect(found[0].dataPoints[0].attributes).toEqual({ source: 'unit' });
  });
});

describe('vCon lifecycle counters', () => {
  const uuid = randomUUID();
  const queries: any = {
    createVCon: async (v: any) => ({ uuid: v.uuid, id: '1' }),
    getVCon: async () => ({ vcon: '0.4.0', uuid, created_at: new Date().toISOString(), parties: [{ name: 'a' }] }),
    deleteVCon: async () => 1,
    updateVCon: async () => undefined,
  };
  const service = new VConService({ queries, pluginManager: { executeHook: async () => undefined } as any });

  it('records created, updated and deleted without vcon.uuid, keeping source', async () => {
    const created = await service.create({ parties: [{ name: 'Test' }] }, { source: 'unit' });
    await service.update(created.uuid, { subject: 'changed' }, { source: 'unit' });
    await service.delete(created.uuid, { source: 'unit' });

    for (const name of ['vcon.created.count', 'vcon.updated.count', 'vcon.deleted.count']) {
      const found = await collect(name);
      expect(found, name).toHaveLength(1);
      for (const point of found[0].dataPoints) {
        expect(Object.keys(point.attributes), name).not.toContain('vcon.uuid');
        expect(point.attributes.source).toBeDefined();
      }
    }
  });
});
