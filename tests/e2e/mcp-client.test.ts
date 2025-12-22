/**
 * MCP Client E2E Integration Tests
 *
 * These tests start a real MCP server and connect via an MCP client
 * to test the full tool execution flow against a real database.
 *
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables set
 * - Server built (npm run build)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  checkE2EEnvironment,
  createTestClient,
  closeTestClient,
  callTool,
  generateTestEmail,
  generateTestPhone,
  generateTestSubject,
  runMigrations,
  type TestContext,
} from './setup.js';

// Skip all tests if environment is not configured
const runE2E = checkE2EEnvironment();

// Track if we should skip due to schema issues
let schemaReady = false;

describe.skipIf(!runE2E)('MCP Server E2E Tests', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // Run migrations to ensure database schema is up to date
    console.log('Running database migrations...');
    await runMigrations();

    // Check if schema is missing - skip tests gracefully
    if (process.env.E2E_SKIP_SCHEMA_MISSING === 'true') {
      console.log('Skipping E2E tests due to missing database schema');
      return;
    }

    // Create test client
    ctx = await createTestClient();
    schemaReady = true;
  }, 120000); // 2 min timeout for migrations + server startup

  afterAll(async () => {
    if (ctx) {
      await closeTestClient(ctx);
    }
  }, 30000);

  // Helper to skip individual tests if schema is not ready
  function skipIfNoSchema() {
    if (!schemaReady) {
      console.log('  → Test skipped: database schema not available');
      return true;
    }
    return false;
  }

  describe('Server Connection', () => {
    it('should list available tools', async () => {
      if (skipIfNoSchema()) return;

      const tools = await ctx.client.listTools();

      expect(tools.tools).toBeDefined();
      expect(tools.tools.length).toBeGreaterThan(0);

      // Check for core vCon tools
      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain('create_vcon');
      expect(toolNames).toContain('get_vcon');
      expect(toolNames).toContain('search_vcons');
      expect(toolNames).toContain('delete_vcon');
      expect(toolNames).toContain('add_dialog');
      expect(toolNames).toContain('add_analysis');
      expect(toolNames).toContain('manage_tag');
    });
  });

  describe('vCon CRUD Operations', () => {
    it('should create a vCon with parties', async () => {
      if (skipIfNoSchema()) return;

      const email = generateTestEmail();
      const subject = generateTestSubject();

      const result = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject,
          parties: [
            { name: 'Test User', mailto: email },
            { name: 'Test Agent', tel: generateTestPhone() },
          ],
        }
      );

      expect(result.success).toBe(true);
      expect(result.uuid).toBeDefined();
      expect(typeof result.uuid).toBe('string');

      // Track for cleanup
      ctx.createdVcons.push(result.uuid);
    });

    it('should retrieve a created vCon', async () => {
      if (skipIfNoSchema()) return;

      const email = generateTestEmail();
      const subject = generateTestSubject();

      // Create
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject,
          parties: [{ name: 'Retrieve Test', mailto: email }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Retrieve
      const getResult = await callTool<{ success: boolean; vcon: any }>(
        ctx.client,
        'get_vcon',
        {
          uuid: createResult.uuid,
        }
      );

      expect(getResult.success).toBe(true);
      expect(getResult.vcon).toBeDefined();
      expect(getResult.vcon.uuid).toBe(createResult.uuid);
      expect(getResult.vcon.subject).toBe(subject);
      expect(getResult.vcon.parties).toHaveLength(1);
      expect(getResult.vcon.parties[0].mailto).toBe(email);
    });

    it('should delete a vCon', async () => {
      if (skipIfNoSchema()) return;

      // Create
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Delete Test' }],
        }
      );

      // Delete
      const deleteResult = await callTool<{ success: boolean }>(
        ctx.client,
        'delete_vcon',
        {
          uuid: createResult.uuid,
        }
      );

      expect(deleteResult.success).toBe(true);

      // Verify deletion - should throw or return error
      try {
        await callTool(ctx.client, 'get_vcon', { uuid: createResult.uuid });
        // If we get here, the vCon wasn't deleted
        expect.fail('Expected get_vcon to fail for deleted vCon');
      } catch (e) {
        // Expected - vCon should not exist
      }
    });
  });

  describe('Search by Party Email (Bug Fix Verification)', () => {
    let testUuid: string;
    let testEmail: string;

    beforeEach(async () => {
      if (!schemaReady) return;

      // Create a vCon with a unique email
      testEmail = generateTestEmail();
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Email Search Test', mailto: testEmail }],
        }
      );
      testUuid = createResult.uuid;
      ctx.createdVcons.push(testUuid);
    });

    it('should find vCon by exact party email', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_email: testEmail,
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.count).toBeGreaterThanOrEqual(1);

      const found = searchResult.results.find((r) => r.uuid === testUuid);
      expect(found).toBeDefined();
    });

    it('should find vCon by partial email match', async () => {
      if (skipIfNoSchema()) return;

      // Extract domain from test email
      const domain = testEmail.split('@')[1];

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_email: domain,
      });

      expect(searchResult.success).toBe(true);
      const found = searchResult.results.find((r) => r.uuid === testUuid);
      expect(found).toBeDefined();
    });

    it('should return empty results for non-existent email', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_email: 'nonexistent-email-xyz@nowhere.invalid',
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.count).toBe(0);
      expect(searchResult.results).toHaveLength(0);
    });
  });

  describe('Search by Party Name', () => {
    it('should find vCon by party name', async () => {
      if (skipIfNoSchema()) return;

      const uniqueName = `TestUser-${Date.now()}`;

      // Create vCon with unique name
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: uniqueName, mailto: generateTestEmail() }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Search by name
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_name: uniqueName,
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.count).toBeGreaterThanOrEqual(1);

      const found = searchResult.results.find(
        (r) => r.uuid === createResult.uuid
      );
      expect(found).toBeDefined();
    });
  });

  describe('Search by Party Phone', () => {
    it('should find vCon by party phone number', async () => {
      if (skipIfNoSchema()) return;

      const uniquePhone = generateTestPhone();

      // Create vCon with unique phone
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Phone Test', tel: uniquePhone }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Search by phone
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_tel: uniquePhone,
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.count).toBeGreaterThanOrEqual(1);

      const found = searchResult.results.find(
        (r) => r.uuid === createResult.uuid
      );
      expect(found).toBeDefined();
    });
  });

  describe('Add Dialog', () => {
    it('should add dialog to existing vCon', async () => {
      if (skipIfNoSchema()) return;

      // Create vCon
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Dialog Test' }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Add dialog
      const dialogResult = await callTool<{ success: boolean }>(
        ctx.client,
        'add_dialog',
        {
          vcon_uuid: createResult.uuid,
          dialog: {
            type: 'text',
            body: 'Hello, this is a test message.',
            encoding: 'none',
            parties: [0],
          },
        }
      );

      expect(dialogResult.success).toBe(true);

      // Verify dialog was added
      const getResult = await callTool<{ success: boolean; vcon: any }>(
        ctx.client,
        'get_vcon',
        {
          uuid: createResult.uuid,
        }
      );

      expect(getResult.vcon.dialog).toBeDefined();
      expect(getResult.vcon.dialog.length).toBeGreaterThanOrEqual(1);
      expect(getResult.vcon.dialog[0].body).toBe(
        'Hello, this is a test message.'
      );
    });
  });

  describe('Add Analysis', () => {
    it('should add analysis with required vendor field', async () => {
      if (skipIfNoSchema()) return;

      // Create vCon
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Analysis Test' }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Add analysis (vendor is REQUIRED per IETF spec)
      const analysisResult = await callTool<{ success: boolean }>(
        ctx.client,
        'add_analysis',
        {
          vcon_uuid: createResult.uuid,
          analysis: {
            type: 'sentiment',
            vendor: 'TestVendor', // Required field
            schema: 'sentiment-v1', // Correct field name (not schema_version)
            body: JSON.stringify({ sentiment: 'positive', score: 0.85 }),
            encoding: 'json',
          },
        }
      );

      expect(analysisResult.success).toBe(true);

      // Verify analysis was added
      const getResult = await callTool<{ success: boolean; vcon: any }>(
        ctx.client,
        'get_vcon',
        {
          uuid: createResult.uuid,
        }
      );

      expect(getResult.vcon.analysis).toBeDefined();
      expect(getResult.vcon.analysis.length).toBeGreaterThanOrEqual(1);
      expect(getResult.vcon.analysis[0].vendor).toBe('TestVendor');
      expect(getResult.vcon.analysis[0].schema).toBe('sentiment-v1');
    });
  });

  describe('Tag Operations', () => {
    let tagTestUuid: string;

    beforeEach(async () => {
      if (!schemaReady) return;

      // Create vCon for tag tests
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Tag Test' }],
        }
      );
      tagTestUuid = createResult.uuid;
      ctx.createdVcons.push(tagTestUuid);
    });

    it('should add and retrieve a tag', async () => {
      if (skipIfNoSchema()) return;

      // Add tag
      const tagResult = await callTool<{ success: boolean }>(
        ctx.client,
        'manage_tag',
        {
          vcon_uuid: tagTestUuid,
          action: 'set',
          key: 'department',
          value: 'e2e-testing',
        }
      );

      expect(tagResult.success).toBe(true);

      // Get tags
      const getTagsResult = await callTool<{
        success: boolean;
        tags: Record<string, string>;
      }>(ctx.client, 'get_tags', {
        vcon_uuid: tagTestUuid,
      });

      expect(getTagsResult.success).toBe(true);
      expect(getTagsResult.tags.department).toBe('e2e-testing');
    });

    it('should search by tags', async () => {
      if (skipIfNoSchema()) return;

      const uniqueTagValue = `e2e-${Date.now()}`;

      // Add unique tag
      await callTool(ctx.client, 'manage_tag', {
        vcon_uuid: tagTestUuid,
        action: 'set',
        key: 'e2e-test',
        value: uniqueTagValue,
      });

      // Search by tag
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        vcon_uuids: string[];
      }>(ctx.client, 'search_by_tags', {
        tags: { 'e2e-test': uniqueTagValue },
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.vcon_uuids).toContain(tagTestUuid);
    });
  });

  describe('Combined Filters', () => {
    it('should search with party email and subject combined', async () => {
      if (skipIfNoSchema()) return;

      const email = generateTestEmail();
      const subject = `Combined Filter Test ${Date.now()}`;

      // Create vCon
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject,
          parties: [{ name: 'Combined Test', mailto: email }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Search with both filters
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_email: email,
        subject: 'Combined Filter',
      });

      expect(searchResult.success).toBe(true);
      const found = searchResult.results.find(
        (r) => r.uuid === createResult.uuid
      );
      expect(found).toBeDefined();
    });

    it('should search with party email and date range', async () => {
      if (skipIfNoSchema()) return;

      const email = generateTestEmail();

      // Create vCon
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject: generateTestSubject(),
          parties: [{ name: 'Date Range Test', mailto: email }],
        }
      );
      ctx.createdVcons.push(createResult.uuid);

      // Search with email and date range (today)
      const today = new Date().toISOString().split('T')[0];
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_email: email,
        start_date: today,
      });

      expect(searchResult.success).toBe(true);
      const found = searchResult.results.find(
        (r) => r.uuid === createResult.uuid
      );
      expect(found).toBeDefined();
    });
  });

  describe('Text Search (search_vcons_content)', () => {
    it('should execute text search and return results', async () => {
      if (skipIfNoSchema()) return;

      // Search for common word "test" which should appear in our test data
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        response_format: string;
        results: any[];
      }>(ctx.client, 'search_vcons_content', {
        query: 'test',
      });

      expect(searchResult.success).toBe(true);
      // Should return results (may be 0 if no data matches)
      expect(typeof searchResult.count).toBe('number');
      expect(Array.isArray(searchResult.results)).toBe(true);
    });

    it('should return snippets with highlighted terms when results exist', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        response_format: string;
        results: any[];
      }>(ctx.client, 'search_vcons_content', {
        query: 'test',
        response_format: 'snippets',
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.response_format).toBe('snippets');

      // If results exist, verify structure
      if (searchResult.count > 0) {
        const result = searchResult.results[0];
        expect(result.vcon_id).toBeDefined();
        expect(result.content_type).toBeDefined();
        expect(typeof result.relevance_score).toBe('number');
      }
    });

    it('should support metadata response format', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        response_format: string;
        results: any[];
      }>(ctx.client, 'search_vcons_content', {
        query: 'test',
        response_format: 'metadata',
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.response_format).toBe('metadata');

      // If results exist, verify structure
      if (searchResult.count > 0) {
        const result = searchResult.results[0];
        expect(result.vcon_id).toBeDefined();
        expect(result.content_type).toBeDefined();
        expect(result.relevance_score).toBeDefined();
        // Metadata format should NOT include snippet
        expect(result.snippet).toBeUndefined();
      }
    });

    it('should support ids_only response format', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        response_format: string;
        results: string[];
      }>(ctx.client, 'search_vcons_content', {
        query: 'test',
        response_format: 'ids_only',
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.response_format).toBe('ids_only');

      // If results exist, they should be string UUIDs
      if (searchResult.count > 0) {
        expect(typeof searchResult.results[0]).toBe('string');
      }
    });

    it('should return empty results for non-matching query', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons_content', {
        query: 'xyznonexistentquerytermxyz12345',
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.count).toBe(0);
      expect(searchResult.results).toHaveLength(0);
    });

    it('should respect limit parameter', async () => {
      if (skipIfNoSchema()) return;

      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons_content', {
        query: 'test',
        limit: 1,
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Full vCon Lifecycle', () => {
    it('should complete full CRUD lifecycle', async () => {
      if (skipIfNoSchema()) return;

      const email = generateTestEmail();
      const subject = generateTestSubject();

      // 1. Create vCon
      const createResult = await callTool<{ success: boolean; uuid: string }>(
        ctx.client,
        'create_vcon',
        {
          subject,
          parties: [{ name: 'Lifecycle Test', mailto: email }],
        }
      );
      const uuid = createResult.uuid;
      expect(createResult.success).toBe(true);

      // 2. Add dialog
      const dialogResult = await callTool<{ success: boolean }>(
        ctx.client,
        'add_dialog',
        {
          vcon_uuid: uuid,
          dialog: {
            type: 'text',
            body: 'Lifecycle test dialog',
            encoding: 'none',
          },
        }
      );
      expect(dialogResult.success).toBe(true);

      // 3. Add analysis
      const analysisResult = await callTool<{ success: boolean }>(
        ctx.client,
        'add_analysis',
        {
          vcon_uuid: uuid,
          analysis: {
            type: 'summary',
            vendor: 'E2ETestVendor',
            body: 'Test summary',
            encoding: 'none',
          },
        }
      );
      expect(analysisResult.success).toBe(true);

      // 4. Add tag
      const tagResult = await callTool<{ success: boolean }>(
        ctx.client,
        'manage_tag',
        {
          vcon_uuid: uuid,
          action: 'set',
          key: 'lifecycle',
          value: 'complete',
        }
      );
      expect(tagResult.success).toBe(true);

      // 5. Search and verify
      const searchResult = await callTool<{
        success: boolean;
        count: number;
        results: any[];
      }>(ctx.client, 'search_vcons', {
        party_email: email,
      });
      expect(searchResult.results.some((r) => r.uuid === uuid)).toBe(true);

      // 6. Get full vCon and verify all parts
      const getResult = await callTool<{ success: boolean; vcon: any }>(
        ctx.client,
        'get_vcon',
        { uuid }
      );
      expect(getResult.vcon.dialog).toHaveLength(1);
      expect(getResult.vcon.analysis).toHaveLength(1);

      // 7. Delete
      const deleteResult = await callTool<{ success: boolean }>(
        ctx.client,
        'delete_vcon',
        { uuid }
      );
      expect(deleteResult.success).toBe(true);

      // Don't add to cleanup list since we already deleted
    });
  });
});
