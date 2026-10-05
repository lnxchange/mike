-- Migration date: 2026-09-21
-- Microsoft delegated Graph token vault and Message-ID on filed emails.
-- Safe to re-run.

create table if not exists public.user_microsoft_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_access_token text not null,
  access_token_iv text not null,
  access_token_tag text not null,
  encrypted_refresh_token text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  access_token_expires_at timestamptz not null,
  granted_scopes text not null,
  mailbox_upn text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_microsoft_tokens enable row level security;

revoke all on public.user_microsoft_tokens from anon, authenticated;
grant select, insert, update, delete on public.user_microsoft_tokens to service_role;

alter table public.documents
  add column if not exists email_internet_message_id text;

create index if not exists idx_documents_email_internet_message_id
  on public.documents(email_internet_message_id)
  where email_internet_message_id is not null;
