import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

export default function AuthCallbackScreen() {
  const { theme } = useThemeContext();
  const params = useLocalSearchParams();
  const deepLinkUrl = Linking.useURL();
  const completedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const errorDescription =
      typeof params.error_description === 'string' ? params.error_description : null;
    const errorParam = typeof params.error === 'string' ? params.error : null;

    if (errorDescription || errorParam) {
      setError(errorDescription || errorParam);
      return;
    }

    if (completedRef.current) return;

    const completeWithTimeout = (url: string) =>
      Promise.race([
        authService.completeOAuthRedirect(url),
        new Promise<Awaited<ReturnType<typeof authService.completeOAuthRedirect>>>((resolve) =>
          setTimeout(() => resolve({ success: false, error: 'OAuth callback timed out' }), 20_000)
        ),
      ]);

    void (async () => {
      const urls: string[] = [];
      const addUrl = (url?: string | null) => {
        if (url && !urls.includes(url)) urls.push(url);
      };

      addUrl(deepLinkUrl);
      addUrl(typeof window !== 'undefined' ? window.location.href : '');
      addUrl(await Linking.getInitialURL());

      if (!urls.length) {
        // Construct URL from params if we are on native and deep linked
        const base = 'https://localhost/auth/callback';
        const query = new URLSearchParams();
        if (params.code) query.append('code', String(params.code));
        if (params.access_token) query.append('access_token', String(params.access_token));
        if (params.refresh_token) query.append('refresh_token', String(params.refresh_token));
        if (params.error) query.append('error', String(params.error));
        if (params.error_description) query.append('error_description', String(params.error_description));
        
        // Only construct if we have relevant params
        if (query.toString()) {
          addUrl(`${base}?${query.toString()}`);
        }
      }

      let lastError: string | null = null;
      for (const url of urls) {
        const result = await completeWithTimeout(url);
        if (result.success) {
          completedRef.current = true;
          router.replace('/main');
          return;
        }
        lastError = result.error || 'Failed to complete sign in';
      }

      const user = await authService.getSessionUser();
      if (user) {
        completedRef.current = true;
        router.replace('/main');
        return;
      }

      if (lastError) setError(lastError);
    })();
  }, [deepLinkUrl, params.code, params.access_token, params.refresh_token, params.error, params.error_description]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        backgroundColor: theme === 'dark' ? '#000017' : '#FFFFFF',
      }}
    >
      {error ? (
        <Text
          style={{
            color: theme === 'dark' ? '#FFFFFF' : '#111111',
            fontFamily: 'Geist-Regular',
            textAlign: 'center',
          }}
        >
          {error}
        </Text>
      ) : (
        <ActivityIndicator size="large" color={theme === 'dark' ? '#FFFFFF' : '#0060FF'} />
      )}
    </View>
  );
}
