-- Migration date: 2026-09-21
-- Encrypted organisation API keys. Admins write them; members inherit them
-- at resolve time. RLS is enabled with no client policies so browser
-- Supabase clients cannot read key material. Safe to re-run.

create table if not exists public.org_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('claude', 'gemini', 'openai', 'openrouter', 'vercel', 'opencode-go', 'courtlistener')),
  encrypted_key text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, provider)
);

create index if not exists idx_org_api_keys_org
  on public.org_api_keys(org_id);

alter table public.org_api_keys enable row level security;

revoke all on public.org_api_keys from anon, authenticated;
grant select, insert, update, delete on public.org_api_keys to service_role;
