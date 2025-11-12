-- Speed up dashboard counts by adding essential indexes for join/filter columns
-- Child tables: ensure fast JOIN by vcon_id
CREATE INDEX IF NOT EXISTS idx_dialog_vcon_id ON public.dialog (vcon_id);
CREATE INDEX IF NOT EXISTS idx_parties_vcon_id ON public.parties (vcon_id);
CREATE INDEX IF NOT EXISTS idx_analysis_vcon_id ON public.analysis (vcon_id);
CREATE INDEX IF NOT EXISTS idx_attachments_vcon_id ON public.attachments (vcon_id);

-- Parent filters: created_at and tenant_id used in WHERE clauses
CREATE INDEX IF NOT EXISTS idx_vcons_created_at ON public.vcons (created_at);
CREATE INDEX IF NOT EXISTS idx_vcons_tenant_created_at ON public.vcons (tenant_id, created_at);
