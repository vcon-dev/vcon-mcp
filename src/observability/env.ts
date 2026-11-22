/**
 * OpenTelemetry settings that depend only on the environment. No SDK imports, so the preload can read
 * them before deciding whether to register the loader hook.
 */

export type ExporterType = 'console' | 'otlp';

/** The collector base URL the environment names, or undefined when none is configured. */
export function configuredOtlpEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_ENDPOINT;
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

/**
 * OTEL_EXPORTER_TYPE wins. When it is unset, a configured endpoint means OTLP: naming a collector and
 * exporting nothing would be a silent failure.
 */
export function resolveExporterType(env: NodeJS.ProcessEnv = process.env): ExporterType {
  const explicit = env.OTEL_EXPORTER_TYPE?.toLowerCase();
  if (explicit === 'otlp' || explicit === 'console') return explicit;
  return configuredOtlpEndpoint(env) ? 'otlp' : 'console';
}

/** Whether OpenTelemetry will export anywhere. The loader hook costs startup time, so only then. */
export function shouldInstrument(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTEL_ENABLED !== 'false' && resolveExporterType(env) === 'otlp';
}
