/**
 * Validation Utilities Tests
 * 
 * Tests for handlers/validation.ts utilities
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  requireUUID,
  requireValidVCon,
  requireValidAnalysis,
  requireValidDialog,
  requireValidAttachment,
  requireValidParty,
  requireParam,
  requireNonEmptyString,
  requirePositiveInteger,
  requireNumberInRange,
  requireOneOf,
  requireObject,
  requireNonEmptyArray,
  requireValidDate,
  normalizeDateString,
} from '../../src/tools/handlers/validation.js';
import { VCon, Analysis, Dialog, Attachment, Party } from '../../src/types/vcon.js';

describe('Validation Utilities', () => {
  describe('requireUUID', () => {
    it('should return UUID if valid', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(requireUUID(uuid)).toBe(uuid);
    });

    it('should throw McpError if UUID is missing', () => {
      expect(() => requireUUID(undefined)).toThrow(McpError);
      expect(() => requireUUID(undefined)).toThrow('is required');
    });

    it('should throw McpError if UUID format is invalid', () => {
      expect(() => requireUUID('invalid-uuid')).toThrow(McpError);
      expect(() => requireUUID('not-a-uuid')).toThrow('Invalid');
    });

    it('should use custom param name in error message', () => {
      expect(() => requireUUID(undefined, 'vcon_uuid')).toThrow('vcon_uuid is required');
    });
  });

  describe('requireValidVCon', () => {
    it('should not throw for valid vCon', () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }],
      };
      expect(() => requireValidVCon(vcon)).not.toThrow();
    });

    it('should throw for invalid vCon', () => {
      const invalidVCon = {
        vcon: '0.2.0', // Wrong version
        uuid: 'invalid',
        created_at: 'invalid-date',
        parties: [],
      };
      expect(() => requireValidVCon(invalidVCon)).toThrow(McpError);
    });
  });

  describe('requireValidAnalysis', () => {
    it('should not throw for valid analysis', () => {
      const analysis: Analysis = {
        type: 'transcript',
        vendor: 'TestVendor',
        body: 'test',
        encoding: 'none',
      };
      expect(() => requireValidAnalysis(analysis)).not.toThrow();
    });

    it('should throw for analysis without vendor', () => {
      const analysis: any = {
        type: 'transcript',
        body: 'test',
      };
      expect(() => requireValidAnalysis(analysis)).toThrow(McpError);
    });
  });

  describe('requireValidDialog', () => {
    it('should not throw for valid dialog', () => {
      const dialog: Dialog = {
        type: 'text',
        body: 'test',
        encoding: 'none',
      };
      expect(() => requireValidDialog(dialog)).not.toThrow();
    });

    it('should throw for invalid dialog type', () => {
      const dialog: any = {
        type: 'invalid',
        body: 'test',
        encoding: 'none',
      };
      expect(() => requireValidDialog(dialog)).toThrow(McpError);
    });
  });

  describe('requireValidAttachment', () => {
    it('should not throw for valid attachment with body and encoding', () => {
      const attachment: Attachment = {
        body: 'test',
        encoding: 'none',
      };
      expect(() => requireValidAttachment(attachment)).not.toThrow();
    });

    it('should not throw for valid attachment with url and content_hash', () => {
      const attachment: Attachment = {
        url: 'https://example.com/file',
        content_hash: 'hash123',
      };
      expect(() => requireValidAttachment(attachment)).not.toThrow();
    });

    it('should throw for attachment without body+encoding or url+content_hash', () => {
      const attachment: Attachment = {
        body: 'test',
        // Missing encoding
      };
      expect(() => requireValidAttachment(attachment)).toThrow(McpError);
    });
  });

  describe('requireValidParty', () => {
    it('should not throw for valid party with name', () => {
      const party: Party = { name: 'Test User' };
      expect(() => requireValidParty(party)).not.toThrow();
    });

    it('should not throw for valid party with email', () => {
      const party: Party = { mailto: 'test@example.com' };
      expect(() => requireValidParty(party)).not.toThrow();
    });

    it('should throw for party without identifier', () => {
      const party: Party = {};
      expect(() => requireValidParty(party)).toThrow(McpError);
    });
  });

  describe('requireParam', () => {
    it('should return value if present', () => {
      expect(requireParam('value', 'param')).toBe('value');
      expect(requireParam(123, 'param')).toBe(123);
      expect(requireParam({ key: 'value' }, 'param')).toEqual({ key: 'value' });
    });

    it('should throw if value is undefined', () => {
      expect(() => requireParam(undefined, 'param')).toThrow(McpError);
      expect(() => requireParam(undefined, 'param')).toThrow('param is required');
    });

    it('should throw if value is null', () => {
      expect(() => requireParam(null, 'param')).toThrow(McpError);
    });
  });

  describe('requireNonEmptyString', () => {
    it('should return trimmed string if valid', () => {
      expect(requireNonEmptyString('  test  ', 'param')).toBe('test');
      expect(requireNonEmptyString('test', 'param')).toBe('test');
    });

    it('should throw if value is not a string', () => {
      expect(() => requireNonEmptyString(123, 'param')).toThrow(McpError);
      expect(() => requireNonEmptyString({}, 'param')).toThrow(McpError);
    });

    it('should throw if string is empty', () => {
      expect(() => requireNonEmptyString('', 'param')).toThrow(McpError);
      expect(() => requireNonEmptyString('   ', 'param')).toThrow(McpError);
    });
  });

  describe('requirePositiveInteger', () => {
    it('should return number if valid positive integer', () => {
      expect(requirePositiveInteger(1, 'param')).toBe(1);
      expect(requirePositiveInteger(100, 'param')).toBe(100);
      expect(requirePositiveInteger('5', 'param')).toBe(5);
    });

    it('should throw if not a positive integer', () => {
      expect(() => requirePositiveInteger(0, 'param')).toThrow(McpError);
      expect(() => requirePositiveInteger(-1, 'param')).toThrow(McpError);
      expect(() => requirePositiveInteger(1.5, 'param')).toThrow(McpError);
      expect(() => requirePositiveInteger('invalid', 'param')).toThrow(McpError);
    });
  });

  describe('requireNumberInRange', () => {
    it('should return number if in range', () => {
      expect(requireNumberInRange(5, 'param', 1, 10)).toBe(5);
      expect(requireNumberInRange(1, 'param', 1, 10)).toBe(1);
      expect(requireNumberInRange(10, 'param', 1, 10)).toBe(10);
    });

    it('should throw if out of range', () => {
      expect(() => requireNumberInRange(0, 'param', 1, 10)).toThrow(McpError);
      expect(() => requireNumberInRange(11, 'param', 1, 10)).toThrow(McpError);
    });
  });

  describe('requireOneOf', () => {
    it('should return value if in allowed values', () => {
      const allowed = ['a', 'b', 'c'] as const;
      expect(requireOneOf('a', 'param', allowed)).toBe('a');
      expect(requireOneOf('b', 'param', allowed)).toBe('b');
    });

    it('should throw if value not in allowed values', () => {
      const allowed = ['a', 'b', 'c'] as const;
      expect(() => requireOneOf('d', 'param', allowed)).toThrow(McpError);
      expect(() => requireOneOf('d', 'param', allowed)).toThrow('must be one of: a, b, c');
    });
  });

  describe('requireObject', () => {
    it('should return object if valid', () => {
      const obj = { key: 'value' };
      expect(requireObject(obj, 'param')).toBe(obj);
    });

    it('should throw if not an object', () => {
      expect(() => requireObject(null, 'param')).toThrow(McpError);
      expect(() => requireObject(undefined, 'param')).toThrow(McpError);
      expect(() => requireObject('string', 'param')).toThrow(McpError);
      expect(() => requireObject(123, 'param')).toThrow(McpError);
      expect(() => requireObject([], 'param')).toThrow(McpError);
    });
  });

  describe('requireNonEmptyArray', () => {
    it('should return array if valid', () => {
      const arr = [1, 2, 3];
      expect(requireNonEmptyArray(arr, 'param')).toBe(arr);
    });

    it('should throw if not an array', () => {
      expect(() => requireNonEmptyArray({}, 'param')).toThrow(McpError);
      expect(() => requireNonEmptyArray('string', 'param')).toThrow(McpError);
    });

    it('should throw if array is empty', () => {
      expect(() => requireNonEmptyArray([], 'param')).toThrow(McpError);
    });
  });

  describe('requireValidDate', () => {
    it('should return ISO string if valid', () => {
      const iso = '2025-01-15T14:30:00Z';
      expect(requireValidDate(iso, 'param')).toBe(iso);
    });

    it('should convert valid date to ISO format', () => {
      const date = '2025-01-15T14:30:00-05:00';
      const result = requireValidDate(date, 'param');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return undefined if value is undefined', () => {
      expect(requireValidDate(undefined, 'param')).toBeUndefined();
    });

    it('should throw if date is invalid', () => {
      expect(() => requireValidDate('invalid-date', 'param')).toThrow(McpError);
      expect(() => requireValidDate('not-a-date', 'param')).toThrow('Invalid');
    });
  });

  describe('normalizeDateString', () => {
    it('should return ISO string if valid', () => {
      const iso = '2025-01-15T14:30:00Z';
      expect(normalizeDateString(iso)).toBe(iso);
    });

    it('should return undefined if value is undefined', () => {
      expect(normalizeDateString(undefined)).toBeUndefined();
    });

    it('should return undefined if value is empty string', () => {
      expect(normalizeDateString('')).toBeUndefined();
      expect(normalizeDateString('   ')).toBeUndefined();
    });

    it('should convert valid date to ISO format', () => {
      const date = new Date('2025-01-15').toISOString();
      const result = normalizeDateString('2025-01-15');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return undefined for invalid dates', () => {
      expect(normalizeDateString('invalid-date')).toBeUndefined();
    });
  });
});

