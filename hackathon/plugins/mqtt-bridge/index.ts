/**
 * MQTT / UNS Bridge Plugin
 * 
 * BASE CHALLENGE 2: vCon to UNS Bridge
 * 
 * Publishes vCon lifecycle events to MQTT broker using
 * Unified Namespace (UNS) topic hierarchy.
 * 
 * Topic structure:
 *   vcon/enterprise/{org_id}/ingested/{uuid}
 *   vcon/enterprise/{org_id}/enriched/{uuid}
 *   vcon/enterprise/{org_id}/tagged/{uuid}/{tag}
 *   vcon/enterprise/{org_id}/alert/{severity}/{uuid}
 * 
 * Events are lightweight JSON payloads referencing the full vCon in MongoDB.
 * The WebSocket listener on port 9001 enables the dashboard to subscribe
 * to real-time events via MQTT over WebSocket.
 */

import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { VConPlugin, RequestContext } from '../../src/hooks/plugin-interface.js';
import { VCon } from '../../src/types/vcon.js';

// ============================================================================
// Types
// ============================================================================

export interface MqttBridgeConfig {
  /** MQTT broker URL (default: mqtt://localhost:1883) */
  brokerUrl?: string;
  /** Organization ID for UNS topic hierarchy */
  orgId?: string;
  /** MQTT client options */
  clientOptions?: IClientOptions;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface VConEvent {
  event: string;
  vcon_uuid: string;
  timestamp: string;
  source_adapter?: string;
  participant_count?: number;
  duration_seconds?: number;
  subject?: string;
  sentiment?: number;
  topics?: string[];
  mongodb_ref: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// MQTT Bridge Plugin
// ============================================================================

export class MqttBridgePlugin implements VConPlugin {
  name = 'mqtt-bridge';
  version = '1.0.0';

  private client: MqttClient | null = null;
  private orgId: string = 'default';
  private brokerUrl: string = 'mqtt://localhost:1883';
  private verbose: boolean = false;
  private connected: boolean = false;

  // Track published event count for metrics
  private eventCount: number = 0;

  constructor(private config?: MqttBridgeConfig) { }

  // ========== Lifecycle ==========

  async initialize(config?: any): Promise<void> {
    const mergedConfig = { ...this.config, ...config };

    this.brokerUrl = mergedConfig?.brokerUrl
      || process.env.MQTT_BROKER_URL
      || 'mqtt://localhost:1883';
    this.orgId = mergedConfig?.orgId
      || process.env.MQTT_ORG_ID
      || 'default';
    this.verbose = mergedConfig?.verbose
      || process.env.MQTT_VERBOSE === 'true'
      || false;

    const clientOptions: IClientOptions = {
      clientId: `vcon-mcp-bridge-${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000,
      ...mergedConfig?.clientOptions,
    };

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.brokerUrl, clientOptions);

      this.client.on('connect', () => {
        this.connected = true;
        this.log('info', `Connected to MQTT broker at ${this.brokerUrl}`);
        resolve();
      });

      this.client.on('error', (err) => {
        this.log('error', `MQTT error: ${err.message}`);
        if (!this.connected) {
          reject(err);
        }
      });

      this.client.on('reconnect', () => {
        this.log('info', 'Reconnecting to MQTT broker...');
      });

      this.client.on('close', () => {
        this.connected = false;
        this.log('info', 'MQTT connection closed');
      });

      // Timeout fallback
      setTimeout(() => {
        if (!this.connected) {
          this.log('warn', 'MQTT connection timeout — continuing without broker');
          resolve(); // Don't block server startup
        }
      }, 5000);
    });
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      this.log('info', `Shutting down MQTT bridge (${this.eventCount} events published)`);
      await new Promise<void>((resolve) => {
        this.client!.end(false, {}, () => resolve());
      });
      this.client = null;
      this.connected = false;
    }
  }

  // ========== Lifecycle Hooks ==========

  /**
   * After a vCon is created, publish an "ingested" event
   */
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    const source = context.purpose || context.metadata?.source || 'unknown';

    // Calculate total duration from dialog segments
    const totalDuration = vcon.dialog?.reduce(
      (sum, d) => sum + (d.duration || 0), 0
    ) || 0;

    const event: VConEvent = {
      event: 'vcon.ingested',
      vcon_uuid: vcon.uuid,
      timestamp: new Date().toISOString(),
      source_adapter: source,
      participant_count: vcon.parties?.length || 0,
      duration_seconds: totalDuration,
      subject: vcon.subject,
      mongodb_ref: `vcons/${vcon.uuid}`,
    };

    await this.publish(`ingested/${vcon.uuid}`, event);
  }

  /**
   * After a vCon is read (used for tracking access patterns)
   */
  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    // Don't publish read events in non-verbose mode (too noisy)
    if (this.verbose) {
      await this.publish(`accessed/${vcon.uuid}`, {
        event: 'vcon.accessed',
        vcon_uuid: vcon.uuid,
        timestamp: new Date().toISOString(),
        mongodb_ref: `vcons/${vcon.uuid}`,
        metadata: { purpose: context.purpose },
      });
    }
    return vcon; // Pass through unmodified
  }

  /**
   * After a vCon is deleted, publish a "deleted" event
   */
  async afterDelete(uuid: string, context: RequestContext): Promise<void> {
    await this.publish(`deleted/${uuid}`, {
      event: 'vcon.deleted',
      vcon_uuid: uuid,
      timestamp: new Date().toISOString(),
      mongodb_ref: `vcons/${uuid}`,
    });
  }

  // ========== Public API ==========

  /**
   * Publish an enrichment event (called by other plugins after analysis)
   */
  async publishEnriched(vcon: VCon, analysisType: string, metadata?: Record<string, any>): Promise<void> {
    const event: VConEvent = {
      event: 'vcon.enriched',
      vcon_uuid: vcon.uuid,
      timestamp: new Date().toISOString(),
      subject: vcon.subject,
      participant_count: vcon.parties?.length || 0,
      mongodb_ref: `vcons/${vcon.uuid}`,
      metadata: {
        analysis_type: analysisType,
        ...metadata,
      },
    };

    await this.publish(`enriched/${vcon.uuid}`, event);
  }

  /**
   * Publish a tag event
   */
  async publishTagged(vconUuid: string, tag: string, value: string): Promise<void> {
    await this.publish(`tagged/${vconUuid}/${tag}`, {
      event: 'vcon.tagged',
      vcon_uuid: vconUuid,
      timestamp: new Date().toISOString(),
      mongodb_ref: `vcons/${vconUuid}`,
      metadata: { tag, value },
    });
  }

  /**
   * Publish an alert (compliance, sentiment threshold, etc.)
   */
  async publishAlert(
    vconUuid: string,
    severity: 'info' | 'warning' | 'critical',
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.publish(`alert/${severity}/${vconUuid}`, {
      event: `vcon.alert.${severity}`,
      vcon_uuid: vconUuid,
      timestamp: new Date().toISOString(),
      mongodb_ref: `vcons/${vconUuid}`,
      metadata: { message, ...metadata },
    });
  }

  /**
   * Get connection status and stats
   */
  getStatus(): { connected: boolean; eventCount: number; brokerUrl: string } {
    return {
      connected: this.connected,
      eventCount: this.eventCount,
      brokerUrl: this.brokerUrl,
    };
  }

  // ========== Private ==========

  /**
   * Publish a message to the UNS topic hierarchy
   */
  private async publish(topicSuffix: string, payload: any): Promise<void> {
    if (!this.client || !this.connected) {
      this.log('warn', `MQTT not connected — dropping event: ${topicSuffix}`);
      return;
    }

    const topic = `vcon/enterprise/${this.orgId}/${topicSuffix}`;
    const message = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, { qos: 1, retain: false }, (err) => {
        if (err) {
          this.log('error', `Failed to publish to ${topic}: ${err.message}`);
          reject(err);
        } else {
          this.eventCount++;
          this.log('debug', `Published to ${topic} (${message.length} bytes)`);
          resolve();
        }
      });
    });
  }

  private log(level: string, message: string): void {
    const prefix = `[mqtt-bridge]`;
    if (level === 'error') {
      console.error(`${prefix} ${message}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`);
    } else if (level === 'debug' && this.verbose) {
      console.log(`${prefix} ${message}`);
    } else if (level === 'info') {
      console.log(`${prefix} ${message}`);
    }
  }
}

// Default export for plugin loader
export default MqttBridgePlugin;
