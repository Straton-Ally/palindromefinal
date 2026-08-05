import { useThemeContext } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
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
          <Text style={[styles.title, { color: text }]}>Terms & Conditions</Text>
          <View style={styles.backBtn} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.updated, { color: muted }]}>Last updated August 5, 2026</Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>1. Acceptance of Terms</Text>
          <Text style={[styles.body, { color: muted }]}>
            By downloading, accessing, or using Palindrome, you agree to these Terms & Conditions. If you do not agree, please do not use the app.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>2. Your Account</Text>
          <Text style={[styles.body, { color: muted }]}>
            You are responsible for keeping your account credentials secure and for all activity that occurs under your account. You must provide accurate information when registering and must be at least 13 years old to create an account.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>3. Acceptable Use</Text>
          <Text style={[styles.body, { color: muted }]}>
            You agree to play fairly and not to cheat, exploit bugs, use automated tools or modified clients, or manipulate scores and leaderboards. You must not harass, threaten, or abuse other players, or upload offensive usernames or avatar images.
          </Text>
          <Text style={[styles.body, { color: muted }]}>
            You must not attempt to disrupt, reverse engineer, or gain unauthorized access to our servers, multiplayer services, or other players' accounts.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>4. User Content</Text>
          <Text style={[styles.body, { color: muted }]}>
            You retain ownership of content you upload, such as avatar images. By uploading, you grant us a license to store and display that content within the app. We may remove content that violates these terms.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>5. Game Content and Availability</Text>
          <Text style={[styles.body, { color: muted }]}>
            All game content, including the PALINDROME® board, artwork, rules, and software, is owned by Gamma Games and protected by intellectual property laws. We may update, modify, or discontinue features, game modes, matchmaking, or the app itself at any time.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>6. Suspension and Termination</Text>
          <Text style={[styles.body, { color: muted }]}>
            We may suspend or terminate your account if you violate these terms, cheat, or abuse other players. You may delete your account at any time by contacting support.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>7. Disclaimer and Liability</Text>
          <Text style={[styles.body, { color: muted }]}>
            The app is provided on an "as is" and "as available" basis without warranties of any kind. We are not liable for lost game progress, scores, service interruptions, or indirect damages arising from your use of the app, to the extent permitted by law.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>8. Privacy</Text>
          <Text style={[styles.body, { color: muted }]}>
            Your use of Palindrome is also governed by our Privacy Policy, which explains what data we collect and how we use it.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>9. Changes to These Terms</Text>
          <Text style={[styles.body, { color: muted }]}>
            We may revise these terms from time to time. Continued use of the app after changes take effect means you accept the revised terms.
          </Text>

          <Text style={[styles.body, { color: text, fontFamily: 'Geist-Bold' }]}>10. Contact</Text>
          <Text style={[styles.body, { color: muted }]}>
            For questions about these terms, contact Gamma Games through the app settings or at the support email listed in the app store.
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
