#!/usr/bin/env tsx

/**
 * E2E Database Setup Script
 *
 * Sets up the database schema for E2E tests by running migrations
 * via the Supabase SQL endpoint.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   npx tsx scripts/setup-e2e-database.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function checkSchemaExists(
  supabase: ReturnType<typeof createClient>
): Promise<boolean> {
  const { error } = await supabase.from('vcons').select('id').limit(1);
  return !error || !error.message.includes('does not exist');
}

async function runSqlViaRest(
  projectRef: string,
  serviceRoleKey: string,
  sql: string
): Promise<{ success: boolean; error?: string }> {
  // Use the Supabase REST API to execute SQL
  // The endpoint is: https://{project_ref}.supabase.co/rest/v1/rpc/exec_sql
  // But for fresh databases, we need to use the pg REST endpoint

  const url = `https://${projectRef}.supabase.co/rest/v1/`;

  // First, try to create exec_sql function if it doesn't exist
  // We'll use the PostgREST /rpc endpoint after creating the function

  try {
    const response = await fetch(
      `https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          query_text: sql,
          query_params: {},
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function main(): Promise<void> {
  console.log('🔧 E2E Database Setup\n');
  console.log('='.repeat(60));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: Missing environment variables');
    console.error(
      '   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
    process.exit(1);
  }

  // Extract project reference from URL
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
  console.log(`Project: ${projectRef}`);
  console.log('='.repeat(60) + '\n');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if schema already exists
  console.log('Checking existing schema...');
  const schemaExists = await checkSchemaExists(supabase);

  if (schemaExists) {
    console.log('✅ Schema already exists. No migration needed.\n');
    return;
  }

  console.log('Schema not found. Running migrations...\n');

  // Get migrations directory
  const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');

  let migrationFiles: string[];
  try {
    migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    console.error('❌ Could not read migrations directory:', err);
    console.error(`   Expected path: ${migrationsDir}\n`);
    process.exit(1);
  }

  console.log(`Found ${migrationFiles.length} migration files\n`);

  // First, we need to manually create the exec_sql function
  // Since we can't run arbitrary SQL without it, we need to check
  // if the Supabase project has the function

  // Try to use exec_sql RPC
  const { error: rpcError } = await supabase.rpc('exec_sql', {
    query_text: 'SELECT 1',
    query_params: {},
  });

  if (rpcError) {
    console.log('='.repeat(60));
    console.log('MANUAL SETUP REQUIRED');
    console.log('='.repeat(60));
    console.log('\nThe exec_sql RPC function is not available.');
    console.log(
      'This is needed to run migrations programmatically.\n'
    );
    console.log('Please run the following options:\n');
    console.log('Option 1: Use Supabase CLI (recommended)');
    console.log('  cd ' + join(__dirname, '..'));
    console.log(
      `  npx supabase db push --db-url "postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres"\n`
    );
    console.log('Option 2: Run migrations in Supabase SQL Editor');
    console.log('  Go to: https://supabase.com/dashboard/project/' + projectRef + '/sql');
    console.log('  Copy and run each file from: supabase/migrations/\n');
    console.log('Option 3: Create exec_sql first');
    console.log('  Run the contents of:');
    console.log(`  ${join(migrationsDir, '20251012150000_exec_sql_rpc.sql')}`);
    console.log('  Then re-run this script.\n');
    console.log('='.repeat(60));
    process.exit(1);
  }

  // Run each migration
  for (const file of migrationFiles) {
    console.log(`Running: ${file}`);

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    const { error } = await supabase.rpc('exec_sql', {
      query_text: sql,
      query_params: {},
    });

    if (error) {
      // Ignore "already exists" errors
      if (
        !error.message.includes('already exists') &&
        !error.message.includes('duplicate key')
      ) {
        console.warn(`   ⚠️  Warning: ${error.message}`);
      }
    } else {
      console.log(`   ✅ Success`);
    }
  }

  console.log('\n✅ Database setup complete!\n');

  // Verify
  const finalCheck = await checkSchemaExists(supabase);
  if (finalCheck) {
    console.log('✅ Schema verified - ready for E2E tests\n');
  } else {
    console.error('❌ Schema verification failed\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
