import { authService } from '@/authService';
import { ColorBlindMode, useSettings } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';
import { DEFAULT_GAME_GRADIENTS, gradientFromHex, type GameColorGradient } from '@/lib/gameColors';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Switch } from 'react-native-switch';

const { height: screenHeight } = Dimensions.get('window');
const MAX_CONTENT_WIDTH = 800;

const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ['●', '▲', '■', '◆', '★'],
  emojis: ['🍓', '🥑', '🫐', '🖤', '🍋'],
  cards: ['♥', '♣', '♦', '♠', '★'],
  letters: ['A', 'B', 'C', 'D', 'E'],
} as const;

function getColorBlindToken(mode: ColorBlindMode, index: number) {
  return COLOR_BLIND_TOKENS[mode][index] ?? '?';
}

export default function ProfileScreenWeb() {
  const { colors, theme } = useTheme();
  const { colorBlindEnabled, colorBlindMode, setColorBlindEnabled, setColorBlindMode, customGameColors, setCustomGameColors } = useSettings();
  const displayGradients = customGameColors ?? [...DEFAULT_GAME_GRADIENTS];
  const [editingColors, setEditingColors] = useState<GameColorGradient[]>(() => customGameColors ?? [...DEFAULT_GAME_GRADIENTS]);
  const [colorsSaved, setColorsSaved] = useState(false);
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(null);
  const [pickerHex, setPickerHex] = useState('');
  const throttleRef = useRef<{ raf: number | null; pending: string | null }>({ raf: null, pending: null });
  const selectedIndexRef = useRef(selectedColorIndex);
  selectedIndexRef.current = selectedColorIndex;

  useEffect(() => {
    setEditingColors(customGameColors ?? [...DEFAULT_GAME_GRADIENTS]);
  }, [customGameColors]);

  useEffect(() => {
    if (selectedColorIndex !== null) setPickerHex(editingColors[selectedColorIndex][0]);
  }, [editingColors, selectedColorIndex]);

  const commitPickerColor = useCallback((hex: string) => {
    const idx = selectedIndexRef.current;
    if (idx === null) return;
    setEditingColors((prev) => {
      const next = [...prev];
      next[idx] = gradientFromHex(hex);
      return next;
    });
    setColorsSaved(false);
  }, []);

  const handlePickerChange = useCallback((hex: string) => {
    setPickerHex(hex);
    const ref = throttleRef.current;
    ref.pending = hex;
    if (ref.raf !== null) return;
    ref.raf = requestAnimationFrame(() => {
      if (ref.pending !== null) {
        commitPickerColor(ref.pending);
        ref.pending = null;
      }
      ref.raf = null;
    });
  }, [commitPickerColor]);

  const isDark = theme === 'dark';
  const gradientColors = isDark
    ? (['#000017', '#000074'] as const)
    : (['#FFFFFF', '#E9EFFF'] as const);

  const [avatar, setAvatar] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');

  React.useEffect(() => {
    const loadProfile = async () => {
      const user = await authService.getSessionUser();
      if (user) {
        setEmail(user.email || '');
        
        const cached = await authService.getCachedProfile(user.id);
        if (cached) {
          setFullName(cached.full_name || '');
          setPhone(cached.phone || '');
          if (cached.email) setEmail(cached.email);
          setAvatar(cached.avatar_url);
        }

        const profile = await authService.getProfile(user.id);
        if (profile) {
          setFullName(profile.full_name || '');
          setPhone(profile.phone || '');
          if (profile.email) setEmail(profile.email);
          setAvatar(profile.avatar_url);
        }
      }
    };
    loadProfile();
  }, []);

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0].uri) {
        let uriToUpload = result.assets[0].uri;
        if (result.assets[0].base64) {
           uriToUpload = `data:image/jpeg;base64,${result.assets[0].base64}`;
        }
        await uploadAvatar(uriToUpload);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      alert('Failed to pick image');
    }
  };

  const uploadAvatar = async (uri: string) => {
    const user = await authService.getSessionUser();
    if (!user) return;

    setUploading(true);
    try {
      const result = await authService.uploadAvatar(user.id, uri);
      if (result.success && result.publicUrl) {
        setAvatar(result.publicUrl);
        await authService.updateProfile(user.id, { avatar_url: result.publicUrl });
      } else {
        alert(result.error || 'Failed to upload image');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const user = await authService.getSessionUser();
    if (!user) return;

    setLoading(true);
    try {
      const updates = {
        full_name: fullName,
        email: email,
        phone: phone,
        updated_at: new Date(),
      };

      const result = await authService.updateProfile(user.id, updates);
      if (result.success) {
        alert('Profile updated successfully!');
      } else {
        alert(result.error || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContainer}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        {/* Header Section */}
        <View style={styles.headerSection}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/main');
              }
            }}
          >
            <Ionicons name="arrow-back" size={22} color={isDark ? '#FFF' : colors.primary} />
            <Text style={[styles.backButtonText, { color: isDark ? '#FFF' : colors.primary }]}>
              Back
            </Text>
          </TouchableOpacity>

          <View style={styles.headerContent}>
            <Text style={[styles.gameTitle, { color: isDark ? '#FFF' : colors.primary }]}>
              PALINDROME
            </Text>
            <Text style={[styles.pageTitle, { color: colors.secondaryText }]}>
              Player Profile
            </Text>
          </View>
        </View>

        {/* Main Content */}
        <View style={styles.contentWrapper}>
          {/* Profile Card */}
          <View
            style={[
              styles.profileCard,
              {
                backgroundColor: isDark ? 'rgba(26, 31, 60, 0.9)' : 'rgba(255, 255, 255, 0.95)',
                borderColor: colors.border,
                shadowColor: isDark ? '#000' : 'rgba(0, 0, 0, 0.08)',
              },
            ]}
          >
            {/* Avatar Section */}
            <View style={styles.avatarSection}>
              <TouchableOpacity onPress={pickImage} disabled={uploading} style={styles.avatarContainer}>
                <Image
                  source={avatar ? { uri: avatar } : require('../../assets/images/profile_ph.png')}
                  style={styles.avatar}
                />
                {uploading && (
                  <View style={styles.uploadingOverlay}>
                    <Text style={styles.uploadingText}>...</Text>
                  </View>
                )}
                <View style={[styles.editAvatarBadge, { backgroundColor: colors.primary }]}>
                  <Ionicons name="camera" size={14} color="#FFF" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Form Fields */}
            <View style={styles.formSection}>
              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, styles.inputGroupHalf]}>
                  <Text style={[styles.inputLabel, { color: colors.secondaryText }]}>Full Name</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: colors.border,
                        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F9FA',
                        color: colors.text,
                      },
                    ]}
                    placeholder="Your name"
                    placeholderTextColor={colors.secondaryText}
                    value={fullName}
                    onChangeText={setFullName}
                  />
                </View>

                <View style={[styles.inputGroup, styles.inputGroupHalf]}>
                  <Text style={[styles.inputLabel, { color: colors.secondaryText }]}>Phone Number</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: colors.border,
                        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F9FA',
                        color: colors.text,
                      },
                    ]}
                    placeholder="0 123 456 7890"
                    placeholderTextColor={colors.secondaryText}
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.secondaryText }]}>Email Address</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      borderColor: colors.border,
                      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F9FA',
                      color: colors.text,
                    },
                  ]}
                  placeholder="your@email.com"
                  placeholderTextColor={colors.secondaryText}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              {/* Action Buttons */}
              <View style={styles.formActions}>
                <TouchableOpacity style={styles.changePasswordLink}>
                  <Text style={[styles.changePasswordText, { color: colors.primary }]}>
                    Change Password
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: colors.primary }]}
                  onPress={handleSave}
                  disabled={loading}
                >
                  <Text style={styles.saveButtonText}>
                    {loading ? 'Saving...' : 'Save Changes'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Settings Grid */}
          <View style={styles.settingsGrid}>
            {/* Accessibility Card */}
            <View
              style={[
                styles.settingsCard,
                {
                  backgroundColor: isDark ? 'rgba(26, 31, 60, 0.9)' : 'rgba(255, 255, 255, 0.95)',
                  borderColor: colors.border,
                  shadowColor: isDark ? '#000' : 'rgba(0, 0, 0, 0.08)',
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <Ionicons name="eye-outline" size={22} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>Accessibility</Text>
              </View>

              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Color Blind Mode</Text>
                <Switch
                  value={colorBlindEnabled}
                  onValueChange={setColorBlindEnabled}
                  circleSize={18}
                  barHeight={22}
                  backgroundActive={colors.primary}
                  backgroundInactive="#ccc"
                  circleActiveColor="#fff"
                  circleInActiveColor="#fff"
                  switchWidthMultiplier={2.5}
                  renderActiveText={false}
                  renderInActiveText={false}
                />
              </View>

              <Text style={[styles.settingDescription, { color: colors.secondaryText }]}>
                Choose how colors are represented in the game
              </Text>

              <View style={styles.modeGrid}>
                {(['symbols', 'emojis', 'cards', 'letters'] as const).map((mode) => {
                  const selected = colorBlindMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      onPress={() => setColorBlindMode(mode)}
                      style={[
                        styles.modeTile,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected
                            ? isDark
                              ? 'rgba(0,96,255,0.20)'
                              : 'rgba(0,96,255,0.08)'
                            : isDark
                              ? 'rgba(255,255,255,0.03)'
                              : 'rgba(0,0,0,0.02)',
                        },
                      ]}
                      activeOpacity={0.9}
                    >
                      <Text style={[styles.modeTitle, { color: colors.text }]}>
                        {mode === 'symbols'
                          ? 'Symbols'
                          : mode === 'emojis'
                            ? 'Emojis'
                            : mode === 'cards'
                              ? 'Cards'
                              : 'Letters'}
                      </Text>
                      <View style={styles.modePreviewRow}>
                        {displayGradients.map((g, i) => (
                          <LinearGradient
                            key={i}
                            colors={g}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.modePreviewSwatch}
                          >
                            <Text style={styles.modePreviewToken}>{getColorBlindToken(mode, i)}</Text>
                          </LinearGradient>
                        ))}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Custom Colors Card */}
            <View
              style={[
                styles.settingsCard,
                {
                  backgroundColor: isDark ? 'rgba(26, 31, 60, 0.9)' : 'rgba(255, 255, 255, 0.95)',
                  borderColor: colors.border,
                  shadowColor: isDark ? '#000' : 'rgba(0, 0, 0, 0.08)',
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <Ionicons name="color-palette-outline" size={22} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>Customize Colors</Text>
              </View>

              <Text style={[styles.settingDescription, { color: colors.secondaryText }]}>
                Tap a block to change its color
              </Text>

              <View style={styles.colorBlocksRow}>
                {editingColors.map((gradient, index) => {
                  const selected = selectedColorIndex === index;
                  return (
                    <TouchableOpacity
                      key={index}
                      onPress={() => setSelectedColorIndex(selected ? null : index)}
                      style={[
                        styles.colorBlockTapTarget,
                        selected && { borderColor: colors.primary, borderWidth: 3 },
                      ]}
                      activeOpacity={0.9}
                    >
                      <LinearGradient
                        colors={gradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.colorBlockSwatch}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedColorIndex !== null && (
                <View style={styles.colorSelectorPanel}>
                  <Text style={[styles.colorSelectorTitle, { color: colors.text }]}>
                    Editing Block {selectedColorIndex + 1}
                  </Text>
                  <View style={styles.pickerWrapper}>
                    <HexColorPicker
                      color={pickerHex || editingColors[selectedColorIndex][0]}
                      onChange={handlePickerChange}
                    />
                  </View>
                  <View style={styles.hexInputRow}>
                    <View
                      style={[
                        styles.hexPreviewSwatch,
                        { backgroundColor: pickerHex || editingColors[selectedColorIndex][0] },
                      ]}
                    />
                    <HexColorInput
                      color={pickerHex || editingColors[selectedColorIndex][0]}
                      onChange={(hex) => {
                        setPickerHex(hex);
                        commitPickerColor(hex);
                      }}
                      prefixed
                      style={{
                        flex: 1,
                        height: 44,
                        borderWidth: 1,
                        borderRadius: 10,
                        paddingLeft: 14,
                        paddingRight: 14,
                        fontSize: 15,
                        fontFamily: 'Geist-Regular',
                        color: colors.text,
                        borderColor: colors.border,
                        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                      }}
                    />
                  </View>
                </View>
              )}

              <View style={styles.colorActionsRow}>
                <TouchableOpacity
                  style={[styles.resetColorsButton, { borderColor: colors.border }]}
                  onPress={() => {
                    setEditingColors([...DEFAULT_GAME_GRADIENTS]);
                    setColorsSaved(false);
                  }}
                >
                  <Text style={[styles.resetColorsButtonText, { color: colors.text }]}>
                    Reset
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveColorsButton, { backgroundColor: colors.primary }]}
                  onPress={async () => {
                    await setCustomGameColors(editingColors);
                    setColorsSaved(true);
                  }}
                >
                  <Text style={styles.saveButtonText}>
                    {colorsSaved ? 'Saved!' : 'Save Colors'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Legal Links */}
          <View style={styles.legalLinksContainer}>
            <TouchableOpacity
              style={[styles.legalLink, { borderColor: colors.border }]}
              onPress={() => router.push('/privacy-policy' as any)}
            >
              <Ionicons name="shield-outline" size={18} color={colors.primary} />
              <Text style={[styles.legalLinkText, { color: colors.text }]}>Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.legalLink, { borderColor: colors.border }]}
              onPress={() => router.push('/terms-and-conditions' as any)}
            >
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={[styles.legalLinkText, { color: colors.text }]}>Terms & Conditions</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Logout Button */}
          <TouchableOpacity
            style={[styles.logoutButton, { backgroundColor: colors.primary }]}
            onPress={async () => {
              try {
                await authService.signOut();
                router.replace('/');
              } catch (error) {
                console.error('Logout failed:', error);
                alert('Failed to logout. Please try again.');
              }
            }}
          >
            <Ionicons name="log-out-outline" size={18} color="#FFF" style={styles.logoutIcon} />
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </ScrollView>
  );
}

const AVATAR_SIZE = 100;

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    minHeight: '100%',
  },
  container: {
    flex: 1,
    minHeight: screenHeight,
    width: '100%',
    alignItems: 'center',
  },

  // Header
  headerSection: {
    width: '100%',
    paddingTop: 40,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 10,
    cursor: 'pointer',
    padding: 8,
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Geist-Bold',
  },
  headerContent: {
    alignItems: 'center',
  },
  gameTitle: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    letterSpacing: 2,
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Geist-Regular',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Content
  contentWrapper: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 20,
  },

  // Profile Card
  profileCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(0, 96, 255, 0.3)',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadingText: {
    color: '#FFF',
    fontSize: 24,
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },

  // Form
  formSection: {
    gap: 16,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 16,
  },
  inputGroup: {
    flex: 1,
  },
  inputGroupHalf: {
    flex: 0.5,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Geist-Bold',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: 'Geist-Regular',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  changePasswordLink: {
    paddingVertical: 8,
  },
  changePasswordText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Geist-Bold',
  },
  saveButton: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Geist-Bold',
  },

  // Settings Grid
  settingsGrid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  settingsCard: {
    flex: 1,
    minWidth: 300,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Geist-Regular',
  },
  settingDescription: {
    fontSize: 13,
    fontFamily: 'Geist-Regular',
    marginBottom: 16,
  },

  // Mode Grid
  modeGrid: {
    flexDirection: 'column',
    gap: 10,
  },
  modeTile: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  modeTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Geist-Bold',
    marginBottom: 10,
  },
  modePreviewRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modePreviewSwatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modePreviewToken: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Color Blocks
  colorBlocksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
    justifyContent: 'center',
  },
  colorBlockTapTarget: {
    padding: 3,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    cursor: 'pointer',
  },
  colorBlockSwatch: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  colorSelectorPanel: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.2)',
    marginBottom: 16,
  },
  colorSelectorTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
    fontFamily: 'Geist-Bold',
  },
  pickerWrapper: {
    height: 180,
    width: '100%',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  hexInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hexPreviewSwatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.3)',
  },
  colorActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  resetColorsButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
  },
  resetColorsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Geist-Bold',
  },
  saveColorsButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },

  // Legal Links
  legalLinksContainer: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  legalLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  legalLinkText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Geist-Regular',
  },

  // Logout
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    gap: 8,
  },
  logoutIcon: {
    marginTop: 1,
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Geist-Bold',
  },

  // Card component style
  card: {
    borderRadius: 20,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
});
