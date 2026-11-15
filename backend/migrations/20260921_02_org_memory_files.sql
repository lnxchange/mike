-- Migration date: 2026-09-21
-- Add organization-scoped memory.md (same 16 KiB Markdown as project memory).
-- Safe to re-run. Org memory is admin-edited only; chats do not curate it.

alter table public.memory_files
  add column if not exists org_id uuid
    references public.organizations(id) on delete cascade;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'memory_files'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%scope in (%user%project%'
      and con.conname <> 'memory_files_scope_owner_check'
  loop
    execute format(
      'alter table public.memory_files drop constraint if exists %I',
      constraint_name
    );
  end loop;
end
$$;

alter table public.memory_files
  drop constraint if exists memory_files_scope_check;
alter table public.memory_files
  add constraint memory_files_scope_check
  check (scope in ('user', 'project', 'org'));

alter table public.memory_files
  drop constraint if exists memory_files_scope_owner_check;
alter table public.memory_files
  add constraint memory_files_scope_owner_check check (
    (scope = 'user' and user_id is not null and project_id is null and org_id is null)
    or (scope = 'project' and project_id is not null and user_id is null and org_id is null)
    or (scope = 'org' and org_id is not null and user_id is null and project_id is null)
  );

create unique index if not exists memory_files_org_unique
  on public.memory_files(org_id);

insert into public.memory_files(scope, org_id, enabled)
select 'org', id, true from public.organizations
on conflict do nothing;

create or replace function public.initialize_new_org_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.memory_files(scope, org_id, enabled)
  values ('org', new.id, true)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created_memory on public.organizations;
create trigger on_organization_created_memory
  after insert on public.organizations
  for each row execute function public.initialize_new_org_memory();
