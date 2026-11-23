import { describe, expect, it } from 'vitest';
import { configuredOtlpEndpoint, resolveExporterType, shouldInstrument } from '../../src/observability/env.js';

describe('preload gating', () => {
  it('does not instrument with OTEL unconfigured', () => {
    expect(shouldInstrument({})).toBe(false);
  });
  it('instruments when an OTLP endpoint is configured', () => {
    expect(shouldInstrument({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' })).toBe(true);
    expect(shouldInstrument({ OTEL_ENDPOINT: 'http://c:4318' })).toBe(true);
    expect(shouldInstrument({ OTEL_EXPORTER_TYPE: 'otlp' })).toBe(true);
  });
  it('does not instrument when disabled, or when the type is console', () => {
    expect(shouldInstrument({ OTEL_ENABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' })).toBe(false);
    expect(shouldInstrument({ OTEL_EXPORTER_TYPE: 'console', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' })).toBe(false);
  });
  it('treats a configured endpoint as otlp unless the type says otherwise', () => {
    expect(resolveExporterType({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c' })).toBe('otlp');
    expect(resolveExporterType({})).toBe('console');
    expect(configuredOtlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c/' })).toBe('http://c');
  });
});
