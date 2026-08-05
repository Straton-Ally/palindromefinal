import { isPasswordResetHandoffActive } from '@/authService';
import { SettingsProvider } from '@/context/SettingsContext';
import { ThemeProvider, useThemeContext } from '@/context/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import * as Font from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter, useSegments } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import 'react-native-url-polyfill/auto';

const WEB_TITLE = 'PALINDROME | GAMMA GAMES BY OXFORD';

const webFontCss = `
@font-face {
  font-family: 'Geist-Regular';
  src: url('/Geist-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Geist-Bold';
  src: url('/Geist-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
html, body, #root {
  min-height: 100%;
  overflow: auto;
  font-family: 'Geist-Regular', system-ui, sans-serif;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar,
#root::-webkit-scrollbar,
*::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
`;

const SplashScreen = Platform.select({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  web: require('../screens/loadscreen.web').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  default: require('../screens/loadscreen.native').default,
});

// Separate component to apply gradient background globally
function AppContent() {
  const { theme } = useThemeContext();

  // Figma dark gradient colors
  const darkGradient = ['#0F172A', '#1E1B4B', '#312E81'] as const;
const lightGradient = ['#FFFFFF', '#E2E8F0'] as const;


  return (
    <LinearGradient
      colors={theme === 'dark' ? darkGradient : lightGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </LinearGradient>
  );
}

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);
  const { user, loading: authLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const splashHiddenRef = useRef(false);

  const [fontsLoaded] = Font.useFonts(
    Platform.OS === 'web'
      ? {}
      : {
          'Geist-Regular': require('../assets/fonts/Geist-Regular.ttf'),
          'Geist-Bold': require('../assets/fonts/Geist-Bold.ttf'),
        }
  );

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = WEB_TITLE;
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;

    const inTabsGroup = segments[0] === '(tabs)';
    const routeName = segments[1] ?? 'index';
    const isAuthScreen = inTabsGroup && (routeName === 'index' || routeName === 'signup');
    const isResetPasswordRoute = inTabsGroup && routeName === 'reset-password';
    const isLegalRoute = segments[0] === 'privacy-policy' || segments[0] === 'terms-and-conditions';
    const isPublicRoute = isAuthScreen || segments[0] === 'auth' || isLegalRoute;
    const isPasswordResetHandoff = isPasswordResetHandoffActive();

    if (!user && !isPublicRoute) {
      router.replace('/');
    } else if (user && isAuthScreen && !isPasswordResetHandoff) {
      router.replace('/(tabs)/main');
    } else if (
      user &&
      segments[0] !== '(tabs)' &&
      segments[0] !== 'auth' &&
      !isLegalRoute &&
      !(isPasswordResetHandoff && isResetPasswordRoute)
    ) {
      router.replace('/(tabs)/main');
    }
  }, [user, segments, authLoading, router]);

  const shouldShowSplash = !fontsLoaded || authLoading || showSplash;

  const handleSplashReady = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    setTimeout(() => setShowSplash(false), 0);
  }, []);

  if (shouldShowSplash) {
    return (
      <>
        {Platform.OS === 'web'
          ? React.createElement('style', { dangerouslySetInnerHTML: { __html: webFontCss } })
          : null}
        <SplashScreen onReady={handleSplashReady} />
      </>
    );
  }

  // ✅ Wrap your entire app in ThemeProvider
  return (
    <ThemeProvider>
      <SettingsProvider>
        {Platform.OS === 'web'
          ? React.createElement('style', { dangerouslySetInnerHTML: { __html: webFontCss } })
          : null}
        <AppContent />
      </SettingsProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
});
