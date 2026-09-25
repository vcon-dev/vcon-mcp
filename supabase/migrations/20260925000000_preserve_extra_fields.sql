-- CON-1047: keep vCon keys that have no column of their own.
--
-- The row builders (src/db/batch-writer.ts) put every input key they do not map
-- to a column into `extra` (party id/role/meta, top-level meta, dialog
-- meta/alg/signature, attachment id, analysis vendor_schema, any extension key),
-- and assembleVCon merges it back on read. `extra` may also hold a reserved
-- `_vcon_mcp_shape` object with type hints for body and analysis.dialog; it is
-- never returned to clients. NULL when nothing was left over.
--
-- Views and vcon_tags_mv list their columns explicitly, and no RPC returns
-- these tables' rows by `*` into a fixed column list, so nothing else changes.

ALTER TABLE vcons       ADD COLUMN IF NOT EXISTS extra JSONB;
ALTER TABLE parties     ADD COLUMN IF NOT EXISTS extra JSONB;
ALTER TABLE dialog      ADD COLUMN IF NOT EXISTS extra JSONB;
ALTER TABLE analysis    ADD COLUMN IF NOT EXISTS extra JSONB;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extra JSONB;

COMMENT ON COLUMN vcons.extra       IS 'vCon keys with no column of their own (e.g. meta); merged back on read.';
COMMENT ON COLUMN parties.extra     IS 'Party keys with no column of their own (e.g. id, role, meta); merged back on read.';
COMMENT ON COLUMN dialog.extra      IS 'Dialog keys with no column of their own (e.g. meta, alg, signature); merged back on read.';
COMMENT ON COLUMN analysis.extra    IS 'Analysis keys with no column of their own (e.g. vendor_schema); merged back on read.';
COMMENT ON COLUMN attachments.extra IS 'Attachment keys with no column of their own (e.g. id); merged back on read.';
