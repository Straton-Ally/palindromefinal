import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import {
  acceptChallenge,
  acceptFriendRequest,
  declineChallenge,
  declineFriendRequest,
  getFriends,
  getHeadToHeadStats,
  getPendingChallenges,
  getPendingFriendRequests,
  type ChallengeRow,
  type FriendRow,
} from '@/lib/friends';
import {
  createInviteMatch,
  getMatch,
  getRecentMatches,
  joinByInviteCode,
  type Match,
} from '@/lib/matchmaking';
import {
  createTurnInviteMatch,
  joinTurnByInviteCode,
} from '@/lib/turnMatchmaking';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type FriendWithStats = FriendRow & {
  otherUserId: string;
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  losses: number;
};

export default function FriendsScreen() {
  const { theme, colors } = useThemeContext();
  const isDark = theme === 'dark';
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStats[]>([]);
  const [pending, setPending] = useState<FriendRow[]>([]);
  const [pendingChallenges, setPendingChallenges] = useState<ChallengeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'race' | 'turn'>('race');
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const load = useCallback(async () => {
    const user = await authService.getSessionUser();
    if (!user) {
      setRecentLoading(false);
      router.replace('/main');
      return;
    }
    setUserId(user.id);
    try {
      const [friendsList, pendingList, challengesList, recentList] = await Promise.all([
        getFriends(user.id),
        getPendingFriendRequests(user.id),
        getPendingChallenges(user.id),
        getRecentMatches(user.id, 10),
      ]);
      setPending(pendingList);
      setPendingChallenges(challengesList);
      setRecentMatches(recentList);

      const enriched: FriendWithStats[] = [];
      for (const f of friendsList) {
        const otherId = f.user_id === user.id ? f.friend_id : f.user_id;
        const profile = await authService.getProfile(otherId);
        const stats = await getHeadToHeadStats(user.id, otherId);
        enriched.push({
          ...f,
          otherUserId: otherId,
          displayName: profile?.full_name || profile?.username || 'Player',
          avatarUrl: profile?.avatar_url ?? null,
          wins: stats.myWins,
          losses: stats.theirWins,
        });
      }
      setFriends(enriched);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const navigateToMatch = useCallback((match: Match, inviteCode?: string) => {
    if (match.status === 'active') {
      const target = match.mode === 'turn' ? '/turngame' : '/gamelayout';
      router.replace({ pathname: target as any, params: { matchId: match.id } });
    } else {
      router.replace({
        pathname: '/matchwaiting',
        params: inviteCode ? { matchId: match.id, inviteCode, returnTo: 'friends' } : { matchId: match.id, returnTo: 'friends' },
      });
    }
  }, []);

  const handleCreateGame = useCallback(async () => {
    if (!userId) return;
    setCreateLoading(true);
    try {
      const { match, inviteCode } = selectedMode === 'turn'
        ? await createTurnInviteMatch(userId)
        : await createInviteMatch(userId);
      navigateToMatch(match, inviteCode);
    } catch (e) {
      Alert.alert('Error', (e as Error).message ?? 'Could not create game.');
    } finally {
      setCreateLoading(false);
    }
  }, [userId, navigateToMatch, selectedMode]);

  const handleJoinByCode = useCallback(async () => {
    if (!userId) return;
    const code = inviteCodeInput.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert('Invalid code', 'Enter the 6-character invite code.');
      return;
    }
    setJoinLoading(true);
    try {
      let match: Match;
      try {
        match = await joinByInviteCode(userId, code);
      } catch {
        match = await joinTurnByInviteCode(userId, code);
      }
      navigateToMatch(match);
    } catch (e) {
      Alert.alert('Could not join', (e as Error).message ?? 'Invalid or expired code.');
    } finally {
      setJoinLoading(false);
    }
  }, [userId, inviteCodeInput, navigateToMatch]);

  const openRecentMatch = useCallback((match: Match) => {
    if (match.status === 'finished') {
      router.push({ pathname: '/matchresult', params: { matchId: match.id } });
    }
  }, []);

  const handleAcceptRequest = useCallback(
    async (requestId: string) => {
      const user = await authService.getSessionUser();
      if (!user) return;
      try {
        await acceptFriendRequest(requestId, user.id);
        load();
      } catch {
        Alert.alert('Error', 'Could not accept request.');
      }
    },
    [load]
  );

  const handleDeclineRequest = useCallback(
    async (requestId: string) => {
      const user = await authService.getSessionUser();
      if (!user) return;
      try {
        await declineFriendRequest(requestId, user.id);
        load();
      } catch {
        Alert.alert('Error', 'Could not decline request.');
      }
    },
    [load]
  );

  const handleChallenge = useCallback(
    async (friendId: string) => {
      if (!userId) return;
      try {
        const { challengeFriend } = await import('@/lib/friends');
        const { matchId } = await challengeFriend(userId, friendId, selectedMode);
        router.replace({ pathname: '/matchwaiting', params: { matchId, returnTo: 'friends' } });
      } catch (e) {
        Alert.alert('Error', (e as Error).message ?? 'Could not challenge.');
      }
    },
    [selectedMode, userId]
  );

  const handleAcceptChallenge = useCallback(
    async (challengeId: string) => {
      const user = await authService.getSessionUser();
      if (!user) return;
      try {
        const { matchId } = await acceptChallenge(challengeId, user.id);
        const match = await getMatch(matchId);
        const target = match?.mode === 'turn' ? '/turngame' : '/gamelayout';
        router.replace({ pathname: target as any, params: { matchId } });
      } catch (e) {
        Alert.alert('Error', (e as Error).message ?? 'Could not accept challenge.');
      }
    },
    []
  );

  const handleDeclineChallenge = useCallback(
    async (challengeId: string) => {
      const user = await authService.getSessionUser();
      if (!user) return;
      try {
        await declineChallenge(challengeId, user.id);
        setPendingChallenges((prev) => prev.filter((c) => c.id !== challengeId));
      } catch {
        // ignore
      }
    },
    []
  );

  const goBack = useCallback(() => router.back(), []);
  const goToAddFriend = useCallback(() => router.push('/addfriend'), []);

  const cardBg = isDark ? 'rgba(25,25,91,0.6)' : 'rgba(255,255,255,0.9)';
  const text = isDark ? '#FFFFFF' : '#111111';
  const muted = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.6)';

  return (
    <LinearGradient
      colors={isDark ? ['#0a0a1c', '#16162e'] : ['#f0f4ff', '#e8ecf8']}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>Play with Friends</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {pendingChallenges.length > 0 && (
            <View style={[styles.card, { backgroundColor: cardBg, borderLeftWidth: 4, borderLeftColor: colors.accent }]}>
              <Text style={[styles.cardTitle, { color: text }]}>Challenges</Text>
              <Text style={[styles.cardSubtitle, { color: muted, marginBottom: 12 }]}>
                Accept or decline to play
              </Text>
              {pendingChallenges.map((c) => (
                <ChallengeRowFriends
                  key={c.id}
                  challenge={c}
                  onAccept={() => handleAcceptChallenge(c.id)}
                  onDecline={() => handleDeclineChallenge(c.id)}
                  text={text}
                  muted={muted}
                  accentColor={colors.accent}
                />
              ))}
            </View>
          )}
          {pending.length > 0 && (
            <View style={[styles.card, { backgroundColor: cardBg }]}>
              <Text style={[styles.cardTitle, { color: text }]}>Friend requests</Text>
              {pending.map((req) => (
                <FriendRequestRow
                  key={req.id}
                  requestId={req.id}
                  fromUserId={req.user_id}
                  onAccept={() => handleAcceptRequest(req.id)}
                  onDecline={() => handleDeclineRequest(req.id)}
                  theme={theme}
                  text={text}
                  muted={muted}
                />
              ))}
            </View>
          )}

          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Game mode</Text>
            <Text style={[styles.cardSubtitle, { color: muted }]}>
              Choose mode for Create, Join, and Challenge
            </Text>
            <View style={styles.modeRow}>
              <Pressable
                onPress={() => setSelectedMode('race')}
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor: selectedMode === 'race' ? '#1177FE' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                  },
                ]}
              >
                <Ionicons name="flash" size={18} color={selectedMode === 'race' ? '#FFFFFF' : muted} />
                <Text style={[styles.modeBtnText, { color: selectedMode === 'race' ? '#FFFFFF' : text }]}>Race</Text>
              </Pressable>
              <Pressable
                onPress={() => setSelectedMode('turn')}
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor: selectedMode === 'turn' ? '#7C3AED' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                  },
                ]}
              >
                <Ionicons name="swap-horizontal" size={18} color={selectedMode === 'turn' ? '#FFFFFF' : muted} />
                <Text style={[styles.modeBtnText, { color: selectedMode === 'turn' ? '#FFFFFF' : text }]}>Turn</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Create game</Text>
            <Text style={[styles.cardSubtitle, { color: muted }]}>
              Create a {selectedMode === 'turn' ? 'turn-based' : 'race'} game and share the code with a friend
            </Text>
            <Pressable
              onPress={handleCreateGame}
              disabled={createLoading}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: colors.accent, opacity: createLoading ? 0.7 : pressed ? 0.9 : 1 },
              ]}
            >
              {createLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>Create & Get Code</Text>
              )}
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Join by code</Text>
            <Text style={[styles.cardSubtitle, { color: muted }]}>
              Enter the 6-character code from your friend
            </Text>
            <View style={styles.joinRow}>
              <TextInput
                value={inviteCodeInput}
                onChangeText={(t) => setInviteCodeInput(t.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor={muted}
                style={[
                  styles.codeInput,
                  {
                    backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)',
                    color: text,
                    borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                  },
                ]}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Pressable
                onPress={handleJoinByCode}
                disabled={joinLoading || inviteCodeInput.trim().length !== 6}
                style={({ pressed }) => [
                  styles.joinBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: joinLoading || inviteCodeInput.trim().length !== 6 ? 0.6 : pressed ? 0.9 : 1,
                  },
                ]}
              >
                {joinLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.joinBtnText}>Join</Text>
                )}
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Recent matches</Text>
            {recentLoading ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 12 }} />
            ) : recentMatches.length === 0 ? (
              <Text style={[styles.emptyText, { color: muted }]}>No recent matches</Text>
            ) : (
              recentMatches.slice(0, 10).map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => openRecentMatch(m)}
                  style={({ pressed }) => [styles.recentRow, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={[styles.recentStatus, { color: muted }]}>
                    {m.status === 'finished' ? 'Finished' : m.status}
                  </Text>
                  <Text style={[styles.recentDate, { color: muted }]}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </Text>
                  {m.status === 'finished' && (
                    <Ionicons name="chevron-forward" size={18} color={muted} />
                  )}
                </Pressable>
              ))
            )}
          </View>

          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Friends</Text>
              <Pressable
                onPress={goToAddFriend}
                style={({ pressed }) => [styles.addFriendBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.9 : 1 }]}
              >
                <Ionicons name="person-add" size={20} color="#FFFFFF" />
                <Text style={styles.addFriendBtnText}>Add friend</Text>
              </Pressable>
            </View>
            {loading ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 20 }} />
            ) : friends.length === 0 ? (
              <Text style={[styles.empty, { color: muted }]}>No friends yet. Add friends to challenge them!</Text>
            ) : (
              friends.map((f) => (
                <View key={f.id} style={styles.friendRow}>
                  <Image
                    source={f.avatarUrl ? { uri: f.avatarUrl } : require('../../assets/images/profile_ph.png')}
                    style={styles.avatar}
                  />
                  <View style={styles.friendInfo}>
                    <Text style={[styles.friendName, { color: text }]}>{f.displayName}</Text>
                    <Text style={[styles.friendStats, { color: muted }]}>
                      H2H: {f.wins}W – {f.losses}L
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleChallenge(f.otherUserId)}
                    style={({ pressed }) => [
                      styles.challengeBtn,
                      { backgroundColor: colors.accent, opacity: pressed ? 0.9 : 1 },
                    ]}
                  >
                    <Text style={styles.challengeBtnText}>Challenge</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function ChallengeRowFriends({
  challenge,
  onAccept,
  onDecline,
  text,
  muted,
  accentColor,
}: {
  challenge: ChallengeRow;
  onAccept: () => void;
  onDecline: () => void;
  text: string;
  muted: string;
  accentColor: string;
}) {
  const [name, setName] = useState('Loading...');
  useEffect(() => {
    authService.getProfile(challenge.from_user_id).then((p) => {
      setName(p?.full_name || p?.username || 'Player');
    });
  }, [challenge.from_user_id]);
  return (
    <View style={[styles.requestRow, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }]}>
      <Text style={[styles.friendName, { flex: 1, color: text }]}>{name} challenged you!</Text>
      <Pressable onPress={onAccept} style={[styles.smallBtn, { backgroundColor: accentColor }]}>
        <Text style={styles.smallBtnText}>Accept</Text>
      </Pressable>
      <Pressable
        onPress={onDecline}
        style={[styles.smallBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: muted }]}
      >
        <Text style={[styles.smallBtnText, { color: muted }]}>Decline</Text>
      </Pressable>
    </View>
  );
}

