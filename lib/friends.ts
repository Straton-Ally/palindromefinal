/**
 * Friends and challenges service.
 * Add friends, challenge them, view head-to-head stats.
 */

import { authService } from '@/authService';
import { withoutBlocked } from '@/lib/moderation';
import { createNotification } from '@/lib/notifications';
import { getSupabaseClient } from '@/supabase';

export interface FriendRow {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
}

export interface FriendWithProfile extends FriendRow {
  profile?: { full_name: string | null; avatar_url: string | null; username: string | null };
}

export interface ChallengeRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  match_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export interface HeadToHeadStats {
  totalMatches: number;
  myWins: number;
  theirWins: number;
}

const CHALLENGE_CODE_PREFIX = 'CHAL';

function generatePrivateChallengeCode(): string {
  const suffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
  return `${CHALLENGE_CODE_PREFIX}${suffix}`.toUpperCase();
}

/**
 * Send a friend request.
 */
export async function sendFriendRequest(
  fromUserId: string,
  toUserId: string
): Promise<FriendRow> {
  const supabase = getSupabaseClient();
  if (fromUserId === toUserId) throw new Error('Cannot add yourself');
  const { data, error } = await supabase
    .from('friends')
    .insert({ user_id: fromUserId, friend_id: toUserId, status: 'pending' })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('Friend request already sent or already friends');
    if (error.code === '42501') throw new Error("You can't add this player.");
    throw error;
  }
  const row = data as FriendRow;
  try {
    const profile = await authService.getProfile(fromUserId);
    const name = profile?.full_name || profile?.username || 'Someone';
    await createNotification(toUserId, 'friend_request', `${name} wants to be your friend`, undefined, {
      friend_request_id: row.id,
      from_user_id: fromUserId,
    });
  } catch {
    // notification is best-effort
  }
  return row;
}

/**
 * Accept a friend request.
 */
