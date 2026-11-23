'use client';

import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import { PlayerActionsButton } from '@/components/PlayerActions';
import { getFriendStatus, getRecentOpponents, searchUsers, sendFriendRequest } from '@/lib/friends';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type UserResult = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  isFriend?: boolean;
  requestSent?: boolean;
};

export default function AddFriendWebScreen() {
  const { theme, colors } = useThemeContext();
  const isDark = theme === 'dark';
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [recentOpponents, setRecentOpponents] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    const user = await authService.getSessionUser();
    if (!user) {
      router.replace('/multiplayer');
      return;
    }
    setUserId(user.id);
    const opponents = await getRecentOpponents(user.id, 20);
    const enriched: UserResult[] = [];
    for (const o of opponents) {
      const status = await getFriendStatus(user.id, o.id);
      enriched.push({
        id: o.id,
        full_name: o.full_name,
        avatar_url: o.avatar_url,
        username: null,
        isFriend: status === 'friends',
        requestSent: status === 'pending',
      });
    }
    setRecentOpponents(enriched);
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const handleSearch = useCallback(async () => {
    const user = await authService.getSessionUser();
    if (!user || query.trim().length < 2) return;
    setLoading(true);
    try {
      const results = await searchUsers(query.trim(), user.id);
      const enriched: UserResult[] = [];
      for (const r of results) {
        const status = await getFriendStatus(user.id, r.id);
        enriched.push({
          ...r,
          isFriend: status === 'friends',
          requestSent: status === 'pending',
        });
      }
      setSearchResults(enriched);
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleSendRequest = useCallback(
    async (toUserId: string) => {
      if (!userId) return;
      setSending(toUserId);
      try {
        await sendFriendRequest(userId, toUserId);
        setSearchResults((prev) => prev.map((r) => (r.id === toUserId ? { ...r, requestSent: true } : r)));
        setRecentOpponents((prev) => prev.map((r) => (r.id === toUserId ? { ...r, requestSent: true } : r)));
        Alert.alert('Sent', 'Friend request sent!');
      } catch (e) {
        Alert.alert('Error', (e as Error).message ?? 'Could not send request.');
      } finally {
        setSending(null);
      }
    },
    [userId]
  );

  const handleBlocked = useCallback((blockedId: string) => {
    setSearchResults((prev) => prev.filter((r) => r.id !== blockedId));
    setRecentOpponents((prev) => prev.filter((r) => r.id !== blockedId));
  }, []);

  const goBack = useCallback(() => router.back(), []);

  const cardBg = isDark ? 'rgba(25,25,91,0.6)' : 'rgba(255,255,255,0.9)';
  const text = isDark ? '#FFFFFF' : '#111111';
  const muted = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.6)';

  const displayName = (u: UserResult) => u.full_name || u.username || 'Player';

  return (
    <div style={{ flex: 1, minHeight: '100vh', background: isDark ? '#0a0a1c' : '#f0f4ff', fontFamily: 'Geist-Regular, system-ui' }}>
      <View style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>Add Friend</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Search by username or name</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Enter username or name..."
              placeholderTextColor={muted}
              style={[
                styles.input,
                {
                  backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)',
                  color: text,
                  borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={handleSearch}
              disabled={loading || query.trim().length < 2}
              style={[
                styles.searchBtn,
                { backgroundColor: colors.accent, opacity: loading || query.trim().length < 2 ? 0.6 : 1 },
              ]}
            >
              {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.searchBtnText}>Search</Text>}
            </Pressable>
          </View>

          {searchResults.length > 0 && (
            <View style={[styles.card, { backgroundColor: cardBg }]}>
              <Text style={[styles.cardTitle, { color: text }]}>Search results</Text>
              {searchResults.map((u) => (
                <View key={u.id} style={styles.userRow}>
                  <Image
                    source={u.avatar_url ? { uri: u.avatar_url } : require('../../assets/images/profile_ph.png')}
                    style={styles.avatar}
                  />
                  <Text style={[styles.userName, { color: text, flex: 1 }]}>{displayName(u)}</Text>
                  {u.isFriend ? (
                    <Text style={[styles.badge, { color: muted }]}>Friends</Text>
                  ) : u.requestSent ? (
                    <Text style={[styles.badge, { color: muted }]}>Request sent</Text>
                  ) : (
                    <Pressable
                      onPress={() => handleSendRequest(u.id)}
                      disabled={!!sending}
                      style={[styles.addBtn, { backgroundColor: colors.accent, opacity: sending ? 0.6 : 1 }]}
                    >
                      {sending === u.id ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.addBtnText}>Add</Text>
                      )}
                    </Pressable>
                  )}
                  <PlayerActionsButton
                    player={{ id: u.id, name: displayName(u), avatarUrl: u.avatar_url }}
                    onBlocked={handleBlocked}
                  />
                </View>
              ))}
            </View>
          )}

          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Players you&apos;ve met</Text>
            {recentOpponents.length === 0 ? (
              <Text style={[styles.empty, { color: muted }]}>Play matches to see opponents here</Text>
            ) : (
              recentOpponents.map((u) => (
                <View key={u.id} style={styles.userRow}>
                  <Image
                    source={u.avatar_url ? { uri: u.avatar_url } : require('../../assets/images/profile_ph.png')}
                    style={styles.avatar}
                  />
                  <Text style={[styles.userName, { color: text, flex: 1 }]}>{displayName(u)}</Text>
                  {u.isFriend ? (
                    <Text style={[styles.badge, { color: muted }]}>Friends</Text>
                  ) : u.requestSent ? (
                    <Text style={[styles.badge, { color: muted }]}>Request sent</Text>
                  ) : (
                    <Pressable
                      onPress={() => handleSendRequest(u.id)}
                      disabled={!!sending}
                      style={[styles.addBtn, { backgroundColor: colors.accent, opacity: sending ? 0.6 : 1 }]}
                    >
                      {sending === u.id ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.addBtnText}>Add</Text>
                      )}
                    </Pressable>
                  )}
                  <PlayerActionsButton
                    player={{ id: u.id, name: displayName(u), avatarUrl: u.avatar_url }}
                    onBlocked={handleBlocked}
                  />
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </div>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingTop: 48, paddingBottom: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: 'Geist-Bold', fontSize: 20 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  card: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: { fontFamily: 'Geist-Bold', fontSize: 17, marginBottom: 14 },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Geist-Regular',
    fontSize: 16,
    marginBottom: 12,
  },
  searchBtn: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: { fontFamily: 'Geist-Bold', fontSize: 16, color: '#FFFFFF' },
  empty: { fontFamily: 'Geist-Regular', fontSize: 14, marginVertical: 12 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  userName: { fontFamily: 'Geist-Bold', fontSize: 15 },
  badge: { fontFamily: 'Geist-Regular', fontSize: 13 },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { fontFamily: 'Geist-Bold', fontSize: 13, color: '#FFFFFF' },
});