function FriendRequestRow({
  requestId,
  fromUserId,
  onAccept,
  onDecline,
  theme,
  text,
  muted,
}: {
  requestId: string;
  fromUserId: string;
  onAccept: () => void;
  onDecline: () => void;
  theme: string;
  text: string;
  muted: string;
}) {
  const [name, setName] = useState('Loading...');
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    authService.getProfile(fromUserId).then((p) => {
      setName(p?.full_name || p?.username || 'Player');
      setAvatar(p?.avatar_url ?? null);
    });
  }, [fromUserId]);

  return (
    <View style={styles.requestRow}>
      <Image
        source={avatar ? { uri: avatar } : require('../../assets/images/profile_ph.png')}
        style={styles.avatar}
      />
      <Text style={[styles.friendName, { flex: 1, color: text }]}>{name} wants to be your friend</Text>
      <Pressable onPress={onAccept} style={[styles.smallBtn, { backgroundColor: '#22c55e', marginRight: 8 }]}>
        <Text style={styles.smallBtnText}>Accept</Text>
      </Pressable>
      <Pressable onPress={onDecline} style={[styles.smallBtn, { borderWidth: 1, borderColor: muted }]}>
        <Text style={[styles.smallBtnText, { color: muted }]}>Decline</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  keyboard: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: 'Geist-Bold', fontSize: 20 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addFriendBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  addFriendBtnText: { fontFamily: 'Geist-Bold', fontSize: 14, color: '#FFFFFF' },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modeBtnText: { fontFamily: 'Geist-Bold', fontSize: 14 },
  card: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: { fontFamily: 'Geist-Bold', fontSize: 17, marginBottom: 4 },
  cardSubtitle: { fontFamily: 'Geist-Regular', fontSize: 13, marginBottom: 14 },
  empty: { fontFamily: 'Geist-Regular', fontSize: 14, marginVertical: 12 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  friendInfo: { flex: 1 },
  friendName: { fontFamily: 'Geist-Bold', fontSize: 15 },
  friendStats: { fontFamily: 'Geist-Regular', fontSize: 12, marginTop: 2 },
  challengeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  challengeBtnText: { fontFamily: 'Geist-Bold', fontSize: 13, color: '#FFFFFF' },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallBtnText: { fontFamily: 'Geist-Bold', fontSize: 12, color: '#FFFFFF' },
  secondaryBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryBtnText: { fontFamily: 'Geist-Bold', fontSize: 15 },
  joinRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 8 },
  codeInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Geist-Regular',
    fontSize: 18,
    letterSpacing: 2,
  },
  joinBtn: {
    minWidth: 80,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinBtnText: { fontFamily: 'Geist-Bold', fontSize: 16, color: '#FFFFFF' },
  emptyText: { fontFamily: 'Geist-Regular', fontSize: 14, marginVertical: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    gap: 8,
  },
  recentStatus: { fontFamily: 'Geist-Regular', fontSize: 14, flex: 1 },
  recentDate: { fontFamily: 'Geist-Regular', fontSize: 12 },
});
