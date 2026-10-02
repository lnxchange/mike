-- Migration date: 2026-09-22
-- Let library search order by SharePoint correspondence fields
-- (arrived / from / to / subject), matching the Matters document table.
-- Safe to re-run: create or replace, same signature.

create or replace function public.search_library_documents(
  p_user_id text,
  p_library_kind text,
  p_limit integer,
  p_offset integer,
  p_search_term text default null,
  p_file_type text default null,
  p_sort_key text default 'updated',
  p_sort_direction text default 'desc',
  p_org_ids uuid[] default '{}'
)
returns table (
  id uuid,
  project_id uuid,
  user_id text,
  org_id uuid,
  status text,
  folder_id uuid,
  library_kind text,
  library_folder_id uuid,
  current_version_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  filename text,
  file_type text,
  storage_path text,
  pdf_storage_path text,
  size_bytes integer,
  page_count integer,
  active_version_number integer
)
language sql
stable
as $$
  select
    d.id,
    d.project_id,
    d.user_id::text as user_id,
    d.org_id,
    d.status,
    d.folder_id,
    d.library_kind,
    d.library_folder_id,
    d.current_version_id,
    d.created_at,
    d.updated_at,
    coalesce(nullif(trim(v.filename), ''), 'Untitled document') as filename,
    v.file_type,
    v.storage_path,
    v.pdf_storage_path,
    v.size_bytes,
    v.page_count,
    v.version_number as active_version_number
  from public.documents d
  left join public.document_versions v
    on v.id = d.current_version_id
   and v.deleted_at is null
  where d.project_id is null
    and (
      (d.org_id is null and d.user_id::text = p_user_id)
      or (cardinality(coalesce(p_org_ids, '{}')) > 0 and d.org_id = any(p_org_ids))
    )
    and (
      (p_library_kind = 'file' and coalesce(d.library_kind, 'file') = 'file')
      or d.library_kind = p_library_kind
    )
    and (
      p_search_term is null
      or p_search_term = ''
      or lower(coalesce(v.filename, '')) like
        '%' || replace(replace(replace(lower(p_search_term), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        escape '\'
    )
    and (
      p_file_type is null
      or lower(coalesce(v.file_type, '')) = lower(p_file_type)
    )
  order by
    case when p_sort_key = 'name' and p_sort_direction = 'asc' then lower(coalesce(v.filename, '')) else null end asc,
    case when p_sort_key = 'name' and p_sort_direction = 'desc' then lower(coalesce(v.filename, '')) else null end desc,
    case when p_sort_key = 'type' and p_sort_direction = 'asc' then lower(coalesce(v.file_type, '')) else null end asc,
    case when p_sort_key = 'type' and p_sort_direction = 'desc' then lower(coalesce(v.file_type, '')) else null end desc,
    case when p_sort_key = 'size' and p_sort_direction = 'asc' then coalesce(v.size_bytes, 0) else null end asc,
    case when p_sort_key = 'size' and p_sort_direction = 'desc' then coalesce(v.size_bytes, 0) else null end desc,
    case when p_sort_key = 'version' and p_sort_direction = 'asc' then coalesce(v.version_number, 0) else null end asc,
    case when p_sort_key = 'version' and p_sort_direction = 'desc' then coalesce(v.version_number, 0) else null end desc,
    case when p_sort_key = 'created' and p_sort_direction = 'asc' then d.created_at else null end asc,
    case when p_sort_key = 'created' and p_sort_direction = 'desc' then d.created_at else null end desc,
    case when p_sort_key = 'updated' and p_sort_direction = 'asc' then d.updated_at else null end asc,
    case when p_sort_key = 'updated' and p_sort_direction = 'desc' then d.updated_at else null end desc,
    case when p_sort_key = 'arrived' and p_sort_direction = 'asc' then coalesce(d.email_received_at, '-infinity'::timestamptz) else null end asc,
    case when p_sort_key = 'arrived' and p_sort_direction = 'desc' then coalesce(d.email_received_at, '-infinity'::timestamptz) else null end desc,
    case when p_sort_key = 'from' and p_sort_direction = 'asc' then lower(coalesce(d.email_from, '')) else null end asc,
    case when p_sort_key = 'from' and p_sort_direction = 'desc' then lower(coalesce(d.email_from, '')) else null end desc,
    case when p_sort_key = 'to' and p_sort_direction = 'asc' then lower(coalesce(d.email_to, '')) else null end asc,
    case when p_sort_key = 'to' and p_sort_direction = 'desc' then lower(coalesce(d.email_to, '')) else null end desc,
    case when p_sort_key = 'subject' and p_sort_direction = 'asc' then lower(coalesce(d.email_subject, '')) else null end asc,
    case when p_sort_key = 'subject' and p_sort_direction = 'desc' then lower(coalesce(d.email_subject, '')) else null end desc,
    d.updated_at desc,
    d.id asc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
