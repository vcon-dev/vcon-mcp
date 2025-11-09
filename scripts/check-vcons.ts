#!/usr/bin/env tsx

/**
 * Check vCon loading status
 * 
 * Verifies how many vCons are in the database and shows recent activity
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { VConQueries } from '../dist/db/queries.js';

dotenv.config();

/**
 * Test database connection and provide helpful error messages
 */
async function testDatabaseConnection(supabase: any): Promise<void> {
  try {
    // Try a simple query to test the connection
    const { error } = await supabase
      .from('vcons')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    
    if (error) {
      throw error;
    }
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const supabaseUrl = process.env.SUPABASE_URL || 'unknown';
    
    // Check for common connection errors
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('network') ||
        errorMessage.includes('connection')) {
      
      console.error('\n❌ Database Connection Failed\n');
      console.error('The database is not accessible. Common causes:');
      console.error('  1. Docker is not running');
      console.error('  2. Supabase local instance is not started');
      console.error('  3. Database URL is incorrect');
      console.error(`\n  Current SUPABASE_URL: ${supabaseUrl}\n`);
      
      if (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')) {
        console.error('💡 To start local Supabase:');
        console.error('     supabase start');
        console.error('  Or check if Docker is running:\n');
        console.error('     docker ps\n');
      }
      
      throw new Error(`Database connection failed: ${errorMessage}`);
    }
    
    // Re-throw other errors as-is
    throw error;
  }
}

async function checkVCons() {
  console.log('🔍 Checking vCon Database Status...\n');

  try {
    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      console.error('❌ Error: SUPABASE_URL environment variable is not set\n');
      console.error('   Please set SUPABASE_URL in your .env file or environment\n');
      process.exit(1);
    }
    
    // Use service role key for admin operations (like the load script)
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseKey) {
      console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY must be set\n');
      process.exit(1);
    }
    
    console.log('🔌 Testing database connection...');
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    
    // Test connection before proceeding
    await testDatabaseConnection(supabase);
    console.log('   ✅ Database connection successful\n');
    
    const queries = new VConQueries(supabase);

    // Get total count
    console.log('1️⃣ Total vCons in database...');
    const { count: totalCount, error: countError } = await supabase
      .from('vcons')
      .select('*', { count: 'exact', head: true });
    
    if (countError) throw countError;
    console.log(`   ✅ Total vCons: ${totalCount || 0}\n`);

    // Get recent vCons (last 48 hours)
    console.log('2️⃣ Recent vCons (last 48 hours)...');
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentVcons, error: recentError } = await supabase
      .from('vcons')
      .select('uuid, subject, created_at')
      .gte('created_at', twoDaysAgo)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (recentError) throw recentError;
    console.log(`   ✅ Found ${recentVcons?.length || 0} vCons in last 48 hours\n`);
    
    if (recentVcons && recentVcons.length > 0) {
      console.log('   Recent vCons:');
      recentVcons.slice(0, 5).forEach((vcon, i) => {
        console.log(`   ${i + 1}. ${vcon.uuid.substring(0, 8)}... | ${vcon.subject || 'No subject'} | ${vcon.created_at}`);
      });
      if (recentVcons.length > 5) {
        console.log(`   ... and ${recentVcons.length - 5} more\n`);
      } else {
        console.log();
      }
    }

    // Get oldest and newest vCons
    console.log('3️⃣ Date range...');
    const { data: oldest, error: oldestError } = await supabase
      .from('vcons')
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1);
    
    const { data: newest, error: newestError } = await supabase
      .from('vcons')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (oldestError) throw oldestError;
    if (newestError) throw newestError;
    
    if (oldest && oldest.length > 0 && newest && newest.length > 0) {
      console.log(`   ✅ Oldest: ${oldest[0].created_at}`);
      console.log(`   ✅ Newest: ${newest[0].created_at}\n`);
    }

    // Get statistics by date (last 7 days)
    console.log('4️⃣ vCons added in last 7 days (by day)...');
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dailyStats, error: dailyError } = await supabase
      .from('vcons')
      .select('created_at')
      .gte('created_at', sevenDaysAgo);
    
    if (dailyError) throw dailyError;
    
    if (dailyStats) {
      const byDay: Record<string, number> = {};
      dailyStats.forEach(vcon => {
        const date = vcon.created_at.split('T')[0];
        byDay[date] = (byDay[date] || 0) + 1;
      });
      
      const sortedDays = Object.keys(byDay).sort().reverse();
      sortedDays.forEach(day => {
        console.log(`   ${day}: ${byDay[day]} vCons`);
      });
      console.log();
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total vCons: ${totalCount || 0}`);
    console.log(`Recent (48h): ${recentVcons?.length || 0}`);
    if (oldest && oldest.length > 0 && newest && newest.length > 0) {
      const oldestDate = new Date(oldest[0].created_at);
      const newestDate = new Date(newest[0].created_at);
      const daysDiff = Math.floor((newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`Date range: ${daysDiff} days`);
    }
    console.log('='.repeat(60));
    console.log('\n✅ Check complete!\n');

  } catch (error: any) {
    // Check if it's a database connection error that we've already handled
    if (error?.message?.includes('Database connection failed')) {
      // Error message already printed by testDatabaseConnection
      process.exit(1);
    }
    
    // For other errors, provide context
    const errorMessage = error?.message || String(error);
    console.error('\n❌ Error checking vCons:', errorMessage);
    
    // Check if it might be a connection error we didn't catch
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('network')) {
      console.error('\n💡 This might be a database connection issue.');
      console.error('   Make sure Docker and Supabase are running.\n');
    }
    
    process.exit(1);
  }
}

checkVCons();

