'use client';

import { PlayerActionsButton } from '@/components/PlayerActions';
import { useThemeContext } from '@/context/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { getMyBestSinglePlayer, getSinglePlayerLeaderboard } from '@/lib/singlePlayer';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function formatTime(totalSeconds: number) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0');
  const ss = (secs % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function LeaderboardWeb() {
  const { theme, colors } = useThemeContext();
  const isDark = theme === 'dark';
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<
    {
      user_id: string;
      best_score: number;
      best_time_seconds: number;
      profile?: { full_name: string | null; username: string | null; avatar_url: string | null };
    }[]
  >([]);
  const [myBest, setMyBest] = useState<{ best_score: number; best_time_seconds: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [top, best] = await Promise.all([
        getSinglePlayerLeaderboard(20),
        user?.id ? getMyBestSinglePlayer(user.id) : Promise.resolve(null),
      ]);
      setError(null);
      setLeaderboard(
        top.map((r) => ({
          user_id: r.user_id,
          best_score: r.best_score,
          best_time_seconds: r.best_time_seconds,
          profile: r.profile
            ? { full_name: r.profile.full_name, username: r.profile.username, avatar_url: r.profile.avatar_url }
            : undefined,
        })),
      );
      setMyBest(best ? { best_score: best.best_score, best_time_seconds: best.best_time_seconds } : null);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not load leaderboard.');
      setLeaderboard([]);
      setMyBest(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const text = isDark ? '#FFFFFF' : '#111111';
  const muted = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(17,17,17,0.62)';
  const shellBg = isDark ? (['#000017', '#000074'] as const) : (['#EEF3FF', '#FFFFFF'] as const);
  const glassBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.92)';
  const glassBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';

  const myBestText = useMemo(() => {
    if (authLoading) return 'Loading...';
    if (!user) return 'Sign in to see your best run.';
    if (error) return 'Could not load your best yet.';
    if (!myBest) return 'No runs recorded yet. Play a game to set your best.';
    if (myBest.best_score <= 0) return 'No runs recorded yet. Play a game to set your best.';
    return `Best score: ${myBest.best_score} • Time: ${formatTime(myBest.best_time_seconds)}`;
  }, [authLoading, error, myBest, user]);

  const topThree = leaderboard.slice(0, 3);

  return (
    <LinearGradient colors={shellBg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={[styles.iconBtn, { borderColor: glassBorder, backgroundColor: glassBg }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: text }]}>Leaderboard</Text>
            <Text style={[styles.subtitle, { color: muted }]}>Top 20 best runs</Text>
          </View>
          <Pressable onPress={() => void load()} style={[styles.iconBtn, { borderColor: glassBorder, backgroundColor: glassBg }]} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={20} color={text} />
          </Pressable>
        </View>

        <View style={[styles.heroCard, { backgroundColor: glassBg, borderColor: glassBorder }]}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="trophy" size={18} color="#FFFFFF" />
            </View>
            <Text style={[styles.heroLabel, { color: muted }]}>Your Best</Text>
          </View>
          <View style={styles.heroRow}>
            <View style={styles.heroMetric}>
              <Text style={[styles.metricValue, { color: text }]}>{myBest?.best_score ?? '—'}</Text>
              <Text style={[styles.metricLabel, { color: muted }]}>Score</Text>
            </View>
            <View style={[styles.heroDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)' }]} />
            <View style={styles.heroMetric}>
              <Text style={[styles.metricValue, { color: text }]}>{myBest ? formatTime(myBest.best_time_seconds) : '—'}</Text>
              <Text style={[styles.metricLabel, { color: muted }]}>Time</Text>
            </View>
          </View>
          <Text style={[styles.heroHint, { color: muted }]}>{myBestText}</Text>
        </View>

        <View style={[styles.panel, { backgroundColor: glassBg, borderColor: glassBorder }]}>
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, { color: text }]}>Podium</Text>
            {error ? (
              <Text style={[styles.panelError, { color: muted }]} numberOfLines={1}>
                {error}
              </Text>
            ) : null}
          </View>

          {loading ? (
            <View style={{ paddingVertical: 18 }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : topThree.length === 0 ? (
            <Text style={[styles.empty, { color: muted }]}>No results yet.</Text>
          ) : (
            <View style={styles.podiumRow}>
              {topThree.map((r, idx) => {
                const rank = idx + 1;
                const name = r.profile?.full_name || r.profile?.username || 'Player';
                const isMe = !!user?.id && r.user_id === user.id;
                const medal =
                  rank === 1
                    ? (['#FDE68A', '#F59E0B'] as const)
                    : rank === 2
                      ? (['#E5E7EB', '#9CA3AF'] as const)
                      : (['#FBCFE8', '#FB7185'] as const);
                return (
                  <LinearGradient
                    key={r.user_id}
                    colors={medal}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.podiumCard, isMe ? styles.podiumMe : null]}
                  >
                    <View style={styles.podiumTop}>
                      <View style={styles.podiumBadge}>
                        <Text style={styles.podiumRank}>#{rank}</Text>
                      </View>
                      {isMe ? (
                        <View style={styles.mePill}>
                          <Text style={styles.mePillText}>YOU</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.podiumAvatarWrap}>
                      {r.profile?.avatar_url ? (
                        <Image source={{ uri: r.profile.avatar_url }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Ionicons name="person" size={16} color="rgba(255,255,255,0.92)" />
                        </View>
                      )}
                    </View>
                    <Text style={styles.podiumName} numberOfLines={1}>
                      {name}
                    </Text>
                    <View style={styles.podiumStats}>
                      <Text style={styles.podiumScore}>{r.best_score}</Text>
                      <Text style={styles.podiumTime}>{formatTime(r.best_time_seconds)}</Text>
                    </View>
                  </LinearGradient>
                );
              })}
            </View>
          )}
        </View>

        <View style={[styles.panel, { backgroundColor: glassBg, borderColor: glassBorder, flex: 1 }]}>
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, { color: text }]}>Top 20</Text>
            <View style={{ flex: 1 }} />
            <View style={[styles.legendChip, { borderColor: glassBorder, backgroundColor: isDark ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.55)' }]}>
              <Text style={[styles.legendText, { color: muted }]}>Score</Text>
              <Text style={[styles.legendDot, { color: muted }]}>•</Text>
              <Text style={[styles.legendText, { color: muted }]}>Time</Text>
            </View>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 18 }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : leaderboard.length === 0 ? (
            <Text style={[styles.empty, { color: muted }]}>No results yet.</Text>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator>
              {leaderboard.map((r, idx) => {
                const name = r.profile?.full_name || r.profile?.username || 'Player';
                const isMe = !!user?.id && r.user_id === user.id;
                const rowBg = isMe
                  ? isDark
                    ? 'rgba(72, 183, 255, 0.18)'
                    : 'rgba(0, 96, 255, 0.10)'
                  : isDark
                    ? 'rgba(255,255,255,0.05)'
                    : 'rgba(255,255,255,0.70)';
                const medalIcon = idx === 0 ? 'trophy' : idx === 1 ? 'medal' : idx === 2 ? 'ribbon' : null;

                return (
                  <View key={r.user_id} style={[styles.listRow, { backgroundColor: rowBg, borderColor: glassBorder }]}>
                    <View style={styles.listLeft}>
                      <View style={[styles.rankPill, { borderColor: glassBorder, backgroundColor: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.55)' }]}>
                        <Text style={[styles.rankText, { color: muted }]}>{idx + 1}</Text>
                      </View>
                      <View style={styles.listAvatarWrap}>
                        {r.profile?.avatar_url ? (
                          <Image source={{ uri: r.profile.avatar_url }} style={styles.listAvatar} />
                        ) : (
                          <View style={[styles.listAvatarFallback, { backgroundColor: isDark ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)' }]}>
                            <Ionicons name="person" size={14} color={isDark ? 'rgba(255,255,255,0.85)' : 'rgba(17,17,17,0.75)'} />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={[styles.listName, { color: text }]} numberOfLines={1}>
                            {name}
                          </Text>
                          {isMe ? (
                            <View style={[styles.youChip, { backgroundColor: isDark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.08)', borderColor: glassBorder }]}>
                              <Text style={[styles.youChipText, { color: text }]}>YOU</Text>
                            </View>
                          ) : null}
                        </View>
                        {medalIcon ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <Ionicons name={medalIcon as any} size={14} color={colors.accent} />
                            <Text style={[styles.topLabel, { color: muted }]}>Top {idx + 1}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.listRight}>
                      <Text style={[styles.listScore, { color: text }]}>{r.best_score}</Text>
                      <Text style={[styles.listTime, { color: muted }]}>{formatTime(r.best_time_seconds)}</Text>
                    </View>
                    {!isMe && user ? (
                      <PlayerActionsButton
                        player={{ id: r.user_id, name, avatarUrl: r.profile?.avatar_url ?? null }}
                        onBlocked={(id) => setLeaderboard((prev) => prev.filter((row) => row.user_id !== id))}
                        size={18}
                      />
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  header: {
    paddingTop: 4,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Geist-Bold',
    lineHeight: 22,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Geist-Regular',
  },
  heroCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 96, 255, 0.85)',
  },
  heroLabel: {
    fontFamily: 'Geist-Bold',
    fontSize: 12,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  heroMetric: {
    flex: 1,
    alignItems: 'center',
  },
  heroDivider: {
    width: 1,
    height: 44,
  },
  metricValue: {
    fontFamily: 'Geist-Bold',
    fontSize: 26,
    letterSpacing: -0.6,
  },
  metricLabel: {
    marginTop: 4,
    fontFamily: 'Geist-Regular',
    fontSize: 12,
  },
  heroHint: {
    marginTop: 10,
    fontFamily: 'Geist-Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  panel: {
    marginTop: 12,
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  panelTitle: {
    fontFamily: 'Geist-Bold',
    fontSize: 14,
  },
  panelError: {
    flex: 1,
    textAlign: 'right',
    fontFamily: 'Geist-Regular',
    fontSize: 12,
  },
  empty: {
    fontFamily: 'Geist-Regular',
    fontSize: 13,
    paddingVertical: 8,
  },
  podiumRow: {
    flexDirection: 'row',
    gap: 10,
  },
  podiumCard: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    minHeight: 122,
  },
  podiumMe: {
    borderWidth: 2,
    borderColor: 'rgba(0, 96, 255, 0.45)',
  },
  podiumTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  podiumBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  podiumRank: {
    fontFamily: 'Geist-Bold',
    fontSize: 11,
    color: 'rgba(255,255,255,0.92)',
  },
  mePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  mePillText: {
    fontFamily: 'Geist-Bold',
    fontSize: 11,
    color: 'rgba(255,255,255,0.95)',
    letterSpacing: 0.6,
  },
  podiumAvatarWrap: {
    marginTop: 10,
    alignItems: 'center',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumName: {
    marginTop: 8,
    fontFamily: 'Geist-Bold',
    fontSize: 12,
    color: 'rgba(0,0,0,0.82)',
    textAlign: 'center',
  },
  podiumStats: {
    marginTop: 6,
    alignItems: 'center',
  },
  podiumScore: {
    fontFamily: 'Geist-Bold',
    fontSize: 18,
    color: 'rgba(0,0,0,0.88)',
  },
  podiumTime: {
    marginTop: 2,
    fontFamily: 'Geist-Regular',
    fontSize: 11,
    color: 'rgba(0,0,0,0.65)',
  },
  legendChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendText: { fontFamily: 'Geist-Regular', fontSize: 11 },
  legendDot: { fontFamily: 'Geist-Bold', fontSize: 12 },
  listRow: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  rankPill: {
    width: 34,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: 'Geist-Bold',
    fontSize: 11,
  },
  listAvatarWrap: { width: 28, height: 28, borderRadius: 10, overflow: 'hidden' },
  listAvatar: { width: 28, height: 28 },
  listAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listName: { fontFamily: 'Geist-Bold', fontSize: 13 },
  youChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  youChipText: { fontFamily: 'Geist-Bold', fontSize: 10, letterSpacing: 0.8 },
  topLabel: { fontFamily: 'Geist-Regular', fontSize: 11 },
  listRight: { alignItems: 'flex-end' },
  listScore: { fontFamily: 'Geist-Bold', fontSize: 16 },
  listTime: { marginTop: 2, fontFamily: 'Geist-Regular', fontSize: 12 },
});
