/**
 * E2E Test Setup
 *
 * Provides utilities for starting the MCP server and connecting a client
 * for end-to-end integration testing.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TestContext {
  client: Client;
  transport: StdioClientTransport;
  createdVcons: string[];
}

/**
 * Check if required environment variables are set for E2E tests
 */
export function checkE2EEnvironment(): boolean {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(
      `E2E tests skipped: Missing environment variables: ${missing.join(', ')}`
    );
    return false;
  }
  return true;
}

/**
 * Verify database schema exists and is ready for E2E tests
 * If schema is missing, provides instructions for setup
 */
export async function ensureDatabaseSchema(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if the vcons table exists by attempting a simple query
  const { error } = await supabase.from('vcons').select('id').limit(1);

  if (error) {
    if (
      error.message.includes('does not exist') ||
      error.message.includes('PGRST205')
    ) {
      console.error('\n' + '='.repeat(70));
      console.error('DATABASE SCHEMA NOT FOUND');
      console.error('='.repeat(70));
      console.error('\nThe E2E test database does not have the required schema.');
      console.error('\nTo set up the database, run migrations using one of these methods:\n');
      console.error('Option 1: Use Supabase CLI (recommended)');
      console.error('  npx supabase db push --db-url "YOUR_DATABASE_URL"\n');
      console.error('Option 2: Run migrations manually in Supabase SQL Editor');
      console.error('  Copy and run each file from: supabase/migrations/\n');
      console.error('Option 3: Use the migrate script');
      console.error('  npm run migrate:remote\n');
      console.error('='.repeat(70) + '\n');
      throw new Error(
        'Database schema not found. See instructions above to set up the test database.'
      );
    }
    // Other errors might be OK (e.g., RLS policies)
    console.warn('Database check warning:', error.message);
  }

  console.log('Database schema verified');
}

/**
 * Run database migrations using exec_sql RPC (if available)
 * This only works if the exec_sql function has been created in the database
 */
export async function runMigrations(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials for migrations');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // First check if schema already exists
  const { error: checkError } = await supabase.from('vcons').select('id').limit(1);

  if (!checkError) {
    console.log('Database schema already exists, skipping migrations');
    return;
  }

  // Schema doesn't exist - check if we have the message about table not found
  const isMissingSchema =
    checkError.message.includes('does not exist') ||
    checkError.message.includes('PGRST205') ||
    checkError.message.includes("Could not find the table 'public.vcons'");

  if (!isMissingSchema) {
    // Some other error - might be OK (RLS policies etc)
    console.warn('Database check warning:', checkError.message);
    return;
  }

  // Schema is missing - check if exec_sql RPC is available
  const { error: rpcError } = await supabase.rpc('exec_sql', {
    query_text: 'SELECT 1',
    query_params: {},
  });

  if (rpcError) {
    // exec_sql not available - need manual setup
    const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

    console.warn('\n' + '='.repeat(70));
    console.warn('DATABASE SCHEMA NOT FOUND');
    console.warn('='.repeat(70));
    console.warn('\nThe E2E test database does not have the required schema.');
    console.warn('\nTo set up the database, use one of these methods:\n');
    console.warn('Option 1: Use Supabase CLI (recommended)');
    console.warn(
      '  npx supabase db push --db-url "postgresql://postgres.[PROJECT]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"\n'
    );
    console.warn('Option 2: Run migrations manually in Supabase SQL Editor');
    console.warn(`  Go to: https://supabase.com/dashboard/project/${projectRef}/sql`);
    console.warn('  Copy and run each file from: supabase/migrations/\n');
    console.warn('Option 3: Use the setup script after creating exec_sql');
    console.warn('  1. First run supabase/migrations/20251012150000_exec_sql_rpc.sql');
    console.warn('  2. Then run: npx tsx scripts/setup-e2e-database.ts\n');
    console.warn('='.repeat(70) + '\n');

    // Set flag to skip tests instead of throwing
    process.env.E2E_SKIP_SCHEMA_MISSING = 'true';
    return;
  }

  // exec_sql is available - run migrations
  const migrationsDir = join(__dirname, '..', '..', 'supabase', 'migrations');

  let migrationFiles: string[];
  try {
    migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    console.warn('Could not read migrations directory:', err);
    throw new Error('Could not read migrations directory');
  }

  console.log(`Found ${migrationFiles.length} migration files`);

  // Create tracking table
  await supabase.rpc('exec_sql', {
    query_text: `
      CREATE TABLE IF NOT EXISTS _e2e_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
    query_params: {},
  });

  // Get applied migrations
  const { data: appliedMigrations } = await supabase
    .from('_e2e_migrations')
    .select('name');

  const appliedSet = new Set(appliedMigrations?.map((m) => m.name) || []);

  // Run pending migrations
  for (const file of migrationFiles) {
    if (appliedSet.has(file)) {
      continue;
    }

    console.log(`Running migration: ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    const { error } = await supabase.rpc('exec_sql', {
      query_text: sql,
      query_params: {},
    });

    if (error) {
      if (
        !error.message.includes('already exists') &&
        !error.message.includes('duplicate key')
      ) {
        console.warn(`Migration ${file} warning:`, error.message);
      }
    }

    // Record as applied
    await supabase
      .from('_e2e_migrations')
      .upsert({ name: file }, { onConflict: 'name' });
  }

  console.log('Migrations complete');
}

/**
 * Create and connect an MCP client to the server
 */
export async function createTestClient(): Promise<TestContext> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      // Ensure we're using test environment
      NODE_ENV: 'test',
    },
  });

  const client = new Client(
    {
      name: 'e2e-test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    transport,
    createdVcons: [],
  };
}

/**
 * Close client connection and cleanup
 */
export async function closeTestClient(context: TestContext): Promise<void> {
  // Delete any vCons created during the test
  for (const uuid of context.createdVcons) {
    try {
      await context.client.callTool({
        name: 'delete_vcon',
        arguments: { uuid },
      });
    } catch (e) {
      // Ignore cleanup errors - vCon may already be deleted
    }
  }

  await context.client.close();
}

/**
 * Helper to call a tool and parse JSON response
 */
export async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await client.callTool({
    name,
    arguments: args,
  });

  // MCP tool results are in content array with text items
  if (
    !result.content ||
    !Array.isArray(result.content) ||
    result.content.length === 0
  ) {
    throw new Error(`Tool ${name} returned no content`);
  }

  const textContent = result.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error(`Tool ${name} returned no text content`);
  }

  return JSON.parse(textContent.text) as T;
}

/**
 * Generate a unique test email to avoid collisions
 */
export function generateTestEmail(): string {
  return `test-${randomUUID().slice(0, 8)}@e2e-test.example.com`;
}

/**
 * Generate a unique test phone number
 */
export function generateTestPhone(): string {
  return `+1555${Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(7, '0')}`;
}

/**
 * Generate a unique test subject
 */
export function generateTestSubject(): string {
  return `E2E Test ${randomUUID().slice(0, 8)} - ${new Date().toISOString()}`;
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
