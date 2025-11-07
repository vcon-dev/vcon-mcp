/**
 * Tests for server setup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer, initializeDatabase } from '../../src/server/setup.js';

// Mock database client
vi.mock('../../src/db/client.js', () => ({
  getSupabaseClient: vi.fn(() => ({})),
  getRedisClient: vi.fn(() => null),
}));

describe('Server Setup', () => {
  describe('createServer', () => {
    it('should create MCP server with correct configuration', () => {
      const server = createServer();
      expect(server).toBeDefined();
    });
  });

  describe('initializeDatabase', () => {
    it('should initialize database clients', () => {
      const result = initializeDatabase();

      expect(result).toHaveProperty('queries');
      expect(result).toHaveProperty('dbInspector');
      expect(result).toHaveProperty('dbAnalytics');
      expect(result).toHaveProperty('dbSizeAnalyzer');
      expect(result).toHaveProperty('supabase');
      expect(result).toHaveProperty('redis');
    });
  });
});

