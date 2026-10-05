-- Migration date: 2026-09-23
-- A Colleague edit saved into SharePoint DR records the new item on the
-- version. The document row keeps the source item (an email or a root
-- file), and the delta treats the version's item id as already mirrored.

alter table public.document_versions
  add column if not exists external_provider text,
  add column if not exists external_item_id text,
  add column if not exists external_ctag text;

create index if not exists document_versions_external_item_idx
  on public.document_versions(document_id)
  where external_item_id is not null;
