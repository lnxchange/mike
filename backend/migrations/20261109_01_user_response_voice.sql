-- Migration date: 2026-11-09
-- Standing custom instructions and response style for Settings > Personalisation.
-- Chat reads these on their own, so a database that has not applied this
-- migration yet keeps answering with the previous prompt.

alter table public.user_profiles
  add column if not exists custom_instructions text not null default '';

alter table public.user_profiles
  drop constraint if exists user_profiles_custom_instructions_length;
alter table public.user_profiles
  add constraint user_profiles_custom_instructions_length
  check (char_length(custom_instructions) <= 8000);

alter table public.user_profiles
  add column if not exists response_style jsonb not null default '{}'::jsonb;

alter table public.user_profiles
  drop constraint if exists user_profiles_response_style_check;
alter table public.user_profiles
  add constraint user_profiles_response_style_check
  check (
    jsonb_typeof(response_style) = 'object'
    and octet_length(response_style::text) <= 2000
  );

create or replace function public.merge_user_response_style(
  p_user_id uuid,
  p_patch jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  update public.user_profiles
     set response_style = jsonb_strip_nulls(response_style || p_patch),
         updated_at = now()
   where user_id = p_user_id
     and jsonb_typeof(p_patch) = 'object'
  returning response_style;
$$;

revoke all on function public.merge_user_response_style(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_user_response_style(uuid, jsonb)
  to service_role;
