/**
 * Registry Initialization Tests
 * 
 * Tests for handler registry initialization
 */

import { describe, it, expect } from 'vitest';
import { createHandlerRegistry } from '../../src/tools/handlers/index.js';
import { ToolHandlerRegistry } from '../../src/tools/handlers/registry.js';

describe('Handler Registry Initialization', () => {
  it('should create registry with all handlers registered', () => {
    const registry = createHandlerRegistry();

    expect(registry).toBeInstanceOf(ToolHandlerRegistry);
    expect(registry.size()).toBeGreaterThan(0);
  });

  it('should register all schema handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('get_schema')).toBe(true);
    expect(registry.has('get_examples')).toBe(true);
  });

  it('should register all vCon CRUD handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('create_vcon')).toBe(true);
    expect(registry.has('create_vcon_from_template')).toBe(true);
    expect(registry.has('get_vcon')).toBe(true);
    expect(registry.has('update_vcon')).toBe(true);
    expect(registry.has('delete_vcon')).toBe(true);
    expect(registry.has('add_analysis')).toBe(true);
    expect(registry.has('add_dialog')).toBe(true);
    expect(registry.has('add_attachment')).toBe(true);
  });

  it('should register all search handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('search_vcons')).toBe(true);
    expect(registry.has('search_vcons_content')).toBe(true);
    expect(registry.has('search_vcons_semantic')).toBe(true);
    expect(registry.has('search_vcons_hybrid')).toBe(true);
  });

  it('should register all tag handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('manage_tag')).toBe(true);
    expect(registry.has('get_tags')).toBe(true);
    expect(registry.has('remove_all_tags')).toBe(true);
    expect(registry.has('search_by_tags')).toBe(true);
    expect(registry.has('get_unique_tags')).toBe(true);
  });

  it('should register all database handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('get_database_shape')).toBe(true);
    expect(registry.has('get_database_stats')).toBe(true);
    expect(registry.has('analyze_query')).toBe(true);
  });

  it('should register all database analytics handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('get_database_analytics')).toBe(true);
    expect(registry.has('get_monthly_growth_analytics')).toBe(true);
    expect(registry.has('get_attachment_analytics')).toBe(true);
    expect(registry.has('get_tag_analytics')).toBe(true);
    expect(registry.has('get_content_analytics')).toBe(true);
    expect(registry.has('get_database_health_metrics')).toBe(true);
  });

  it('should register all database size handlers', () => {
    const registry = createHandlerRegistry();

    expect(registry.has('get_database_size_info')).toBe(true);
    expect(registry.has('get_smart_search_limits')).toBe(true);
  });

  it('should have correct total number of handlers', () => {
    const registry = createHandlerRegistry();
    const toolNames = registry.getToolNames();

    // Count expected handlers:
    // Schema: 2
    // CRUD: 8
    // Search: 4
    // Tags: 5
    // Database: 3
    // Analytics: 6
    // Size: 2
    // Total: 30
    expect(toolNames.length).toBe(30);
  });

  it('should allow retrieving handlers by name', () => {
    const registry = createHandlerRegistry();

    const handler = registry.get('get_vcon');
    expect(handler).toBeDefined();
    expect(handler?.toolName).toBe('get_vcon');
  });

  it('should return undefined for non-existent handler', () => {
    const registry = createHandlerRegistry();

    const handler = registry.get('nonexistent_tool');
    expect(handler).toBeUndefined();
  });
});

