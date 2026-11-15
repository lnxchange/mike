-- Migration date: 2026-09-21
-- Background repository of official legislation, regulations, and court
-- documents retrieved by Colleague or uploaded by the user. Safe to re-run.

create table if not exists public.legal_source_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  family text not null
    check (family in ('energy', 'legislation', 'vic_legislation', 'case_law')),
  instrument_id text not null,
  name text not null,
  version_label text,
  official_url text not null,
  retrieved_via text not null
    check (retrieved_via in ('official', 'exa', 'upload')),
  currency_status text not null default 'current'
    check (currency_status in ('current', 'unconfirmed', 'superseded')),
  last_checked_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  full_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_source_documents_owner_check check (
    org_id is not null or user_id is not null
  )
);

alter table public.legal_source_documents enable row level security;

create index if not exists idx_legal_source_documents_lookup
  on public.legal_source_documents (family, instrument_id, last_used_at desc);

create unique index if not exists legal_source_documents_org_uniq
  on public.legal_source_documents (org_id, family, instrument_id, coalesce(version_label, ''))
  where org_id is not null;

create unique index if not exists legal_source_documents_user_uniq
  on public.legal_source_documents (user_id, family, instrument_id, coalesce(version_label, ''))
  where org_id is null;

revoke all on public.legal_source_documents from anon, authenticated;
grant select, insert, update, delete on public.legal_source_documents to service_role;
