/**
 * Tests for response utilities
 */

import { describe, it, expect } from 'vitest';
import { createTextResponse, createSuccessResponse, createErrorResponse } from '../../src/utils/responses.js';

describe('Response Utilities', () => {
  describe('createTextResponse', () => {
    it('should create a text response from JSON data', () => {
      const data = { message: 'test', value: 123 };
      const response = createTextResponse(data);

      expect(response).toHaveProperty('content');
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toHaveProperty('type', 'text');
      expect(response.content[0]).toHaveProperty('text');
      expect(JSON.parse(response.content[0].text)).toEqual(data);
    });

    it('should handle nested objects', () => {
      const data = { nested: { deep: { value: 'test' } } };
      const response = createTextResponse(data);
      expect(JSON.parse(response.content[0].text)).toEqual(data);
    });
  });

  describe('createSuccessResponse', () => {
    it('should create a success response with data', () => {
      const data = { result: 'success', count: 5 };
      const response = createSuccessResponse(data);
      const parsed = JSON.parse(response.content[0].text);

      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('result', 'success');
      expect(parsed).toHaveProperty('count', 5);
    });

    it('should create a success response without data', () => {
      const response = createSuccessResponse();
      const parsed = JSON.parse(response.content[0].text);

      expect(parsed).toHaveProperty('success', true);
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response with message', () => {
      const response = createErrorResponse('Test error');
      const parsed = JSON.parse(response.content[0].text);

      expect(parsed).toHaveProperty('success', false);
      expect(parsed).toHaveProperty('error', 'Test error');
    });

    it('should create an error response with details', () => {
      const details = { code: 'ERR001', field: 'name' };
      const response = createErrorResponse('Validation failed', details);
      const parsed = JSON.parse(response.content[0].text);

      expect(parsed).toHaveProperty('success', false);
      expect(parsed).toHaveProperty('error', 'Validation failed');
      expect(parsed).toHaveProperty('details', details);
    });
  });
});

