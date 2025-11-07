/**
 * Tests for Database Inspector
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseInspector } from '../../src/db/database-inspector.js';

describe('Database Inspector', () => {
  let inspector: DatabaseInspector;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
    };

    inspector = new DatabaseInspector(mockSupabase);
  });

  describe('getDatabaseShape', () => {
    it('should return database shape with default options', async () => {
      mockSupabase.rpc
        // First call: Get tables list
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
              total_size: '1 MB',
              table_size: '800 kB',
              indexes_size: '200 kB',
              hasindexes: true,
            },
          ],
          error: null,
        })
        // Second call: Get row count for vcons table
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        // Third call: Get indexes for vcons table
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        // Fourth call: Get relationships (foreign keys)
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({});

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('tables');
      expect(Array.isArray(result.tables)).toBe(true);
    });

    it('should include table sizes when includeSizes is true', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
              total_size: '1 MB',
              table_size: '800 kB',
              indexes_size: '200 kB',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeSizes: true,
      });

      expect(result.tables[0]).toHaveProperty('total_size');
      expect(result.tables[0]).toHaveProperty('table_size');
      expect(result.tables[0]).toHaveProperty('indexes_size');
    });

    it('should exclude table sizes when includeSizes is false', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
              hasindexes: true,
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeSizes: false,
      });

      expect(result.tables[0]).not.toHaveProperty('total_size');
    });

    it('should include row counts when includeCounts is true', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeCounts: true,
      });

      expect(result.tables[0]).toHaveProperty('row_count', 100);
    });

    it('should exclude row counts when includeCounts is false', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeCounts: false,
      });

      expect(result.tables[0]).not.toHaveProperty('row_count');
    });

    it('should include columns when includeColumns is true', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [
            {
              column_name: 'id',
              data_type: 'uuid',
              is_nullable: 'NO',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeColumns: true,
      });

      expect(result.tables[0]).toHaveProperty('columns');
      expect(Array.isArray(result.tables[0].columns)).toBe(true);
    });

    it('should exclude columns when includeColumns is false', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeColumns: false,
      });

      expect(result.tables[0]).not.toHaveProperty('columns');
    });

    it('should include indexes when includeIndexes is true', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [
            {
              tablename: 'vcons',
              schemaname: 'public',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ count: '100' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [
            {
              indexname: 'idx_vcons_uuid',
              indexdef: 'CREATE INDEX idx_vcons_uuid ON vcons(uuid)',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await inspector.getDatabaseShape({
        includeIndexes: true,
      });

      expect(result.tables[0]).toHaveProperty('indexes');
      expect(Array.isArray(result.tables[0].indexes)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors in getDatabaseShape', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Database error'));

      await expect(inspector.getDatabaseShape({})).rejects.toThrow('Database error');
    });

    it('should handle RPC errors gracefully', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [{ tablename: 'vcons', schemaname: 'public' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'Count query failed' },
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      // Should handle count error gracefully
      const result = await inspector.getDatabaseShape({
        includeCounts: true,
      });

      expect(result.tables[0]).not.toHaveProperty('row_count');
    });
  });
});

