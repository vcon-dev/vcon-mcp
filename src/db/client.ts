/**
 * Supabase Database Client & Redis Cache Client
 * 
 * Singleton clients for connecting to Supabase PostgreSQL database and Redis cache
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import { logWithContext, recordCounter } from '../observability/instrumentation.js';

let supabase: SupabaseClient | null = null;
let redis: Redis | null = null;

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

/**
 * Get or create Redis client instance (optional cache layer)
 * @returns Initialized Redis client or null if Redis is not configured
 */
export function getRedisClient(): Redis | null {
  // Redis is optional - if not configured, cache layer is disabled
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!redis) {
    try {
      const redisUrl = process.env.REDIS_URL;
      
      redis = new Redis(redisUrl, {
        // Connection pool settings
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        
        // Retry strategy for transient failures
        retryStrategy(times: number) {
          if (times > 3) {
            console.error('Redis connection failed after 3 attempts, disabling cache');
            return null; // Stop retrying
          }
          const delay = Math.min(times * 100, 2000);
          return delay;
        },
        
        // Connection timeout
        connectTimeout: 5000,
        
        // Reconnect on error
        reconnectOnError(err: Error) {
          const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
          return targetErrors.some(target => err.message.includes(target));
        },
      });

      redis.on('error', (error) => {
        logWithContext('error', 'Redis connection error', {
          error_message: error.message,
        });
        recordCounter('cache.error', 1, {
          error_type: error.name,
        }, 'Cache connection errors');
      });

      redis.on('connect', () => {
        logWithContext('info', 'Redis cache connected');
      });

      redis.on('close', () => {
        logWithContext('warn', 'Redis cache connection closed');
      });

    } catch (error) {
      logWithContext('error', 'Failed to initialize Redis client', {
        error_message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  return redis;
}

/**
 * Close and reset the Redis client connection
 * Useful for testing or cleaning up resources
 */
export async function closeRedisClient(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Test Redis connectivity
 * @returns Promise resolving to true if connected, false otherwise
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (!client) return false;
    
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    console.error('Redis connection test failed:', error);
    return false;
  }
}

/**
 * Close all database connections gracefully
 */
export async function closeAllConnections(): Promise<void> {
  await closeRedisClient();
  closeSupabaseClient();
}

