/**
 * Notifications service.
 * Friend requests, challenges, and app updates.
 */

import { getHiddenPlayerIds } from '@/lib/moderation';
import { getSupabaseClient } from '@/supabase';

export type NotificationType = 'friend_request' | 'challenge' | 'app_update';

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

/**
 * Get notifications for a user, newest first.
 */
export async function getNotifications(
  userId: string,
  options?: { limit?: number; unreadOnly?: boolean }
): Promise<NotificationRow[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 50);

  if (options?.unreadOnly) {
    query = query.is('read_at', null);
  }

  const { data, error } = await query;
  if (error) throw error;
  // Hide notifications sent by blocked players (their names are in the title).
  const hidden = await getHiddenPlayerIds();
  return ((data ?? []) as NotificationRow[]).filter((n) => {
    const from = n.data?.from_user_id;
    return !(typeof from === 'string' && hidden.has(from));
  });
}

/**
 * Get count of unread notifications.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Mark a notification as read.
 */
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Mark all notifications as read.
 */
export async function markAllAsRead(userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Create a notification (called by other services).
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  data?: Record<string, unknown>
): Promise<NotificationRow> {
  const supabase = getSupabaseClient();
  const { data: row, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      body: body ?? null,
      data: data ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return row as NotificationRow;
}
