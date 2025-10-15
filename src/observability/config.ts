/**
 * OpenTelemetry Configuration
 * 
 * Initializes and configures OpenTelemetry instrumentation for the vCon MCP server
 * Supports both console (JSON) and OTLP collector exports
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { 
  trace, 
  metrics, 
  Tracer, 
  Meter,
  DiagConsoleLogger,
  DiagLogLevel,
  diag
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';

/**
 * Observability configuration from environment variables
 */
interface ObservabilityConfig {
  enabled: boolean;
  exporterType: 'console' | 'otlp';
  endpoint: string;
  serviceName: string;
  serviceVersion: string;
  logLevel: DiagLogLevel;
}

let sdk: NodeSDK | null = null;
let isInitialized = false;

/**
 * Parse observability configuration from environment variables
 */
function getConfig(): ObservabilityConfig {
  const enabled = process.env.OTEL_ENABLED !== 'false'; // Default to true
  const exporterType = (process.env.OTEL_EXPORTER_TYPE?.toLowerCase() as 'console' | 'otlp') || 'console';
  const endpoint = process.env.OTEL_ENDPOINT || 'http://localhost:4318';
  const serviceName = process.env.OTEL_SERVICE_NAME || 'vcon-mcp-server';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION || '1.0.0';
  
  // Parse log level
  const logLevelStr = process.env.OTEL_LOG_LEVEL?.toLowerCase() || 'info';
  const logLevelMap: Record<string, DiagLogLevel> = {
    'none': DiagLogLevel.NONE,
    'error': DiagLogLevel.ERROR,
    'warn': DiagLogLevel.WARN,
    'info': DiagLogLevel.INFO,
    'debug': DiagLogLevel.DEBUG,
    'verbose': DiagLogLevel.VERBOSE,
    'all': DiagLogLevel.ALL,
  };
  const logLevel = logLevelMap[logLevelStr] || DiagLogLevel.INFO;
  
  return {
    enabled,
    exporterType,
    endpoint,
    serviceName,
    serviceVersion,
    logLevel,
  };
}

/**
 * Initialize OpenTelemetry instrumentation
 */
export async function initializeObservability(): Promise<void> {
  if (isInitialized) {
    console.error('⚠️  Observability already initialized');
    return;
  }
  
  const config = getConfig();
  
  if (!config.enabled) {
    console.error('ℹ️  OpenTelemetry observability disabled');
    isInitialized = true;
    return;
  }
  
  try {
    // Set up diagnostic logging
    diag.setLogger(new DiagConsoleLogger(), config.logLevel);
    
    // Create resource with service information
    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion,
    });
    
    // Configure trace exporter
    let traceExporter;
    if (config.exporterType === 'otlp') {
      traceExporter = new OTLPTraceExporter({
        url: `${config.endpoint}/v1/traces`,
      });
      console.error(`✅ OpenTelemetry traces: OTLP export to ${config.endpoint}`);
    } else {
      traceExporter = new ConsoleSpanExporter();
      console.error('✅ OpenTelemetry traces: Console export (JSON)');
    }
    
    // Configure metric exporter
    let metricReader;
    if (config.exporterType === 'otlp') {
      const metricExporter = new OTLPMetricExporter({
        url: `${config.endpoint}/v1/metrics`,
      });
      metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60000, // Export every 60 seconds
      });
      console.error(`✅ OpenTelemetry metrics: OTLP export to ${config.endpoint}`);
    } else {
      const metricExporter = new ConsoleMetricExporter();
      metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60000,
      });
      console.error('✅ OpenTelemetry metrics: Console export (JSON)');
    }
    
    // Initialize SDK
    sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable some auto-instrumentations that might be noisy
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
        }),
      ],
    });
    
    // Start the SDK
    await sdk.start();
    
    isInitialized = true;
    console.error('✅ OpenTelemetry SDK initialized');
    
  } catch (error) {
    console.error('❌ Failed to initialize OpenTelemetry:', error);
    console.error('⚠️  Continuing without observability...');
    isInitialized = true; // Set to true to prevent retry loops
  }
}

/**
 * Shutdown OpenTelemetry and flush pending telemetry
 */
export async function shutdownObservability(): Promise<void> {
  if (!isInitialized || !sdk) {
    return;
  }
  
  try {
    console.error('🔄 Flushing OpenTelemetry data...');
    await sdk.shutdown();
    console.error('✅ OpenTelemetry shutdown complete');
  } catch (error) {
    console.error('❌ Error during OpenTelemetry shutdown:', error);
  }
}

/**
 * Get the tracer instance for creating spans
 */
export function getTracer(): Tracer {
  const config = getConfig();
  return trace.getTracer(config.serviceName, config.serviceVersion);
}

/**
 * Get the meter instance for recording metrics
 */
export function getMeter(): Meter {
  const config = getConfig();
  return metrics.getMeter(config.serviceName, config.serviceVersion);
}

/**
 * Check if observability is enabled
 */
export function isObservabilityEnabled(): boolean {
  const config = getConfig();
  return config.enabled && isInitialized;
}

// Export singleton instances
export const tracer = getTracer();
export const meter = getMeter();

