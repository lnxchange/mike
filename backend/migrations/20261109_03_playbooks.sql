-- Migration date: 2026-11-09
-- Playbooks: negotiation rules and the reviews run against them.
-- Private by default. An organisation playbook can be public to its members.
-- A share row grants viewer (run) or editor (change the rules).

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  represented_party text,
  description text,
  visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  content jsonb not null default '{"rules":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playbook_shares (
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  primary key (playbook_id, user_id)
);

create table if not exists public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid,
  mode text not null default 'strict' check (mode in ('strict', 'permissive')),
  summary text not null default '',
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.playbooks enable row level security;
alter table public.playbook_shares enable row level security;
alter table public.playbook_runs enable row level security;
revoke all on public.playbooks from public, anon, authenticated;
revoke all on public.playbook_shares from public, anon, authenticated;
revoke all on public.playbook_runs from public, anon, authenticated;
grant select, insert, update, delete on public.playbooks to service_role;
grant select, insert, update, delete on public.playbook_shares to service_role;
grant select, insert, update, delete on public.playbook_runs to service_role;
