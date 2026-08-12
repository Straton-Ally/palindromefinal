import { useThemeContext } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';
  const text = isDark ? '#FFFFFF' : '#0F172A';
  const muted = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.68)';

  return (
    <LinearGradient colors={isDark ? ['#0a0a1c', '#16162e'] : ['#f8fbff', '#eef2ff']} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>Privacy Policy</Text>
          <View style={styles.backBtn} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.updated, { color: muted }]}>Last updated August 5, 2026</Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>1. Information GammaGames Collects</Text>
          <Text style={[styles.body, { color: muted }]}>
            When you create an account, GammaGames collects your email address, username, and profile information you provide (display name, avatar image). If you sign in with Google or Apple, GammaGames receives basic profile information from those services.
          </Text>
          <Text style={[styles.body, { color: muted }]}>
            During gameplay, GammaGames collects game statistics, match results, scores, friend connections, and in-game preferences. GammaGames also collects device information and app diagnostics to maintain service quality.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>2. How GammaGames Uses Your Information</Text>
          <Text style={[styles.body, { color: muted }]}>
            GammaGames uses your information to provide game services including multiplayer matchmaking, leaderboards, friend challenges, notifications, and profile customization. GammaGames analyzes gameplay data to improve game balance and detect cheating or abuse.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>3. Data Storage and Security</Text>
          <Text style={[styles.body, { color: muted }]}>
            Your data is stored securely using Supabase infrastructure. GammaGames implements industry-standard security measures to protect your information. Avatar images are stored in cloud storage with public read access so they can be displayed to other players.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>4. Information Sharing</Text>
          <Text style={[styles.body, { color: muted }]}>
            GammaGames does not sell your personal information. Your username, avatar, and game statistics are visible to other players. GammaGames may share data with service providers who help operate the game, and when required by law.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>5. Your Rights</Text>
          <Text style={[styles.body, { color: muted }]}>
            You can update your profile information in-app. You may request to view, export, or delete your personal data by contacting support. Account deletion will remove your profile and personal information, though anonymized game statistics may be retained.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>6. Children&apos;s Privacy</Text>
          <Text style={[styles.body, { color: muted }]}>
            Palindrome is not directed to children under 13. GammaGames does not knowingly collect information from children under 13. If you believe a child has provided GammaGames with personal information, please contact GammaGames.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>7. Changes to This Policy</Text>
          <Text style={[styles.body, { color: muted }]}>
            GammaGames may update this Privacy Policy from time to time. GammaGames will notify you of significant changes through the app or by email.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>8. Contact</Text>
          <Text style={[styles.body, { color: muted }]}>
            For privacy questions or data requests, contact Gamma Games through the app settings or at the support email listed in the app store.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Geist-Bold', fontSize: 20 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 24, gap: 16 },
  updated: { fontFamily: 'Geist-Regular', fontSize: 13 },
  body: { fontFamily: 'Geist-Regular', fontSize: 16, lineHeight: 24 },
});
