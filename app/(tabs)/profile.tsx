import { authService } from '@/authService';
import { ColorBlindMode, useSettings } from '@/context/SettingsContext';
import { useThemeContext } from '@/context/ThemeContext';
import { DEFAULT_GAME_GRADIENTS, gradientFromHex, normalizeHex, type GameColorGradient } from '@/lib/gameColors';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Switch } from 'react-native-switch';
import ColorPicker from 'react-native-wheel-color-picker';

const { width } = Dimensions.get('window');

const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ['●', '▲', '■', '◆', '★'],
  emojis: ['🍓', '🥑', '🫐', '🖤', '🍋'],
  cards: ['♥', '♣', '♦', '♠', '★'],
  letters: ['A', 'B', 'C', 'D', 'E'],
} as const;

function getColorBlindToken(mode: ColorBlindMode, index: number) {
  return COLOR_BLIND_TOKENS[mode][index] ?? '?';
}

export default function ProfileScreen() {
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';
  const { colorBlindEnabled, colorBlindMode, setColorBlindEnabled, setColorBlindMode, customGameColors, setCustomGameColors } = useSettings();
  const insets = useSafeAreaInsets();
  const displayGradients = customGameColors ?? [...DEFAULT_GAME_GRADIENTS];
  const [editingColors, setEditingColors] = useState<GameColorGradient[]>(() => customGameColors ?? [...DEFAULT_GAME_GRADIENTS]);
  const [colorsSaved, setColorsSaved] = useState(false);
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(null);
  const [hexInputValue, setHexInputValue] = useState('');
  const [colorPickerActive, setColorPickerActive] = useState(false);
  useEffect(() => {
    setEditingColors(customGameColors ?? [...DEFAULT_GAME_GRADIENTS]);
  }, [customGameColors]);

  const applySelectedColor = useCallback((color: string) => {
    if (selectedColorIndex === null) return;

    const hex = normalizeHex(color);
    setHexInputValue(hex);
    setEditingColors((prev) => {
      const next = [...prev];
      next[selectedColorIndex] = gradientFromHex(hex);
      return next;
    });
    setColorsSaved(false);
  }, [selectedColorIndex]);

  const [avatar, setAvatar] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const loadProfile = async () => {
      // Use getSessionUser for faster initial load (avoids network roundtrip)
      const user = await authService.getSessionUser();
      if (user) {
        // Set email from auth user as fallback
        setEmail(user.email || '');
        
        // Try to load from cache first
        const cached = await authService.getCachedProfile(user.id);
        if (cached) {
          setFullName(cached.full_name || '');
          setPhone(cached.phone || '');
          if (cached.email) setEmail(cached.email);
          setAvatar(cached.avatar_url);
        }

        // Fetch fresh profile data
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
        base64: false, // We use URI for upload
      });

      if (!result.canceled && result.assets[0].uri) {
        await uploadAvatar(result.assets[0].uri);
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
      const result = await authService.uploadAvatar(user.id, { uri, type: 'image/jpeg' });
      if (result.success && result.publicUrl) {
        setAvatar(result.publicUrl);
        // Update profile with new avatar URL
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
        updated_at: new Date().toISOString(),
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
    <LinearGradient
      colors={
        isDark
          ? ['rgba(0, 0, 116, 1)', 'rgba(0, 0, 23, 1)']
          : ['#FFFFFF', '#E9EFFF']
      }
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!colorPickerActive}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Image
            source={require('../../assets/images/bg.png')}
            style={styles.headerImage}
            resizeMode="cover"
          />
          
          {/* Back Button */}
          <TouchableOpacity 
            style={[styles.backButton, { top: insets.top + 12 }]} 
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
              router.replace('/main');
              }
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={isDark ? '#FFFFFF' : '#0060FF'} />
          </TouchableOpacity>

          <Text
            style={[
              styles.headerTitle,
              { color: isDark ? '#FFFFFF' : '#0060FF' },
            ]}
          >
            PROFILE
          </Text>

          <View
            style={[
              styles.semicircle,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#fff' },
            ]}
          />
        </View>

        {/* Profile Image */}
        <TouchableOpacity onPress={pickImage} disabled={uploading}>
          <Image
            source={avatar ? { uri: avatar } : require('../../assets/images/profile_ph.png')}
            style={styles.profileImage}
          />
          {uploading && (
            <View style={[styles.profileImage, styles.uploadingOverlay]}>
              <Text style={{ color: '#FFF' }}>...</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Form */}
        <View style={styles.form}>
          {/* Full Name */}
          <View style={styles.inputGroup}>
            <View style={styles.floatingLabelWrapper}>
              <Text
                style={[
                  styles.floatingLabel,
                  {
                    backgroundColor: 'transparent',
                    color: isDark ? '#FFF' : '#000',
                  },
                ]}
              >
                Full Name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: 'transparent',
                    color: isDark ? '#FFF' : '#000',
                    borderColor: isDark ? 'rgba(255,255,255,0.3)' : '#CCC',
                  },
                ]}
                placeholder="e.g. Jenny Wilson"
                placeholderTextColor={isDark ? '#CCC' : '#777'}
                value={fullName}
                onChangeText={setFullName}
              />
            </View>
          </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <View style={styles.floatingLabelWrapper}>
              <Text
                style={[
                  styles.floatingLabel,
                  {
                    backgroundColor: 'transparent',
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
                    backgroundColor: 'transparent',
                    color: isDark ? '#FFF' : '#000',
                    borderColor: isDark ? 'rgba(255,255,255,0.3)' : '#CCC',
                  },
                ]}
                placeholder="e.g. wilson09@gmail.com"
                placeholderTextColor={isDark ? '#CCC' : '#777'}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Phone */}
          <View style={styles.inputGroup}>
            <View style={styles.floatingLabelWrapper}>
              <Text
                style={[
                  styles.floatingLabel,
                  {
                    backgroundColor: 'transparent',
                    color: isDark ? '#FFF' : '#000',
                  },
                ]}
              >
                Phone number
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: 'transparent',
                    color: isDark ? '#FFF' : '#000',
                    borderColor: isDark ? 'rgba(255,255,255,0.3)' : '#CCC',
                  },
                ]}
                placeholder="e.g. 0 123 456 7890"
                placeholderTextColor={isDark ? '#CCC' : '#777'}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* Change Password + Save */}
          <View style={styles.actionRow}>
            <TouchableOpacity>
              <Text
                style={[
                  styles.changePassword,
                  { color: isDark ? '#FFF' : '#000' },
                ]}
              >
                Change Password
              </Text>
            </TouchableOpacity>

            {/* ✅ Gradient Button */}
            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: 'rgba(0, 123, 255, 0.85)' }, // ✅ single color with opacity
              ]}
              onPress={handleSave}
              disabled={loading}
            >
              <Text style={styles.saveButtonText}>{loading ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.twoColumnRow}>
          <View
            style={[
              styles.accessibilityCard,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)',
                borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            <Text style={[styles.accessibilityTitle, { color: isDark ? '#FFFFFF' : '#0A0F2D' }]}>
              Accessibility
            </Text>

            <View style={styles.accessibilityRow}>
              <Text style={[styles.accessibilityLabel, { color: isDark ? '#FFFFFF' : '#111111' }]}>
                Color Blind Mode
              </Text>
              <Switch
                value={colorBlindEnabled}
                onValueChange={setColorBlindEnabled}
                disabled={false}
                activeText=""
                inActiveText=""
                circleSize={18}
                barHeight={22}
                circleBorderWidth={0}
                backgroundActive="#0060FF"
                backgroundInactive="#ccc"
                circleActiveColor="#FFFFFF"
                circleInActiveColor="#FFFFFF"
                changeValueImmediately={true}
                switchWidthMultiplier={2.5}
              />
            </View>

            <Text style={[styles.accessibilitySubtitle, { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(17,17,17,0.65)' }]}>
              Choose how colors are represented in the game.
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
                        borderColor: selected ? '#0060FF' : isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
                        backgroundColor: selected ? (isDark ? 'rgba(0,96,255,0.22)' : 'rgba(0,96,255,0.08)') : 'transparent',
                      },
                    ]}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.modeTitle, { color: isDark ? '#FFFFFF' : '#111111' }]}>
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
                        <LinearGradient key={i} colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.modePreviewSwatch}>
                          <Text style={styles.modePreviewToken}>{getColorBlindToken(mode, i)}</Text>
                        </LinearGradient>
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View
            style={[
              styles.customColorsCard,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)',
                borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            <Text style={[styles.accessibilityTitle, { color: isDark ? '#FFFFFF' : '#0A0F2D' }]}>
              Customize colors
            </Text>
            <Text style={[styles.accessibilitySubtitle, { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(17,17,17,0.65)', marginTop: 4 }]}>
              Tap a block to change its color. Enter a hex code (e.g. #000000 or #fff).
            </Text>
            <View style={styles.colorBlocksRow}>
              {editingColors.map((gradient, index) => {
                const selected = selectedColorIndex === index;
                return (
                  <TouchableOpacity
                    key={index}
                    onPress={() => {
                      const nextIndex = selected ? null : index;
                      setColorPickerActive(false);
                      setSelectedColorIndex(nextIndex);
                      if (nextIndex !== null) {
                        setHexInputValue(editingColors[nextIndex][0]);
                      }
                    }}
                    style={[
                      styles.colorBlockTapTarget,
                      selected && { borderColor: '#0060FF', borderWidth: 3 },
                    ]}
                    activeOpacity={0.9}
                  >
                    <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.colorBlockSwatch} />
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedColorIndex !== null && (
              <View style={styles.colorSelectorPanel}>
                <Text style={[styles.colorSelectorTitle, { color: isDark ? '#FFFFFF' : '#111111' }]}>
                  Editing block {selectedColorIndex + 1}
                </Text>

                <View
                  style={styles.colorWheelWrap}
                  onTouchStart={() => setColorPickerActive(true)}
                  onTouchEnd={() => setColorPickerActive(false)}
                  onTouchCancel={() => setColorPickerActive(false)}
                >
                  <ColorPicker
                    key={selectedColorIndex}
                    color={hexInputValue || editingColors[selectedColorIndex][0]}
                    onInteractionStart={() => setColorPickerActive(true)}
                    onColorChange={applySelectedColor}
                    onColorChangeComplete={(color: string) => {
                      applySelectedColor(color);
                      setColorPickerActive(false);
                    }}
                    thumbSize={28}
                    sliderSize={24}
                    noSnap
                    row={false}
                    swatches={false}
                    useNativeLayout
                  />
                </View>

                <View style={styles.hexInputRow}>
                  <LinearGradient
                    colors={editingColors[selectedColorIndex]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.hexPreviewSwatch}
                  />
                  <TextInput
                    style={[
                      styles.hexColorInput,
                      {
                        color: isDark ? '#FFFFFF' : '#111111',
                        borderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',
                        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                      },
                    ]}
                    placeholder="#000000"
                    placeholderTextColor={isDark ? '#888' : '#999'}
                    value={hexInputValue}
                    onChangeText={(text) => {
                      setHexInputValue(text);
                      const cleaned = text.replace(/^#/, '');
                      if (/^[0-9a-fA-F]{3}$/.test(cleaned) || /^[0-9a-fA-F]{6}$/.test(cleaned)) {
                        const hex = normalizeHex(text);
                        setEditingColors((prev) => {
                          const next = [...prev];
                          next[selectedColorIndex] = gradientFromHex(hex);
                          return next;
                        });
                        setColorsSaved(false);
                      }
                    }}
                    onBlur={() => {
                      const hex = normalizeHex(hexInputValue || '#000000');
                      setHexInputValue(hex);
                      setEditingColors((prev) => {
                        const next = [...prev];
                        next[selectedColorIndex] = gradientFromHex(hex);
                        return next;
                      });
                      setColorsSaved(false);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
            )}
            <View style={styles.colorActionsRow}>
              <TouchableOpacity
                style={[styles.resetColorsButton, { borderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' }]}
                onPress={() => {
                  setEditingColors([...DEFAULT_GAME_GRADIENTS]);
                  if (selectedColorIndex !== null) {
                    setHexInputValue(DEFAULT_GAME_GRADIENTS[selectedColorIndex][0]);
                  }
                  setColorsSaved(false);
                }}
              >
                <Text style={[styles.resetColorsButtonText, { color: isDark ? '#FFFFFF' : '#111111' }]}>Reset to default</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveColorsButton, { backgroundColor: 'rgba(0, 123, 255, 0.85)' }]}
                onPress={async () => {
                  await setCustomGameColors(editingColors);
                  setColorsSaved(true);
                }}
              >
                <Text style={styles.saveButtonText}>{colorsSaved ? 'Saved' : 'Save colors'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.legalLinksContainer,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)',
              borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.legalLinkRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }]}
            onPress={() => router.push('/privacy' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="shield-outline" size={20} color={isDark ? '#FFFFFF' : '#0060FF'} />
            <Text style={[styles.legalLinkText, { color: isDark ? '#FFFFFF' : '#111111' }]}>
              Privacy Policy
            </Text>
            <Ionicons name="chevron-forward" size={18} color={isDark ? 'rgba(255,255,255,0.65)' : '#0060FF'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.legalLinkRow, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/terms' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="document-text-outline" size={20} color={isDark ? '#FFFFFF' : '#0060FF'} />
            <Text style={[styles.legalLinkText, { color: isDark ? '#FFFFFF' : '#111111' }]}>
              Terms & Conditions
            </Text>
            <Ionicons name="chevron-forward" size={18} color={isDark ? 'rgba(255,255,255,0.65)' : '#0060FF'} />
          </TouchableOpacity>
        </View>

        {/* ✅ Gradient Logout Button */}
        <TouchableOpacity
          style={[
            styles.logoutButton,
            { backgroundColor: 'rgba(0, 123, 255, 0.85)' }, // ✅ single color with opacity
          ]}
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
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  header: {
    width: width,
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
    elevation: 5,
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.1)', // Subtle background for visibility
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '500',
    fontFamily: 'Geist-Bold',
    marginTop: 0,
  },
  semicircle: {
    position: 'absolute',
    bottom: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  profileImage: {
    width: 94,
    height: 94,
    borderRadius: 47,
    marginTop: -70,
    marginBottom: 20,
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  form: {
    width: '100%',
    maxWidth: 440,
  },
  inputGroup: {
    marginBottom: 20,
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
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
    gap: 80,
  },
  changePassword: {
    fontSize: 14,
    fontWeight: '500',
  },
  saveButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 30,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },
  logoutButton: {
    marginTop: 24,
    width: '100%',
    maxWidth: 440,
    borderRadius: 25,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  legalLinksContainer: {
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderRadius: 16,
    marginTop: 20,
    overflow: 'hidden',
  },
  legalLinkRow: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
  },
  legalLinkText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Geist-Regular',
  },
  twoColumnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    justifyContent: 'center',
    marginTop: 20,
    gap: 20,
  },
  accessibilityCard: {
    flex: 1,
    minWidth: 300,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  customColorsCard: {
    flex: 1,
    minWidth: 300,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  colorRow: {
    marginTop: 12,
  },
  colorRowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  colorPreviewSwatch: {
    width: 32,
    height: 32,
    borderRadius: 10,
  },
  colorRowText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Geist-Regular',
  },
  colorBlocksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 14,
    justifyContent: 'center',
  },
  colorBlockTapTarget: {
    padding: 4,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorBlockSwatch: {
    width: 52,
    height: 52,
    borderRadius: 12,
  },
  colorSelectorPanel: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
  colorSelectorTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
    fontFamily: 'Geist-Bold',
  },
  colorWheelWrap: {
    height: 240,
    width: '100%',
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hexPreviewSwatch: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.3)',
  },
  hexColorInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: 'Geist-Regular',
  },
  colorActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    gap: 12,
  },
  resetColorsButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  resetColorsButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  saveColorsButton: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  accessibilityTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Geist-Bold',
  },
  accessibilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  accessibilityLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Geist-Regular',
  },
  accessibilitySubtitle: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: 'Geist-Regular',
  },
  modeGrid: {
    marginTop: 14,
    flexDirection: 'column',
    gap: 12,
  },
  modeTile: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Geist-Bold',
    marginBottom: 12,
  },
  modePreviewRow: {
    flexDirection: 'row',
    gap: 6,
  },
  modePreviewSwatch: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modePreviewToken: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
