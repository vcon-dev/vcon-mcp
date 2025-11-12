-- Indexes to stop timeouts on analysis/attachments counts and speed up vcons filtering
CREATE INDEX IF NOT EXISTS idx_analysis_vcon_id ON public.analysis (vcon_id);
CREATE INDEX IF NOT EXISTS idx_attachments_vcon_id ON public.attachments (vcon_id);

-- Support the subquery that filters vcons by date and tenant
CREATE INDEX IF NOT EXISTS idx_vcons_created_at ON public.vcons (created_at);
CREATE INDEX IF NOT EXISTS idx_vcons_tenant_created_at ON public.vcons (tenant_id, created_at);