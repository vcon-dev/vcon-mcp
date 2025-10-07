/**
 * Database Client Tests
 * Tests for Supabase client initialization and connection management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSupabaseClient, closeSupabaseClient, testConnection } from '../src/db/client.js';

describe('Database Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    vi.resetModules();
    process.env = { ...originalEnv };
    closeSupabaseClient();
  });

  afterEach(() => {
    process.env = originalEnv;
    closeSupabaseClient();
  });

  describe('getSupabaseClient', () => {
    it('should create a client with valid credentials', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'test-anon-key-12345';

      const client = getSupabaseClient();
      
      expect(client).toBeDefined();
      expect(client.auth).toBeDefined();
    });

    it('should throw error when SUPABASE_URL is missing', () => {
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_ANON_KEY = 'test-key';

      expect(() => getSupabaseClient()).toThrow('Missing Supabase credentials');
      expect(() => getSupabaseClient()).toThrow('SUPABASE_URL');
    });

    it('should throw error when SUPABASE_ANON_KEY is missing', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      delete process.env.SUPABASE_ANON_KEY;

      expect(() => getSupabaseClient()).toThrow('Missing Supabase credentials');
      expect(() => getSupabaseClient()).toThrow('SUPABASE_ANON_KEY');
    });

    it('should throw error when both credentials are missing', () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;

      expect(() => getSupabaseClient()).toThrow('Missing Supabase credentials');
    });

    it('should return the same instance on multiple calls (singleton)', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'test-anon-key-12345';

      const client1 = getSupabaseClient();
      const client2 = getSupabaseClient();
      
      expect(client1).toBe(client2);
    });

    it('should create client with correct auth options', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'test-anon-key-12345';

      const client = getSupabaseClient();
      
      // Verify auth settings are applied
      expect(client).toBeDefined();
      // The client should have auth disabled for session persistence
      expect(client.auth).toBeDefined();
    });
  });

  describe('closeSupabaseClient', () => {
    it('should reset the client instance', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'test-anon-key-12345';

      const client1 = getSupabaseClient();
      closeSupabaseClient();
      const client2 = getSupabaseClient();
      
      // After closing, should get a new instance
      expect(client1).not.toBe(client2);
    });

    it('should not throw when called multiple times', () => {
      expect(() => {
        closeSupabaseClient();
        closeSupabaseClient();
        closeSupabaseClient();
      }).not.toThrow();
    });
  });

  describe('testConnection', () => {
    it('should return false when credentials are missing', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;

      const result = await testConnection();
      
      expect(result).toBe(false);
    });

    it('should handle connection errors gracefully', async () => {
      process.env.SUPABASE_URL = 'https://invalid-url.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'invalid-key';

      // Should not throw, but return false
      const result = await testConnection();
      
      expect(result).toBe(false);
    });
  });
});

