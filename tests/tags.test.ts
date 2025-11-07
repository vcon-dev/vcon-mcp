/**
 * Tag Management Tests
 * 
 * Tests for vCon tag functionality including:
 * - Adding tags
 * - Getting tags
 * - Updating tags
 * - Removing tags
 * - Searching by tags
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';
import { VCon } from '../src/types/vcon.js';

describe('Tag Management', () => {
  let queries: VConQueries;
  let testVConUuid: string;

  beforeAll(async () => {
    const supabase = getSupabaseClient();
    queries = new VConQueries(supabase);

    // Create a test vCon
    const testVCon: VCon = {
      vcon: '0.3.0',
      uuid: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      subject: 'Test vCon for Tags',
      parties: [
        { name: 'Test User' }
      ]
    };

    const result = await queries.createVCon(testVCon);
    testVConUuid = result.uuid;
  });

  afterAll(async () => {
    // Clean up test vCon
    if (testVConUuid) {
      await queries.deleteVCon(testVConUuid);
    }
  });

  describe('Add and Get Tags', () => {
    it('should add a string tag', async () => {
      await queries.addTag(testVConUuid, 'department', 'sales');
      const value = await queries.getTag(testVConUuid, 'department');
      expect(value).toBe('sales');
    });

    it('should add a number tag', async () => {
      await queries.addTag(testVConUuid, 'priority', 5);
      const value = await queries.getTag(testVConUuid, 'priority');
      expect(value).toBe('5');
    });

    it('should add a boolean tag', async () => {
      await queries.addTag(testVConUuid, 'resolved', true);
      const value = await queries.getTag(testVConUuid, 'resolved');
      expect(value).toBe('true');
    });

    it('should get all tags', async () => {
      const tags = await queries.getTags(testVConUuid);
      expect(tags).toHaveProperty('department', 'sales');
      expect(tags).toHaveProperty('priority', '5');
      expect(tags).toHaveProperty('resolved', 'true');
      expect(Object.keys(tags).length).toBeGreaterThanOrEqual(3);
    });

    it('should return default value for non-existent tag', async () => {
      const value = await queries.getTag(testVConUuid, 'nonexistent', 'default');
      expect(value).toBe('default');
    });

    it('should return null for non-existent tag without default', async () => {
      const value = await queries.getTag(testVConUuid, 'nonexistent');
      expect(value).toBeNull();
    });
  });

  describe('Update Tags', () => {
    it('should update an existing tag', async () => {
      await queries.addTag(testVConUuid, 'department', 'support', true);
      const value = await queries.getTag(testVConUuid, 'department');
      expect(value).toBe('support');
    });

    it('should not overwrite when overwrite is false', async () => {
      await expect(
        queries.addTag(testVConUuid, 'department', 'engineering', false)
      ).rejects.toThrow("Tag 'department' already exists");
      
      const value = await queries.getTag(testVConUuid, 'department');
      expect(value).toBe('support');
    });

    it('should update multiple tags at once (merge)', async () => {
      await queries.updateTags(testVConUuid, {
        region: 'west',
        team: 'alpha'
      }, true);

      const tags = await queries.getTags(testVConUuid);
      expect(tags).toHaveProperty('region', 'west');
      expect(tags).toHaveProperty('team', 'alpha');
      expect(tags).toHaveProperty('department', 'support'); // Should still exist
    });

    it('should replace all tags when merge is false', async () => {
      await queries.updateTags(testVConUuid, {
        status: 'active',
        level: 'high'
      }, false);

      const tags = await queries.getTags(testVConUuid);
      expect(tags).toHaveProperty('status', 'active');
      expect(tags).toHaveProperty('level', 'high');
      expect(tags).not.toHaveProperty('department'); // Should be removed
      expect(tags).not.toHaveProperty('region'); // Should be removed
    });
  });

  describe('Remove Tags', () => {
    beforeAll(async () => {
      // Set up some tags for removal tests
      await queries.updateTags(testVConUuid, {
        tag1: 'value1',
        tag2: 'value2',
        tag3: 'value3'
      }, false);
    });

    it('should remove a specific tag', async () => {
      await queries.removeTag(testVConUuid, 'tag1');
      const tags = await queries.getTags(testVConUuid);
      expect(tags).not.toHaveProperty('tag1');
      expect(tags).toHaveProperty('tag2', 'value2');
      expect(tags).toHaveProperty('tag3', 'value3');
    });

    it('should not error when removing non-existent tag', async () => {
      await expect(
        queries.removeTag(testVConUuid, 'nonexistent')
      ).resolves.not.toThrow();
    });

    it('should remove all tags', async () => {
      await queries.removeAllTags(testVConUuid);
      const tags = await queries.getTags(testVConUuid);
      expect(Object.keys(tags).length).toBe(0);
    });
  });

  describe('Search by Tags', () => {
    let vcon1Uuid: string;
    let vcon2Uuid: string;
    let vcon3Uuid: string;

    beforeAll(async () => {
      // Create test vCons with tags
      const vcon1: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Sales Call 1',
        parties: [{ name: 'Customer 1' }]
      };
      const result1 = await queries.createVCon(vcon1);
      vcon1Uuid = result1.uuid;
      await queries.updateTags(vcon1Uuid, {
        department: 'sales',
        priority: 'high',
        status: 'open'
      });

      const vcon2: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Sales Call 2',
        parties: [{ name: 'Customer 2' }]
      };
      const result2 = await queries.createVCon(vcon2);
      vcon2Uuid = result2.uuid;
      await queries.updateTags(vcon2Uuid, {
        department: 'sales',
        priority: 'low',
        status: 'open'
      });

      const vcon3: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Support Call',
        parties: [{ name: 'Customer 3' }]
      };
      const result3 = await queries.createVCon(vcon3);
      vcon3Uuid = result3.uuid;
      await queries.updateTags(vcon3Uuid, {
        department: 'support',
        priority: 'high',
        status: 'closed'
      });
    });

    afterAll(async () => {
      // Clean up test vCons
      if (vcon1Uuid) await queries.deleteVCon(vcon1Uuid);
      if (vcon2Uuid) await queries.deleteVCon(vcon2Uuid);
      if (vcon3Uuid) await queries.deleteVCon(vcon3Uuid);
    });

    it('should find vCons by single tag', async () => {
      // Verify tags were actually saved first
      const tags1 = await queries.getTags(vcon1Uuid);
      const tags2 = await queries.getTags(vcon2Uuid);
      expect(tags1.department).toBe('sales');
      expect(tags2.department).toBe('sales');
      
      // Give the database time to commit the tag changes and ensure they're queryable
      // Retry a few times in case of eventual consistency
      let results: string[] = [];
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        results = await queries.searchByTags({ department: 'sales' });
        if (results.length >= 2 && results.includes(vcon1Uuid) && results.includes(vcon2Uuid)) {
          break;
        }
      }
      
      // Note: This test may fail if the search_vcons_by_tags RPC function doesn't exist
      // and the fallback search isn't working correctly. The tags are confirmed to be saved.
      if (results.length === 0) {
        console.warn('searchByTags returned empty results even though tags exist. This may indicate the RPC function is missing or the fallback has an issue.');
      }
      
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results).toContain(vcon1Uuid);
      expect(results).toContain(vcon2Uuid);
    });

    it('should find vCons by multiple tags (AND logic)', async () => {
      // Verify tags were actually saved first
      const tags1 = await queries.getTags(vcon1Uuid);
      expect(tags1.department).toBe('sales');
      expect(tags1.priority).toBe('high');
      
      // Give the database time to commit the tag changes and ensure they're queryable
      // Retry a few times in case of eventual consistency
      let results: string[] = [];
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        results = await queries.searchByTags({
          department: 'sales',
          priority: 'high'
        });
        if (results.length >= 1 && results.includes(vcon1Uuid)) {
          break;
        }
      }
      
      // Note: This test may fail if the search_vcons_by_tags RPC function doesn't exist
      // and the fallback search isn't working correctly. The tags are confirmed to be saved.
      if (results.length === 0) {
        console.warn('searchByTags returned empty results even though tags exist. This may indicate the RPC function is missing or the fallback has an issue.');
      }
      
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results).toContain(vcon1Uuid);
      expect(results).not.toContain(vcon2Uuid); // Has sales but not high priority
    });

    it('should return empty array when no vCons match', async () => {
      const results = await queries.searchByTags({
        department: 'nonexistent',
        priority: 'ultra'
      });
      expect(results.length).toBe(0);
    });

    it('should respect the limit parameter', async () => {
      const results = await queries.searchByTags({ department: 'sales' }, 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Tag Storage Format', () => {
    it('should store tags as an attachment with correct format', async () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test Tag Format',
        parties: [{ name: 'Test' }]
      };
      const result = await queries.createVCon(vcon);
      const uuid = result.uuid;

      await queries.updateTags(uuid, {
        key1: 'value1',
        key2: 'value2'
      });

      // Get the full vCon and check attachment
      const fullVCon = await queries.getVCon(uuid);
      expect(fullVCon.attachments).toBeDefined();
      
      const tagsAttachment = fullVCon.attachments?.find(att => att.type === 'tags');
      expect(tagsAttachment).toBeDefined();
      expect(tagsAttachment?.encoding).toBe('json');
      expect(tagsAttachment?.body).toBeDefined();

      // Parse and validate body format
      const tagsArray = JSON.parse(tagsAttachment!.body!);
      expect(Array.isArray(tagsArray)).toBe(true);
      expect(tagsArray).toContain('key1:value1');
      expect(tagsArray).toContain('key2:value2');

      // Clean up
      await queries.deleteVCon(uuid);
    });
  });

  describe('Edge Cases', () => {
    it('should handle tags with special characters in values', async () => {
      await queries.addTag(testVConUuid, 'email', 'test@example.com');
      const value = await queries.getTag(testVConUuid, 'email');
      expect(value).toBe('test@example.com');
    });

    it('should handle tags with spaces in values', async () => {
      await queries.addTag(testVConUuid, 'name', 'John Doe');
      const value = await queries.getTag(testVConUuid, 'name');
      expect(value).toBe('John Doe');
    });

    it('should handle empty string values', async () => {
      await queries.addTag(testVConUuid, 'empty', '');
      const value = await queries.getTag(testVConUuid, 'empty');
      expect(value).toBe('');
    });

    it('should handle tag keys with underscores', async () => {
      await queries.addTag(testVConUuid, 'customer_id', '12345');
      const value = await queries.getTag(testVConUuid, 'customer_id');
      expect(value).toBe('12345');
    });

    it('should handle updating empty tags object', async () => {
      await queries.updateTags(testVConUuid, {}, false);
      const tags = await queries.getTags(testVConUuid);
      expect(Object.keys(tags).length).toBe(0);
    });
  });
});

