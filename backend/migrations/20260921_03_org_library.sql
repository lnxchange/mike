-- Migration date: 2026-09-21
-- Organisation-scoped Library shelves. Each user keeps their personal
-- Files/Templates library and also sees every organisation they belong to.
-- Writes stay on one shelf. Safe to re-run.

alter table public.library_folders
  add column if not exists org_id uuid
    references public.organizations(id) on delete cascade;

alter table public.library_folders
  alter column user_id drop not null;

alter table public.library_folders
  drop constraint if exists library_folders_user_id_fkey;
alter table public.library_folders
  add constraint library_folders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.library_folders
  drop constraint if exists library_folders_owner_check;
alter table public.library_folders
  add constraint library_folders_owner_check check (
    org_id is not null or user_id is not null
  );

create index if not exists idx_library_folders_org_kind
  on public.library_folders(org_id, library_kind)
  where org_id is not null;

create index if not exists idx_documents_org_library_kind_folder
  on public.documents(org_id, library_kind, library_folder_id)
  where project_id is null and org_id is not null;

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
    d.updated_at desc,
    d.id asc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

drop function if exists public.search_library_documents(text, text, integer, integer, text, text, text, text);
drop function if exists public.search_library_documents(text, text, integer, integer, text, text, text, text, uuid);

create or replace function public.get_library_filter_options(
  p_user_id text,
  p_library_kind text,
  p_org_ids uuid[] default '{}'
)
returns table (file_types text[])
language sql
stable
as $$
  select coalesce(
    array_agg(distinct lower(v.file_type) order by lower(v.file_type))
      filter (where nullif(trim(v.file_type), '') is not null),
    array[]::text[]
  ) as file_types
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
    );
$$;

drop function if exists public.get_library_filter_options(text, text);
drop function if exists public.get_library_filter_options(text, text, uuid);

create or replace function public.get_library_document_ids(
  p_user_id text,
  p_library_kind text,
  p_search_term text,
  p_file_type text,
  p_limit integer,
  p_offset integer,
  p_org_ids uuid[] default '{}'
)
returns table (
  id uuid,
  user_id text,
  org_id uuid
)
language sql
stable
as $$
  select d.id, d.user_id::text as user_id, d.org_id
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
  order by d.updated_at desc, d.id asc
  limit greatest(coalesce(p_limit, 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

drop function if exists public.get_library_document_ids(text, text, text, text, integer, integer);
drop function if exists public.get_library_document_ids(text, text, text, text, integer, integer, uuid);

create or replace function public.resolve_library_folder_path(
  target_user_id uuid,
  target_library_kind text,
  base_folder_id uuid,
  path_segments text[],
  conflict_resolution text default 'error',
  target_org_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_parent_id uuid := base_folder_id;
  folder_row public.library_folders%rowtype;
  resolved_folders jsonb := '[]'::jsonb;
  segment text;
  resolved_name text;
  first_resolved_name text;
  candidate_name text;
  suffix integer;
  segment_index integer;
begin
  if target_library_kind not in ('file', 'template') then
    raise exception 'Invalid library kind';
  end if;
  if conflict_resolution not in ('error', 'reuse', 'rename') then
    raise exception 'Invalid folder conflict resolution';
  end if;
  if coalesce(array_length(path_segments, 1), 0) = 0
     or array_length(path_segments, 1) > 100 then
    raise exception 'Folder path must contain between 1 and 100 segments';
  end if;
  if base_folder_id is not null and not exists (
    select 1 from public.library_folders
    where id = base_folder_id
      and library_kind = target_library_kind
      and org_id is not distinct from target_org_id
      and (
        target_org_id is not null
        or user_id = target_user_id
      )
  ) then
    raise exception 'Parent folder not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'library-folder-path:'
        || coalesce(target_org_id::text, target_user_id::text)
        || ':' || target_library_kind,
      0
    )
  );

  for segment_index in 1..array_length(path_segments, 1) loop
    segment := btrim(path_segments[segment_index]);
    if segment = '' or length(segment) > 255 then
      raise exception 'Folder names must contain between 1 and 255 characters';
    end if;
    resolved_name := segment;

    select * into folder_row
    from public.library_folders
    where library_kind = target_library_kind
      and org_id is not distinct from target_org_id
      and (
        target_org_id is not null
        or user_id = target_user_id
      )
      and parent_folder_id is not distinct from current_parent_id
      and lower(btrim(name)) = lower(segment)
    order by created_at, id
    limit 1;

    if folder_row.id is not null and segment_index = 1 then
      suffix := 2;
      loop
        candidate_name := segment || ' (' || suffix || ')';
        exit when not exists (
          select 1 from public.library_folders
          where library_kind = target_library_kind
            and org_id is not distinct from target_org_id
            and (
              target_org_id is not null
              or user_id = target_user_id
            )
            and parent_folder_id is not distinct from current_parent_id
            and lower(btrim(name)) = lower(candidate_name)
        );
        suffix := suffix + 1;
      end loop;

      if conflict_resolution = 'error' then
        return jsonb_build_object(
          'conflict', true,
          'folder_name', folder_row.name,
          'existing_folder_id', folder_row.id,
          'suggested_name', candidate_name
        );
      elsif conflict_resolution = 'rename' then
        folder_row := null;
        resolved_name := candidate_name;
      end if;
    end if;

    if folder_row.id is null then
      insert into public.library_folders (
        user_id, org_id, library_kind, name, parent_folder_id
      ) values (
        target_user_id, target_org_id, target_library_kind, resolved_name, current_parent_id
      ) returning * into folder_row;
    end if;

    if segment_index = 1 then
      first_resolved_name := folder_row.name;
    end if;
    current_parent_id := folder_row.id;
    resolved_folders := resolved_folders || jsonb_build_array(to_jsonb(folder_row));
    folder_row := null;
  end loop;

  return jsonb_build_object(
    'conflict', false,
    'folder_id', current_parent_id,
    'resolved_name', first_resolved_name,
    'folders', resolved_folders
  );
end;
$$;

drop function if exists public.resolve_library_folder_path(uuid, text, uuid, text[], text);

revoke all on function public.resolve_library_folder_path(uuid, text, uuid, text[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_library_folder_path(uuid, text, uuid, text[], text, uuid)
  to service_role;
