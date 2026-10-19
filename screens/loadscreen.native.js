import {
  Canvas,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Rect,
  Text as SkiaText,
  useFont,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import * as NativeSplash from 'expo-splash-screen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Image, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// Keep the OS launch screen up until this component mounts (runs at module load; this file is
// required by app/_layout). It is hidden on mount, over our plain navy background, and the
// bulldog intro starts only after the OS has finished fading it out, so the two never overlap.
NativeSplash.preventAutoHideAsync().catch(() => {});
NativeSplash.setOptions({ fade: false });

// Time to let the OS launch screen finish disappearing before the bulldog appears.
const LAUNCH_SPLASH_CLEAR_MS = 900;
// If the bulldog image or font somehow fails to load, start anyway after this long.
const ASSET_TIMEOUT_MS = 1500;

const { width, height } = Dimensions.get('window');

const scale = size => (width / 375) * size;
const verticalScale = size => (height / 812) * size;

// Splash stays at least this long so it never flashes; longer if the app is still loading.
const MIN_VISIBLE_MS = 1800;
const INTRO_MS = 550;
const SHIMMER_MS = 1100;
const EXIT_MS = 350;

const LOGO_SIZE = scale(180);
const LOGO_GAP = verticalScale(80);
const TITLE_SIZE = scale(48);
const TITLE_MAX_WIDTH = width * 0.95;

/**
 * Animated splash (Skia + Reanimated):
 * bulldog and PALINDROME® fade/scale in, a light shimmer sweeps across both (masked to their
 * shapes), then the splash fades out once the app is ready (`ready`) and calls `onFinish`.
 */
export default function SplashScreen({ ready = false, onFinish }) {
  const bulldog = useImage(require('../assets/images/bulldog.png'));
  const font = useFont(require('../assets/fonts/Geist-Bold.ttf'), TITLE_SIZE);

  const intro = useSharedValue(0);
  const sweep = useSharedValue(0);
  const exit = useSharedValue(1);
  const startedAt = useRef(Date.now());
  const finishing = useRef(false);
  const [started, setStarted] = useState(false);
  const [assetTimeout, setAssetTimeout] = useState(false);
  const [launchCleared, setLaunchCleared] = useState(false);

  // Hide the OS launch screen right away (our first frame is the same navy background).
  useEffect(() => {
    NativeSplash.hideAsync().catch(() => {});
    const cleared = setTimeout(() => setLaunchCleared(true), LAUNCH_SPLASH_CLEAR_MS);
    const assets = setTimeout(() => setAssetTimeout(true), ASSET_TIMEOUT_MS);
    return () => {
      clearTimeout(cleared);
      clearTimeout(assets);
    };
  }, []);

  // Start the intro once the launch screen is gone and the bulldog + title can be drawn.
  useEffect(() => {
    if (started || !launchCleared) return;
    if (!(bulldog && font) && !assetTimeout) return;
    startedAt.current = Date.now();
    setStarted(true);
    intro.value = withTiming(1, { duration: INTRO_MS, easing: Easing.out(Easing.cubic) });
    sweep.value = withDelay(
      INTRO_MS * 0.6,
      withRepeat(withTiming(1, { duration: SHIMMER_MS, easing: Easing.inOut(Easing.quad) }), -1, false)
    );
  }, [assetTimeout, bulldog, font, intro, launchCleared, started, sweep]);

  useEffect(() => {
    if (!started || !ready || finishing.current) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    const timer = setTimeout(() => {
      finishing.current = true;
      exit.value = withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }, (done) => {
        if (done && onFinish) runOnJS(onFinish)();
      });
    }, wait);
    return () => clearTimeout(timer);
  }, [exit, onFinish, ready, started]);

  // Title layout: Skia text has no letter-spacing, so draw glyphs at the RN title's spacing (4).
  const title = 'PALINDROME®';
  const titleLayout = useMemo(() => {
    if (!font) return null;
    const spacing = 4;
    const glyphWidths = Array.from(title).map((ch) => font.measureText(ch).width);
    const natural = glyphWidths.reduce((a, b) => a + b, 0) + spacing * (title.length - 1);
    const fit = Math.min(1, TITLE_MAX_WIDTH / natural);
    let x = 0;
    const glyphs = Array.from(title).map((ch, i) => {
      const g = { ch, x };
      x += glyphWidths[i] + spacing;
      return g;
    });
    const metrics = font.getMetrics();
    return { glyphs, natural, fit, ascent: -metrics.ascent, descent: metrics.descent };
  }, [font]);

  const canvasW = width;
  const titleH = titleLayout ? (titleLayout.ascent + titleLayout.descent) * titleLayout.fit : TITLE_SIZE;
  const canvasH = LOGO_SIZE + LOGO_GAP + titleH + 8;
  const logoX = (canvasW - LOGO_SIZE) / 2;
  const titleTop = LOGO_SIZE + LOGO_GAP;

  // Diagonal light band travelling left to right across the canvas.
  const band = canvasW * 0.35;
  const shimmerStart = useDerivedValue(() => vec(-band + (canvasW + band * 2) * sweep.value - band, 0));
  const shimmerEnd = useDerivedValue(() => vec(-band + (canvasW + band * 2) * sweep.value + band, canvasH * 0.35));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: intro.value,
    transform: [{ scale: 0.9 + 0.1 * intro.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: intro.value,
    transform: [{ translateY: (1 - intro.value) * 10 }],
  }));
  const exitStyle = useAnimatedStyle(() => ({ opacity: exit.value }));

  return (
    <Animated.View style={[styles.container, exitStyle]}>
      <Image source={require('../assets/images/bg.png')} style={styles.background} resizeMode="cover" />

      <View style={styles.contentContainer}>
        <Animated.View style={contentStyle}>
          <Canvas style={{ width: canvasW, height: canvasH }}>
            {/* Offscreen layer so the shimmer only lights up the bulldog and the title pixels. */}
            <Group layer>
              {bulldog ? (
                <SkiaImage image={bulldog} x={logoX} y={0} width={LOGO_SIZE} height={LOGO_SIZE} fit="contain" />
              ) : null}
              {titleLayout ? (
                <Group
                  transform={[
                    { translateX: (canvasW - titleLayout.natural * titleLayout.fit) / 2 },
                    { translateY: titleTop },
                    { scale: titleLayout.fit },
                  ]}
                >
                  {titleLayout.glyphs.map((g, i) => (
                    <SkiaText key={i} x={g.x} y={titleLayout.ascent} text={g.ch} font={font} color="#0060FF" />
                  ))}
                </Group>
              ) : null}
              <Rect x={0} y={0} width={canvasW} height={canvasH} blendMode="srcATop">
                <LinearGradient
                  start={shimmerStart}
                  end={shimmerEnd}
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
                />
              </Rect>
            </Group>
          </Canvas>
        </Animated.View>

        <Animated.View style={subtitleStyle}>
          <Text style={styles.subtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            BY GAMMA GAMES BY OXFORD
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000428',
  },

  background: {
    position: 'absolute',
    width: width,
    height: height,
    top: 0,
    left: 0,
  },

  contentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: verticalScale(80),
  },

  subtitle: {
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '400',
    letterSpacing: 4,
    marginTop: verticalScale(8),
    maxWidth: width * 0.9,
    fontFamily: Platform.select({
      ios: 'Geist-Regular',
      android: 'Geist-Regular',
      default: 'Geist-Regular',
    }),
  },
});
