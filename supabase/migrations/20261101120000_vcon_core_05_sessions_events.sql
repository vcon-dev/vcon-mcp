-- vCon core-05 (syntax "0.5.0"): Session and Event storage.
--
-- NOT APPLIED by the change that added it. Review, then apply with your usual
-- migration runner (`supabase db push` or the SQL editor). Nothing in this repo
-- runs it.
--
-- What 0.5.0 adds to storage (draft-ietf-vcon-vcon-core-05):
--   * sessions   new table: the Session Object (Section 4.2), the scope of dialog and events
--   * events     new table: the Event Object (Section 4.3); replaces Dialog party_history and
--                the 'transfer' Dialog
--   * vcons      redacted -> redacted_from, amended -> amended_from (renamed), redacted_strings
--   * attachments / analysis   session_indices: Attachment `session`, Analysis `sessions`
--   * dialog     empty Dialog Object {} is a row with type NULL; originator moved to the Session
--   * save_vcon_batch          takes p_sessions and p_events
--
-- Existing rows are NOT converted here. A vCon whose vcon_version is not '0.5.0' is read
-- through the TypeScript migration module (src/utils/vcon-migration.ts, a port of the
-- reference vcon-lib migration), which reads the legacy dialog.originator column and the
-- party_history / transfer / recording-set data in dialog.extra, and is written back as
-- 0.5.0, Sessions and Events included, the first time it is changed. Nothing is lost by
-- applying this migration before or after the new server is deployed:
--   * old server, new schema: keeps working (it never touches the new tables or columns,
--     except that it reads `redacted` / `amended`, which this migration renames; deploy the
--     2.0.0 server with or right after this migration);
--   * new server, old schema: reads work (missing tables read as no Sessions or Events), but
--     a write that needs them fails, and create_vcon takes the non-atomic fallback.
--
-- Per-group schemas: like save_vcon_batch before it, this creates objects in the caller's
-- search_path (public). Apply it again in each per-group schema.
--
-- Idempotent: every statement guards on existing state.
--
-- Data: nothing is dropped. The two renames keep their data; dialog.originator and the
-- party_history table stay (legacy rows still read them). A stored 0.4.0 vCon is rewritten
-- as 0.5.0 only by a structural write (upgrade on write) or a re-post, and the migration
-- report of that rewrite (every dropped value, removed Dialogs verbatim) is first appended to
-- vcon_migration_reports (section 8), so the rewrite never loses the 0.4.0 content.
--
-- Rollback (manual, no down migration). Only before any 0.5.0 data has been written:
--   ALTER TABLE vcons RENAME COLUMN redacted_from TO redacted;
--   ALTER TABLE vcons RENAME COLUMN amended_from TO amended;
--   ALTER TABLE vcons DROP COLUMN redacted_strings;
--   then restore sync_vcon_deprecated_fields() and get_vcon_amended() from
--   20251120150100_field_renames.sql, the dialog_type_check of the initial schema and
--   type NOT NULL, the five-argument save_vcon_batch from 20261020130000_save_vcon_batch.sql,
--   and cascade_tenant_id_update() from 20251122175919_create_tenant_triggers.sql;
--   DROP TABLE events, sessions, vcon_migration_reports; drop the session_indices columns.
-- After 0.5.0 writes, rolling back loses Sessions and Events; restore from a backup instead.

SET client_min_messages TO WARNING;

-- ============================================================================
-- 1. vcons: renamed columns and redacted_strings
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'vcons' AND column_name = 'redacted')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'vcons' AND column_name = 'redacted_from') THEN
    ALTER TABLE vcons RENAME COLUMN redacted TO redacted_from;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'vcons' AND column_name = 'amended')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'vcons' AND column_name = 'amended_from') THEN
    ALTER TABLE vcons RENAME COLUMN amended TO amended_from;
  END IF;
END $$;

-- A view that selected the old columns (vcons_legacy) keeps working: Postgres tracks the
-- renamed column by attribute number and the view keeps its old output names.

