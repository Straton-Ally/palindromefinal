'use client';

import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import { getMatch, leaveMatch, subscribeToMatch, type Match } from '@/lib/matchmaking';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function MatchWaitingWebScreen() {
  const { theme, colors } = useThemeContext();
  const isDark = theme === 'dark';
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId: string; inviteCode?: string; returnTo?: string }>();
  const matchId = typeof params.matchId === 'string' ? params.matchId : Array.isArray(params.matchId) ? params.matchId[0] : undefined;
  const inviteCodeParam = typeof params.inviteCode === 'string' ? params.inviteCode : Array.isArray(params.inviteCode) ? params.inviteCode[0] : undefined;
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : Array.isArray(params.returnTo) ? params.returnTo[0] : undefined;
  const backTarget = returnTo === 'friends' ? '/friends' : '/multiplayer';
  const [match, setMatch] = useState<Match | null>(null);
  const [inviteCodeFromMatch, setInviteCodeFromMatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [leaveConfirmVisible, setLeaveConfirmVisible] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!matchId) {
      router.replace(backTarget);
      return;
    }

    getMatch(matchId).then((m) => {
      if (m) {
        setMatch(m);
        if (m.invite_code) setInviteCodeFromMatch(m.invite_code);
      }
      setLoading(false);
    });

    unsubRef.current = subscribeToMatch(matchId, (m) => {
      setMatch(m);
      if (m.invite_code) setInviteCodeFromMatch(m.invite_code);
      if (m.status === 'active') {
        const dest = m.mode === 'turn' ? '/turngame' : '/gamelayout';
        router.replace({ pathname: dest as any, params: { matchId: m.id, ...(returnTo ? { returnTo } : {}) } });
      } else if (m.status === 'cancelled') {
        router.replace(backTarget);
      }
    });

    const poll = setInterval(async () => {
      const m = await getMatch(matchId);
      if (m) {
        setMatch(m);
        if (m.invite_code) setInviteCodeFromMatch(m.invite_code);
        if (m.status === 'active') {
          const dest = m.mode === 'turn' ? '/turngame' : '/gamelayout';
          router.replace({ pathname: dest as any, params: { matchId: m.id, ...(returnTo ? { returnTo } : {}) } });
        } else if (m.status === 'cancelled') {
          router.replace(backTarget);
        }
      }
    }, 2500);

    return () => {
      clearInterval(poll);
      unsubRef.current?.();
    };
  }, [matchId, router, backTarget, returnTo]);

  const handleCancel = useCallback(async () => {
    if (!matchId) return;
    const user = await authService.getSessionUser();
    if (!user) {
      router.replace(backTarget);
      return;
    }
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveMatch(matchId, user.id);
      setLeaveConfirmVisible(false);
      router.replace(backTarget);
    } catch {
      setLeaveError('Could not leave match. Please try again.');
    } finally {
      setLeaving(false);
    }
  }, [matchId, router, backTarget]);

  // Ask before cancelling, same as the mobile app.
  const askToLeave = useCallback(() => {
    setLeaveError(null);
    setLeaveConfirmVisible(true);
  }, []);

  useEffect(() => {
    if (!leaveConfirmVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !leaving) setLeaveConfirmVisible(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaveConfirmVisible, leaving]);

  const rawDisplayCode = (inviteCodeParam ?? inviteCodeFromMatch ?? match?.invite_code ?? '').toString().toUpperCase();
  const displayCode = rawDisplayCode.startsWith('CHAL') ? '' : rawDisplayCode;
  const text = isDark ? '#FFFFFF' : '#111111';
  const muted = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.6)';

  if (!matchId) return null;

  return (
    <div
      style={{
        flex: 1,
        minHeight: '100vh',
        background: isDark ? '#0a0a1c' : '#f0f4ff',
        fontFamily: 'Geist-Regular, system-ui',
      }}
    >
      <View style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={askToLeave} style={styles.backBtn} accessibilityLabel="Cancel">
            <Ionicons name="arrow-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>Waiting for opponent</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.content}>
          {loading ? (
            <Text style={{ color: muted }}>Connecting...</Text>
          ) : (
            <>
              <Text style={[styles.waitingText, { color: text }]}>
                Waiting for opponent...
              </Text>
              {displayCode ? (
                <View style={[styles.codeBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
                  <Text style={[styles.codeLabel, { color: muted }]}>Invite code</Text>
                  <Text style={[styles.codeValue, { color: text }]} selectable>
                    {displayCode}
                  </Text>
                  <Text style={[styles.codeHint, { color: muted }]}>
                    Share this code with a friend to join
                  </Text>
                </View>
              ) : null}
            </>
          )}

          <Pressable
            onPress={askToLeave}
            disabled={leaving}
            style={[styles.cancelBtn, { borderColor: colors.accent, opacity: leaving ? 0.6 : 1 }]}
          >
            <Text style={[styles.cancelBtnText, { color: colors.accent }]}>
              {leaving ? 'Leaving...' : 'Cancel'}
            </Text>
          </Pressable>
        </View>
      </View>

      {leaveConfirmVisible ? (
        <div
          onClick={() => {
            if (!leaving) setLeaveConfirmVisible(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 30px',
            backgroundColor: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            animation: 'mwFadeIn 160ms ease-out',
          }}
        >
          <style>{`
            @keyframes mwFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes mwZoomIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
          `}</style>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-match-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 400,
              borderRadius: 32,
              padding: 32,
              boxShadow: '0px 20px 40px rgba(0, 0, 0, 0.4)',
              background: isDark ? 'linear-gradient(to right bottom, #000017, #000074)' : '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              animation: 'mwZoomIn 200ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
            }}
          >
            <h2
              id="leave-match-title"
              style={{ fontSize: 24, fontWeight: 700, color: text, fontFamily: 'Geist-Regular, system-ui', margin: '0 0 16px', textAlign: 'center' }}
            >
              Leave match?
            </h2>
            <p style={{ fontSize: 16, color: text, opacity: 0.8, fontFamily: 'Geist-Regular, system-ui', margin: '0 0 32px', textAlign: 'center' }}>
              If you leave, the match will be cancelled.
            </p>
            {leaveError ? (
              <p style={{ fontSize: 14, color: '#ef4444', fontFamily: 'Geist-Regular, system-ui', margin: '-20px 0 20px', textAlign: 'center' }}>
                {leaveError}
              </p>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', gap: 20, width: '100%' }}>
              <button
                type="button"
                onClick={() => setLeaveConfirmVisible(false)}
                disabled={leaving}
                style={{
                  flex: 1,
                  padding: 16,
                  borderRadius: 16,
                  border: 'none',
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  color: text,
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: 'Geist-Regular, system-ui',
                  cursor: leaving ? 'default' : 'pointer',
                }}
              >
                Stay
              </button>
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={leaving}
                style={{
                  flex: 1,
                  padding: 16,
                  borderRadius: 16,
                  border: 'none',
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: '#FFFFFF',
                  fontSize: 16,
                  fontWeight: 700,
                  fontFamily: 'Geist-Regular, system-ui',
                  cursor: leaving ? 'default' : 'pointer',
                  opacity: leaving ? 0.7 : 1,
                }}
              >
                {leaving ? 'Leaving...' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  title: { fontFamily: 'Geist-Bold', fontSize: 18 },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  waitingText: { fontFamily: 'Geist-Regular', fontSize: 16, marginBottom: 24 },
  codeBox: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 24,
    marginBottom: 32,
    borderRadius: 16,
    minWidth: 200,
  },
  codeLabel: { fontFamily: 'Geist-Regular', fontSize: 12, marginBottom: 6 },
  codeValue: { fontFamily: 'Geist-Bold', fontSize: 28, letterSpacing: 4 },
  codeHint: { fontFamily: 'Geist-Regular', fontSize: 12, marginTop: 8 },
  cancelBtn: {
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 140,
  },
  cancelBtnText: { fontFamily: 'Geist-Bold', fontSize: 16 },
});
