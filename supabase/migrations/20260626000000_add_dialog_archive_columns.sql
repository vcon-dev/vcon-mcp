-- Migration: Add recording-archive locator columns to dialog
--
-- These point a dialog at its recording inside a compressed archive (e.g. a
-- .tar.zst on a mounted filesystem or in S3): archive_url + byte offset/length
-- locate a single zstd frame that decompresses to one Ogg-Opus file.
-- archived_at is NULL until the recording has been committed to the archive.
--
-- These columns already exist on deployments where recording archival was
-- enabled out-of-band; this formalizes them in the schema. Idempotent so it
-- no-ops where they are already present.

ALTER TABLE dialog ADD COLUMN IF NOT EXISTS archive_url TEXT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS archive_member TEXT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS archive_offset BIGINT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS archive_length BIGINT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