-- The draft-01 transition trigger and helper read the renamed column by name. Left as they
-- were, every INSERT and UPDATE on vcons fails after the rename ("record new has no field
-- amended"). They are redefined on amended_from; behaviour is otherwise unchanged.
CREATE OR REPLACE FUNCTION sync_vcon_deprecated_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.critical IS NOT NULL THEN
    NEW.must_support := NEW.critical;
  ELSIF NEW.must_support IS NOT NULL AND NEW.critical IS NULL THEN
    NEW.critical := NEW.must_support;
  END IF;

  IF NEW.amended_from IS NOT NULL AND NEW.amended_from != '{}'::jsonb THEN
    NEW.appended := NEW.amended_from;
  ELSIF NEW.appended IS NOT NULL AND NEW.appended != '{}'::jsonb
        AND (NEW.amended_from IS NULL OR NEW.amended_from = '{}'::jsonb) THEN
    NEW.amended_from := NEW.appended;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_vcon_amended(vcon_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT COALESCE(
    NULLIF(amended_from, '{}'::jsonb),
    NULLIF(appended, '{}'::jsonb),
    '{}'::jsonb
  ) INTO result
  FROM vcons
  WHERE id = vcon_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE vcons ADD COLUMN IF NOT EXISTS redacted_from JSONB DEFAULT '{}';
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS amended_from JSONB DEFAULT '{}';
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS redacted_strings JSONB;

COMMENT ON COLUMN vcons.redacted_from IS 'Section 4.1.8 Redacted_from Object (was `redacted`). Empty object means absent. Mutually exclusive with amended_from.';
COMMENT ON COLUMN vcons.amended_from  IS 'Section 4.1.9 Amended_from Object (was `amended`). Empty object means absent. Mutually exclusive with redacted_from.';
COMMENT ON COLUMN vcons.redacted_strings IS 'Section 4.1.16 Redacted_string Objects ({ref, type, orig}) for __REDACTED_REF_<ref> markers.';

-- ============================================================================
-- 2. dialog: the empty Dialog Object {} and the 0.5.0 type set
-- ============================================================================

-- An empty Dialog Object holds an index position (Section 4.5.1) and has no type.
ALTER TABLE dialog ALTER COLUMN type DROP NOT NULL;

-- 0.5.0 writes recording, text and incomplete. 'audio' and 'video' are read-only values older
-- versions of this server stored; 'transfer' and 'recording-set' rows are 0.4.0 data awaiting
-- migration on read (a database whose original check was relaxed may hold either; without
-- them here the ADD CONSTRAINT fails on such a database).
ALTER TABLE dialog DROP CONSTRAINT IF EXISTS dialog_type_check;
ALTER TABLE dialog ADD CONSTRAINT dialog_type_check
  CHECK (type IS NULL OR type IN ('recording', 'text', 'incomplete', 'audio', 'video', 'transfer', 'recording-set'));

COMMENT ON COLUMN dialog.originator IS 'DEPRECATED, 0.4.0 rows only. Moved to sessions.originator in 0.5.0; no longer written.';
COMMENT ON COLUMN dialog.parties IS 'Contributors only (0.5.0). Receivers are sessions.parties. A null slot or a per-channel nested list is kept in dialog.extra (parties) and this column is NULL.';

-- ============================================================================
-- 3. attachments and analysis: Session references
-- ============================================================================

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS session_indices INTEGER[];
ALTER TABLE analysis    ADD COLUMN IF NOT EXISTS session_indices INTEGER[];

COMMENT ON COLUMN attachments.session_indices IS 'Section 4.6.5 Attachment `session`: indexes into the sessions of this vCon. At least one of dialog or session is required.';
COMMENT ON COLUMN analysis.session_indices    IS 'Section 4.7.3 Analysis `sessions`: indexes into the sessions of this vCon.';

CREATE INDEX IF NOT EXISTS idx_attachments_session_indices ON attachments USING GIN (session_indices);
CREATE INDEX IF NOT EXISTS idx_analysis_session_indices    ON analysis    USING GIN (session_indices);

-- ============================================================================
-- 4. sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(uuid) ON DELETE CASCADE, -- uuid, as every child table (20260527230000)
    session_index INTEGER NOT NULL,           -- Index in the vCon sessions array
    tenant_id TEXT,

    -- Session Object (Section 4.2). A Session with no parameters is a row of NULLs.
    start_time TIMESTAMPTZ,                   -- 4.2.1
    duration_seconds REAL,                    -- 4.2.2
    parties INTEGER[],                        -- 4.2.3 receivers; the first is the implied originator
    originator INTEGER,                       -- 4.2.4 only when parties[1] is NOT the originator
    session_id JSONB,                         -- 4.2.5 SessionId {local, remote}
    session_refs JSONB,                       -- 4.2.6 Session_Reference[] {session, type, description}
    dialog_indices INTEGER[],                 -- 4.2.7 indexes into the dialog array

    extra JSONB,                              -- keys with no column of their own

    UNIQUE (vcon_id, session_index)
);

COMMENT ON TABLE sessions IS 'Session Objects (core-05 Section 4.2): the scope for dialog and events.';
COMMENT ON COLUMN sessions.parties IS 'Receivers (indexes into the parties of the vCon). Contributors are in dialog.parties.';
COMMENT ON COLUMN sessions.dialog_indices IS 'Indexes into the dialog array of this vCon. Every Dialog SHOULD be listed by at least one Session.';
COMMENT ON COLUMN sessions.session_refs IS 'Session_Reference Objects: child, peer, precursor, breakout (or an extension value).';

-- Indexed where dialog is indexed (vcon_id, start, session id, tenant), plus the array columns.
CREATE INDEX IF NOT EXISTS idx_sessions_vcon           ON sessions(vcon_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start          ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id     ON sessions USING GIN (session_id jsonb_path_ops) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_parties        ON sessions USING GIN (parties);
CREATE INDEX IF NOT EXISTS idx_sessions_dialog_indices ON sessions USING GIN (dialog_indices);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id      ON sessions(tenant_id);

-- ============================================================================
-- 5. events
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(uuid) ON DELETE CASCADE, -- uuid, as every child table (20260527230000)
    event_index INTEGER NOT NULL,             -- Index in the vCon events array (not chronological)
    tenant_id TEXT,

    -- Event Object (Section 4.3)
    type TEXT NOT NULL,                       -- 4.3.1 join, drop, hold, unhold, mute, unmute, keydown, keyup,
                                              --   consultation-start, blind-transfer, consultative-transfer,
                                              --   transfer-abandoned, channel-contributors, or an extension value
    time TIMESTAMPTZ,                         -- 4.3.2 MUST be present; nullable so a malformed legacy value is kept, not lost
    session_indices INTEGER[],                -- 4.3.3 `sessions` (a single index for transfer types)
    party INTEGER,                            -- 4.3.4 (the Transferor for transfer types)
    dialog JSONB,                             -- 4.3.5 channel-contributors; an extension type may use an array
    channel INTEGER,                          -- 4.3.6
    contributors JSONB,                       -- 4.3.7 index, list of indexes, or null
    button TEXT,                              -- 4.3.8 keydown / keyup
    transferee INTEGER,                       -- 4.3.9
    transfer_target INTEGER,                  -- 4.3.10
    consultation INTEGER,                     -- 4.3.11 Session index
    target_session INTEGER,                   -- 4.3.12 Session index

    extra JSONB,                              -- extension parameters, shape hints

    UNIQUE (vcon_id, event_index)
);

COMMENT ON TABLE events IS 'Event Objects (core-05 Section 4.3): point-in-time occurrences. Replace dialog party_history and transfer dialogs.';
COMMENT ON COLUMN events.session_indices IS 'Sessions the event applies to; it does not apply to their child or parent Sessions unless they are listed.';

CREATE INDEX IF NOT EXISTS idx_events_vcon            ON events(vcon_id);
CREATE INDEX IF NOT EXISTS idx_events_type            ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_time            ON events("time");
CREATE INDEX IF NOT EXISTS idx_events_session_indices ON events USING GIN (session_indices);
CREATE INDEX IF NOT EXISTS idx_events_party           ON events(party) WHERE party IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_tenant_id       ON events(tenant_id);

-- ============================================================================
-- 6. Tenant isolation: the same pattern as the other child tables
-- ============================================================================

-- BEFORE INSERT: keep the parent's tenant when it is visible, else the explicit value
-- (20261020150000_child_tenant_id_keep_explicit.sql). Matched on vcons.uuid, the column the
-- foreign key references.
CREATE OR REPLACE FUNCTION set_sessions_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.uuid = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_events_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.uuid = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_sessions_tenant_id ON sessions;
CREATE TRIGGER trg_set_sessions_tenant_id
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_sessions_tenant_id();

DROP TRIGGER IF EXISTS trg_set_events_tenant_id ON events;
CREATE TRIGGER trg_set_events_tenant_id
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION set_events_tenant_id();

-- When a vCon's tenant changes, its Sessions and Events follow (extends the cascade of
-- 20251122175919_create_tenant_triggers.sql; the rest of that function is unchanged).
CREATE OR REPLACE FUNCTION cascade_tenant_id_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    UPDATE parties SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE dialog SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE attachments SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE analysis SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE groups SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE sessions SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.uuid;  -- FK is vcons(uuid)
    UPDATE events SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.uuid;
    UPDATE vcon_migration_reports SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.uuid;
    UPDATE party_history
    SET tenant_id = NEW.tenant_id
    FROM dialog
    WHERE dialog.id = party_history.dialog_id
      AND dialog.vcon_id = NEW.id;
    UPDATE vcon_embeddings SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE embedding_queue SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    UPDATE s3_sync_tracking SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_tenant_isolation" ON sessions;
