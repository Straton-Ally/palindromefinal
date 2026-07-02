import { authService } from '@/authService';
import { useThemeContext } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  InteractionManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SpotlightTourProvider, type TourState, type TourStep } from 'react-native-spotlight-tour';

const TOUR_SEEN_KEY = 'palindrome_ui_tour_v1_seen';

function TourCard(props: {
  title: string;
  description: string;
  stepIndex: number;
  stepsCount: number;
  isDark: boolean;
  accentColor: string;
  isFirst: boolean;
  isLast: boolean;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <View
      style={{
        width: 360,
        maxWidth: '100%',
        borderRadius: 18,
        padding: 16,
        backgroundColor: props.isDark ? 'rgba(10,10,28,0.96)' : 'rgba(255,255,255,0.97)',
        borderWidth: 1,
        borderColor: props.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 18 },
        elevation: 12,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ fontFamily: 'Geist-Bold', fontSize: 15, color: props.isDark ? '#FFFFFF' : '#111111' }}>
          {props.title}
        </Text>
        <Text
          style={{
            fontFamily: 'Geist-Regular',
            fontSize: 12,
            color: props.isDark ? 'rgba(255,255,255,0.65)' : 'rgba(17,17,17,0.55)',
          }}
        >
          {Math.min(props.stepIndex + 1, props.stepsCount)}/{props.stepsCount}
        </Text>
      </View>

      <Text
        style={{
          marginTop: 8,
          fontFamily: 'Geist-Regular',
          fontSize: 13,
          lineHeight: 18,
          color: props.isDark ? 'rgba(255,255,255,0.78)' : 'rgba(17,17,17,0.78)',
        }}
      >
        {props.description}
      </Text>

      <View style={{ marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <Pressable
          onPress={props.onSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip tour"
          style={({ pressed }) => ({
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: props.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.16)',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontFamily: 'Geist-Regular', fontSize: 13, color: props.isDark ? '#FFFFFF' : '#111111' }}>
            Skip
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={props.onBack}
            disabled={props.isFirst}
            accessibilityRole="button"
            accessibilityLabel="Previous step"
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: props.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.16)',
              opacity: props.isFirst ? 0.5 : pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontFamily: 'Geist-Regular', fontSize: 13, color: props.isDark ? '#FFFFFF' : '#111111' }}>
              Back
            </Text>
          </Pressable>

          <Pressable
            onPress={props.onNext}
            accessibilityRole="button"
            accessibilityLabel={props.isLast ? 'Finish tour' : 'Next step'}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: props.accentColor,
              borderWidth: 1,
              borderColor: props.accentColor,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            <Text style={{ fontFamily: 'Geist-Bold', fontSize: 13, color: '#FFFFFF' }}>
              {props.isLast ? 'Got it' : 'Next'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MainTourSpotSync(props: {
  tour: any;
  scrollToTile: (key: 'single' | 'multi' | 'practice' | 'settings') => Promise<void>;
  topInset: number;
  topbarRef: React.RefObject<View | null>;
  singleRef: React.RefObject<any>;
  multiRef: React.RefObject<any>;
  practiceRef: React.RefObject<any>;
  settingsRef: React.RefObject<any>;
}) {
  const { current, status, changeSpot } = props.tour ?? {};
  const { scrollToTile, topbarRef, singleRef, multiRef, practiceRef, settingsRef } = props;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const yOffset = props.topInset;

  useEffect(() => {
    if (status !== 'running') return;
    if (typeof current !== 'number') return;

    let cancelled = false;

    const measure = (node: any) => {
      return new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
        if (!node?.measureInWindow) return resolve(null);
        node.measureInWindow((x: number, y: number, width: number, height: number) => {
          if (width > 0 && height > 0) resolve({ x, y, width, height });
          else resolve(null);
        });
      });
    };

    const run = async () => {
      const idx = current;
      if (idx === 1) await scrollToTile('single');
      if (idx === 2) await scrollToTile('multi');
      if (idx === 3) await scrollToTile('practice');
      if (idx === 4) await scrollToTile('settings');

      const ref =
        idx === 0
          ? topbarRef
          : idx === 1
            ? singleRef
            : idx === 2
              ? multiRef
              : idx === 3
                ? practiceRef
                : settingsRef;

      let didSet = false;
      const delays = [0, 40, 90, 160, 260, 420];
      for (const d of delays) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, d)));
        if (cancelled) return;
        const node = (ref as any)?.current as any;
        const rect = await measure(node);
        if (!rect) continue;
        changeSpot({ ...rect, y: rect.y + yOffset });
        didSet = true;
        break;
      }

      if (!didSet && typeof changeSpot === 'function') {
        const x = Math.max(0, windowWidth / 2 - 2);
        const y = Math.max(0, windowHeight / 2 - 2 + yOffset);
        changeSpot({ x, y, width: 4, height: 8 });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [changeSpot, current, multiRef, practiceRef, scrollToTile, settingsRef, singleRef, status, topbarRef, windowHeight, windowWidth, yOffset]);

  return null;
}

export default function MainScreen() {
  const router = useRouter();
  const { theme, toggleTheme, colors } = useThemeContext();
  const isDark = theme === 'dark';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState<string>('Player');
  const [, setUserId] = useState<string | null>(null);
  const tourRef = useRef<any>(null);
  const topbarRef = useRef<View | null>(null);
  const singleRef = useRef<any>(null);
  const multiRef = useRef<any>(null);
  const practiceRef = useRef<any>(null);
  const settingsRef = useRef<any>(null);

  const isCompact = width < 420;
  const float = useRef(new Animated.Value(0)).current;

  const backgroundColors = useMemo(() => {
    return isDark ? (['#000017', '#000074'] as const) : (['#FFFFFF', '#E9EFFF'] as const);
  }, [isDark]);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [float]);

  const scrollRef = useRef<ScrollView>(null);
  const tileGridYRef = useRef<number>(0);
  const tileYRef = useRef<{ single?: number; multi?: number; practice?: number; settings?: number }>({});

  const markTourSeen = useCallback(() => {
    void AsyncStorage.setItem(TOUR_SEEN_KEY, '1');
  }, []);

  const scrollToTile = useCallback((key: 'single' | 'multi' | 'practice' | 'settings') => {
    const y = tileYRef.current[key];
    if (typeof y !== 'number') return Promise.resolve();
    return new Promise<void>((resolve) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: false });
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => setTimeout(resolve, 140));
      });
    });
  }, []);

  const tourSteps = useMemo<TourStep[]>(() => {
    const stepsCount = 5;

    const step = (cfg: {
      title: string;
      description: string;
      before?: () => Promise<void> | void;
    }): TourStep => {
      return {
        arrow: false,
        shape: { type: 'rectangle', padding: 10 },
        before: cfg.before,
        render: ({ current, isFirst, isLast, next, previous, stop }) => (
          <TourCard
            title={cfg.title}
            description={cfg.description}
            stepIndex={current}
            stepsCount={stepsCount}
            isDark={isDark}
            accentColor={colors.accent}
            isFirst={isFirst}
            isLast={isLast}
            onSkip={stop}
            onBack={previous}
            onNext={isLast ? stop : next}
          />
        ),
      };
    };

    return [
      step({
        title: 'Quick Tour',
        description: 'Here’s a short walkthrough of the main options. You’ll only see this once.',
      }),
      step({
        title: 'Single Player',
        description: 'Start a new match and play at your own pace. This is the best place to begin.',
        before: () => scrollToTile('single'),
      }),
      step({
        title: 'Play Online',
        description: 'Quick match with a random opponent or create a private game with an invite code.',
        before: () => scrollToTile('multi'),
      }),
      step({
        title: 'Play with Friends',
        description: 'Lobby to add friends and challenge them to a match within your friend circle.',
        before: () => scrollToTile('practice'),
      }),
      step({
        title: 'Settings & Profile',
        description: 'Update your profile and preferences.',
        before: () => scrollToTile('settings'),
      }),
    ];
  }, [colors.accent, isDark, scrollToTile]);

  useEffect(() => {
    void (async () => {
      try {
        const seen = await AsyncStorage.getItem(TOUR_SEEN_KEY);
        if (seen === '1') return;
        setTimeout(() => tourRef.current?.start?.(), 450);
      } catch {
        return;
      }
    })();
  }, []);

  const openTour = useCallback(() => {
    tourRef.current?.start?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await authService.getSessionUser();
      if (cancelled) return;
      if (user) {
        setUserId(user.id);
        const name = user.displayName?.trim() || user.email?.split('@')[0]?.trim() || 'Player';
        setDisplayName(name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    await authService.signOut();
    router.replace('/');
  }, [router]);

  const handleSinglePlayer = useCallback(() => {
    router.push('/gamelayout');
  }, [router]);

  const handlePlayOnline = useCallback(() => {
    router.push('/multiplayer');
  }, [router]);

  const handlePlayWithFriends = useCallback(() => {
    router.push('/friends');
  }, [router]);

  const handleSettings = useCallback(() => {
    router.push('/profile');
  }, [router]);

  const handleNotifications = useCallback(() => {
    router.push('/notifications');
  }, [router]);

  const orbAOffset = float.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const orbBOffset = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const orbCOffset = float.interpolate({ inputRange: [0, 1], outputRange: [0, -18] });

  return (
    <SpotlightTourProvider
      ref={tourRef}
      steps={tourSteps}
      overlayColor={'#000000'}
      overlayOpacity={0.72}
      arrow={false}
      shape={{ type: 'rectangle', padding: 10 }}
      onBackdropPress={() => {}}
      onStop={(_values: TourState) => markTourSeen()}
    >
      {(tour) => (
        <>
          <MainTourSpotSync
            tour={tour}
            scrollToTile={scrollToTile}
            topInset={insets.top}
            topbarRef={topbarRef}
            singleRef={singleRef}
            multiRef={multiRef}
            practiceRef={practiceRef}
            settingsRef={settingsRef}
          />
          <LinearGradient colors={backgroundColors} style={{ flex: 1 }}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Animated.View style={[styles.orb, styles.orbA, { transform: [{ translateY: orbAOffset }] }]}>
              <LinearGradient colors={['rgba(142,217,252,0.55)', 'rgba(60,141,234,0.0)']} style={styles.orbFill} />
            </Animated.View>
            <Animated.View style={[styles.orb, styles.orbB, { transform: [{ translateY: orbBOffset }] }]}>
              <LinearGradient colors={['rgba(255,238,96,0.55)', 'rgba(255,164,11,0.0)']} style={styles.orbFill} />
            </Animated.View>
            <Animated.View style={[styles.orb, styles.orbC, { transform: [{ translateY: orbCOffset }] }]}>
              <LinearGradient colors={['rgba(195,93,217,0.42)', 'rgba(195,93,217,0.0)']} style={styles.orbFill} />
            </Animated.View>
          </View>

          <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1 }}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={[
                styles.scrollContent,
                {
                  paddingHorizontal: isCompact ? 14 : 16,
                  paddingTop: insets.top + (isCompact ? 12 : 16),
                  paddingBottom: 28,
                },
              ]}
            >
              <View
                ref={topbarRef}
                collapsable={false}
                style={[styles.topbarWrap, { borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)' }]}
              >
                <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                <View style={styles.topbarRow}>
                  <View style={styles.brandWrap}>
                    <Text
                      style={[styles.brand, { color: isDark ? '#FFFFFF' : '#0060FF' }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.72}
                    >
                      PALINDROME®
                    </Text>
                    <Text style={[styles.welcome, { color: isDark ? 'rgba(255,255,255,0.78)' : 'rgba(17,17,17,0.62)' }]}>
                      Welcome, {displayName}
                    </Text>
                  </View>

                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={toggleTheme}
                      style={({ pressed }) => [
                        styles.iconButton,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.80)',
                          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)',
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Toggle theme"
                    >
                      <Ionicons name={isDark ? 'sunny' : 'moon'} size={19} color={isDark ? '#FFFFFF' : '#0060FF'} />
                    </Pressable>

                    <Pressable
                      onPress={openTour}
                      style={({ pressed }) => [
                        styles.iconButton,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.80)',
                          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)',
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Open UI tour"
                    >
                      <Ionicons name="help-circle-outline" size={19} color={isDark ? '#FFFFFF' : '#0060FF'} />
                    </Pressable>

                    <Pressable
                      onPress={handleNotifications}
                      style={({ pressed }) => [
                        styles.iconButton,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.80)',
                          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)',
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Notifications"
                    >
                      <Ionicons name="notifications-outline" size={19} color={isDark ? '#FFFFFF' : '#0060FF'} />
                    </Pressable>

                    <Pressable
                      onPress={handleSignOut}
                      style={({ pressed }) => [
                        styles.iconButton,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.80)',
                          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)',
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Sign out"
                    >
                      <Ionicons name="log-out-outline" size={19} color={isDark ? '#FFFFFF' : '#111111'} />
                    </Pressable>
                  </View>
                </View>
              </View>

          <View style={{ marginTop: 14 }}>
            <Text style={[styles.heroTitle, { color: isDark ? '#FFFFFF' : '#0A0F2D' }]}>Choose Your Mode</Text>
            <Text
              style={[
                styles.heroSubtitle,
                { color: isDark ? 'rgba(255,255,255,0.74)' : 'rgba(17,17,17,0.62)' },
              ]}
            >
              Single player, play online, or play with friends.
            </Text>
          </View>

          <View
            style={styles.tileGrid}
            onLayout={(e) => {
              tileGridYRef.current = e.nativeEvent.layout.y;
            }}
          >

            <View
              style={[styles.tileWrap, { width: '100%' }]}
              onLayout={(e) => {
                tileYRef.current.single = tileGridYRef.current + e.nativeEvent.layout.y;
              }}
            >
              <MenuTile
                ref={singleRef}
                title="Single Player"
                subtitle="Start a new game"
                badge="Play"
                icon="person"
                colors={['#8ed9fc', '#3c8dea']}
                onPress={handleSinglePlayer}
              />
            </View>

            <View
              style={[styles.tileWrap, { width: '100%' }]}
              onLayout={(e) => {
                tileYRef.current.multi = tileGridYRef.current + e.nativeEvent.layout.y;
              }}
            >
              <MenuTile
                ref={multiRef}
                title="Play Online"
                subtitle="Quick match & invite code"
                badge="Play"
                icon="globe"
                colors={['#ffee60', '#ffa40b']}
                onPress={handlePlayOnline}
              />
            </View>

            <View
              style={[styles.tileWrap, { width: '100%' }]}
              onLayout={(e) => {
                tileYRef.current.practice = tileGridYRef.current + e.nativeEvent.layout.y;
              }}
            >
              <MenuTile
                ref={practiceRef}
                title="Play with Friends"
                subtitle="Lobby, add friends, challenge"
                badge="Play"
                icon="people"
                colors={['#C35DD7', '#E879F9']}
                onPress={handlePlayWithFriends}
              />
            </View>

            <View
              style={[styles.tileWrap, { width: '100%' }]}
              onLayout={(e) => {
                tileYRef.current.settings = tileGridYRef.current + e.nativeEvent.layout.y;
              }}
            >
              <MenuTile
                ref={settingsRef}
                title="Settings"
                subtitle="Profile and preferences"
                badge="Open"
                icon="settings"
                colors={['#111111', '#3C3C3C']}
                onPress={handleSettings}
              />
            </View>
          </View>
        </ScrollView>

      </SafeAreaView>
    </LinearGradient>
    </>
  )}
    </SpotlightTourProvider>
  );
}

const MenuTile = React.forwardRef<any, {
  title: string;
  subtitle: string;
  badge: string;
  icon: keyof typeof Ionicons.glyphMap;
  colors: readonly [string, string];
  onPress: () => void;
}>((props, ref) => {
  const sparkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkle, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(sparkle, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [sparkle]);

  const sparkleTranslate = sparkle.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.tilePressable,
        {
          transform: [{ scale: pressed ? 0.98 : 1 }],
          shadowOpacity: pressed ? 0.14 : 0.24,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={props.title}
    >
      <LinearGradient colors={props.colors} style={styles.tileGradient}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.spark,
            {
              transform: [{ translateY: sparkleTranslate }],
              opacity: 0.55,
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.0)']}
            style={styles.sparkFill}
          />
        </Animated.View>

        <View style={styles.tileInner}>
          <View style={styles.tileTopRow}>
            <View style={styles.tileIconWrap}>
              <Ionicons name={props.icon} size={22} color="#FFFFFF" />
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{props.badge}</Text>
            </View>
          </View>

          <View>
            <Text style={styles.tileTitle}>{props.title}</Text>
            <Text style={styles.tileSubtitle}>{props.subtitle}</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

MenuTile.displayName = 'MenuTile';

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
  },
  orbFill: {
    flex: 1,
    borderRadius: 999,
  },
  orbA: {
    width: 280,
    height: 280,
    left: -120,
    top: -130,
  },
  orbB: {
    width: 320,
    height: 320,
    right: -170,
    top: 40,
  },
  orbC: {
    width: 360,
    height: 360,
    right: -220,
    bottom: -260,
  },
  topbarWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
  },
  topbarRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  brandWrap: {
    flex: 1,
    minWidth: 0,
  },
  brand: {
    fontFamily: 'Geist-Bold',
    fontSize: 18,
    letterSpacing: 0.6,
  },
  welcome: {
    fontFamily: 'Geist-Regular',
    fontSize: 12,
    marginTop: 3,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  heroTitle: {
    fontFamily: 'Geist-Bold',
    fontSize: 24,
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    fontFamily: 'Geist-Regular',
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  friendsCard: {
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  friendsCardHeader: {
    marginBottom: 12,
  },
  friendsCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  friendsCardTitle: {
    fontFamily: 'Geist-Bold',
    fontSize: 16,
  },
  friendsCardActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  friendsCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexShrink: 0,
  },
  friendsCardBtnText: {
    fontFamily: 'Geist-Bold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  friendsCardBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    flexShrink: 0,
  },
  friendsCardBtnSecondaryText: {
    fontFamily: 'Geist-Bold',
    fontSize: 13,
  },
  pendingSection: {
    marginTop: 4,
  },
  pendingLabel: {
    fontFamily: 'Geist-Regular',
    fontSize: 12,
    marginBottom: 8,
  },
  friendRequestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  friendRequestName: {
    fontFamily: 'Geist-Regular',
    fontSize: 14,
    flex: 1,
  },
  friendRequestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  friendRequestAccept: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  friendRequestDecline: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  friendRequestBtnText: {
    fontFamily: 'Geist-Bold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  friendsEmpty: {
    fontFamily: 'Geist-Regular',
    fontSize: 13,
    marginTop: 12,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    marginHorizontal: -6,
  },
  tileWrap: {
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  tilePressable: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 22,
    elevation: 6,
  },
  tileGradient: {
    borderRadius: 18,
    minHeight: 114,
  },
  tileInner: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'space-between',
    minHeight: 114,
  },
  tileTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  tileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  badgeText: {
    fontFamily: 'Geist-Regular',
    fontSize: 11,
    color: 'rgba(255,255,255,0.92)',
  },
  tileTitle: {
    fontFamily: 'Geist-Bold',
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 10,
  },
  tileSubtitle: {
    fontFamily: 'Geist-Regular',
    fontSize: 12,
    color: 'rgba(255,255,255,0.90)',
    marginTop: 6,
  },
  spark: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 46,
    height: 46,
    borderRadius: 999,
  },
  sparkFill: {
    flex: 1,
    borderRadius: 999,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.OS === 'web' ? 22 : 18,
    alignSelf: 'center',
    backgroundColor: 'rgba(17,17,17,0.92)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    maxWidth: 520,
  },
  toastText: {
    fontFamily: 'Geist-Regular',
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 14,
  },
});
