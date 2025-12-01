-- Indexes to stop timeouts on analysis/attachments counts and speed up vcons filtering
CREATE INDEX IF NOT EXISTS idx_analysis_vcon_id ON public.analysis (vcon_id);
CREATE INDEX IF NOT EXISTS idx_attachments_vcon_id ON public.attachments (vcon_id);

-- Support the subquery that filters vcons by date
CREATE INDEX IF NOT EXISTS idx_vcons_created_at ON public.vcons (created_at);
-- Note: idx_vcons_tenant_created_at is created later in 20251122175915_create_tenant_id_indexes.sql
-- after tenant_id column is added to the vcons table