/**
 * Resources Endpoint Tests
 * Tests for MCP resources endpoint (ListResources and ReadResource)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VConQueries } from '../src/db/queries.js';
import { getCoreResources, resolveCoreResource } from '../src/resources/index.js';
import { VCon } from '../src/types/vcon.js';

describe('Resources Endpoint Tests', () => {
  let queries: VConQueries;
  let mockSupabase: any;

  beforeEach(() => {
    // Create a chainable mock that returns itself for all methods
    const createChainableMock = () => {
      const mock: any = {
        from: vi.fn(),
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        eq: vi.fn(),
        single: vi.fn(),
        limit: vi.fn(),
        order: vi.fn(),
        ilike: vi.fn(),
        gte: vi.fn(),
        lte: vi.fn(),
        or: vi.fn(),
      };

      // Make all methods return the mock itself for chaining
      Object.keys(mock).forEach(key => {
        if (key !== 'single') {
          mock[key].mockReturnValue(mock);
        }
      });

      return mock;
    };

    mockSupabase = createChainableMock();
    queries = new VConQueries(mockSupabase);
  });

  describe('getCoreResources', () => {
    it('should return all expected core resources', () => {
      const resources = getCoreResources();

      expect(resources).toHaveLength(12);
      expect(resources.map(r => r.uri)).toEqual([
        'vcon://v1/vcons/recent',
        'vcon://v1/vcons/recent/ids',
        'vcon://v1/vcons/ids',
        'vcon://v1/vcons/{uuid}',
        'vcon://v1/vcons/{uuid}/metadata',
        'vcon://v1/vcons/{uuid}/parties',
        'vcon://v1/vcons/{uuid}/dialog',
        'vcon://v1/vcons/{uuid}/analysis',
        'vcon://v1/vcons/{uuid}/attachments',
        'vcon://v1/vcons/{uuid}/transcript',
        'vcon://v1/vcons/{uuid}/summary',
        'vcon://v1/vcons/{uuid}/tags',
      ]);
    });

    it('should return resources with correct structure', () => {
      const resources = getCoreResources();

      resources.forEach(resource => {
        expect(resource).toHaveProperty('uri');
        expect(resource).toHaveProperty('name');
        expect(resource).toHaveProperty('description');
        expect(resource).toHaveProperty('mimeType');
        expect(resource.mimeType).toBe('application/json');
        expect(typeof resource.uri).toBe('string');
        expect(typeof resource.name).toBe('string');
        expect(typeof resource.description).toBe('string');
      });
    });

    it('should include vcon://v1/vcons/{uuid} resource', () => {
      const resources = getCoreResources();
      const uuidResource = resources.find(r => r.uri === 'vcon://v1/vcons/{uuid}');

      expect(uuidResource).toBeDefined();
      expect(uuidResource?.name).toBe('Get vCon by UUID');
      expect(uuidResource?.mimeType).toBe('application/json');
    });
  });

  describe('resolveCoreResource - Recent vCons', () => {
    it('should return recent vCons with default limit of 10', async () => {
      const mockVCons: VCon[] = Array.from({ length: 10 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date().toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/recent');

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('count', 10);
      expect(result?.content).toHaveProperty('limit', 10);
      expect(result?.content).toHaveProperty('vcons');
      expect(result?.content.vcons).toHaveLength(10);
      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 10 });
    });

    it('should return recent vCons with custom limit', async () => {
      const mockVCons: VCon[] = Array.from({ length: 25 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date().toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/recent/25');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('limit', 25);
      expect(result?.content.vcons).toHaveLength(25);
      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 25 });
    });

    it('should enforce max limit of 100', async () => {
      vi.spyOn(queries, 'searchVCons').mockResolvedValue([]);

      resolveCoreResource(queries, 'vcon://v1/vcons/recent/200');

      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 100 });
    });

    it('should handle empty results', async () => {
      vi.spyOn(queries, 'searchVCons').mockResolvedValue([]);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/recent');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('count', 0);
      expect(result?.content.vcons).toHaveLength(0);
    });
  });

  describe('resolveCoreResource - Recent vCon IDs', () => {
    it('should return recent vCon IDs with default limit of 10', async () => {
      const mockVCons: VCon[] = Array.from({ length: 10 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/recent/ids');

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('count', 10);
      expect(result?.content).toHaveProperty('limit', 10);
      expect(result?.content).toHaveProperty('vcons');
      expect(result?.content.vcons).toHaveLength(10);
      
      // Check that only uuid, created_at, and subject are included
      result?.content.vcons.forEach((vcon: any) => {
        expect(vcon).toHaveProperty('uuid');
        expect(vcon).toHaveProperty('created_at');
        expect(vcon).toHaveProperty('subject');
        expect(vcon).not.toHaveProperty('parties');
        expect(vcon).not.toHaveProperty('dialog');
        expect(vcon).not.toHaveProperty('analysis');
      });
    });

    it('should return recent vCon IDs with custom limit', async () => {
      const mockVCons: VCon[] = Array.from({ length: 50 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date().toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/recent/ids/50');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('limit', 50);
      expect(result?.content.vcons).toHaveLength(50);
      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 50 });
    });

    it('should enforce max limit of 100 for recent IDs', async () => {
      vi.spyOn(queries, 'searchVCons').mockResolvedValue([]);

      resolveCoreResource(queries, 'vcon://v1/vcons/recent/ids/200');

      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 100 });
    });
  });

  describe('resolveCoreResource - List All IDs', () => {
    it('should return list of IDs with default limit of 100', async () => {
      const mockVCons: VCon[] = Array.from({ length: 100 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/ids');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('count', 100);
      expect(result?.content).toHaveProperty('limit', 100);
      expect(result?.content).toHaveProperty('has_more', false);
      expect(result?.content).toHaveProperty('next_cursor', null);
      expect(result?.content).toHaveProperty('vcons');
      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 101 }); // Fetch one extra
    });

    it('should return list of IDs with custom limit', async () => {
      const mockVCons: VCon[] = Array.from({ length: 500 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/ids/500');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('limit', 500);
      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 501 }); // Fetch one extra
    });

    it('should enforce max limit of 1000', async () => {
      vi.spyOn(queries, 'searchVCons').mockResolvedValue([]);

      resolveCoreResource(queries, 'vcon://v1/vcons/ids/2000');

      expect(queries.searchVCons).toHaveBeenCalledWith({ limit: 1001 }); // Fetch one extra
    });

    it('should indicate has_more when more results exist', async () => {
      // Return 101 items to indicate more exist
      const mockVCons: VCon[] = Array.from({ length: 101 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/ids/100');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('has_more', true);
      expect(result?.content).toHaveProperty('next_cursor');
      expect(result?.content.next_cursor).toBeTruthy();
      expect(result?.content.vcons).toHaveLength(100); // Should return only 100
    });

    it('should handle pagination with after parameter', async () => {
      const afterTimestamp = '2024-01-01T00:00:00Z';
      const mockVCons: VCon[] = Array.from({ length: 50 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/ids/50/after/${encodeURIComponent(afterTimestamp)}`);

      expect(result).toBeDefined();
      expect(queries.searchVCons).toHaveBeenCalledWith({
        limit: 51,
        startDate: expect.stringContaining('2024-01-01'),
      });
    });

    it('should return null next_cursor when no more results', async () => {
      const mockVCons: VCon[] = Array.from({ length: 50 }, (_, i) => ({
        vcon: '0.3.0',
        uuid: `test-uuid-${i}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        subject: `Test vCon ${i}`,
        parties: [],
      }));

      vi.spyOn(queries, 'searchVCons').mockResolvedValue(mockVCons);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/ids/100');

      expect(result).toBeDefined();
      expect(result?.content).toHaveProperty('has_more', false);
      expect(result?.content.next_cursor).toBeNull();
    });
  });

  describe('resolveCoreResource - UUID-based Resources', () => {
    const testUuid = '123e4567-e89b-12d3-a456-426614174000';
    const mockVCon: VCon = {
      vcon: '0.3.0',
      uuid: testUuid,
      created_at: '2024-01-01T00:00:00Z',
      subject: 'Test vCon',
      parties: [
        { name: 'Alice', mailto: 'alice@example.com', uuid: 'party-uuid-1' },
      ],
      dialog: [
        { type: 'text', body: 'Hello', encoding: 'none' },
      ],
      analysis: [
        { type: 'summary', vendor: 'TestVendor', body: 'Summary', encoding: 'none' },
      ],
      attachments: [
        { type: 'document', body: 'attachment', encoding: 'none' },
      ],
    };

    it('should return full vCon by UUID', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toEqual(mockVCon);
      expect(queries.getVCon).toHaveBeenCalledWith(testUuid);
    });

    it('should return full vCon by UUID with trailing slash', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/`);

      expect(result).toBeDefined();
      expect(result?.content).toEqual(mockVCon);
    });

    it('should return metadata only for metadata endpoint', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/metadata`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('vcon');
      expect(result?.content).toHaveProperty('uuid');
      expect(result?.content).toHaveProperty('created_at');
      expect(result?.content).toHaveProperty('subject');
      expect(result?.content).not.toHaveProperty('parties');
      expect(result?.content).not.toHaveProperty('dialog');
      expect(result?.content).not.toHaveProperty('analysis');
      expect(result?.content).not.toHaveProperty('attachments');
    });

    it('should return undefined for invalid UUID format', async () => {
      vi.spyOn(queries, 'getVCon');
      
      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/invalid-uuid');

      expect(result).toBeUndefined();
      expect(queries.getVCon).not.toHaveBeenCalled();
    });

    it('should return undefined for unsupported UUID suffix', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/unsupported`);

      expect(result).toBeUndefined();
    });
  });

  describe('resolveCoreResource - Error Cases', () => {
    it('should return undefined for unknown URI', async () => {
      const result = await resolveCoreResource(queries, 'vcon://v1/unknown/resource');

      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid URI format', async () => {
      const result = await resolveCoreResource(queries, 'not-a-valid-uri');

      expect(result).toBeUndefined();
    });

    it('should handle database errors gracefully', async () => {
      vi.spyOn(queries, 'searchVCons').mockRejectedValue(new Error('Database error'));

      await expect(
        resolveCoreResource(queries, 'vcon://v1/vcons/recent')
      ).rejects.toThrow('Database error');
    });

    it('should handle getVCon errors gracefully', async () => {
      const testUuid = '123e4567-e89b-12d3-a456-426614174000';
      vi.spyOn(queries, 'getVCon').mockRejectedValue(new Error('vCon not found'));

      await expect(
        resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}`)
      ).rejects.toThrow('vCon not found');
    });
  });

  describe('Resource Response Format', () => {
    it('should return JSON mime type for all resources', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        created_at: new Date().toISOString(),
        subject: 'Test',
        parties: [],
      };

      vi.spyOn(queries, 'searchVCons').mockResolvedValue([mockVCon]);
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const recentResult = await resolveCoreResource(queries, 'vcon://v1/vcons/recent');
      const uuidResult = await resolveCoreResource(queries, 'vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000');

      expect(recentResult?.mimeType).toBe('application/json');
      expect(uuidResult?.mimeType).toBe('application/json');
    });

    it('should format content as JSON-serializable objects', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        created_at: new Date().toISOString(),
        subject: 'Test',
        parties: [],
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, 'vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000');

      // Should be able to JSON.stringify without errors
      expect(() => JSON.stringify(result?.content)).not.toThrow();
    });
  });

  describe('Subresource endpoints', () => {
    const testUuid = '123e4567-e89b-12d3-a456-426614174000';
    const mockVCon: VCon = {
      vcon: '0.3.0',
      uuid: testUuid,
      created_at: new Date().toISOString(),
      subject: 'Test vCon',
      parties: [
        { name: 'Alice', mailto: 'alice@example.com' },
        { name: 'Bob', tel: '+1-555-1234' }
      ],
      dialog: [
        { type: 'text', start: '2024-01-01T10:00:00Z', parties: [0, 1], body: 'Hello' }
      ],
      analysis: [
        { type: 'sentiment', vendor: 'TestVendor', body: '{"score": 0.8}' },
        { type: 'summary', vendor: 'TestVendor', body: 'Test summary' }
      ],
      attachments: [
        { type: 'tags', encoding: 'json', body: '["key1:value1", "key2:value2"]' },
        { type: 'document', filename: 'test.pdf' }
      ]
    };

    it('should return parties subresource', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/parties`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('parties');
      expect(result?.content.parties).toHaveLength(2);
      expect(result?.content.parties[0]).toHaveProperty('name', 'Alice');
    });

    it('should return dialog subresource', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/dialog`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('dialog');
      expect(result?.content.dialog).toHaveLength(1);
      expect(result?.content.dialog[0]).toHaveProperty('type', 'text');
    });

    it('should return analysis subresource', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/analysis`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('analysis');
      expect(result?.content.analysis).toHaveLength(2);
    });

    it('should return attachments subresource', async () => {
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/attachments`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('attachments');
      expect(result?.content.attachments).toHaveLength(2);
    });

    it('should return empty arrays for missing subresources', async () => {
      const minimalVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Minimal vCon',
        parties: []
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(minimalVCon);

      const dialogResult = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/dialog`);
      const analysisResult = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/analysis`);
      const attachmentsResult = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/attachments`);

      expect(dialogResult?.content.dialog).toEqual([]);
      expect(analysisResult?.content.analysis).toEqual([]);
      expect(attachmentsResult?.content.attachments).toEqual([]);
    });
  });

  describe('Derived resource endpoints', () => {
    const testUuid = '123e4567-e89b-12d3-a456-426614174000';

    it('should return transcript derived resource', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Test vCon',
        parties: [],
        analysis: [
          { type: 'transcript', vendor: 'Google', body: 'Hello world' },
          { type: 'summary', vendor: 'OpenAI', body: 'Test summary' },
          { type: 'transcript', vendor: 'Azure', body: 'Another transcript' }
        ]
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/transcript`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('count', 2);
      expect(result?.content).toHaveProperty('transcripts');
      expect(result?.content.transcripts).toHaveLength(2);
      expect(result?.content.transcripts[0].type).toBe('transcript');
      expect(result?.content.transcripts[1].type).toBe('transcript');
    });

    it('should return summary derived resource', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Test vCon',
        parties: [],
        analysis: [
          { type: 'summary', vendor: 'OpenAI', body: 'Summary 1' },
          { type: 'transcript', vendor: 'Google', body: 'Transcript' },
          { type: 'summary', vendor: 'Anthropic', body: 'Summary 2' }
        ]
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/summary`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('count', 2);
      expect(result?.content).toHaveProperty('summaries');
      expect(result?.content.summaries).toHaveLength(2);
      expect(result?.content.summaries[0].type).toBe('summary');
      expect(result?.content.summaries[1].type).toBe('summary');
    });

    it('should return tags derived resource', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Test vCon',
        parties: [],
        attachments: [
          { type: 'tags', encoding: 'json', body: '["department:sales", "priority:high", "status:open"]' },
          { type: 'document', filename: 'test.pdf' }
        ]
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/tags`);

      expect(result).toBeDefined();
      expect(result?.mimeType).toBe('application/json');
      expect(result?.content).toHaveProperty('tags');
      expect(result?.content.tags).toEqual({
        department: 'sales',
        priority: 'high',
        status: 'open'
      });
    });

    it('should return empty tags object when no tags exist', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Test vCon',
        parties: [],
        attachments: [
          { type: 'document', filename: 'test.pdf' }
        ]
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/tags`);

      expect(result).toBeDefined();
      expect(result?.content.tags).toEqual({});
    });

    it('should handle malformed tags gracefully', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Test vCon',
        parties: [],
        attachments: [
          { type: 'tags', encoding: 'json', body: 'invalid json' }
        ]
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const result = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/tags`);

      expect(result).toBeDefined();
      expect(result?.content.tags).toEqual({});
    });

    it('should return empty arrays for derived resources when no matches', async () => {
      const mockVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Test vCon',
        parties: [],
        analysis: [
          { type: 'sentiment', vendor: 'TestVendor', body: '{}' }
        ]
      };

      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon);

      const transcriptResult = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/transcript`);
      const summaryResult = await resolveCoreResource(queries, `vcon://v1/vcons/${testUuid}/summary`);

      expect(transcriptResult?.content.count).toBe(0);
      expect(transcriptResult?.content.transcripts).toEqual([]);
      expect(summaryResult?.content.count).toBe(0);
      expect(summaryResult?.content.summaries).toEqual([]);
    });
  });
});
