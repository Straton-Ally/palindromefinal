/**
 * In-app confirmation dialog (native), styled like the game's "Leave Game?" card.
 * Replaces Android's system Alert so prompts match the app's look.
 */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

type Props = {
  visible: boolean;
  isDark: boolean;
  title: string;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  cancelLabel?: string;
  confirmLabel?: string;
  /** Shown under the message, e.g. when the confirm action failed. */
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog(props: Props) {
  const {
    visible,
    isDark,
    title,
    message,
    icon = 'exit-outline',
    cancelLabel = 'Stay',
    confirmLabel = 'Leave',
    error,
    busy = false,
    onCancel,
    onConfirm,
  } = props;

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(140)}
      style={[StyleSheet.absoluteFill, styles.root]}
      pointerEvents="auto"
    >
      <BlurView
        intensity={20}
        tint={isDark ? 'dark' : 'light'}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <Pressable style={styles.overlay} onPress={busy ? undefined : onCancel}>
        <Animated.View entering={ZoomIn.springify().damping(18).stiffness(220)} style={styles.cardWrap}>
          {/* Inner Pressable swallows taps so they don't reach the backdrop. */}
          <Pressable onPress={() => {}}>
            <LinearGradient colors={isDark ? ['#000017', '#000074'] : ['#FFFFFF', '#FFFFFF']} style={styles.card}>
              <View style={styles.iconCircle}>
                <Ionicons name={icon} size={28} color="#FFFFFF" />
              </View>
              <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>{title}</Text>
              <Text style={[styles.message, { color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.75)' }]}>
                {message}
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.buttonRow}>
                <Pressable
                  onPress={onCancel}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                    (pressed || busy) && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.secondaryText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>{cancelLabel}</Text>
                </Pressable>
                <Pressable
                  onPress={onConfirm}
                  disabled={busy}
                  style={({ pressed }) => [styles.primaryButton, pressed && { transform: [{ scale: 0.98 }] }]}
                >
                  <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.primaryGradient}>
                    {busy ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryText}>{confirmLabel}</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 1000, elevation: 1000 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cardWrap: { width: '100%', maxWidth: 400 },
  card: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: '#ef4444',
  },
  title: { fontSize: 22, fontWeight: '800', fontFamily: 'Geist-Bold', textAlign: 'center' },
  message: { marginTop: 6, fontSize: 14, fontFamily: 'Geist-Regular', textAlign: 'center', lineHeight: 20 },
  error: { marginTop: 10, fontSize: 13, fontFamily: 'Geist-Regular', textAlign: 'center', color: '#ef4444' },
  buttonRow: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 20 },
  secondaryButton: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontFamily: 'Geist-Regular', fontWeight: '700' },
  primaryButton: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  primaryGradient: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Geist-Bold', fontWeight: '700' },
});
