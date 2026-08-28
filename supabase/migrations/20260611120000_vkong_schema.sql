-- vKong's durable store, consolidated from its retired dedicated Supabase
-- stack (2026-06-11). Isolated in its own schema; vcon-mcp's public.vcons is
-- a different table. Redis remains vKong's live/processing store; this is the
-- system-of-record copy written by vKong's server (service_role only).
create schema if not exists vkong;
grant usage on schema vkong to anon, authenticated, service_role;

create table if not exists vkong.vcons (
  uuid        uuid primary key,
  vcon        jsonb not null,
  subject     text,
  source      text,
  sentiment   text,
  health      integer,
  created_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists vcons_health_idx     on vkong.vcons (health);
create index if not exists vcons_source_idx     on vkong.vcons (source);
create index if not exists vcons_created_at_idx on vkong.vcons (created_at desc);

grant all on vkong.vcons to service_role;
grant select on vkong.vcons to authenticated;
alter default privileges in schema vkong grant all on tables to service_role;
