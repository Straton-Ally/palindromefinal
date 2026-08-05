import { authService } from '@/authService'; // Adjust path as needed
import { useTheme } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router'; // Added for navigation
import React, { useEffect, useState } from 'react';

export default function SignUpWeb() {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [agree, setAgree] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { colors, theme } = useTheme();

  // Track screen width for responsive scroll
  useEffect(() => {
    function handleResize() {
      setWindowWidth(window.innerWidth);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle signup with Firebase
const handleSignUp = async () => {
  // Reset error
  setError('');
  console.log('🔧 handleSignUp called');
  
  // Validate inputs
  if (!name || !email || !password) {
    setError('Please fill in all fields');
    return;
  }

  if (!agree) {
    setError('You must agree to the terms and privacy policy');
    return;
  }

  if (password.length < 6) {
    setError('Password must be at least 6 characters');
    return;
  }

  console.log('✅ Validation passed. Starting signup...');
  setLoading(true);

  // Add timeout to prevent hanging
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Signup timeout after 10 seconds')), 20000);
  });

  try {
    // Race between signup and timeout
    const result = await Promise.race([
      authService.signUp(email, password, name),
      timeoutPromise
    ]) as any; // Type assertion since we know it's AuthResult

    console.log('📦 signUp result:', result);
    
    if (result.success) {
      console.log('✅ Supabase signup successful!');
      
      // Show success and navigate
      alert('Account created successfully! Please check your email for verification.');
      
      // Clear form
      setName('');
      setEmail('');
      setPassword('');
      setAgree(false);
      
      // Short delay then navigate
      setTimeout(() => {
        console.log('Navigating to home...');
        router.push('/');
      }, 1000);
      
    } else {
      console.log('❌ Firebase signup failed:', result.error);
      setError(result.error || 'Signup failed. Please try again.');
    }
  } catch (err: any) {
    console.error('💥 Error in handleSignUp:', err);
    setError(err.message || 'An unexpected error occurred');
  } finally {
    console.log('🏁 Setting loading to false');
    setLoading(false);
  }
};

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await authService.signInWithGoogle();
      if (!result.success) {
        setError(result.error || 'Google sign-in failed');
        setLoading(false);
      }
      // On web, if successful, the page will redirect automatically
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed');
      setLoading(false);
    }
  };

  const placeholderStyles = `
    input::placeholder {
      color: ${colors.secondaryText} !important;
      opacity: 0.7;
    }
  `;

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        overflowY: 'auto',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        background:
          theme === 'dark'
            ? 'linear-gradient(to right, #000017, #000074)'
            : '#FFFFFF',
        fontFamily: 'Geist, sans-serif',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <style>{placeholderStyles}</style>

      {/* Error Message Display */}
      {error && (
        <div
          style={{
            position: 'fixed',
            top: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            backgroundColor: colors.error + '20',
            border: `1px solid ${colors.error}`,
            borderRadius: '8px',
            color: colors.error,
            fontSize: '14px',
            maxWidth: '400px',
            textAlign: 'center',
            zIndex: 1000,
          }}
        >
          {error}
        </div>
      )}

      {/* ✅ Top Bar */}
      <div
        style={{
          width: '100%',
          borderBottom: `1px solid ${colors.border}`,
          padding: '20px 0',
          textAlign: 'center',
          fontWeight: 700,
          color: colors.primary,
          fontSize: '22px',
          letterSpacing: '0.5px',
          background: theme === 'dark' ? 'linear-gradient(to right, #000017, #000074)' : '#FFFFFF',
          backdropFilter: 'blur(10px)',
        }}
      >
        PALINDROME®
      </div>

      {/* ✅ Main Section */}
      <div
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '1100px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: windowWidth < 900 ? 'center' : 'flex-start',
          padding: windowWidth < 900 ? '28px 20px 40px' : 'clamp(32px, 6vh, 60px) 40px',
          gap: windowWidth < 900 ? '24px' : '60px',
          flexWrap: 'wrap',
          boxSizing: 'border-box',
        }}
      >
        {/* Left Text */}
        <div
          style={{
            flex: 1,
            minWidth: windowWidth < 900 ? '0' : '360px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: windowWidth < 900 ? 'center' : 'flex-start',
            marginTop: windowWidth < 900 ? '0' : 'clamp(16px, 6vh, 60px)'
          }}
        >
          <div
            style={{
              width: 'min(400px, 100%)',
              textAlign: windowWidth < 900 ? 'center' : 'right',
            }}
          >
            <h1
              style={{
                fontSize: windowWidth < 520 ? '28px' : '36px',
                fontWeight: 700,
                marginBottom: '10px',
                color: colors.text,
              }}
            >
              Create your account
            </h1>
            <p
              style={{
                fontSize: '18px',
                color: colors.secondaryText,
              }}
            >
              Enter the Palindrome Realm
            </p>
          </div>
        </div>

        {/* Right Form */}
        <div
          style={{
            flex: 1,
            minWidth: '0',
            maxWidth: '400px',
            width: '100%',
            marginTop: windowWidth < 900 ? '0' : 'clamp(24px, 8vh, 80px)'
          }}
        >
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: '16px',
              padding: '32px',
              boxShadow:
                theme === 'dark'
                  ? '0 4px 20px rgba(0, 96, 255, 0.1)'
                  : '0 2px 10px rgba(0,0,0,0.04)',
              marginBottom: '20px',
              background:
                theme === 'dark'
                  ? 'rgba(25, 25, 91, 0.7)'
                  : '#FFFFFF',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '400px',
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
              }}
            >
              {/* Name */}
              <div style={{ position: 'relative', width: '100%' }}>
                <label
                  style={{
                    position: 'absolute',
                    top: '0',
                    left: '16px',
                    backgroundColor:
                      theme === 'dark'
                        ? 'rgba(25, 25, 91, 0.7)'
                        : '#F9FAFB',
                    padding: '0 6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: colors.text,
                    transform: 'translateY(-50%)',
                    lineHeight: '1',
                  }}
                >
                  Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '16px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    outline: 'none',
                    backgroundColor:
                      theme === 'dark'
                        ? 'rgba(25, 25, 91, 0.7)'
                        : '#F9FAFB',
                    color: colors.text,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Email */}
              <div style={{ position: 'relative', width: '100%' }}>
                <label
                  style={{
                    position: 'absolute',
                    top: '0',
                    left: '16px',
                    backgroundColor:
                      theme === 'dark'
                        ? 'rgba(25, 25, 91, 0.7)'
                        : '#F9FAFB',
                    padding: '0 6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: colors.text,
                    transform: 'translateY(-50%)',
                  }}
                >
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="e.g. wilson09@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '16px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    outline: 'none',
                    backgroundColor:
                      theme === 'dark'
                        ? 'rgba(25, 25, 91, 0.7)'
                        : '#F9FAFB',
                    color: colors.text,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Password */}
              <div style={{ position: 'relative', width: '100%' }}>
                <label
                  style={{
                    position: 'absolute',
                    top: '0',
                    left: '16px',
                    backgroundColor:
                      theme === 'dark'
                        ? 'rgba(25, 25, 91, 0.7)'
                        : '#F9FAFB',
                    padding: '0 6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: colors.text,
                    transform: 'translateY(-50%)',
                    lineHeight: '1',
                  }}
                >
                  Password
                </label>
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '16px 42px 16px 16px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    outline: 'none',
                    backgroundColor:
                      theme === 'dark'
                        ? 'rgba(25, 25, 91, 0.7)'
                        : '#F9FAFB',
                    color: colors.text,
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible(!passwordVisible)}
                  disabled={loading}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    right: '12px',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    color: colors.secondaryText,
                  }}
                >
                  <Ionicons
                    name={passwordVisible ? 'eye' : 'eye-off'}
                    size={20}
                    color={colors.secondaryText}
                  />
                </button>
              </div>

              {/* Checkbox */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '14px',
                  color: colors.text,
                }}
              >
                <input
                  type="checkbox"
                  id="agree"
                  checked={agree}
                  onChange={() => !loading && setAgree(!agree)}
                  disabled={loading}
                  style={{
                    marginRight: '8px',
                    width: '16px',
                    height: '16px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                />
                <label htmlFor="agree">
                  I agree to the{' '}
                  <span
                    onClick={(e) => {
                      e.preventDefault();
                      router.push('/terms-and-conditions');
                    }}
                    style={{
                      color: '#FF0000',
                      fontWeight: 600,
                      textDecoration: 'underline',
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    terms
                  </span>{' '}
                  and{' '}
                  <span
                    onClick={(e) => {
                      e.preventDefault();
                      router.push('/privacy-policy');
                    }}
                    style={{
                      color: '#FF0000',
                      fontWeight: 600,
                      textDecoration: 'underline',
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    privacy policy
                  </span>
                </label>
              </div>

              {/* Signup Button */}
              <button
                onClick={handleSignUp}
                disabled={loading || !agree}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: '50px',
                  backgroundColor: (loading || !agree) ? colors.secondaryText : colors.buttonPrimary,
                  color: colors.buttonText,
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '16px',
                  cursor: (loading || !agree) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !agree) ? 0.7 : 1,
                }}
              >
                {loading ? 'Creating Account...' : 'Sign Up'}
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '18px 0',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ width: '70px', height: '1px', background: colors.border }} />
                <span style={{ color: colors.primary, fontWeight: 600, fontSize: '14px' }}>or</span>
                <div style={{ width: '70px', height: '1px', background: colors.border }} />
              </div>

              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '50px',
                  backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  fontWeight: 600,
                  fontSize: '15px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  marginBottom: '20px',
                }}
              >
                <img src="/images/google.png" alt="Google" style={{ width: 18, height: 18 }} />
                Continue with Google
              </button>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              textAlign: 'center',
              fontSize: '14px',
              color: colors.text,
            }}
          >
            Already have an account?{' '}
            <span
              onClick={() => !loading && router.push('/')}
              style={{
                color: colors.primary,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              Log In
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
