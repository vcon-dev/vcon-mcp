-- Verification for vcons.conversation_start
-- (migration 20261019171238_add_conversation_start.sql).
--
-- Rule, with "plausible" meaning start_time >= 1990-01-01T00:00:00Z (NULLs
-- and earlier placeholders such as 1970 epoch defaults are ignored):
--   COALESCE(min plausible dialog start,
--            LEAST(min plausible attachment start, created_at))
--
-- Run against a database where the migration has been applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/conversation_start.sql
--
-- Everything runs in one transaction that is rolled back, so no test rows are
-- left behind. Any mismatch raises an exception naming the failing check.
-- The final check recomputes the rule for every vCon in the table (a full
-- scan) to confirm the backfill; skip it on very large databases by editing
-- the script.

\set ON_ERROR_STOP on

BEGIN;

-- Check output is noise; failures still reach stderr.
\o /dev/null

CREATE FUNCTION pg_temp.expect(p_id uuid, p_expected timestamptz, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  got timestamptz;
BEGIN
  SELECT conversation_start INTO got FROM vcons WHERE id = p_id;
  IF got IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'conversation_start check failed [%]: expected %, got %', p_label, p_expected, got;
  END IF;
END;
$$;

-- Test vCons. created_at is 2026-10-01 unless a case says otherwise.
INSERT INTO vcons (id, uuid, subject, created_at) VALUES
  ('c0ffee00-0000-4000-8000-000000000001', 'c0ffee00-0000-4000-8000-000000000001', 'cs-test dialog lifecycle',  '2026-10-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000002', 'c0ffee00-0000-4000-8000-000000000002', 'cs-test null starts',       '2026-10-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000003', 'c0ffee00-0000-4000-8000-000000000003', 'cs-test placeholders',      '2026-10-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000004', 'c0ffee00-0000-4000-8000-000000000004', 'cs-test attachment only',   '2026-10-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000005', 'c0ffee00-0000-4000-8000-000000000005', 'cs-test late stamps only',  '2026-10-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000006', 'c0ffee00-0000-4000-8000-000000000006', 'cs-test dialog beats att',  '2026-10-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000007', 'c0ffee00-0000-4000-8000-000000000007', 'cs-test no children',       '2026-10-01T00:00:00Z');

SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-10-01T00:00:00Z', 'insert sets created_at');

-- 1. Dialog insert / update / delete ------------------------------------------
INSERT INTO dialog (vcon_id, dialog_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000001', 0, 'text', '2026-05-10T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000001', 1, 'text', '2026-05-03T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-05-03T00:00:00Z', 'dialog insert: min dialog start');

UPDATE dialog SET start_time = '2026-06-01T00:00:00Z'
 WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000001' AND dialog_index = 1;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-05-10T00:00:00Z', 'dialog update moves min');

DELETE FROM dialog WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000001' AND dialog_index = 0;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-06-01T00:00:00Z', 'dialog delete');

