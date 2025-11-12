#!/usr/bin/env tsx

/**
 * Pull missing migrations from remote Supabase database
 * Creates local migration files for migrations that exist on remote but not locally
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

dotenv.config();

async function getRemoteMigrationSQL(supabase: any, version: string): Promise<string | null> {
  // Use exec_sql RPC to query the supabase_migrations schema
  const { data, error } = await supabase.rpc('exec_sql', {
    q: `
      SELECT statements 
      FROM supabase_migrations.schema_migrations 
      WHERE version = '${version}'
    `,
    params: {}
  });
  
  if (error) {
    console.error(`Error fetching migration ${version}: ${error.message}`);
    return null;
  }
  
  // exec_sql returns an array of results
  if (Array.isArray(data) && data.length > 0) {
    return data[0]?.statements || null;
  }
  
  return null;
}

async function main(): Promise<void> {
  const remoteUrl = process.env.REMOTE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ijuooeoejxyjmoxrwgzg.supabase.co';
  const remoteKey = process.env.REMOTE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!remoteKey) {
    console.error('❌ Error: REMOTE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  
  console.log('🔌 Connecting to remote Supabase...\n');
  
  const supabase = createClient(remoteUrl, remoteKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  
  // Migrations that exist on remote but not locally
  const missingMigrations = [
    '20251111182435',
    '20251111182504',
    '20251111182528',
    '20251111182556',
    '20251111183320',
    '20251111183350',
    '20251111220707',
    '20251111222241',
    '20251112164958'
  ];
  
  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
  
  console.log(`📥 Pulling ${missingMigrations.length} migrations from remote...\n`);
  
  for (const version of missingMigrations) {
    console.log(`Fetching migration ${version}...`);
    
    // Get migration name
    const { data: migrationData, error: nameError } = await supabase.rpc('exec_sql', {
      q: `
        SELECT name 
        FROM supabase_migrations.schema_migrations 
        WHERE version = '${version}'
      `,
      params: {}
    });
    
    let migrationName = 'remote_migration';
    if (!nameError && Array.isArray(migrationData) && migrationData.length > 0) {
      const name = migrationData[0]?.name;
      if (name && name !== 'unnamed') {
        migrationName = name;
      }
    }
    
    // Get migration SQL
    const sql = await getRemoteMigrationSQL(supabase, version);
    
    if (!sql) {
      console.warn(`  ⚠️  Could not fetch SQL for ${version}, skipping...\n`);
      continue;
    }
    
    // Create migration file
    const filename = `${version}_${migrationName}.sql`;
    const filepath = join(migrationsDir, filename);
    
    await writeFile(filepath, sql, 'utf-8');
    console.log(`  ✅ Created ${filename}\n`);
  }
  
  console.log('✅ Done pulling migrations from remote!\n');
  console.log('📝 Next steps:');
  console.log('   1. Review the new migration files');
  console.log('   2. Test locally: supabase db reset');
  console.log('   3. Commit the new migration files');
}

main().catch(console.error);

