#!/usr/bin/env npx tsx
/**
 * Bulk importer for .vcon files into local Supabase.
 *
 * Handles real Strolid vCon files where body fields may be objects.
 *
 * Usage:
 *   npx tsx scripts/import-vcon-files.ts /Volumes/T9/test-vcons/strolid/2026/04
 *   npx tsx scripts/import-vcon-files.ts /Volumes/T9/test-vcons/strolid/2026/04/01
 *
 * Options:
 *   --skip-embed        Skip embedding backfill after import (runs by default if API keys set)
 *   --skip-tags         Skip vcon_tags_mv refresh after import (runs by default)
 *
 * Options (env vars):
 *   CONCURRENCY=20      parallel inserts (default: 20)
 *   SKIP_EXISTING=true  skip UUIDs already in DB (default: true)
 *   DRY_RUN=true        parse + validate, no DB writes
 */

import dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'http://127.0.0.1:54321';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CONCURRENCY   = parseInt(process.env.CONCURRENCY   || '20');
const SKIP_EXISTING = process.env.SKIP_EXISTING !== 'false';
const DRY_RUN       = process.env.DRY_RUN === 'true';
const TENANT_ID     = process.env.CURRENT_TENANT_ID || '1';

// Valid dialog types per DB check constraint
const VALID_DIALOG_TYPES = new Set(['recording', 'text', 'transfer', 'incomplete']);
// Valid encoding values per DB check constraint
const VALID_ENCODINGS = new Set(['base64url', 'json', 'none']);

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (.env)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function hasEmbeddingCredentials(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.HF_API_TOKEN || process.env.AZURE_OPENAI_EMBEDDING_API_KEY);
}

async function runEmbedContinuous(): Promise<void> {
  const embedScript = path.join(__dirname, 'embed-vcons.ts');
  await new Promise<void>((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', embedScript, '--continuous', '--limit=500', '--delay=2'],
      { stdio: 'inherit', env: process.env }
    );
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`\n⚠️  embed-vcons.ts exited with code ${code} — embeddings may be incomplete`);
      }
      resolve();
    });
    child.on('error', (err) => {
      console.warn(`\n⚠️  Failed to run embed-vcons.ts: ${err.message}`);
      resolve();
    });
  });
}

async function refreshTagsMaterializedView(db: SupabaseClient): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🏷️  Refreshing vcon_tags_mv materialized view...');
  console.log('='.repeat(60) + '\n');
  const { error } = await db.rpc('refresh_vcon_tags_mv');
  if (error) {
    if (error.message.includes('does not exist') || error.code === '42883') {
      console.warn('⚠️  refresh_vcon_tags_mv not found — run migrations if tag search is required.');
    } else {
      console.warn(`⚠️  refresh_vcon_tags_mv failed: ${error.message}`);
      console.warn('     Run manually: REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;');
    }
    return;
  }
  const { count } = await db.from('vcon_tags_mv').select('*', { count: 'exact', head: true });
  console.log(`✅ vcon_tags_mv refreshed (${count?.toLocaleString() ?? '?'} rows)\n`);
}

// ─── Body normalisation ───────────────────────────────────────────────────────

function normaliseBody(body: any, encoding: string | undefined): { body: string | null; encoding: string | null } {
  if (body === null || body === undefined) return { body: null, encoding: null };
  const enc = VALID_ENCODINGS.has(encoding ?? '') ? (encoding as string) : null;
  if (typeof body === 'string') return { body, encoding: enc };
  // Object/array → JSON string, force encoding to 'json'
  return { body: JSON.stringify(body), encoding: 'json' };
}

function normaliseTagsBody(body: any): string {
  if (!body) return '[]';
  if (Array.isArray(body)) {
    if (body.length === 0 || typeof body[0] === 'string') return JSON.stringify(body);
    // [{key, value}] objects
    return JSON.stringify(body.map((t: any) => `${t.key ?? t.name ?? '?'}:${t.value ?? t.val ?? ''}`));
  }
  if (typeof body === 'object') {
    return JSON.stringify(Object.entries(body).map(([k, v]) => `${k}:${v}`));
  }
  return JSON.stringify([String(body)]);
}

// ─── File discovery ───────────────────────────────────────────────────────────

function findVConFiles(dir: string): string[] {
  const results: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...findVConFiles(full));
    else if (e.isFile() && /\.(vcon|json)$/.test(e.name)) results.push(full);
  }
  return results;
}

// ─── Pre-fetch existing UUIDs ─────────────────────────────────────────────────

async function fetchExistingUUIDs(): Promise<Set<string>> {
  const existing = new Set<string>();
  if (!SKIP_EXISTING) return existing;
  process.stdout.write('Fetching existing UUIDs from DB... ');
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('vcons').select('uuid').range(offset, offset + 4999);
    if (error) throw error;
    if (!data?.length) break;
    data.forEach(r => existing.add(r.uuid));
    if (data.length < 5000) break;
    offset += data.length;
  }
  console.log(`${existing.size.toLocaleString()} already in DB`);
  return existing;
}