-- Upsert conflict path, as the server's batch writer issues it
INSERT INTO dialog (vcon_id, dialog_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000001', 1, 'text', '2026-04-15T00:00:00Z')
  ON CONFLICT (vcon_id, dialog_index) DO UPDATE SET start_time = EXCLUDED.start_time;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-04-15T00:00:00Z', 'dialog upsert conflict update');

-- Parent re-upsert with unchanged created_at keeps the value
INSERT INTO vcons (id, uuid, subject, created_at) VALUES
  ('c0ffee00-0000-4000-8000-000000000001', 'c0ffee00-0000-4000-8000-000000000001', 'cs-test dialog lifecycle', '2026-10-01T00:00:00Z')
  ON CONFLICT (id) DO UPDATE SET subject = EXCLUDED.subject, created_at = EXCLUDED.created_at;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-04-15T00:00:00Z', 'parent re-upsert keeps value');

-- removeDialog-style placeholder: start cleared
UPDATE dialog SET start_time = NULL WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000001';
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000001', '2026-10-01T00:00:00Z', 'all dialog starts NULL -> created_at');

-- 2. NULL starts ---------------------------------------------------------------
INSERT INTO dialog (vcon_id, dialog_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000002', 0, 'text', NULL);
INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000002', 0, 'note', NULL);
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000002', '2026-10-01T00:00:00Z', 'NULL starts ignored');

-- 3. Placeholder 1970 starts ---------------------------------------------------
INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000003', 0, 'note', '1970-01-01T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000003', '2026-10-01T00:00:00Z', '1970 attachment start ignored');

INSERT INTO dialog (vcon_id, dialog_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000003', 0, 'text', '1970-01-01T00:00:00Z');
INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000003', 1, 'note', '2026-05-05T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000003', '2026-05-05T00:00:00Z', '1970 dialog start ignored, attachment used');

-- 4. Attachment-only vCon, plus a later-stamped enrichment attachment -----------
INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000004', 0, 'email', '2026-05-01T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000004', '2026-05-01T00:00:00Z', 'attachment-only: min attachment start');

INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000004', 1, 'enrichment', '2026-10-19T12:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000004', '2026-05-01T00:00:00Z', 'later enrichment attachment does not move it');

DELETE FROM attachments WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000004' AND attachment_index = 0;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000004', '2026-10-01T00:00:00Z', 'only late-stamped attachment left -> capped at created_at');

-- Every attachment stamped after created_at from the start
INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000005', 0, 'enrichment', '2026-11-01T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000005', 1, 'enrichment', '2026-11-02T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000005', '2026-10-01T00:00:00Z', 'late stamps capped at created_at');

-- Unrelated attachment update (e.g. tag rewrite) leaves it alone
UPDATE attachments SET body = '["k:v"]' WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000005' AND attachment_index = 0;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000005', '2026-10-01T00:00:00Z', 'non-start attachment update');

-- 5. Dialog start wins over attachments, even after created_at ------------------
INSERT INTO attachments (vcon_id, attachment_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000006', 0, 'email', '2026-04-01T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000006', '2026-04-01T00:00:00Z', 'attachment only so far');
INSERT INTO dialog (vcon_id, dialog_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000006', 0, 'text', '2026-12-01T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000006', '2026-12-01T00:00:00Z', 'dialog start wins, not capped');

-- Moving a dialog row to another vCon recomputes both
UPDATE dialog SET vcon_id = 'c0ffee00-0000-4000-8000-000000000007'
 WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000006' AND dialog_index = 0;
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000006', '2026-04-01T00:00:00Z', 'dialog moved away');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000007', '2026-12-01T00:00:00Z', 'dialog moved in');
UPDATE dialog SET vcon_id = 'c0ffee00-0000-4000-8000-000000000006'
 WHERE vcon_id = 'c0ffee00-0000-4000-8000-000000000007';

-- 6. created_at changes ---------------------------------------------------------
UPDATE vcons SET created_at = '2026-01-01T00:00:00Z' WHERE id = 'c0ffee00-0000-4000-8000-000000000007';
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000007', '2026-01-01T00:00:00Z', 'no children: follows created_at');

UPDATE vcons SET created_at = '2026-12-15T00:00:00Z' WHERE id = 'c0ffee00-0000-4000-8000-000000000005';
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000005', '2026-11-01T00:00:00Z', 'created_at raised past attachment stamps');

UPDATE vcons SET created_at = '2026-03-01T00:00:00Z' WHERE id = 'c0ffee00-0000-4000-8000-000000000006';
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000006', '2026-12-01T00:00:00Z', 'created_at change does not cap dialog start');

-- 7. One statement touching several vCons ---------------------------------------
INSERT INTO dialog (vcon_id, dialog_index, type, start_time) VALUES
  ('c0ffee00-0000-4000-8000-000000000002', 1, 'text', '2026-02-02T00:00:00Z'),
  ('c0ffee00-0000-4000-8000-000000000004', 0, 'text', '2026-02-03T00:00:00Z');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000002', '2026-02-02T00:00:00Z', 'multi-vCon insert (a)');
SELECT pg_temp.expect('c0ffee00-0000-4000-8000-000000000004', '2026-02-03T00:00:00Z', 'multi-vCon insert (b)');

-- 8. Cascade delete through the child triggers ----------------------------------
DELETE FROM vcons WHERE id = 'c0ffee00-0000-4000-8000-000000000003';

-- 9. Every row matches the rule (backfill + triggers) ---------------------------
DO $$
DECLARE
  bad record;
BEGIN
  SELECT v.id, v.conversation_start,
         COALESCE(
           (SELECT min(d.start_time) FROM dialog d
             WHERE d.vcon_id = v.id AND d.start_time >= '1990-01-01T00:00:00Z'),
           LEAST(
             (SELECT min(a.start_time) FROM attachments a
               WHERE a.vcon_id = v.id AND a.start_time >= '1990-01-01T00:00:00Z'),
             v.created_at)
         ) AS expected
    INTO bad
    FROM vcons v
   WHERE v.conversation_start IS DISTINCT FROM COALESCE(
           (SELECT min(d.start_time) FROM dialog d
             WHERE d.vcon_id = v.id AND d.start_time >= '1990-01-01T00:00:00Z'),
           LEAST(
             (SELECT min(a.start_time) FROM attachments a
               WHERE a.vcon_id = v.id AND a.start_time >= '1990-01-01T00:00:00Z'),
             v.created_at))
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'conversation_start check failed [table-wide rule]: vcon % has %, expected %',
      bad.id, bad.conversation_start, bad.expected;
  END IF;
END;
$$;

\o
SELECT 'conversation_start: all checks passed' AS result;

ROLLBACK;
