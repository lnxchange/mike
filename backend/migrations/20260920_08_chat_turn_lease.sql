-- Migration date: 2026-09-20
-- One assistant turn at a time per chat. A second stream request while a
-- turn is running used to start a concurrent turn that cancelled the first
-- and ran blind to its edits. The lease lives on the chat row and is kept
-- alive by a heartbeat, so a crashed process frees the chat within about a
-- minute instead of holding it for the whole turn window. Safe to re-run.
-- RLS is unchanged: the new columns inherit the existing chats policies and
-- are only written through service-role RPCs.

alter table public.chats
  add column if not exists active_turn_id uuid,
  add column if not exists active_turn_message_id uuid,
  add column if not exists active_turn_started_at timestamptz,
  add column if not exists active_turn_heartbeat_at timestamptz,
  add column if not exists active_turn_cancel_requested_at timestamptz;

-- Claim the chat for one turn. A live lease belongs to another turn while its
-- heartbeat is fresh; a stale heartbeat means the owning process is gone and
-- the chat may be reclaimed.
create or replace function public.claim_chat_turn(
  p_chat_id uuid,
  p_turn_id uuid,
  p_assistant_message_id uuid,
  p_stale_after_seconds integer default 90
)
returns table(
  claimed boolean,
  active_turn_id uuid,
  active_turn_message_id uuid,
  active_turn_started_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.chats%rowtype;
begin
  if p_turn_id is null or p_assistant_message_id is null
    or p_stale_after_seconds < 10 or p_stale_after_seconds > 3600
  then
    raise exception using errcode = '22023', message = 'invalid_chat_turn_claim';
  end if;

  select * into target from public.chats where id = p_chat_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'chat_not_found';
  end if;

  if target.active_turn_id is not null
    and target.active_turn_id <> p_turn_id
    and coalesce(target.active_turn_heartbeat_at, target.active_turn_started_at)
        > now() - make_interval(secs => p_stale_after_seconds)
  then
    return query select
      false,
      target.active_turn_id,
      target.active_turn_message_id,
      target.active_turn_started_at;
    return;
  end if;

  update public.chats
  set active_turn_id = p_turn_id,
      active_turn_message_id = p_assistant_message_id,
      active_turn_started_at = now(),
      active_turn_heartbeat_at = now(),
      active_turn_cancel_requested_at = null
  where id = p_chat_id;

  return query select true, p_turn_id, p_assistant_message_id, now();
end;
$$;

-- Keep the lease alive and learn whether a cancel was requested. `alive` is
-- false when another turn has taken the chat; the caller must stop.
create or replace function public.heartbeat_chat_turn(
  p_chat_id uuid,
  p_turn_id uuid
)
returns table(alive boolean, cancel_requested boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.chats%rowtype;
begin
  select * into target from public.chats where id = p_chat_id for update;
  if not found or target.active_turn_id is distinct from p_turn_id then
    return query select false, false;
    return;
  end if;
  update public.chats
  set active_turn_heartbeat_at = now()
  where id = p_chat_id;
  return query select true, target.active_turn_cancel_requested_at is not null;
end;
$$;

create or replace function public.release_chat_turn(
  p_chat_id uuid,
  p_turn_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats
  set active_turn_id = null,
      active_turn_message_id = null,
      active_turn_started_at = null,
      active_turn_heartbeat_at = null,
      active_turn_cancel_requested_at = null
  where id = p_chat_id and active_turn_id = p_turn_id;
  return found;
end;
$$;

-- Ask the running turn to stop. The turn itself notices on its next
-- heartbeat (or immediately when it runs in the same process).
create or replace function public.request_chat_turn_cancel(
  p_chat_id uuid,
  p_assistant_message_id uuid
)
returns table(requested boolean, turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.chats%rowtype;
begin
  select * into target from public.chats where id = p_chat_id for update;
  if not found
    or target.active_turn_id is null
    or target.active_turn_message_id is distinct from p_assistant_message_id
  then
    return query select false, null::uuid;
    return;
  end if;
  update public.chats
  set active_turn_cancel_requested_at = coalesce(active_turn_cancel_requested_at, now())
  where id = p_chat_id;
  return query select true, target.active_turn_id;
end;
$$;

revoke all on function public.claim_chat_turn(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_chat_turn(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_chat_turn(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.request_chat_turn_cancel(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_chat_turn(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.heartbeat_chat_turn(uuid, uuid)
  to service_role;
grant execute on function public.release_chat_turn(uuid, uuid)
  to service_role;
grant execute on function public.request_chat_turn_cancel(uuid, uuid)
  to service_role;
