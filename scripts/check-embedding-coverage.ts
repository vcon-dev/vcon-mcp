#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkEmbeddingCoverage() {
  console.log('\n📊 Embedding Coverage Report\n');
  console.log('='.repeat(80));

  try {
    // Overall embedding counts
    console.log('\n1️⃣  OVERALL COUNTS\n');
    
    const { count: totalEmbeddings } = await supabase
      .from('vcon_embeddings')
      .select('*', { count: 'exact', head: true });
    
    console.log(`Total embeddings: ${totalEmbeddings || 0}`);
    
    const { data: typeCount } = await supabase.rpc('exec_sql', {
      q: `
        SELECT content_type, COUNT(*) as count
        FROM vcon_embeddings
        GROUP BY content_type
        ORDER BY count DESC
      `,
      params: {}
    });
    
    if (typeCount) {
      console.log('\nBy content type:');
      typeCount.forEach((row: any) => {
        console.log(`  - ${row.content_type}: ${row.count}`);
      });
    }

    // Analysis encoding distribution (optimized with sample)
    console.log('\n2️⃣  ANALYSIS ENCODING DISTRIBUTION (Recent Sample)\n');
    
    const { data: encodings, error: encError } = await supabase.rpc('exec_sql', {
      q: `
        WITH recent_sample AS (
          SELECT encoding, vcon_id
          FROM analysis
          WHERE body IS NOT NULL AND body <> ''
          LIMIT 100000
        )
        SELECT 
          COALESCE(encoding, 'NULL') as encoding,
          COUNT(*) as total_analysis,
          COUNT(DISTINCT vcon_id) as unique_vcons
        FROM recent_sample
        GROUP BY encoding
        ORDER BY total_analysis DESC
      `,
      params: {}
    });
    
    if (encError) {
      console.error('Error querying encodings:', encError.message);
    } else if (encodings) {
      console.log('Encoding        | Total Analysis | Unique vCons');
      console.log('-'.repeat(60));
      encodings.forEach((row: any) => {
        console.log(`${row.encoding.padEnd(15)} | ${String(row.total_analysis).padStart(14)} | ${String(row.unique_vcons).padStart(12)}`);
      });
      console.log('\nNote: Based on 100k sample');
    }

    // Embedding coverage by encoding (optimized - count embeddings only)
    console.log('\n3️⃣  ANALYSIS EMBEDDING COVERAGE\n');
    
    const { data: embAnalysisCount } = await supabase.rpc('exec_sql', {
      q: `
        SELECT COUNT(*) as count
        FROM vcon_embeddings
        WHERE content_type = 'analysis'
      `,
      params: {}
    });
    
    if (embAnalysisCount && embAnalysisCount[0]) {
      console.log(`Total analysis embeddings: ${embAnalysisCount[0].count}`);
      console.log(`\n(For detailed coverage by encoding, run on smaller dataset or use SQL directly)`);
    }

    // Subject and dialog coverage
    console.log('\n4️⃣  SUBJECT & DIALOG COVERAGE\n');
    
    // Subjects
    const { data: subjectStats } = await supabase.rpc('exec_sql', {
      q: `
        SELECT 
          COUNT(DISTINCT v.id) as total_with_subject,
          COUNT(DISTINCT e.vcon_id) as embedded_subjects,
          COUNT(DISTINCT v.id) - COUNT(DISTINCT e.vcon_id) as missing_subjects
        FROM vcons v
        LEFT JOIN vcon_embeddings e 
          ON e.vcon_id = v.id AND e.content_type = 'subject' AND e.content_reference IS NULL
        WHERE v.subject IS NOT NULL AND v.subject <> ''
      `,
      params: {}
    });
    
    if (subjectStats && subjectStats[0]) {
      const s = subjectStats[0];
      const pct = (s.embedded_subjects / s.total_with_subject * 100).toFixed(2);
      console.log(`Subjects: ${s.embedded_subjects}/${s.total_with_subject} (${pct}%) | Missing: ${s.missing_subjects}`);
    }
    
    // Dialogs
    const { data: dialogStats } = await supabase.rpc('exec_sql', {
      q: `
        SELECT 
          COUNT(DISTINCT d.id) as total_dialogs,
          COUNT(DISTINCT e.id) as embedded_dialogs,
          COUNT(DISTINCT d.id) - COUNT(DISTINCT e.id) as missing_dialogs
        FROM dialog d
        LEFT JOIN vcon_embeddings e 
          ON e.vcon_id = d.vcon_id AND e.content_type = 'dialog' AND e.content_reference = d.dialog_index::text
        WHERE d.body IS NOT NULL AND d.body <> ''
      `,
      params: {}
    });
    
    if (dialogStats && dialogStats[0]) {
      const d = dialogStats[0];
      const pct = (d.embedded_dialogs / d.total_dialogs * 100).toFixed(2);
      console.log(`Dialogs:  ${d.embedded_dialogs}/${d.total_dialogs} (${pct}%) | Missing: ${d.missing_dialogs}`);
    }

    // Analysis types and encodings sample (from recent data)
    console.log('\n5️⃣  TOP ANALYSIS TYPES & ENCODINGS (Recent Sample)\n');
    
    const { data: typeStats } = await supabase.rpc('exec_sql', {
      q: `
        WITH recent_analysis AS (
          SELECT a.type, a.encoding
          FROM analysis a
          WHERE a.body IS NOT NULL AND a.body <> ''
          LIMIT 50000
        )
        SELECT 
          type,
          COALESCE(encoding, 'NULL') as encoding,
          COUNT(*) as count
        FROM recent_analysis
        GROUP BY type, encoding
        ORDER BY count DESC
        LIMIT 20
      `,
      params: {}
    });
    
    if (typeStats) {
      console.log('Type                    | Encoding     | Count');
      console.log('-'.repeat(60));
      typeStats.forEach((row: any) => {
        console.log(`${row.type.padEnd(23)} | ${row.encoding.padEnd(12)} | ${row.count}`);
      });
      console.log('\nNote: Based on 50k sample');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Report complete\n');

  } catch (error) {
    console.error('\n❌ Error generating report:', error);
    process.exit(1);
  }
}

checkEmbeddingCoverage();