CREATE POLICY "sessions_tenant_isolation" ON sessions
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS "events_tenant_isolation" ON events;
CREATE POLICY "events_tenant_isolation" ON events
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vcon_dashboard_readonly') THEN
    GRANT SELECT ON sessions TO vcon_dashboard_readonly;
    GRANT SELECT ON events TO vcon_dashboard_readonly;
  END IF;
END $$;

-- ============================================================================
-- 7. save_vcon_batch: also writes sessions and events
-- ============================================================================
-- Same semantics as 20261020130000_save_vcon_batch.sql (one transaction, idempotent upsert
-- by (vcon_id, *_index), column list = union of keys). The five-argument form is dropped:
-- keeping both would make a named-argument call ambiguous.

DROP FUNCTION IF EXISTS save_vcon_batch(JSONB, JSONB, JSONB, JSONB, JSONB);

CREATE OR REPLACE FUNCTION save_vcon_batch(
  p_vcons JSONB,
  p_parties JSONB DEFAULT '[]'::jsonb,
  p_dialog JSONB DEFAULT '[]'::jsonb,
  p_analysis JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb,
  p_sessions JSONB DEFAULT '[]'::jsonb,
  p_events JSONB DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  spec RECORD;
  col_list TEXT;
  set_list TEXT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      (1, 'vcons',       p_vcons,       'id'),
      (2, 'parties',     p_parties,     'vcon_id, party_index'),
      (3, 'dialog',      p_dialog,      'vcon_id, dialog_index'),
      (4, 'sessions',    p_sessions,    'vcon_id, session_index'),
      (5, 'events',      p_events,      'vcon_id, event_index'),
      (6, 'analysis',    p_analysis,    'vcon_id, analysis_index'),
      (7, 'attachments', p_attachments, 'vcon_id, attachment_index')
    ) AS s(ord, tbl, rows, conflict)
    ORDER BY ord
  LOOP
    CONTINUE WHEN spec.rows IS NULL OR jsonb_array_length(spec.rows) = 0;

    SELECT string_agg(format('%I', k), ', ' ORDER BY k),
           string_agg(format('%I = EXCLUDED.%I', k, k), ', ' ORDER BY k)
      INTO col_list, set_list
      FROM (SELECT DISTINCT jsonb_object_keys(r) AS k
              FROM jsonb_array_elements(spec.rows) AS r) AS keys;

    EXECUTE format(
      'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%I, $1) '
      'ON CONFLICT (%s) DO UPDATE SET %s',
      spec.tbl, col_list, col_list, spec.tbl, spec.conflict, set_list
    ) USING spec.rows;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION save_vcon_batch(JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB)
  TO authenticated, service_role;

