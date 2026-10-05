-- Migration date: 2026-09-21
--
-- Enable deny-all RLS on backend-owned tables that shipped without it.
-- The frontend never queries these tables: it talks to the Express API, which
-- uses service_role and bypasses RLS. Browser roles already have no grants.
-- No policies are created. Safe to re-run.

do $$
declare
  table_name text;
  backend_tables text[] := array[
    'user_profiles',
    'projects',
    'project_subfolders',
    'library_folders',
    'documents',
    'document_versions',
    'document_edits',
    'workflows',
    'hidden_workflows',
    'workflow_shares',
    'default_workflow_installations',
    'quick_actions',
    'mike_workflows',
    'mike_workflow_assets',
    'workflow_addons',
    'chats',
    'chat_messages',
    'tabular_reviews',
    'tabular_cells',
    'tabular_review_chats',
    'tabular_review_chat_messages'
  ];
begin
  foreach table_name in array backend_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'alter table public.%I enable row level security',
        table_name
      );
      execute format(
        'revoke all privileges on table public.%I from anon, authenticated',
        table_name
      );
    end if;
  end loop;
end $$;
