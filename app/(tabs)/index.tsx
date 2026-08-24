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
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    useWindowDimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFriendlyErrorMessage } from '../../utils/authErrors';

export default function LoginScreen() {
  const router = useRouter();
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';
  const { height: windowHeight } = useWindowDimensions();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetStep, setResetStep] = useState<'email' | 'otp'>('email');
  const [resetLoading, setResetLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.signIn(email, password);
      if (result.success) {
        router.replace('/main');
      } else {
        const message = result.error ? getFriendlyErrorMessage(result.error) : 'Login failed';
        Alert.alert('Login Failed', message);
      }
    } catch (error: any) {
      const message = getFriendlyErrorMessage(error.code || error.message);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const openForgotPassword = () => {
    setResetEmail(email);
    setResetOtp('');
    setResetStep('email');
    setForgotModalVisible(true);
  };

  const handleSendResetOtp = async () => {
    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail) {
      Alert.alert('Reset Password', 'Please enter your email address.');
      return;
    }

    setResetLoading(true);
    try {
      const result = await authService.resetPassword(trimmedEmail);
      if (result.success) {
        setResetEmail(trimmedEmail);
        setResetStep('otp');
        Alert.alert('Check your email', 'Enter the OTP from your recovery email.');
      } else {
        Alert.alert('Error', result.error || 'Failed to send reset code');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'An unexpected error occurred');
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyResetOtp = async () => {
    if (!resetOtp.trim()) {
      Alert.alert('Reset Password', 'Please enter the OTP from your email.');
      return;
    }

    setResetLoading(true);
    try {
      const result = await authService.verifyPasswordResetOtp(resetEmail, resetOtp);
      if (result.success) {
        setForgotModalVisible(false);
        router.replace('/reset-password');
      } else {
        Alert.alert('Error', result.error || 'Invalid or expired reset code');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to verify reset code');
    } finally {
      setResetLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const result = await authService.signInWithGoogle();
      if (result.success) {
        router.replace('/main');
      } else if (result.code === 'oauth_handoff') {
        return;
      } else {
        // `result.error` already carries the raw native detail when
        // EXPO_PUBLIC_AUTH_DEBUG=1; otherwise it stays user-friendly.
        Alert.alert('Login Failed', result.error || 'Google sign-in failed');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      const result = await authService.signInWithApple();
      if (result.success) {
        router.replace('/main');
      } else {
        Alert.alert('Login Failed', result.error || 'Apple sign-in failed');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Apple sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(0, 0, 116, 1)', 'rgba(0, 0, 23, 1)']
          : ['#FFFFFF', '#FFFFFF']
      }
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            style={[
              styles.container,
              {
                paddingTop: windowHeight < 700 ? 16 : 24,
                paddingBottom: windowHeight < 700 ? 16 : 24,
              },
            ]}
          >
            <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text
                  style={[
                    styles.title,
                    { color: isDark ? '#FFFFFF' : '#000000' },
                  ]}
                >
                  Login to your account
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    {
                      color: isDark ? '#DADADA' : '#49463F',
                      marginBottom: windowHeight < 700 ? 24 : 40,
                    },
                  ]}
                >
                  Continue Your Palindrome Journey
                </Text>

                <View style={styles.inputGroup}>
                  <View style={styles.floatingLabelWrapper}>
                    <Text
                      style={[
                        styles.floatingLabel,
                        {
                          backgroundColor: isDark ? 'rgba(0,0,23,1)' : '#FFF',
                          color: isDark ? '#FFF' : '#000',
                        },
                      ]}
                    >
                      Email address
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(255,255,255,0.6)',
                          color: isDark ? '#FFF' : '#000',
                          borderColor: isDark ? '#2A2D50' : '#EFE8E8',
                        },
                      ]}
                      placeholder="e.g. wilson09@gmail.com"
                      placeholderTextColor={isDark ? '#CCC' : '#555'}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      value={email}
                      onChangeText={setEmail}
                      editable={!loading}
                      returnKeyType="next"
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <View style={styles.floatingLabelWrapper}>
                    <Text
                      style={[
                        styles.floatingLabel,
                        {
                          backgroundColor: isDark ? 'rgba(0,0,23,1)' : '#FFF',
                          color: isDark ? '#FFF' : '#000',
                        },
                      ]}
                    >
                      Password
                    </Text>
                    <View
                      style={[
                        styles.passwordContainer,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(255,255,255,0.6)',
                          borderColor: isDark ? '#2A2D50' : '#EFE8E8',
                        },
                      ]}
                    >
                      <TextInput
                        style={[
                          styles.passwordInput,
                          { color: isDark ? '#FFF' : '#000' },
                        ]}
                        placeholder="********"
                        placeholderTextColor={isDark ? '#CCC' : '#555'}
                        secureTextEntry={!passwordVisible}
                        value={password}
                        onChangeText={setPassword}
                        editable={!loading}
                        returnKeyType="done"
                        onSubmitEditing={handleLogin}
                      />
                      <TouchableOpacity
                        onPress={() => setPasswordVisible(!passwordVisible)}
                        style={styles.iconButton}
                        disabled={loading}
                      >
                        <Ionicons
                          name={passwordVisible ? 'eye-outline' : 'eye-off-outline'}
                          size={20}
                          color={isDark ? '#CCC' : '#999'}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.forgotWrapper}
                  onPress={openForgotPassword}
                  disabled={loading}
                >
                  <Text
                    style={[
                      styles.forgotPassword,
                      { color: isDark ? '#FF6B81' : '#FF002B' },
                    ]}
                  >
                    Forgot password?
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.loginButton,
                    { backgroundColor: isDark ? '#375FFF' : '#007BFF' },
                    loading && { opacity: 0.7 },
                  ]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.loginButtonText}>Log In</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.dividerRow}>
                  <View
                    style={[
                      styles.dividerLine,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB' },
                    ]}
                  />
                  <Text style={[styles.dividerText, { color: isDark ? '#AAB3FF' : '#007BFF' }]}>
                    or
                  </Text>
                  <View
                    style={[
                      styles.dividerLine,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB' },
                    ]}
                  />
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

                <TouchableOpacity
                  style={[
                    styles.googleButton,
                    {
                      borderColor: isDark ? 'rgba(255,255,255,0.25)' : '#E5E7EB',
                      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                      marginTop: 12,
                    },
                    loading && { opacity: 0.7 },
                  ]}
                  onPress={handleAppleSignIn}
                  disabled={loading}
                >
                  <Ionicons
                    name="logo-apple"
                    size={24}
                    color={isDark ? '#FFFFFF' : '#000000'}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={[styles.googleText, { color: isDark ? '#FFFFFF' : '#111111' }]}>
                    Continue with Apple
                  </Text>
                </TouchableOpacity>
              </View>

            <View style={styles.footer}>
              <Text
                style={[
                  styles.footerText,
                  { color: isDark ? '#DDD' : '#2A2A2A' },
                ]}
              >
                New on Palindrome?{' '}
                <Text
                  style={[
                    styles.footerBold,
                    { color: isDark ? '#6C8CFF' : '#007BFF' },
                  ]}
                  onPress={() => router.push('/signup')}
                >
                  Create an account.
                </Text>
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Modal
        animationType="fade"
        transparent
        visible={forgotModalVisible}
        onRequestClose={() => !resetLoading && setForgotModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalKeyboard}
          >
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: isDark ? '#101543' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255,255,255,0.18)' : '#E5E7EB',
                },
              ]}
            >
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                  Reset password
                </Text>
                <TouchableOpacity
                  onPress={() => setForgotModalVisible(false)}
                  disabled={resetLoading}
                  style={styles.modalCloseButton}
                >
                  <Ionicons name="close" size={22} color={isDark ? '#FFFFFF' : '#111111'} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.modalCopy, { color: isDark ? '#DADADA' : '#49463F' }]}>
                {resetStep === 'email'
                  ? 'Enter the email linked to your account.'
                  : 'Enter the OTP sent to your email.'}
              </Text>

              <View style={styles.inputGroup}>
                <View style={styles.floatingLabelWrapper}>
                  <Text
                    style={[
                      styles.floatingLabel,
                      {
                        backgroundColor: isDark ? '#101543' : '#FFFFFF',
                        color: isDark ? '#FFFFFF' : '#000000',
                      },
                    ]}
                  >
                    {resetStep === 'email' ? 'Email address' : 'OTP'}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                        color: isDark ? '#FFFFFF' : '#000000',
                        borderColor: isDark ? '#2A2D50' : '#EFE8E8',
                      },
                    ]}
                    placeholder={resetStep === 'email' ? 'e.g. wilson09@gmail.com' : 'Enter OTP'}
                    placeholderTextColor={isDark ? '#CCC' : '#555'}
                    keyboardType={resetStep === 'email' ? 'email-address' : 'number-pad'}
                    autoCapitalize="none"
                    value={resetStep === 'email' ? resetEmail : resetOtp}
                    onChangeText={resetStep === 'email' ? setResetEmail : setResetOtp}
                    editable={!resetLoading}
                    returnKeyType="done"
                    onSubmitEditing={resetStep === 'email' ? handleSendResetOtp : handleVerifyResetOtp}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.loginButton,
                  styles.modalPrimaryButton,
                  { backgroundColor: isDark ? '#375FFF' : '#007BFF' },
                  resetLoading && { opacity: 0.7 },
                ]}
                onPress={resetStep === 'email' ? handleSendResetOtp : handleVerifyResetOtp}
                disabled={resetLoading}
              >
                {resetLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.loginButtonText}>
                    {resetStep === 'email' ? 'Send OTP' : 'Verify OTP'}
                  </Text>
                )}
              </TouchableOpacity>

              {resetStep === 'otp' ? (
                <TouchableOpacity
                  onPress={handleSendResetOtp}
                  disabled={resetLoading}
                  style={styles.resendButton}
                >
                  <Text style={[styles.forgotPassword, { color: isDark ? '#AAB3FF' : '#007BFF' }]}>
                    Resend OTP
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
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
  forgotWrapper: {
    alignSelf: 'flex-end',
    marginBottom: 28,
  },
  forgotPassword: {
    fontFamily: 'Geist-Bold',
    fontSize: 14,
  },
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
  footer: {
    alignItems: 'center',
  },
  footerText: {
    fontFamily: 'Geist-Regular',
    fontSize: 14,
  },
  footerBold: {
    fontFamily: 'Geist-Bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalKeyboard: {
    width: '100%',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontFamily: 'Geist-Bold',
    fontSize: 22,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalCopy: {
    fontFamily: 'Geist-Regular',
    fontSize: 14,
    marginBottom: 24,
  },
  modalPrimaryButton: {
    marginBottom: 0,
  },
  resendButton: {
    alignItems: 'center',
    paddingTop: 16,
  },
});
