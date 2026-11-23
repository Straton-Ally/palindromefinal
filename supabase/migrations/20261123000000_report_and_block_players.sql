-- Report and block players (App Store Guideline 1.2: apps that show
-- user-generated content such as names and profile photos must let users
-- report objectionable content and block abusive users).

-- ── Blocks ────────────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamp with time zone default now() not null,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocked on public.user_blocks(blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "Users can read own blocks" on public.user_blocks;
create policy "Users can read own blocks" on public.user_blocks for select
  using (blocker_id = auth.uid());

drop policy if exists "Users can unblock" on public.user_blocks;
create policy "Users can unblock" on public.user_blocks for delete
  using (blocker_id = auth.uid());

-- Inserts go through block_player() so the friendship and pending
-- challenges are cleaned up in the same transaction.

-- True when either user has blocked the other. SECURITY DEFINER so RLS
-- policies on other tables can see blocks made by the other user.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- Ids hidden from the current user: people they blocked and people who
-- blocked them.
create or replace function public.get_hidden_player_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select blocked_id from public.user_blocks where blocker_id = auth.uid()
  union
  select blocker_id from public.user_blocks where blocked_id = auth.uid();
$$;

revoke all on function public.get_hidden_player_ids() from public, anon;
grant execute on function public.get_hidden_player_ids() to authenticated;

create or replace function public.block_player(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_target is null or p_target = uid then
    raise exception 'Invalid player';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (uid, p_target)
  on conflict do nothing;

  -- Remove the friendship / friend requests in both directions.
  delete from public.friends
  where (user_id = uid and friend_id = p_target)
     or (user_id = p_target and friend_id = uid);

  -- Decline pending challenges in both directions and cancel their lobbies.
  update public.matches m
  set status = 'cancelled', finished_at = now()
  from public.challenges c
  where c.match_id = m.id
    and c.status = 'pending'
    and m.status = 'waiting'
    and ((c.from_user_id = uid and c.to_user_id = p_target)
      or (c.from_user_id = p_target and c.to_user_id = uid));

  update public.challenges
  set status = 'declined'
  where status = 'pending'
    and ((from_user_id = uid and to_user_id = p_target)
      or (from_user_id = p_target and to_user_id = uid));
end;
$$;

revoke all on function public.block_player(uuid) from public, anon;
grant execute on function public.block_player(uuid) to authenticated;

-- Blocked players can't send each other friend requests or challenges.
drop policy if exists "Users can insert friend request" on public.friends;
create policy "Users can insert friend request" on public.friends for insert
  with check (user_id = auth.uid() and not public.is_blocked_between(user_id, friend_id));

drop policy if exists "Users can create challenge" on public.challenges;
create policy "Users can create challenge" on public.challenges for insert
  with check (from_user_id = auth.uid() and not public.is_blocked_between(from_user_id, to_user_id));

-- ── Reports ───────────────────────────────────────────────────────────────
-- Reviewed by the developer in the Supabase dashboard (Table Editor →
-- player_reports). Set status to 'actioned' or 'dismissed' once handled.
create table if not exists public.player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reported_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('offensive_name', 'inappropriate_photo', 'cheating', 'harassment', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  -- Snapshot of what was reported, kept even if the player edits their profile.
  reported_name text,
  reported_avatar_url text,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamp with time zone default now() not null
);

create index if not exists idx_player_reports_status on public.player_reports(status, created_at desc);

alter table public.player_reports enable row level security;

-- Players can file reports but never read them back.
drop policy if exists "Users can report players" on public.player_reports;
create policy "Users can report players" on public.player_reports for insert
  with check (reporter_id = auth.uid() and reported_id <> auth.uid() and status = 'open');

-- ── Quick match: never pair players who blocked each other ────────────────
create or replace function public.claim_quick_match(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'Missing user id';
  end if;

  -- If this user already has an open quick-match lobby, reuse it instead of
  -- creating duplicates or matching them against themselves.
  select m.id into v_match_id
  from public.matches m
  where m.status = 'waiting'
    and m.mode = 'race'
    and m.invite_code is null
    and not exists (
      select 1 from public.challenges c where c.match_id = m.id and c.status = 'pending'
    )
    and exists (
      select 1 from public.match_players mp
      where mp.match_id = m.id and mp.user_id = p_user_id
    )
  order by m.created_at asc
  limit 1;

  if v_match_id is not null then
    select to_jsonb(m.*) into v_result from (select * from public.matches where id = v_match_id) m;
    return v_result;
  end if;

  -- Join the oldest open quick-match lobby owned by another player. Pending
  -- friend challenges also use waiting race matches, so explicitly exclude them.
  -- Skip lobbies whose host has blocked this player (or vice versa).
  select m.id into v_match_id
  from public.matches m
  where m.status = 'waiting'
    and m.mode = 'race'
    and m.invite_code is null
    and not exists (
      select 1 from public.challenges c where c.match_id = m.id and c.status = 'pending'
    )
    and not exists (
      select 1 from public.match_players mp
      where mp.match_id = m.id and mp.user_id = p_user_id
    )
    and not exists (
      select 1 from public.match_players mp
      join public.user_blocks b
        on (b.blocker_id = mp.user_id and b.blocked_id = p_user_id)
        or (b.blocker_id = p_user_id and b.blocked_id = mp.user_id)
      where mp.match_id = m.id
    )
    and (
      select count(*) from public.match_players mp
      where mp.match_id = m.id
    ) = 1
  order by m.created_at asc
  limit 1
  for update skip locked;

  if v_match_id is not null then
    insert into public.match_players (match_id, user_id)
    values (v_match_id, p_user_id)
    on conflict (match_id, user_id) do nothing;

    update public.matches
    set status = 'active', started_at = coalesce(started_at, now())
    where id = v_match_id
      and status = 'waiting';

    select to_jsonb(m.*) into v_result from (select * from public.matches where id = v_match_id) m;
    return v_result;
  end if;

  insert into public.matches (status, mode, seed, invite_code, time_limit_seconds, created_by)
  values ('waiting', 'race', gen_random_uuid()::text, null, 300, p_user_id)
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id)
  values (v_match_id, p_user_id)
  on conflict (match_id, user_id) do nothing;

  select to_jsonb(m.*) into v_result from (select * from public.matches where id = v_match_id) m;
  return v_result;
end;
$$;

grant execute on function public.claim_quick_match(uuid) to authenticated;
