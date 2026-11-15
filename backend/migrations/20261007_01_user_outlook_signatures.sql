-- Migration date: 2026-10-07
-- The Outlook signature copied once from sent mail and edited on the account.
-- Safe to re-run.

create table if not exists public.user_outlook_signatures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  html text not null check (char_length(html) between 1 and 500000),
  updated_at timestamptz not null default now()
);

alter table public.user_outlook_signatures enable row level security;

revoke all on public.user_outlook_signatures from anon, authenticated;
grant select, insert, update, delete on public.user_outlook_signatures to service_role;
