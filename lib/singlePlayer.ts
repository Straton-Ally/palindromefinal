import { withoutBlocked } from '@/lib/moderation';
import { getSupabaseClient } from '@/supabase';

export type SinglePlayerBestRow = {
  user_id: string;
  best_score: number;
  best_time_seconds: number;
  updated_at: string;
};

export type LeaderboardRow = {
  user_id: string;
  best_score: number;
  best_time_seconds: number;
  profile?: { full_name: string | null; avatar_url: string | null; username: string | null };
};

export async function saveSinglePlayerRun(
  userId: string,
  score: number,
  timeSeconds: number
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('single_player_runs').insert({
    user_id: userId,
    score: Math.max(0, Math.floor(score)),
    time_seconds: Math.max(0, Math.floor(timeSeconds)),
  });
  if (error) throw error;
}

export async function getMyBestSinglePlayer(userId: string): Promise<SinglePlayerBestRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('single_player_best')
    .select('user_id, best_score, best_time_seconds, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as SinglePlayerBestRow) ?? null;
}

export async function getSinglePlayerLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('single_player_best')
    .select('user_id, best_score, best_time_seconds')
    .order('best_score', { ascending: false })
    .order('best_time_seconds', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const rows = await withoutBlocked((data ?? []) as any[], (r) => r.user_id as string);

  // Fetch profiles separately — single_player_best.user_id FK points to auth.users,
  // so PostgREST cannot resolve the profiles relationship automatically.
  const userIds = rows.map((r) => r.user_id as string);
  const profileMap: Record<string, { full_name: string | null; avatar_url: string | null; username: string | null }> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username')
      .in('id', userIds);
    for (const p of profiles ?? []) {
      profileMap[(p as any).id] = {
        full_name: (p as any).full_name ?? null,
        avatar_url: (p as any).avatar_url ?? null,
        username: (p as any).username ?? null,
      };
    }
  }

  return rows.map((r) => ({
    user_id: r.user_id,
    best_score: r.best_score,
    best_time_seconds: r.best_time_seconds,
    profile: profileMap[r.user_id],
  }));
}

