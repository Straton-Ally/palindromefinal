-- Finish race matches when either player leaves an active multiplayer game.
create or replace function public.forfeit_race_match(
  p_match_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_opponent_id uuid;
  v_now timestamptz := now();
begin
  if p_match_id is null or p_user_id is null then
    raise exception 'Missing match or user id';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match not found';
  end if;

  if v_match.mode <> 'race' then
    raise exception 'forfeit_race_match can only finish race matches';
  end if;

  if not exists (
    select 1 from public.match_players
    where match_id = p_match_id and user_id = p_user_id
  ) then
    raise exception 'Not a participant in this match';
  end if;

  if v_match.status = 'finished' then
    return;
  end if;

  select user_id into v_opponent_id
  from public.match_players
  where match_id = p_match_id and user_id <> p_user_id
  limit 1;

  update public.match_players
  set
    submitted_at = coalesce(submitted_at, v_now),
    is_winner = false
  where match_id = p_match_id
    and user_id = p_user_id;

  if v_opponent_id is not null then
    update public.match_players
    set is_winner = true
    where match_id = p_match_id
      and user_id = v_opponent_id;

    update public.matches
    set status = 'finished', finished_at = v_now
    where id = p_match_id;
  else
    update public.matches
    set status = 'cancelled', finished_at = v_now
    where id = p_match_id;
  end if;
end;
$$;

grant execute on function public.forfeit_race_match(uuid, uuid) to authenticated;
