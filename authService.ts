import { getSupabaseClient } from '@/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser | null;
  error?: string;
  code?: string;
}

let passwordResetHandoffActive = false;
const WEB_AUTH_ORIGIN = 'https://palindrome.gammagamesbyoxford.com';

export const isPasswordResetHandoffActive = () => passwordResetHandoffActive;
export const clearPasswordResetHandoff = () => {
  passwordResetHandoffActive = false;
};

const toAuthUser = (user: any): AuthUser => {
  const displayName =
    (user?.user_metadata?.displayName as string | undefined) ??
    (user?.user_metadata?.display_name as string | undefined) ??
    null;

  return {
    id: user.id,
    email: user.email ?? null,
    displayName,
  };
};

const parseOAuthRedirectUrl = (url: string) => {
  const u = new URL(url);
  const query = u.searchParams;
  const hashParams = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);

  const code = query.get('code') || hashParams.get('code');

  const access_token = hashParams.get('access_token') || query.get('access_token');
  const refresh_token = hashParams.get('refresh_token') || query.get('refresh_token');

  const error = query.get('error') || hashParams.get('error');
  const error_description = query.get('error_description') || hashParams.get('error_description');

  return {
    code,
    access_token,
    refresh_token,
    error,
    error_description,
  };
};

const getWebAuthOrigin = () =>
  typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : WEB_AUTH_ORIGIN;

