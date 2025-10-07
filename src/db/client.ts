/**
 * Supabase Database Client
 * 
 * Singleton client for connecting to Supabase PostgreSQL database
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

/**
 * Get or create Supabase client instance
 * @returns Initialized Supabase client
 * @throws Error if environment variables are missing
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
      );
    }

    supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabase;
}

/**
 * Close and reset the Supabase client connection
 * Useful for testing or cleaning up resources
 */
export function closeSupabaseClient(): void {
  supabase = null;
}

/**
 * Test database connectivity
 * @returns Promise resolving to true if connected, false otherwise
 */
export async function testConnection(): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    const { error } = await client.from('vcons').select('count').limit(1);
    return !error;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

