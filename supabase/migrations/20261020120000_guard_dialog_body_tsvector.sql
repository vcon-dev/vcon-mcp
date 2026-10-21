-- CON-957: inserting a dialog with a large inline base64 recording failed with
-- "string is too long for tsvector (N bytes, max 1048575 bytes)" (HTTP 500)
-- because update_dialog_body_tsvector() ran to_tsvector() on every body.
--
-- Binary bodies are not searchable text, so skip them. Text bodies are
-- truncated to stay under the tsvector cap, with a last-resort fallback to NULL.
--
-- Search RPCs (search_vcons_keyword / search_vcons_hybrid, latest definitions)
-- read the stored body_tsvector column, so no query-time guard is needed.
--
-- Backfill (not run here): rows already stored cannot contain an oversized
-- tsvector, so no backfill is required. Existing base64 rows that did get a
-- (junk) tsvector can be cleaned in bounded batches if desired:
--   UPDATE dialog SET body_tsvector = NULL
--   WHERE body_tsvector IS NOT NULL AND encoding = 'base64url';

CREATE OR REPLACE FUNCTION update_dialog_body_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.body IS NULL
     OR NEW.encoding = 'base64url'
     OR (
       NEW.mediatype IS NOT NULL
       AND NEW.mediatype !~* '^(text/|message/|application/json|application/[^;[:space:]]*\+json)'
     )
  THEN
    NEW.body_tsvector := NULL;
    RETURN NEW;
  END IF;

  BEGIN
    NEW.body_tsvector := setweight(to_tsvector('english', left(NEW.body, 400000)), 'C');
  EXCEPTION WHEN program_limit_exceeded THEN
    NEW.body_tsvector := NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger fires on body only; also refire when encoding or mediatype change.
DROP TRIGGER IF EXISTS trigger_dialog_body_tsvector ON dialog;
CREATE TRIGGER trigger_dialog_body_tsvector
  BEFORE INSERT OR UPDATE OF body, encoding, mediatype ON dialog
  FOR EACH ROW
  EXECUTE FUNCTION update_dialog_body_tsvector();

-- Same guard for analysis: update_analysis_body_tsvector() ran to_tsvector()
-- on every body, so a large base64url analysis body failed the same way.
-- Weight stays 'B' as in the original definition. Attachments have no
-- tsvector trigger, so nothing to guard there.
CREATE OR REPLACE FUNCTION update_analysis_body_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.body IS NULL
     OR NEW.encoding = 'base64url'
     OR (
       NEW.mediatype IS NOT NULL
       AND NEW.mediatype !~* '^(text/|message/|application/json|application/[^;[:space:]]*\+json)'
     )
  THEN
    NEW.body_tsvector := NULL;
    RETURN NEW;
  END IF;

  BEGIN
    NEW.body_tsvector := setweight(to_tsvector('english', left(NEW.body, 400000)), 'B');
  EXCEPTION WHEN program_limit_exceeded THEN
    NEW.body_tsvector := NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_analysis_body_tsvector ON analysis;
CREATE TRIGGER trigger_analysis_body_tsvector
  BEFORE INSERT OR UPDATE OF body, encoding, mediatype ON analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_analysis_body_tsvector();
