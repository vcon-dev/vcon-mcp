-- Partial index to speed up tag-related queries on the attachments table.
-- Without this, getUniqueTags fallback and searchByTags fallback do full
-- sequential scans of 600k+ rows looking for type='tags'.
-- After: index-only scan on the ~113k tag rows.

CREATE INDEX IF NOT EXISTS idx_attachments_tags_partial
  ON attachments (vcon_id, body)
  WHERE type = 'tags';
