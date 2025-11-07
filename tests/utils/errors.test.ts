/**
 * Tests for error utilities
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  extractErrorMessage,
  createMcpError,
  isDatabaseConnectionError,
  createDatabaseConnectionError,
} from '../../src/utils/errors.js';

describe('Error Utilities', () => {
  describe('extractErrorMessage', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Test error message');
      expect(extractErrorMessage(error)).toBe('Test error message');
    });

    it('should extract message from error object with message property', () => {
      const error = { message: 'Object error message' };
      expect(extractErrorMessage(error)).toBe('Object error message');
    });

    it('should extract message from error object with error property', () => {
      const error = { error: 'Nested error message' };
      expect(extractErrorMessage(error)).toBe('Nested error message');
    });

    it('should format Supabase-style errors', () => {
      const error = { code: 'PGRST116', message: 'Not found' };
      expect(extractErrorMessage(error)).toBe('PGRST116: Not found');
    });

    it('should handle string errors', () => {
      expect(extractErrorMessage('String error')).toBe('String error');
    });

    it('should handle unknown error types', () => {
      const error = { someProperty: 'value', another: 123 };
      const message = extractErrorMessage(error);
      // Should JSON stringify the object
      expect(message).toContain('someProperty');
      expect(message).toContain('value');
    });
  });

  describe('createMcpError', () => {
    it('should create MCP error from Error instance', () => {
      const error = new Error('Test error');
      const mcpError = createMcpError(error);

      expect(mcpError).toBeInstanceOf(McpError);
      expect(mcpError.code).toBe(ErrorCode.InternalError);
      expect(mcpError.message).toContain('Test error');
    });

    it('should create MCP error with custom code', () => {
      const error = new Error('Invalid input');
      const mcpError = createMcpError(error, ErrorCode.InvalidParams);

      expect(mcpError.code).toBe(ErrorCode.InvalidParams);
    });
  });

  describe('isDatabaseConnectionError', () => {
    it('should identify database connection errors', () => {
      const error = new TypeError('fetch failed');
      expect(isDatabaseConnectionError(error)).toBe(true);
    });

    it('should return false for other errors', () => {
      const error = new Error('Other error');
      expect(isDatabaseConnectionError(error)).toBe(false);
    });
  });

  describe('createDatabaseConnectionError', () => {
    it('should create user-friendly database connection error', () => {
      const error = new TypeError('fetch failed: ECONNREFUSED');
      const mcpError = createDatabaseConnectionError(error);

      expect(mcpError).toBeInstanceOf(McpError);
      expect(mcpError.code).toBe(ErrorCode.InternalError);
      expect(mcpError.message).toContain('Database connection failed');
      expect(mcpError.message).toContain('SUPABASE_URL');
    });
  });
});

