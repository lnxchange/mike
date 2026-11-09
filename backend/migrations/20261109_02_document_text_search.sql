-- Migration date: 2026-11-09
-- Search index for find_documents. Reading a document still uses the storage
-- text cache. text_revision moves when the version's bytes change, so a late
-- extract cannot publish text for an edit that has already been replaced.

alter table public.document_versions
  add column if not exists text_revision uuid not null default gen_random_uuid();

create table if not exists public.document_version_texts (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  source_revision uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  text_content text,
  textless_page_count integer,
  updated_at timestamptz not null default now(),
  constraint document_version_texts_ready
    check ((status = 'ready') = (text_content is not null))
);

alter table public.document_version_texts enable row level security;
revoke all on public.document_version_texts from public, anon, authenticated;
grant select, insert, update, delete on public.document_version_texts to service_role;

create extension if not exists pg_trgm;

do $$
declare extension_schema text;
begin
  select n.nspname into extension_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if extension_schema is not null then
    execute format(
      'create index if not exists document_version_texts_find_idx on public.document_version_texts using gin (lower(text_content) %I.gin_trgm_ops) where status = %L',
      extension_schema,
      'ready'
    );
  end if;
end $$;

create or replace function public.touch_document_text_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.storage_path is distinct from old.storage_path
    or new.content_sha256 is distinct from old.content_sha256
    or new.file_type is distinct from old.file_type
  ) then
    new.text_revision := gen_random_uuid();
  end if;
  return new;
end;
$$;

drop trigger if exists document_versions_touch_text_revision on public.document_versions;
create trigger document_versions_touch_text_revision
  before update of storage_path, content_sha256, file_type
  on public.document_versions
  for each row execute procedure public.touch_document_text_revision();
