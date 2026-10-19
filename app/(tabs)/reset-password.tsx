import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';
  const { height: windowHeight } = useWindowDimensions();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const handleResetPassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Reset Password', 'Please enter and confirm your new password.');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Reset Password', 'Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Reset Password', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.updatePassword(newPassword);
      if (result.success) {
        setSuccessVisible(true);
        redirectTimerRef.current = setTimeout(() => {
          void authService.signOut().finally(() => {
            router.replace('/');
          });
        }, 5000);
      } else {
        Alert.alert('Error', result.error || 'Failed to update password');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  const renderPasswordInput = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    visible: boolean,
    onToggleVisible: () => void
  ) => (
    <View style={styles.inputGroup}>
      <View style={styles.floatingLabelWrapper}>
        <Text
          style={[
            styles.floatingLabel,
            {
              backgroundColor: isDark ? 'transparent' : '#FFF',
              color: isDark ? '#FFF' : '#000',
            },
          ]}
        >
          {label}
        </Text>
        <View
          style={[
            styles.passwordContainer,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)',
              borderColor: isDark ? '#2A2D50' : '#EFE8E8',
            },
          ]}
        >
          <TextInput
            style={[styles.passwordInput, { color: isDark ? '#FFF' : '#000' }]}
            placeholder="********"
            placeholderTextColor={isDark ? '#CCC' : '#555'}
            secureTextEntry={!visible}
            value={value}
            onChangeText={onChangeText}
            editable={!loading}
            returnKeyType="done"
            onSubmitEditing={handleResetPassword}
          />
          <TouchableOpacity onPress={onToggleVisible} style={styles.iconButton} disabled={loading}>
            <Ionicons
              name={visible ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={isDark ? '#CCC' : '#999'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <LinearGradient
      colors={isDark ? ['rgba(0, 0, 116, 1)', 'rgba(0, 0, 23, 1)'] : ['#FFFFFF', '#FFFFFF']}
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
            <View style={styles.content}>
              <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                Enter New Password
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
                Confirm your new password to continue
              </Text>

              {renderPasswordInput(
                'New Password',
                newPassword,
                setNewPassword,
                newPasswordVisible,
                () => setNewPasswordVisible((value) => !value)
              )}

              {renderPasswordInput(
                'Confirm Password',
                confirmPassword,
                setConfirmPassword,
                confirmPasswordVisible,
                () => setConfirmPasswordVisible((value) => !value)
              )}

              <TouchableOpacity
                style={[
                  styles.loginButton,
                  { backgroundColor: isDark ? '#375FFF' : '#007BFF' },
                  loading && { opacity: 0.7 },
                ]}
                onPress={handleResetPassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.loginButtonText}>Reset Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Modal animationType="fade" transparent visible={successVisible}>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.successCard,
              {
                backgroundColor: isDark ? '#101543' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255,255,255,0.18)' : '#E5E7EB',
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={42} color={isDark ? '#7EA2FF' : '#007BFF'} />
            <Text style={[styles.successTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              You have reset your password successfully
            </Text>
          </View>
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
  content: {
    flex: 1,
    justifyContent: 'center',
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
  loginButton: {
    borderRadius: 80,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  loginButtonText: {
    color: '#FFF',
    fontFamily: 'Geist-Bold',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  successCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 28,
    gap: 14,
  },
  successTitle: {
    fontFamily: 'Geist-Bold',
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
  },
});