// ─── Insert one vCon ─────────────────────────────────────────────────────────

async function insertVCon(db: SupabaseClient, raw: any): Promise<void> {
  const uuid: string = raw.uuid;

  // ── vcons ──────────────────────────────────────────────────────────────────
  // Handle both spec v0.0.1 (appended/must_support) and v0.4.0 (amended/critical)
  const amendedVal = raw.amended ?? raw.appended ?? null;
  const criticalVal = raw.critical ?? raw.must_support ?? null;

  const { data: vconRow, error: vconErr } = await db
    .from('vcons')
    .insert({
      uuid,
      subject:    raw.subject    || null,
      created_at: raw.created_at || new Date().toISOString(),
      redacted:   typeof raw.redacted === 'object' && raw.redacted !== null ? raw.redacted : {},
      amended:    typeof amendedVal  === 'object' && amendedVal  !== null ? amendedVal  : {},
      group_data: Array.isArray(raw.group) ? raw.group : [],
      // extensions and critical are text[] — only pass real string arrays
      extensions: Array.isArray(raw.extensions) ? raw.extensions : null,
      critical:   Array.isArray(criticalVal)    ? criticalVal    : null,
      tenant_id: TENANT_ID,
    })
    .select('id')
    .single();

  if (vconErr) throw new Error(`vcons: ${vconErr.message}`);
  const vconId: string = vconRow!.id;

  // ── parties ────────────────────────────────────────────────────────────────
  if (raw.parties?.length) {
    const rows = (raw.parties as any[]).map((p, i) => ({
      vcon_id:     vconId,
      party_index: i,
      tel:         p.tel    || null,
      sip:         p.sip    || null,
      mailto:      p.mailto || null,
      name:        p.name   || null,
      uuid:        p.uuid   || null,
      did:         p.did    || null,
      metadata:    p.meta ? { ...p.meta, role: p.role } : (p.role ? { role: p.role } : {}),
      tenant_id:   TENANT_ID,
    }));
    const { error } = await db.from('parties').insert(rows);
    if (error) throw new Error(`parties: ${error.message}`);
  }

  // ── dialog ─────────────────────────────────────────────────────────────────
  if (raw.dialog?.length) {
    const rows = (raw.dialog as any[]).map((d, i) => {
      const { body, encoding } = normaliseBody(d.body, d.encoding);
      return {
        vcon_id:          vconId,
        dialog_index:     i,
        type:             VALID_DIALOG_TYPES.has(d.type) ? d.type : 'text',
        start_time:       d.start || d.start_time || null,
        duration_seconds: d.duration ?? null,
        parties:          Array.isArray(d.parties) ? d.parties : [],
        originator:       d.originator ?? null,
        mediatype:        d.mimetype || d.mediatype || null,
        filename:         d.filename || null,
        body,
        encoding,
        url:              d.url      || null,
        message_id:       d.meta?.message_id || null,
        metadata:         d.meta ? { ...d.meta } : {},
        tenant_id:        TENANT_ID,
      };
    });
    const { error } = await db.from('dialog').insert(rows);
    if (error) throw new Error(`dialog: ${error.message}`);
  }

  // ── analysis ───────────────────────────────────────────────────────────────
  if (raw.analysis?.length) {
    const rows = (raw.analysis as any[]).map((a, i) => {
      const { body, encoding } = normaliseBody(a.body, a.encoding);
      return {
        vcon_id:        vconId,
        analysis_index: i,
        type:           a.type    || 'unknown',
        vendor:         a.vendor  || 'unknown',
        product:        a.product || null,
        schema:         a.schema  || a.schema_version || null,
        dialog_indices: Array.isArray(a.dialog) ? a.dialog : null,
        body,
        encoding,
        metadata:  a.meta ? { ...a.meta } : {},
        tenant_id: TENANT_ID,
      };
    });
    const { error } = await db.from('analysis').insert(rows);
    if (error) throw new Error(`analysis: ${error.message}`);
  }

  // ── attachments ────────────────────────────────────────────────────────────
  if (raw.attachments?.length) {
    const rows = (raw.attachments as any[]).map((a, i) => {
      let body: string | null;
      let encoding: string | null;
      if (a.type === 'tags') {
        body     = normaliseTagsBody(a.body);
        encoding = 'json';
      } else {
        ({ body, encoding } = normaliseBody(a.body, a.encoding));
      }
      return {
        vcon_id:          vconId,
        attachment_index: i,
        type:             a.type     || null,
        party:            a.party    ?? null,
        dialog:           a.dialog   ?? null,
        mimetype:         a.mimetype || a.mediatype || null,
        filename:         a.filename || null,
        body,
        encoding,
        url:              a.url      || null,
        metadata:         a.meta ? { ...a.meta } : {},
        tenant_id:        TENANT_ID,
      };
    });
    const { error } = await db.from('attachments').insert(rows);
    if (error) throw new Error(`attachments: ${error.message}`);
  }
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runPool(
  files: string[],
  concurrency: number,
  onDone: (file: string, err?: Error) => void
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const file = files[i++];
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!DRY_RUN) await insertVCon(supabase, raw);
        onDone(file);
      } catch (err: any) {
        onDone(file, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const skipEmbed = args.includes('--skip-embed');
  const skipTags = args.includes('--skip-tags');
  const dir = args.find(a => !a.startsWith('--'));
  if (!dir || !fs.existsSync(dir)) {
    console.error(
      `Usage: npx tsx scripts/import-vcon-files.ts <path/to/vcon/folder> [--skip-embed] [--skip-tags]\n` +
        (dir ? `Directory not found: ${dir}` : 'Missing directory argument.')
    );
    process.exit(1);
  }

  console.log(`\nvCon Bulk Importer`);
  console.log(`  Source:      ${dir}`);
  console.log(`  Database:    ${SUPABASE_URL}`);
  console.log(
    `  Concurrency: ${CONCURRENCY}  |  Skip existing: ${SKIP_EXISTING}  |  Dry run: ${DRY_RUN}  |  ` +
      `Post-import embed: ${skipEmbed || DRY_RUN ? 'no' : 'yes'}  |  Post-import tags MV: ${skipTags || DRY_RUN ? 'no' : 'yes'}\n`
  );

  process.stdout.write('Scanning .vcon files... ');
  const allFiles = findVConFiles(dir);
  console.log(`${allFiles.length.toLocaleString()} found`);

  const existing = await fetchExistingUUIDs();

  const toImport = allFiles.filter(f => !existing.has(path.basename(f, path.extname(f))));
  const skipped  = allFiles.length - toImport.length;
  console.log(`Importing ${toImport.length.toLocaleString()} files (${skipped.toLocaleString()} already in DB)\n`);

  if (!toImport.length) {
    console.log('Nothing to import.');
    if (!DRY_RUN) {
      await postImportPipeline(skipEmbed, skipTags);
    }
    return;
  }

  const start = Date.now();
  let done = 0, errors = 0;
  const errorLog: string[] = [];

  await runPool(toImport, CONCURRENCY, (file, err) => {
    if (err) {
      errors++;
      errorLog.push(`${path.basename(file)}: ${err.message}`);
    } else {
      done++;
    }
    // Progress every 100 files
    const total = toImport.length;
    const n = done + errors;
    if (n % 100 === 0 || n === total) {
      const elapsed = (Date.now() - start) / 1000;
      const rate    = elapsed > 0 ? Math.round(n / elapsed) : 0;
      const eta     = rate > 0 ? Math.round((total - n) / rate) : 0;
      const pct     = Math.round((n / total) * 100);
      const bar     = '█'.repeat(Math.floor(pct / 5)).padEnd(20, '░');
      process.stdout.write(`\r  [${bar}] ${pct}%  ${n.toLocaleString()}/${total.toLocaleString()}  ${rate}/s  ETA ${eta}s  err:${errors}  `);
    }
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n\n✅ Done in ${elapsed}s`);
  console.log(`   Imported: ${done.toLocaleString()}`);
  console.log(`   Errors:   ${errors.toLocaleString()}`);

  if (errorLog.length) {
    const logFile = path.join(process.cwd(), 'import-errors.log');
    fs.writeFileSync(logFile, errorLog.join('\n') + '\n');
    console.log(`\n   Error log: ${logFile}`);
    console.log(`   First 5 errors:`);
    errorLog.slice(0, 5).forEach(l => console.log(`     ${l}`));
  }

  if (!DRY_RUN) {
    const { count } = await supabase.from('vcons').select('*', { count: 'exact', head: true });
    console.log(`\n   Total vCons in DB: ${count?.toLocaleString()}`);
    await postImportPipeline(skipEmbed, skipTags);
  }
}

async function postImportPipeline(skipEmbed: boolean, skipTags: boolean): Promise<void> {
  if (!skipEmbed) {
    if (hasEmbeddingCredentials()) {
      console.log('\n' + '='.repeat(60));
      console.log('🔮 Running embedding backfill (continuous until caught up)...');
      console.log('   (use --skip-embed to disable)');
      console.log('='.repeat(60));
      await runEmbedContinuous();
    } else {
      console.log('\n⚠️  Skipping embeddings: set OPENAI_API_KEY or HF_API_TOKEN (or Azure embedding vars).');
      console.log('   Use --skip-embed to silence this message when keys are intentionally omitted.\n');
    }
  }

  if (!skipTags) {
    await refreshTagsMaterializedView(supabase);
  }
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
