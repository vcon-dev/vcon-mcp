/**
 * VConService Tests
 * 
 * Tests for the unified vCon lifecycle service including hooks, validation, and metrics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { VConService, VConValidationError } from '../../src/services/vcon-service.js';
import { VCon } from '../../src/types/vcon.js';
import { VConQueries } from '../../src/db/queries.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';

// Mock observability
vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
}));

vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_VCON_UUID: 'vcon.uuid',
}));

describe('VConService', () => {
  let service: VConService;
  let mockQueries: any;
  let mockPluginManager: any;

  beforeEach(() => {
    mockQueries = {
      createVCon: vi.fn(),
      getVCon: vi.fn(),
      deleteVCon: vi.fn(),
      searchVCons: vi.fn(),
    };

    mockPluginManager = {
      executeHook: vi.fn(),
    };

    service = new VConService({
      queries: mockQueries as unknown as VConQueries,
      pluginManager: mockPluginManager as unknown as PluginManager,
    });
  });

  describe('create', () => {
    it('should create a vCon with auto-generated UUID and timestamp', async () => {
      const createdUuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await service.create({
        parties: [{ name: 'Test User' }],
      });

      expect(result.uuid).toBe(createdUuid);
      expect(result.vcon.vcon).toBe('0.3.0');
      expect(result.vcon.uuid).toBeDefined();
      expect(result.vcon.created_at).toBeDefined();
      expect(result.vcon.parties).toEqual([{ name: 'Test User' }]);
    });

    it('should call beforeCreate hook before saving', async () => {
      const createdUuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.create({
        parties: [{ name: 'Test User' }],
      });

      // Verify beforeCreate was called with the vCon and request context
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'beforeCreate',
        expect.objectContaining({
          vcon: '0.3.0',
          parties: [{ name: 'Test User' }],
        }),
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should call afterCreate hook after saving', async () => {
      const createdUuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.create({
        parties: [{ name: 'Test User' }],
      });

      // Verify afterCreate was called
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'afterCreate',
        expect.objectContaining({
          vcon: '0.3.0',
          parties: [{ name: 'Test User' }],
        }),
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should apply modifications from beforeCreate hook', async () => {
      const createdUuid = randomUUID();
      const modifiedVCon: VCon = {
        vcon: '0.3.0',
        uuid: createdUuid,
        created_at: new Date().toISOString(),
        subject: 'Modified by plugin',
        parties: [{ name: 'Test User' }],
      };

      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'beforeCreate') return Promise.resolve(modifiedVCon);
        return Promise.resolve(undefined);
      });

      const result = await service.create({
        parties: [{ name: 'Test User' }],
      });

      // The modified vCon should be saved
      expect(mockQueries.createVCon).toHaveBeenCalledWith(modifiedVCon);
      expect(result.vcon.subject).toBe('Modified by plugin');
    });

    it('should throw if beforeCreate hook throws', async () => {
      mockPluginManager.executeHook.mockRejectedValue(new Error('Plugin blocked creation'));

      await expect(service.create({
        parties: [{ name: 'Test User' }],
      })).rejects.toThrow('Plugin blocked creation');

      // createVCon should not be called
      expect(mockQueries.createVCon).not.toHaveBeenCalled();
    });

    it('should validate vCon before saving', async () => {
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      // Empty parties should fail validation
      await expect(service.create({
        parties: [],
      })).rejects.toThrow(VConValidationError);

      expect(mockQueries.createVCon).not.toHaveBeenCalled();
    });

    it('should skip hooks when skipHooks option is true', async () => {
      const createdUuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });

      await service.create(
        { parties: [{ name: 'Test User' }] },
        { skipHooks: true }
      );

      expect(mockPluginManager.executeHook).not.toHaveBeenCalled();
    });

    it('should skip validation when skipValidation option is true', async () => {
      const createdUuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      // Empty parties would normally fail, but skipValidation bypasses it
      const result = await service.create(
        { parties: [] },
        { skipValidation: true }
      );

      expect(result.uuid).toBe(createdUuid);
    });

    it('should pass source to request context', async () => {
      const createdUuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid: createdUuid, id: '1' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.create(
        { parties: [{ name: 'Test User' }] },
        { source: 'rest-api' }
      );

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'beforeCreate',
        expect.any(Object),
        expect.objectContaining({
          purpose: 'rest-api',
        })
      );
    });
  });

  describe('createBatch', () => {
    it('should create multiple vCons', async () => {
      mockQueries.createVCon
        .mockResolvedValueOnce({ uuid: 'uuid-1', id: '1' })
        .mockResolvedValueOnce({ uuid: 'uuid-2', id: '2' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await service.createBatch([
        { parties: [{ name: 'User 1' }] },
        { parties: [{ name: 'User 2' }] },
      ]);

      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
    });

    it('should continue processing on individual failures', async () => {
      mockQueries.createVCon
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ uuid: 'uuid-2', id: '2' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await service.createBatch([
        { parties: [{ name: 'User 1' }] },
        { parties: [{ name: 'User 2' }] },
      ]);

      expect(result.total).toBe(2);
      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('DB error');
      expect(result.results[1].success).toBe(true);
    });

    it('should call hooks for each vCon in batch', async () => {
      mockQueries.createVCon
        .mockResolvedValueOnce({ uuid: 'uuid-1', id: '1' })
        .mockResolvedValueOnce({ uuid: 'uuid-2', id: '2' });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.createBatch([
        { parties: [{ name: 'User 1' }] },
        { parties: [{ name: 'User 2' }] },
      ]);

      // beforeCreate and afterCreate should be called twice each
      const beforeCreateCalls = mockPluginManager.executeHook.mock.calls
        .filter((call: any[]) => call[0] === 'beforeCreate');
      const afterCreateCalls = mockPluginManager.executeHook.mock.calls
        .filter((call: any[]) => call[0] === 'afterCreate');

      expect(beforeCreateCalls).toHaveLength(2);
      expect(afterCreateCalls).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should retrieve a vCon by UUID', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test User' }],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await service.get(testVCon.uuid!);

      expect(result).toEqual(testVCon);
      expect(mockQueries.getVCon).toHaveBeenCalledWith(testVCon.uuid);
    });

    it('should call beforeRead hook before fetching', async () => {
      const uuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.get(uuid);

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'beforeRead',
        uuid,
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should call afterRead hook after fetching', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.get(testVCon.uuid!);

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'afterRead',
        testVCon,
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should apply modifications from afterRead hook', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test User' }],
      };
      const filteredVCon = { ...testVCon, subject: 'Filtered by plugin' };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'afterRead') return Promise.resolve(filteredVCon);
        return Promise.resolve(undefined);
      });

      const result = await service.get(testVCon.uuid!);

      expect(result.subject).toBe('Filtered by plugin');
    });

    it('should throw if beforeRead hook throws (access blocked)', async () => {
      const uuid = randomUUID();
      mockPluginManager.executeHook.mockRejectedValue(new Error('Access denied'));

      await expect(service.get(uuid)).rejects.toThrow('Access denied');

      // getVCon should not be called
      expect(mockQueries.getVCon).not.toHaveBeenCalled();
    });

    it('should skip hooks when skipHooks option is true', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);

      await service.get(testVCon.uuid!, { skipHooks: true });

      expect(mockPluginManager.executeHook).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a vCon by UUID', async () => {
      const uuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockQueries.deleteVCon.mockResolvedValue(undefined);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await service.delete(uuid);

      expect(result).toBe(true);
      expect(mockQueries.deleteVCon).toHaveBeenCalledWith(uuid);
    });

    it('should return false if vCon not found', async () => {
      const uuid = randomUUID();
      mockQueries.getVCon.mockRejectedValue(new Error('Not found'));

      const result = await service.delete(uuid);

      expect(result).toBe(false);
      expect(mockQueries.deleteVCon).not.toHaveBeenCalled();
    });

    it('should call beforeDelete hook before deleting', async () => {
      const uuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockQueries.deleteVCon.mockResolvedValue(undefined);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.delete(uuid);

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'beforeDelete',
        uuid,
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should call afterDelete hook after deleting', async () => {
      const uuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockQueries.deleteVCon.mockResolvedValue(undefined);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.delete(uuid);

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'afterDelete',
        uuid,
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should throw if beforeDelete hook throws (deletion blocked)', async () => {
      const uuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockRejectedValue(new Error('Deletion blocked'));

      await expect(service.delete(uuid)).rejects.toThrow('Deletion blocked');

      // deleteVCon should not be called
      expect(mockQueries.deleteVCon).not.toHaveBeenCalled();
    });

    it('should skip hooks when skipHooks option is true', async () => {
      const uuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockQueries.deleteVCon.mockResolvedValue(undefined);

      await service.delete(uuid, { skipHooks: true });

      expect(mockPluginManager.executeHook).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('should search vCons with filters', async () => {
      const testVCons: VCon[] = [
        { vcon: '0.3.0', uuid: randomUUID(), created_at: new Date().toISOString(), parties: [] },
        { vcon: '0.3.0', uuid: randomUUID(), created_at: new Date().toISOString(), parties: [] },
      ];

      mockQueries.searchVCons.mockResolvedValue(testVCons);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await service.search({ subject: 'test' });

      expect(result).toEqual(testVCons);
      expect(mockQueries.searchVCons).toHaveBeenCalledWith({ subject: 'test' });
    });

    it('should call beforeSearch hook to modify criteria', async () => {
      const testVCons: VCon[] = [];
      mockQueries.searchVCons.mockResolvedValue(testVCons);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.search({ subject: 'test' });

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'beforeSearch',
        { subject: 'test' },
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should apply modified criteria from beforeSearch hook', async () => {
      const modifiedFilters = { subject: 'modified', limit: 5 };
      mockQueries.searchVCons.mockResolvedValue([]);
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'beforeSearch') return Promise.resolve(modifiedFilters);
        return Promise.resolve(undefined);
      });

      await service.search({ subject: 'original' });

      expect(mockQueries.searchVCons).toHaveBeenCalledWith(modifiedFilters);
    });

    it('should call afterSearch hook to filter results', async () => {
      const testVCons: VCon[] = [
        { vcon: '0.3.0', uuid: randomUUID(), created_at: new Date().toISOString(), parties: [] },
      ];

      mockQueries.searchVCons.mockResolvedValue(testVCons);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await service.search({});

      expect(mockPluginManager.executeHook).toHaveBeenCalledWith(
        'afterSearch',
        testVCons,
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should apply filtered results from afterSearch hook', async () => {
      const testVCons: VCon[] = [
        { vcon: '0.3.0', uuid: 'uuid-1', created_at: new Date().toISOString(), parties: [] },
        { vcon: '0.3.0', uuid: 'uuid-2', created_at: new Date().toISOString(), parties: [] },
      ];
      const filteredVCons = [testVCons[0]]; // Plugin filters out second result

      mockQueries.searchVCons.mockResolvedValue(testVCons);
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'afterSearch') return Promise.resolve(filteredVCons);
        return Promise.resolve(undefined);
      });

      const result = await service.search({});

      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe('uuid-1');
    });
  });

  describe('VConValidationError', () => {
    it('should contain validation errors', () => {
      const error = new VConValidationError(['Error 1', 'Error 2']);

      expect(error.name).toBe('VConValidationError');
      expect(error.errors).toEqual(['Error 1', 'Error 2']);
      expect(error.message).toContain('Error 1');
      expect(error.message).toContain('Error 2');
    });
  });
});

