/**
 * Tests for HTTP transport
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHttpTransport, getHttpTransportConfig } from '../../src/transport/http.js';

describe('HTTP Transport', () => {
  beforeEach(() => {
    // Reset environment variables
    delete process.env.MCP_HTTP_PORT;
    delete process.env.MCP_HTTP_HOST;
    delete process.env.MCP_HTTP_STATELESS;
    delete process.env.MCP_HTTP_JSON_ONLY;
    delete process.env.MCP_HTTP_ALLOWED_HOSTS;
    delete process.env.MCP_HTTP_ALLOWED_ORIGINS;
    delete process.env.MCP_HTTP_DNS_PROTECTION;
  });

  describe('getHttpTransportConfig', () => {
    it('should return default configuration', () => {
      const config = getHttpTransportConfig();

      expect(config.port).toBe(3000);
      expect(config.host).toBe('127.0.0.1');
      expect(config.stateless).toBe(false);
      expect(config.jsonOnly).toBe(false);
      expect(config.dnsProtection).toBe(false);
    });

    it('should read configuration from environment', () => {
      process.env.MCP_HTTP_PORT = '8080';
      process.env.MCP_HTTP_HOST = '0.0.0.0';
      process.env.MCP_HTTP_STATELESS = 'true';
      process.env.MCP_HTTP_JSON_ONLY = 'true';
      process.env.MCP_HTTP_DNS_PROTECTION = 'true';
      process.env.MCP_HTTP_ALLOWED_HOSTS = 'localhost,example.com';
      process.env.MCP_HTTP_ALLOWED_ORIGINS = 'http://localhost:3000';

      const config = getHttpTransportConfig();

      expect(config.port).toBe(8080);
      expect(config.host).toBe('0.0.0.0');
      expect(config.stateless).toBe(true);
      expect(config.jsonOnly).toBe(true);
      expect(config.dnsProtection).toBe(true);
      expect(config.allowedHosts).toEqual(['localhost', 'example.com']);
      expect(config.allowedOrigins).toEqual(['http://localhost:3000']);
    });
  });

  describe('createHttpTransport', () => {
    it('should create transport with default config', () => {
      const transport = createHttpTransport();
      expect(transport).toBeDefined();
    });

    it('should create transport with custom config', () => {
      const config = {
        stateless: true,
        jsonOnly: true,
        allowedHosts: ['localhost'],
      };
      const transport = createHttpTransport(config);
      expect(transport).toBeDefined();
    });

    it('should create stateless transport when stateless is true', () => {
      const config = { stateless: true };
      const transport = createHttpTransport(config);
      expect(transport).toBeDefined();
    });

    it('should create transport with allowed hosts', () => {
      const config = {
        allowedHosts: ['localhost', 'example.com'],
      };
      const transport = createHttpTransport(config);
      expect(transport).toBeDefined();
    });

    it('should create transport with allowed origins', () => {
      const config = {
        allowedOrigins: ['http://localhost:3000'],
      };
      const transport = createHttpTransport(config);
      expect(transport).toBeDefined();
    });

    it('should create transport with DNS protection enabled', () => {
      const config = {
        dnsProtection: true,
      };
      const transport = createHttpTransport(config);
      expect(transport).toBeDefined();
    });
  });
});

