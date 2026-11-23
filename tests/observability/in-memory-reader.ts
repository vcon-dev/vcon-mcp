import { MetricReader } from '@opentelemetry/sdk-metrics';

/** A pull reader that keeps nothing: tests call collect() and read the data points. */
export class InMemoryMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}
