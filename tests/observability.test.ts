/**
 * Observability Tests
 * 
 * Tests for OpenTelemetry instrumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeObservability, shutdownObservability, isObservabilityEnabled } from '../src/observability/config.js';
import { withSpan, recordCounter, recordHistogram, logWithContext } from '../src/observability/instrumentation.js';

describe('Observability Configuration', () => {
  beforeEach(async () => {
    // Set test environment variables
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_TYPE = 'console';
    process.env.OTEL_LOG_LEVEL = 'error'; // Quiet during tests
  });

  afterEach(async () => {
    await shutdownObservability();
    // Clean up environment
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_TYPE;
    delete process.env.OTEL_LOG_LEVEL;
  });

  it('should initialize successfully', async () => {
    await initializeObservability();
    expect(isObservabilityEnabled()).toBe(true);
  });

  it('should disable when OTEL_ENABLED=false', async () => {
    process.env.OTEL_ENABLED = 'false';
    await initializeObservability();
    expect(isObservabilityEnabled()).toBe(false);
  });

  it('should handle multiple initializations gracefully', async () => {
    await initializeObservability();
    await initializeObservability(); // Should not throw
    expect(isObservabilityEnabled()).toBe(true);
  });

  it('should shutdown gracefully', async () => {
    await initializeObservability();
    await shutdownObservability(); // Should not throw
  });
});

describe('Instrumentation', () => {
  beforeEach(async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_TYPE = 'console';
    process.env.OTEL_LOG_LEVEL = 'error';
    await initializeObservability();
  });

  afterEach(async () => {
    await shutdownObservability();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_TYPE;
    delete process.env.OTEL_LOG_LEVEL;
  });

  it('should create spans with withSpan', async () => {
    const result = await withSpan('test.span', async (span) => {
      expect(span).toBeDefined();
      return 'test-result';
    });
    
    expect(result).toBe('test-result');
  });

  it('should handle errors in spans', async () => {
    await expect(async () => {
      await withSpan('test.error', async () => {
        throw new Error('Test error');
      });
    }).rejects.toThrow('Test error');
  });

  it('should record counters', () => {
    // Should not throw
    recordCounter('test.counter', 1, { test: 'value' }, 'Test counter');
  });

  it('should record histograms', () => {
    // Should not throw
    recordHistogram('test.histogram', 123, { test: 'value' }, 'Test histogram');
  });

  it('should handle structured logging', () => {
    // Should not throw
    logWithContext('info', 'Test log message', {
      test_attribute: 'value',
    });
  });

  it('should work when disabled', async () => {
    await shutdownObservability();
    process.env.OTEL_ENABLED = 'false';
    await initializeObservability();

    // All operations should work but be no-ops
    const result = await withSpan('test.disabled', async () => {
      return 'test-result';
    });
    expect(result).toBe('test-result');
    
    recordCounter('test.counter', 1);
    recordHistogram('test.histogram', 123);
    logWithContext('info', 'Test message');
  });
});

describe('Attributes', () => {
  it('should export semantic attribute constants', async () => {
    const { 
      ATTR_VCON_UUID,
      ATTR_TOOL_NAME,
      ATTR_SEARCH_TYPE,
      ATTR_CACHE_HIT,
    } = await import('../src/observability/attributes.js');

    expect(ATTR_VCON_UUID).toBe('vcon.uuid');
    expect(ATTR_TOOL_NAME).toBe('mcp.tool.name');
    expect(ATTR_SEARCH_TYPE).toBe('search.type');
    expect(ATTR_CACHE_HIT).toBe('cache.hit');
  });
});

describe('Trace Context', () => {
  beforeEach(async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_TYPE = 'console';
    process.env.OTEL_LOG_LEVEL = 'error';
    await initializeObservability();
  });

  afterEach(async () => {
    await shutdownObservability();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_TYPE;
    delete process.env.OTEL_LOG_LEVEL;
  });

  it('should propagate context in nested spans', async () => {
    await withSpan('parent.span', async () => {
      await withSpan('child.span', async () => {
        // Should not throw and maintain context
        expect(true).toBe(true);
      });
    });
  });

  it('should include trace context in logs within spans', async () => {
    await withSpan('test.span', async () => {
      // This should include trace_id and span_id in the log output
      // (we can't easily test the actual output without capturing stderr)
      logWithContext('info', 'Test log with context', {
        test_attribute: 'value',
      });
      expect(true).toBe(true);
    });
  });
});

describe('Error Handling', () => {
  beforeEach(async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_TYPE = 'console';
    process.env.OTEL_LOG_LEVEL = 'error';
    await initializeObservability();
  });

  afterEach(async () => {
    await shutdownObservability();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_TYPE;
    delete process.env.OTEL_LOG_LEVEL;
  });

  it('should attach errors to spans', async () => {
    await expect(async () => {
      await withSpan('test.error', async () => {
        throw new Error('Test error message');
      });
    }).rejects.toThrow('Test error message');
  });

  it('should handle non-Error objects', async () => {
    await expect(async () => {
      await withSpan('test.error', async () => {
        throw 'String error';
      });
    }).rejects.toBe('String error');
  });
});