export async function acceptFriendRequest(
  requestId: string,
  userId: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('friends')
    .update({ status: 'accepted' })
    .eq('id', requestId)
    .eq('friend_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * Decline a friend request.
 */
export async function declineFriendRequest(
  requestId: string,
  userId: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('friends')
    .delete()
    .eq('id', requestId)
    .eq('friend_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * Get friends list (accepted only).
 */
export async function getFriends(userId: string): Promise<FriendRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('friends')
    .select('*')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  if (error) throw error;
  return withoutBlocked((data ?? []) as FriendRow[], (f) => (f.user_id === userId ? f.friend_id : f.user_id));
}

/**
 * Get pending friend requests (where I am the recipient).
 */
export async function getPendingFriendRequests(userId: string): Promise<FriendRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('friends')
    .select('*')
    .eq('friend_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  return withoutBlocked((data ?? []) as FriendRow[], (f) => f.user_id);
}

/**
 * Check friend status: 'friends' | 'pending' (we sent) | 'received' (they sent) | null
 */
export async function getFriendStatus(
  userId: string,
  otherId: string
): Promise<'friends' | 'pending' | 'received' | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('friends')
    .select('user_id, friend_id, status')
    .or(`and(user_id.eq.${userId},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${userId})`)
    .maybeSingle();
  if (!data) return null;
  if (data.status === 'accepted') return 'friends';
  if (data.user_id === userId) return 'pending';
  return 'received';
}

/**
 * Check if two users are friends.
 */
export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('friends')
    .select('id')
    .eq('status', 'accepted')
    .or(`and(user_id.eq.${userId},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${userId})`)
    .maybeSingle();
  return !!data;
}

/**
 * Challenge a friend to a match.
 */
export async function challengeFriend(
  fromUserId: string,
  toUserId: string,
  mode: 'race' | 'turn' = 'race'
): Promise<{ challenge: ChallengeRow; matchId: string }> {
  const supabase = getSupabaseClient();
  const isFriend = await areFriends(fromUserId, toUserId);
  if (!isFriend) throw new Error('Can only challenge friends');

  const seed = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({
      status: 'waiting',
      mode,
      seed,
      invite_code: generatePrivateChallengeCode(),
      time_limit_seconds: 300,
      created_by: fromUserId,
    })
    .select('id')
    .single();
  if (matchErr) throw matchErr;

  const { error: playerErr } = await supabase
    .from('match_players')
    .insert({ match_id: match.id, user_id: fromUserId });
  if (playerErr) {
    await supabase.from('matches').update({ status: 'cancelled' }).eq('id', match.id);
    throw playerErr;
  }

  // For turn mode, create the turn_match_states row
  if (mode === 'turn') {
    const { error: turnStateErr } = await supabase.from('turn_match_states').insert({
      match_id: match.id,
      player1_user_id: fromUserId,
      player2_user_id: fromUserId, // placeholder until opponent joins
      current_turn_user_id: null,
      board: [],
      player1_blocks: [8, 8, 8, 8, 8],
      player2_blocks: [8, 8, 8, 8, 8],
      player1_score: 0,
      player2_score: 0,
      player1_time_ms: 300000,
      player2_time_ms: 300000,
      move_number: 0,
      bulldog_positions: [],
    });
    if (turnStateErr) {
      await supabase.from('matches').update({ status: 'cancelled' }).eq('id', match.id);
      throw turnStateErr;
    }
  }

  const { data: challenge, error: chalErr } = await supabase
    .from('challenges')
    .insert({
      from_user_id: fromUserId,
      to_user_id: toUserId,
      match_id: match.id,
      status: 'pending',
    })
    .select()
    .single();
  if (chalErr) {
    await supabase.from('matches').update({ status: 'cancelled' }).eq('id', match.id);
    if (chalErr.code === '42501') throw new Error("You can't challenge this player.");
    throw chalErr;
  }

  try {
    const profile = await authService.getProfile(fromUserId);
    const name = profile?.full_name || profile?.username || 'A friend';
    const modeLabel = mode === 'turn' ? 'Turn mode' : 'Race mode';
    await createNotification(toUserId, 'challenge', `${name} challenged you to ${modeLabel}!`, 'Tap to accept.', {
      challenge_id: challenge.id,
      match_id: match.id,
      from_user_id: fromUserId,
    });
  } catch {
    // notification is best-effort
  }

  return { challenge: challenge as ChallengeRow, matchId: match.id };
}

/**
 * Accept a challenge.
 */
export async function acceptChallenge(
  challengeId: string,
  userId: string
): Promise<{ matchId: string }> {
  const supabase = getSupabaseClient();
  const { data: c, error: fetchErr } = await supabase
    .from('challenges')
    .select('match_id, from_user_id, to_user_id, status')
    .eq('id', challengeId)
    .eq('to_user_id', userId)
    .eq('status', 'pending')
    .single();
  if (fetchErr || !c) throw new Error('Invalid or expired challenge');

  const { data: m } = await supabase
    .from('matches')
    .select('mode')
    .eq('id', c.match_id)
    .single();

  const { error: playerErr } = await supabase
    .from('match_players')
    .upsert(
      { match_id: c.match_id, user_id: userId },
      { onConflict: 'match_id,user_id', ignoreDuplicates: true }
    );
  if (playerErr) throw playerErr;

  const { error: matchErr } = await supabase
    .from('matches')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', c.match_id);
  if (matchErr) throw matchErr;

  if (m?.mode === 'turn') {
    const { error: turnStateErr } = await supabase.from('turn_match_states').update({
      player2_user_id: userId,
      current_turn_user_id: c.from_user_id,
      turn_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('match_id', c.match_id);
    if (turnStateErr) throw turnStateErr;
  }

  const { error: challengeErr } = await supabase
    .from('challenges')
    .update({ status: 'accepted' })
    .eq('id', challengeId);
  if (challengeErr) throw challengeErr;

  return { matchId: c.match_id };
}

/**
 * Decline a challenge.
 */
export async function declineChallenge(challengeId: string, userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: challenge } = await supabase
    .from('challenges')
    .select('match_id')
    .eq('id', challengeId)
    .eq('to_user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();

  const { error } = await supabase
    .from('challenges')
    .update({ status: 'declined' })
    .eq('id', challengeId)
    .eq('to_user_id', userId)
    .eq('status', 'pending');
  if (error) throw error;

  if (challenge?.match_id) {
    await supabase
      .from('matches')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', challenge.match_id)
      .eq('status', 'waiting');
  }
}

/**
 * Get pending challenges (where I am the recipient).
 */
export async function getPendingChallenges(userId: string): Promise<ChallengeRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('to_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return withoutBlocked((data ?? []) as ChallengeRow[], (c) => c.from_user_id);
}

/**
 * Search users by username or full_name (for Add Friend).
 */
export async function searchUsers(
  query: string,
  excludeUserId: string,
  limit = 20
): Promise<{ id: string; full_name: string | null; avatar_url: string | null; username: string | null }[]> {
  const supabase = getSupabaseClient();
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, username')
    .neq('id', excludeUserId)
    .or(`username.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(limit);
  if (error) return [];
  return withoutBlocked(
    (data ?? []) as { id: string; full_name: string | null; avatar_url: string | null; username: string | null }[],
    (u) => u.id
  );
}

/**
 * Get recent opponents (users we've played matches with).
 */
export async function getRecentOpponents(
  userId: string,
  limit = 20
): Promise<{ id: string; full_name: string | null; avatar_url: string | null }[]> {
  const supabase = getSupabaseClient();
  const { data: myMatches } = await supabase
    .from('match_players')
    .select('match_id')
    .eq('user_id', userId);
  if (!myMatches?.length) return [];

  const matchIds = myMatches.map((m) => m.match_id);
  const { data: opponents } = await supabase
    .from('match_players')
    .select('user_id')
    .in('match_id', matchIds)
    .neq('user_id', userId);

  const opponentIds = await withoutBlocked([...new Set((opponents ?? []).map((o) => o.user_id as string))], (id) => id);
  if (!opponentIds.length) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', opponentIds.slice(0, limit));
  return (profiles ?? []) as { id: string; full_name: string | null; avatar_url: string | null }[];
}

/**
 * Get head-to-head stats vs a friend.
 */
export async function getHeadToHeadStats(
  myId: string,
  friendId: string
): Promise<HeadToHeadStats> {
  const supabase = getSupabaseClient();
  const { data: matches } = await supabase
    .from('match_players')
    .select('match_id, user_id, score, is_winner')
    .or(`user_id.eq.${myId},user_id.eq.${friendId}`);

  if (!matches?.length) return { totalMatches: 0, myWins: 0, theirWins: 0 };

  const matchIds = [...new Set(matches.map((m) => m.match_id))];
  const { data: fullMatches } = await supabase
    .from('matches')
    .select('id')
    .eq('status', 'finished')
    .in('id', matchIds);

  const finishedIds = new Set((fullMatches ?? []).map((m) => m.id));

  let myWins = 0;
  let theirWins = 0;
  const seen = new Set<string>();

  for (const m of matches) {
    if (!finishedIds.has(m.match_id) || seen.has(m.match_id)) continue;
    seen.add(m.match_id);

    const myRow = matches.find((r) => r.match_id === m.match_id && r.user_id === myId);
    const theirRow = matches.find((r) => r.match_id === m.match_id && r.user_id === friendId);
    if (!myRow || !theirRow) continue;

    const myScore = typeof myRow.score === 'number' ? myRow.score : null;
    const theirScore = typeof theirRow.score === 'number' ? theirRow.score : null;

    if (myScore !== null && theirScore !== null) {
      if (myScore > theirScore) myWins++;
      else if (theirScore > myScore) theirWins++;
    } else if (myRow.is_winner) {
      myWins++;
    } else if (theirRow.is_winner) {
      theirWins++;
    }
  }

  return {
    totalMatches: seen.size,
    myWins,
    theirWins,
  };
}
