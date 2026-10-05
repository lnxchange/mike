-- Migration date: 2026-09-21
-- SharePoint / parsed email list fields on documents. created_at stays
-- ingest time; email_received_at is when the message arrived. Safe to re-run.

alter table public.documents
  add column if not exists email_subject text;

alter table public.documents
  add column if not exists email_from text;

alter table public.documents
  add column if not exists email_to text;

alter table public.documents
  add column if not exists email_received_at timestamptz;

create index if not exists idx_documents_project_email_received
  on public.documents(project_id, email_received_at desc)
  where email_received_at is not null;
