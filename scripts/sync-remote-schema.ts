#!/usr/bin/env tsx

/**
 * Sync schema from remote Supabase database
 * Queries the remote database to get schema information and migration history
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config();

async function getRemoteMigrations(supabase: SupabaseClient): Promise<any[]> {
  console.log('📋 Querying remote migration history...\n');
  
  // Query the schema_migrations table
  const { data, error } = await supabase
    .from('supabase_migrations.schema_migrations')
    .select('version, name')
    .order('version', { ascending: true });
  
  if (error) {
    // Try alternative query if schema_migrations table structure is different
    const { data: altData, error: altError } = await supabase.rpc('exec_sql', {
      q: `
        SELECT version, name 
        FROM supabase_migrations.schema_migrations 
        ORDER BY version ASC
      `,
      params: {}
    });
    
    if (altError) {
      throw new Error(`Failed to query migrations: ${error.message}`);
    }
    
    return altData || [];
  }
  
  return data || [];
}

async function getRemoteSchema(supabase: SupabaseClient): Promise<string> {
  console.log('📊 Querying remote schema...\n');
  
  // Get table definitions
  const { data: tables, error: tablesError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT 
        table_name,
        table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,
    params: {}
  });
  
  if (tablesError) {
    throw new Error(`Failed to query tables: ${tablesError.message}`);
  }
  
  console.log(`Found ${tables?.length || 0} tables in public schema\n`);
  
  // Get function definitions
  const { data: functions, error: functionsError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT 
        routine_name,
        routine_definition
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_type = 'FUNCTION'
      ORDER BY routine_name
    `,
    params: {}
  });
  
  if (functionsError) {
    console.warn(`Warning: Could not query functions: ${functionsError.message}`);
  } else {
    console.log(`Found ${functions?.length || 0} functions in public schema\n`);
  }
  
  return JSON.stringify({ tables, functions }, null, 2);
}

async function main(): Promise<void> {
  const remoteUrl = process.env.REMOTE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ijuooeoejxyjmoxrwgzg.supabase.co';
  const remoteKey = process.env.REMOTE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!remoteKey) {
    console.error('❌ Error: REMOTE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  
  console.log('🔌 Connecting to remote Supabase...\n');
  console.log(`URL: ${remoteUrl}\n`);
  
  const supabase = createClient(remoteUrl, remoteKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  
  try {
    // Test connection
    const { error: testError } = await supabase.from('vcons').select('id').limit(1);
    if (testError && !testError.message.includes('permission')) {
      throw testError;
    }
    
    // Get migration history
    const migrations = await getRemoteMigrations(supabase);
    console.log('📋 Remote Migration History:');
    console.log('='.repeat(60));
    migrations.forEach((m: any) => {
      console.log(`  ${m.version} - ${m.name || 'unnamed'}`);
    });
    console.log('='.repeat(60));
    console.log(`\nTotal: ${migrations.length} migrations\n`);
    
    // Get schema info
    const schemaInfo = await getRemoteSchema(supabase);
    console.log('\n📊 Schema Information:');
    console.log(schemaInfo);
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main().catch(console.error);

