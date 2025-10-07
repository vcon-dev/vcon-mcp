/**
 * Plugin interface for extending vCon MCP Server
 * Implement this interface to add custom functionality
 */

import { VCon } from '../types/vcon.js';
import { Tool, Resource } from '@modelcontextprotocol/sdk/types.js';

export interface VConPlugin {
  /** Plugin name */
  name: string;
  
  /** Plugin version */
  version: string;
  
  /** Initialize plugin (called at server startup) */
  initialize?(config: any): Promise<void>;
  
  /** Cleanup on shutdown */
  shutdown?(): Promise<void>;
  
  // ========== Lifecycle Hooks ==========
  
  /** Called before creating a vCon. Can modify vCon or throw to block. */
  beforeCreate?(vcon: VCon, context: RequestContext): Promise<VCon>;
  
  /** Called after vCon created successfully */
  afterCreate?(vcon: VCon, context: RequestContext): Promise<void>;
  
  /** Called before reading a vCon. Throw to block access. */
  beforeRead?(uuid: string, context: RequestContext): Promise<void>;
  
  /** Called after reading vCon. Can modify returned data (e.g., redact PII). */
  afterRead?(vcon: VCon, context: RequestContext): Promise<VCon>;
  
  /** Called before updating a vCon */
  beforeUpdate?(uuid: string, updates: any, context: RequestContext): Promise<void>;
  
  /** Called after vCon updated */
  afterUpdate?(vcon: VCon, context: RequestContext): Promise<void>;
  
  /** Called before deleting a vCon. Throw to prevent deletion. */
  beforeDelete?(uuid: string, context: RequestContext): Promise<void>;
  
  /** Called after vCon deleted */
  afterDelete?(uuid: string, context: RequestContext): Promise<void>;
  
  /** Called before search. Can modify search criteria. */
  beforeSearch?(criteria: SearchCriteria, context: RequestContext): Promise<SearchCriteria>;
  
  /** Called after search. Can filter or modify results. */
  afterSearch?(results: VCon[], context: RequestContext): Promise<VCon[]>;
  
  // ========== Tool Registration ==========
  
  /** Register additional MCP tools */
  registerTools?(): Tool[];
  
  /** Register additional MCP resources */
  registerResources?(): Resource[];
  
  /** Handle a tool call */
  handleToolCall?(toolName: string, args: any, context: RequestContext): Promise<any>;
}

export interface RequestContext {
  /** User ID (if authenticated) */
  userId?: string;
  
  /** Purpose of access */
  purpose?: string;
  
  /** Client IP address */
  ipAddress?: string;
  
  /** Request timestamp */
  timestamp: Date;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface SearchCriteria {
  subject?: string;
  partyName?: string;
  partyEmail?: string;
  partyTel?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  [key: string]: any;
}