class AuthService {
  constructor() {
    // Configure Google Sign-In for native platforms
    if (Platform.OS !== 'web') {
      GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
        scopes: ['profile', 'email'],
        offlineAccess: true,
      });
    }
  }

  private async signInWithNativeOAuth(provider: 'google' | 'apple'): Promise<AuthResult> {
    const supabase = getSupabaseClient();
    const redirectTo = Linking.createURL('auth/callback');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        ...(provider === 'apple' ? { scopes: 'name email' } : {}),
      },
    });

    if (error) return { success: false, error: error.message, code: (error as any).code };
    if (!data?.url) return { success: false, error: 'Missing OAuth URL' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) return { success: false, error: 'Sign in canceled' };

    return await this.completeOAuthRedirect(result.url);
  }

  async exchangeCodeForSession(code: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return { success: false, error: error.message, code: (error as any).code };
      return { success: true, user: data.user ? toAuthUser(data.user) : null };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to complete sign in' };
    }
  }

  async setSessionFromTokens(access_token: string, refresh_token: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) return { success: false, error: error.message, code: (error as any).code };
      return { success: true, user: data.user ? toAuthUser(data.user) : null };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to complete sign in' };
    }
  }

  async completeOAuthRedirect(url: string): Promise<AuthResult> {
    try {
      const parsed = parseOAuthRedirectUrl(url);

      if (parsed.error || parsed.error_description) {
        return { success: false, error: parsed.error_description || parsed.error || 'OAuth error' };
      }

      if (parsed.code) return await this.exchangeCodeForSession(parsed.code);
      if (parsed.access_token && parsed.refresh_token) {
        return await this.setSessionFromTokens(parsed.access_token, parsed.refresh_token);
      }

      return { success: false, error: 'Missing auth code' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to complete sign in' };
    }
  }

  async signInWithGoogle(): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();

      if (Platform.OS === 'web') {
        // Web: Use Supabase OAuth flow
        const redirectTo = `${getWebAuthOrigin()}/auth/callback`;
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo },
        });

        if (error) return { success: false, error: error.message, code: (error as any).code };
        if (data?.url) window.location.assign(data.url);
        return { success: true };
      }

      // Native: Use Google Sign-In SDK
      try {
        // Check if Google Play Services are available
        await GoogleSignin.hasPlayServices();
        
        // Sign in with Google
        const userInfo = await GoogleSignin.signIn();
        
        // Extract ID token (handle different response structures)
        const idToken = userInfo.data?.idToken || (userInfo as any).idToken;

        if (!idToken) {
          return { success: false, error: 'No ID token found' };
        }

        // Sign in to Supabase with the Google ID token
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });

        if (error) {
          return { success: false, error: error.message, code: (error as any).code };
        }

        return { success: true, user: data.user ? toAuthUser(data.user) : null };
      } catch (error: any) {
        // Handle Google Sign-In specific errors
        if (isErrorWithCode(error)) {
          switch (error.code) {
            case statusCodes.SIGN_IN_CANCELLED:
              return { success: false, error: 'Sign in cancelled' };
            case statusCodes.IN_PROGRESS:
              return { success: false, error: 'Sign in already in progress' };
            case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
              return { success: false, error: 'Google Play Services not available' };
            default:
              if (error.code === 'DEVELOPER_ERROR') {
                return await this.signInWithNativeOAuth('google');
              }
              return { success: false, error: error.message || 'Google sign-in failed' };
          }
        }
        if (error?.code === 'DEVELOPER_ERROR' || error?.message?.includes('DEVELOPER_ERROR')) {
          return await this.signInWithNativeOAuth('google');
        }
        return { success: false, error: error?.message || 'Google sign-in failed' };
      }
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to sign in with Google' };
    }
  }

  async signInWithApple(): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();

      if (Platform.OS === 'web') {
        const redirectTo = `${getWebAuthOrigin()}/auth/callback`;
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: { 
            redirectTo,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
            scopes: 'name email'
          },
        });

        if (error) return { success: false, error: error.message, code: (error as any).code };
        if (data?.url) window.location.assign(data.url);
        return { success: true };
      }

      if (Platform.OS === 'ios') {
        try {
          const credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
          });

          if (credential.identityToken) {
            const { data, error } = await supabase.auth.signInWithIdToken({
              provider: 'apple',
              token: credential.identityToken,
            });

            if (error) return { success: false, error: error.message, code: (error as any).code };

            // If we got a user, and we also have name information from Apple (only on first login),
            // we might want to ensure it's saved.
            if (data.user && credential.fullName) {
               const givenName = credential.fullName.givenName;
               const familyName = credential.fullName.familyName;
               const displayName = [givenName, familyName].filter(Boolean).join(' ');
               
               if (displayName) {
                 // Attempt to update profile immediately if possible, or at least return it in user object
                 // Ideally we call updateProfile, but we can't await it inside this flow easily without side effects?
                 // Actually we can.
                 await this.updateProfile(data.user.id, { full_name: displayName });
               }
            }

            return { success: true, user: data.user ? toAuthUser(data.user) : null };
          } else {
             return { success: false, error: 'No identity token provided' };
          }
        } catch (e: any) {
          if (e.code === 'ERR_REQUEST_CANCELED') {
             return { success: false, error: 'Sign in cancelled' };
          }
          throw e;
        }
      }

      // For Android (or other native platforms), use standard OAuth flow
      return await this.signInWithNativeOAuth('apple');
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to sign in with Apple' };
    }
  }

  async signUp(email: string, password: string, displayName?: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const emailRedirectTo =
        Platform.OS === 'web'
          ? `${getWebAuthOrigin()}/auth/verified`
          : Linking.createURL('auth/verified');

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
          ...(displayName ? { data: { displayName } } : {}),
        },
      });

      if (error) return { success: false, error: error.message, code: (error as any).code };
      return { success: true, user: data.user ? toAuthUser(data.user) : null };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to sign up' };
    }
  }

  private async getInvalidCredentialsError(email: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();

      if (error) {
        return { success: false, error: 'invalid_credentials', code: 'invalid_credentials' };
      }

      const code = data ? 'wrong_password' : 'wrong_email';
      return { success: false, error: code, code };
    } catch {
      return { success: false, error: 'invalid_credentials', code: 'invalid_credentials' };
    }
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const normalizedEmail = email.trim();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        const code = (error as any).code;
        if (code === 'invalid_credentials' || error.message === 'Invalid login credentials') {
          return await this.getInvalidCredentialsError(normalizedEmail);
        }

        return { success: false, error: error.message, code };
      }
      return { success: true, user: data.user ? toAuthUser(data.user) : null };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to sign in' };
    }
  }

  async signOut(): Promise<AuthResult> {
    try {
      clearPasswordResetHandoff();
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signOut();
      if (error) return { success: false, error: error.message, code: (error as any).code };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to sign out' };
    }
  }

  async resetPassword(email: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const emailRedirectTo =
        Platform.OS === 'web'
          ? `${getWebAuthOrigin()}/reset-password`
          : Linking.createURL('reset-password');

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo,
          shouldCreateUser: false,
        },
      });
      if (error) return { success: false, error: error.message, code: (error as any).code };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to reset password' };
    }
  }

  async verifyPasswordResetOtp(email: string, token: string): Promise<AuthResult> {
    try {
      passwordResetHandoffActive = true;
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: 'magiclink',
      });

      if (error) {
        clearPasswordResetHandoff();
        return { success: false, error: error.message, code: (error as any).code };
      }
      return { success: true, user: data.user ? toAuthUser(data.user) : null };
    } catch (e: any) {
      clearPasswordResetHandoff();
      return { success: false, error: e?.message || 'Failed to verify reset code' };
    }
  }

  async updatePassword(password: string): Promise<AuthResult> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.updateUser({ password });

      if (error) return { success: false, error: error.message, code: (error as any).code };
      return { success: true, user: data.user ? toAuthUser(data.user) : null };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to update password' };
    }
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getUser();

      if (error) {
        if (
          error.message?.includes('Refresh Token') ||
          error.message?.includes('Invalid Refresh Token')
        ) {
          await supabase.auth.signOut();
        }
        return null;
      }

      if (!data.user) return null;
      return toAuthUser(data.user);
    } catch {
      return null;
    }
  }

  // Faster method that uses local session without server verification
  async getSessionUser(): Promise<AuthUser | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        // If the session is invalid (e.g. refresh token missing/revoked), clear it
        if (
          error.message?.includes('Refresh Token') ||
          error.message?.includes('Invalid Refresh Token')
        ) {
          await supabase.auth.signOut();
        }
        return null;
      }

      if (!data.session?.user) return null;
      return toAuthUser(data.session.user);
    } catch {
      return null;
    }
  }

  async getCachedProfile(userId: string) {
    try {
      const json = await AsyncStorage.getItem(`profile_cache_${userId}`);
      return json ? JSON.parse(json) : null;
    } catch (e) {
      console.error('Error reading profile cache:', e);
      return null;
    }
  }

  async saveProfileToCache(userId: string, profile: any) {
    try {
      await AsyncStorage.setItem(`profile_cache_${userId}`, JSON.stringify(profile));
    } catch (e) {
      console.error('Error saving profile cache:', e);
    }
  }

  async getProfile(userId: string) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        return null;
      }
      
      // Update cache
      if (data) {
        this.saveProfileToCache(userId, data);
      }
      
      return data;
    } catch (e) {
      console.error('Error in getProfile:', e);
      return null;
    }
  }

  async ensureProfile(user: AuthUser) {
    try {
      const supabase = getSupabaseClient();

      const { data: existing, error: existingError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!existingError && existing) {
        await this.saveProfileToCache(user.id, existing);
        return { success: true, profile: existing };
      }

      const fullName =
        user.displayName ?? (user.email ? user.email.split('@')[0] : null);

      const profile = {
        id: user.id,
        full_name: fullName,
        email: user.email,
        updated_at: new Date().toISOString(),
      };

      const { data: upserted, error: upsertError } = await supabase
        .from('profiles')
        .upsert(profile, { onConflict: 'id' })
        .select('*')
        .single();

      if (upsertError) {
        return { success: false, error: upsertError.message };
      }

      await this.saveProfileToCache(user.id, upserted);
      return { success: true, profile: upserted };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to ensure profile' };
    }
  }

  async updateProfile(userId: string, updates: any) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) {
        throw error;
      }
      
      // Update cache optimistically or re-fetch
      // For simplicity and correctness, let's patch the existing cache
      const cached = await this.getCachedProfile(userId);
      if (cached) {
        const newProfile = { ...cached, ...updates };
        await this.saveProfileToCache(userId, newProfile);
      } else {
        // If no cache, try to fetch fresh
        await this.getProfile(userId);
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to update profile' };
    }
  }

  async uploadAvatar(userId: string, file: { uri: string; type: string; name?: string } | string) {
    try {
      const supabase = getSupabaseClient();
      const filePath = `${userId}/${new Date().getTime()}.jpg`;

      // Handle base64 string (web or data uri)
      if (typeof file === 'string' && file.startsWith('data:')) {
        const base64Data = file.split(',')[1];
        const { error } = await supabase.storage
          .from('avatars')
          .upload(filePath, decode(base64Data), {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (error) throw error;
      } else if (typeof file === 'object' && 'uri' in file) {
         // React Native file upload
        const response = await fetch(file.uri);
        const arrayBuffer = await response.arrayBuffer();
        
        const { error } = await supabase.storage
          .from('avatars')
          .upload(filePath, arrayBuffer, {
            contentType: file.type || 'image/jpeg',
            upsert: true,
          });
          
        if (error) throw error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      return { success: true, publicUrl };
    } catch (e: any) {
      console.error('Upload avatar error:', e);
      return { success: false, error: e?.message || 'Failed to upload avatar' };
    }
  }
}

// Helper to decode base64 on native/web universally if needed
// For this simple case, relying on supabase-js handling or Buffer might be needed depending on environment
// But supabase-js upload accepts ArrayBuffer/Blob/File. 
// For Web: base64 -> Blob is easy.
// For Native: fetch(uri) -> blob() is standard in Expo.

// Minimal polyfill for decode if not present (mostly for web base64 handling if fetch doesn't work for data-uri)
function decode(base64: string) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}


export const authService = new AuthService();
