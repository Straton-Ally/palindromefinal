-- Lets a signed-in user permanently delete their own account
-- (App Store Guideline 5.1.1(v): in-app account deletion).
--
-- Deleting the auth.users row cascades to profiles, match_players, friends,
-- challenges, rematch_requests, notifications and single-player scores.
-- matches.created_by has no ON DELETE action, so it is cleared first to keep
-- other players' match history intact.
-- Avatar files are removed by the client through the Storage API beforehand
-- (direct deletes on storage.objects are blocked by Supabase).

create or replace function public.delete_own_account()
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

  update public.matches set created_by = null where created_by = uid;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