-- ============================================================================
-- 8. vcon_migration_reports: the report of every 0.4.0 -> 0.5.0 rewrite
-- ============================================================================
-- The reference migration requires the report to be stored with each record migrated in
-- production: it holds every value the migration dropped and each removed Dialog verbatim,
-- so it is the only copy of that content once the 0.4.0 rows are rewritten. Append-only:
-- the server inserts one row before it rewrites a stored 0.4.0 vCon (upgrade on write) and
-- one after it stores a vCon that was posted as 0.4.0. A migration on read that writes
-- nothing back stores nothing (the 0.4.0 rows are still there).

CREATE TABLE IF NOT EXISTS vcon_migration_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(uuid) ON DELETE CASCADE,
    tenant_id TEXT,
    source_version TEXT,
    target_version TEXT NOT NULL,
    trigger TEXT NOT NULL,                    -- 'upgrade-on-write' or 'create'
    report JSONB NOT NULL,                    -- MigrationReport, as the reference to_dict() shape
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vcon_migration_reports IS 'Append-only reports of 0.4.0 -> 0.5.0 migrations written back to storage. Holds every dropped value and each removed Dialog verbatim.';

CREATE INDEX IF NOT EXISTS idx_vcon_migration_reports_vcon      ON vcon_migration_reports(vcon_id);
CREATE INDEX IF NOT EXISTS idx_vcon_migration_reports_tenant_id ON vcon_migration_reports(tenant_id);

CREATE OR REPLACE FUNCTION set_vcon_migration_reports_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.uuid = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_vcon_migration_reports_tenant_id ON vcon_migration_reports;
CREATE TRIGGER trg_set_vcon_migration_reports_tenant_id
  BEFORE INSERT ON vcon_migration_reports
  FOR EACH ROW EXECUTE FUNCTION set_vcon_migration_reports_tenant_id();

ALTER TABLE vcon_migration_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vcon_migration_reports_tenant_isolation" ON vcon_migration_reports;
CREATE POLICY "vcon_migration_reports_tenant_isolation" ON vcon_migration_reports
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());
