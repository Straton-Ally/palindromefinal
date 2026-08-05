import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { getFriendlyErrorMessage } from '../../utils/authErrors';

export default function SignupScreen() {
  const router = useRouter();
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!fullName || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!agree) {
      Alert.alert('Error', 'Please agree to the terms and conditions');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.signUp(email, password, fullName);
      if (result.success) {
        Alert.alert(
          'Account Created',
          'Your account has been created successfully. Please verify your email.',
          [{ text: 'OK', onPress: () => router.replace('/') }]
        );
      } else {
        const message = result.error ? getFriendlyErrorMessage(result.error) : 'Signup failed';
        Alert.alert('Signup Failed', message);
      }
    } catch (error: any) {
      const message = getFriendlyErrorMessage(error.code || error.message);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const result = await authService.signInWithGoogle();
      if (result.success) {
        router.replace('/main');
      } else {
        Alert.alert('Signup Failed', result.error || 'Google sign-in failed');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={
        isDark
          ? ['#000017', '#000074'] // 🌙 Dark theme gradient
          : ['#FFFFFF', '#FFFFFF'] // ☀️ Light theme gradient
      }
      style={{ flex: 1 }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
      >
        <View style={styles.container}>
          {/* Header */}
          <Text
            style={[
              styles.title,
              { color: isDark ? '#FFF' : '#000' },
            ]}
          >
            Create your account
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: isDark ? '#CCC' : '#49463F' },
            ]}
          >
            Enter the Palindrome Realm
          </Text>

          {/* Full Name Input */}
          <View style={styles.inputGroup}>
            <View style={styles.floatingLabelWrapper}>
              <Text
                style={[
                  styles.floatingLabel,
                  {
                    color: isDark ? '#FFF' : '#000',
                    backgroundColor: isDark ? '#00001D' : '#FFF',
                  },
                ]}
              >
                Full Name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor:
                      isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(255,255,255,0.6)',
                    borderColor:
                      isDark
                        ? 'rgba(255,255,255,0.2)'
                        : 'rgba(0,0,0,0.1)',
                    color: isDark ? '#FFF' : '#000',
                  },
                ]}
                placeholder="e.g. Jenny Wilson"
                placeholderTextColor={isDark ? '#AAA' : '#B0B0B0'}
                keyboardType="default"
                value={fullName}
                onChangeText={setFullName}
                editable={!loading}
              />
            </View>
          </View>

          {/* Email Input */}
          <View style={styles.inputGroup}>
            <View style={styles.floatingLabelWrapper}>
              <Text
                style={[
                  styles.floatingLabel,
                  {
                    color: isDark ? '#FFF' : '#000',
                    backgroundColor: isDark ? '#00001D' : '#FFF',
                  },
                ]}
              >
                Email address
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor:
                      isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(255,255,255,0.6)',
                    borderColor:
                      isDark
                        ? 'rgba(255,255,255,0.2)'
                        : 'rgba(0,0,0,0.1)',
                    color: isDark ? '#FFF' : '#000',
                  },
                ]}
                placeholder="e.g. wilson09@gmail.com"
                placeholderTextColor={isDark ? '#AAA' : '#B0B0B0'}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                editable={!loading}
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <View style={styles.floatingLabelWrapper}>
              <Text
                style={[
                  styles.floatingLabel,
                  {
                    color: isDark ? '#FFF' : '#000',
                    backgroundColor: isDark ? '#00001D' : '#FFF',
                  },
                ]}
              >
                Password
              </Text>
              <View
                style={[
                  styles.passwordContainer,
                  {
                    backgroundColor:
                      isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(255,255,255,0.6)',
                    borderColor:
                      isDark
                        ? 'rgba(255,255,255,0.2)'
                        : 'rgba(0,0,0,0.1)',
                  },
                ]}
              >
                <TextInput
                  style={[
                    styles.passwordInput,
                    { color: isDark ? '#FFF' : '#000' },
                  ]}
                  placeholder="********"
                  placeholderTextColor={isDark ? '#AAA' : '#B0B0B0'}
                  secureTextEntry={!passwordVisible}
                  value={password}
                  onChangeText={setPassword}
                  editable={!loading}
                />
                <TouchableOpacity
                  onPress={() => setPasswordVisible(!passwordVisible)}
                  style={styles.iconButton}
                  disabled={loading}
                >
                  <Ionicons
                    name={passwordVisible ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color={isDark ? '#DDD' : '#999'}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* ✅ Terms & Conditions Checkbox */}
          <TouchableOpacity
            onPress={() => setAgree(!agree)}
            activeOpacity={0.8}
            style={styles.checkboxRow}
            disabled={loading}
          >
            <View
              style={[
                styles.checkboxBox,
                {
                  backgroundColor:
                    isDark ? '#00001D' : '#FFF',
                  borderColor:
                    isDark ? '#999' : '#B0B0B0',
                },
                agree && {
                  backgroundColor: '#007BFF',
                  borderColor: '#007BFF',
                },
              ]}
            >
              {agree && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>

            <Text
              style={[
                styles.checkboxText,
                { color: isDark ? '#DDD' : '#333' },
              ]}
            >
              {"I've read and agree to the "}
              <Text
                style={[styles.linkText, { textDecorationLine: 'underline' }]}
                onPress={() => router.push('/terms-and-conditions' as any)}
              >
                terms{' '}
              </Text>
              or{' '}
              <Text
                style={[styles.linkText, { textDecorationLine: 'underline' }]}
                onPress={() => router.push('/privacy-policy' as any)}
              >
                privacy policy
              </Text>
            </Text>
          </TouchableOpacity>

          {/* Sign Up Button */}
          <TouchableOpacity
            style={[
              styles.loginButton,
              { backgroundColor: (agree && !loading) ? '#007BFF' : '#A0C8FF' },
              loading && { opacity: 0.7 }
            ]}
            onPress={handleSignup}
            disabled={!agree || loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.loginButtonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB' }]} />
              <Text style={[styles.dividerText, { color: isDark ? '#AAB3FF' : '#007BFF' }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB' }]} />
            </View>

            <TouchableOpacity
              style={[
                styles.googleButton,
                {
                  borderColor: isDark ? 'rgba(255,255,255,0.25)' : '#E5E7EB',
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                },
                loading && { opacity: 0.7 },
              ]}
              onPress={handleGoogleSignIn}
              disabled={loading}
            >
              <Image source={require('../../assets/images/google.png')} style={styles.googleIcon} />
              <Text style={[styles.googleText, { color: isDark ? '#FFFFFF' : '#111111' }]}>
                Continue with Google
              </Text>
            </TouchableOpacity>

          {/* Footer */}
          <View style={styles.footer}>
            <Text
              style={[
                styles.footerText,
                { color: isDark ? '#CCC' : '#2A2A2A' },
              ]}
            >
              Already have an account?{' '}
              <Text
                style={[
                  styles.footerBold,
                  { color: isDark ? '#66A3FF' : '#007BFF' },
                ]}
                onPress={() => router.replace('/')}
              >
                Log In
              </Text>
            </Text>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 60,
  },

  // --- Header ---
  title: {
    fontFamily: 'Geist-Bold',
    fontSize: 26,
    marginBottom: 6,
    textAlign: 'left',
  },
  subtitle: {
    fontFamily: 'Geist-Regular',
    fontSize: 14,
    marginBottom: 40,
    textAlign: 'left',
  },

  // --- Input Section ---
  inputGroup: {
    marginBottom: 18,
  },
  floatingLabelWrapper: {
    position: 'relative',
  },
  floatingLabel: {
    position: 'absolute',
    top: -7,
    left: 16,
    paddingHorizontal: 6,
    fontSize: 13,
    fontFamily: 'Geist-Bold',
    zIndex: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Geist-Regular',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    fontFamily: 'Geist-Regular',
    fontSize: 16,
    paddingVertical: 14,
  },
  iconButton: {
    paddingLeft: 6,
  },

  // ✅ Checkbox Styles
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxText: {
    fontSize: 14,
    flex: 1,
    fontFamily: 'Geist-Regular',
  },
  linkText: {
    color: '#007BFF',
    fontWeight: '500',
  },

  // --- Buttons ---
  loginButton: {
    borderRadius: 80,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 28,
  },
  loginButtonText: {
    color: '#FFF',
    fontFamily: 'Geist-Bold',
    fontSize: 16,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 18,
  },
  dividerLine: {
    height: 1,
    width: 70,
  },
  dividerText: {
    fontFamily: 'Geist-Bold',
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 80,
    paddingVertical: 12,
    marginBottom: 18,
  },
  googleIcon: {
    width: 18,
    height: 18,
  },
  googleText: {
    fontFamily: 'Geist-Bold',
    fontSize: 15,
  },

  // --- Footer ---
  footer: {
    marginTop: 200,
    alignItems: 'center',
  },
  footerText: {
    fontFamily: 'Geist-Regular',
    fontSize: 14,
  },
  footerBold: {
    fontFamily: 'Geist-Bold',
  },
});
