/**
 * Report and block players (App Store Guideline 1.2).
 * Backed by supabase/migrations/20261123000000_report_and_block_players.sql.
 */

import { getSupabaseClient } from '@/supabase';

export type ReportReason = 'offensive_name' | 'inappropriate_photo' | 'cheating' | 'harassment' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'offensive_name', label: 'Offensive name' },
  { value: 'inappropriate_photo', label: 'Inappropriate profile photo' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'cheating', label: 'Cheating' },
  { value: 'other', label: 'Something else' },
];

export interface PlayerSummary {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let hiddenCache: { at: number; ids: Set<string> } | null = null;

/** Subscribe to block/unblock changes (to refresh lists). */
export function onBlockListChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyChanged() {
  hiddenCache = null;
  listeners.forEach((l) => l());
}

/**
 * Players hidden from the current user: everyone they blocked plus everyone
 * who blocked them. Cached briefly because lists call it on every load.
 */
export async function getHiddenPlayerIds(): Promise<Set<string>> {
  if (hiddenCache && Date.now() - hiddenCache.at < 30_000) return hiddenCache.ids;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_hidden_player_ids');
  if (error) return hiddenCache?.ids ?? new Set();
  const ids = new Set<string>(
    ((data ?? []) as unknown[]).map((row) =>
      typeof row === 'string' ? row : String((row as Record<string, unknown>).get_hidden_player_ids ?? '')
    )
  );
  hiddenCache = { at: Date.now(), ids };
  return ids;
}

/** Drop rows belonging to blocked players. */
export async function withoutBlocked<T>(rows: T[], getId: (row: T) => string): Promise<T[]> {
  if (!rows.length) return rows;
  const hidden = await getHiddenPlayerIds();
  if (!hidden.size) return rows;
  return rows.filter((r) => !hidden.has(getId(r)));
}

/** Block a player. Also removes the friendship and pending challenges. */
export async function blockPlayer(playerId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('block_player', { p_target: playerId });
  if (error) throw new Error(error.message || 'Could not block player.');
  notifyChanged();
}

export async function unblockPlayer(playerId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', me)
    .eq('blocked_id', playerId);
  if (error) throw new Error(error.message || 'Could not unblock player.');
  notifyChanged();
}

/** Players the current user has blocked, newest first. */
export async function getBlockedPlayers(): Promise<PlayerSummary[]> {
  const supabase = getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id, created_at')
    .eq('blocker_id', me)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message || 'Could not load blocked players.');
  const ids = (data ?? []).map((r) => r.blocked_id as string);
  if (!ids.length) return [];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', ids);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  return ids.map((id) => {
    const p = byId.get(id);
    return {
      id,
      name: p?.full_name || p?.username || 'Player',
      avatarUrl: p?.avatar_url ?? null,
    };
  });
}

/** File a report. The developer reviews reports in the Supabase dashboard. */
export async function reportPlayer(
  player: PlayerSummary,
  reason: ReportReason,
  details?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('Sign in to report a player.');
  const { error } = await supabase.from('player_reports').insert({
    reporter_id: me,
    reported_id: player.id,
    reason,
    details: details?.trim() ? details.trim().slice(0, 1000) : null,
    reported_name: player.name,
    reported_avatar_url: player.avatarUrl ?? null,
  });
  if (error) throw new Error(error.message || 'Could not send report.');
}
