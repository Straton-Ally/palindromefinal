import { useThemeContext } from '@/context/ThemeContext';
import { getBlockedPlayers, PlayerSummary, unblockPlayer } from '@/lib/moderation';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function BlockedPlayersScreen() {
  const { theme, colors } = useThemeContext();
  const isDark = theme === 'dark';
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlayers(await getBlockedPlayers());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await unblockPlayer(id);
      setPlayers((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }, []);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/profile' as any));

  const cardBg = isDark ? 'rgba(25,25,91,0.6)' : 'rgba(255,255,255,0.9)';
  const text = isDark ? '#FFFFFF' : '#111111';
  const muted = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.6)';

  return (
    <LinearGradient colors={isDark ? ['#0a0a1c', '#16162e'] : ['#f0f4ff', '#e8ecf8']} style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.backBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>Blocked Players</Text>
          <View style={styles.backBtn} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.note, { color: muted }]}>
              Blocked players can&apos;t find you, add you, challenge you or be matched with you, and you won&apos;t
              see them anywhere in the app.
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
            ) : players.length === 0 ? (
              <Text style={[styles.note, { color: muted, marginBottom: 0 }]}>You haven&apos;t blocked anyone.</Text>
            ) : (
              players.map((p) => (
                <View key={p.id} style={styles.row}>
                  <Image
                    source={p.avatarUrl ? { uri: p.avatarUrl } : require('../../assets/images/profile_ph.png')}
                    style={styles.avatar}
                  />
                  <Text style={[styles.name, { color: text }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Pressable
                    onPress={() => void unblock(p.id)}
                    disabled={!!busyId}
                    style={({ pressed }) => [
                      styles.unblockBtn,
                      { borderColor: colors.accent, opacity: busyId ? 0.6 : pressed ? 0.8 : 1 },
                    ]}
                  >
                    {busyId === p.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={[styles.unblockText, { color: colors.accent }]}>Unblock</Text>
                    )}
                  </Pressable>
                </View>
              ))
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: 'Geist-Bold', fontSize: 20 },
  content: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { borderRadius: 16, padding: 18 },
  note: { fontFamily: 'Geist-Regular', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.25)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  name: { fontFamily: 'Geist-Bold', fontSize: 15, flex: 1, marginRight: 8 },
  unblockBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minWidth: 84, alignItems: 'center' },
  unblockText: { fontFamily: 'Geist-Bold', fontSize: 13 },
  error: { fontFamily: 'Geist-Regular', fontSize: 13, color: '#E5484D', marginTop: 10 },
});
