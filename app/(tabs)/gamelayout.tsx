import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    GestureResponderEvent,
    Image,
    PanResponder,
    PanResponderGestureState,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SpotlightTourProvider, type TourState, type TourStep } from 'react-native-spotlight-tour';
import Svg, { Defs, Stop, LinearGradient as SvgLinearGradient, Text as SvgText } from 'react-native-svg';
import { Switch } from 'react-native-switch';
import { Video, ResizeMode } from 'expo-av';

// ✅ Import theme context
import { authService } from '@/authService';
import { ColorBlindMode, useSettings } from '@/context/SettingsContext';
import { useThemeContext } from '@/context/ThemeContext';
import { useSound } from '@/hooks/use-sound';
import { DEFAULT_GAME_GRADIENTS } from '@/lib/gameColors';
import { createInitialState, createSinglePlayerInitialState, scoreNewPalindromes } from '@/lib/gameEngine';
import { FIRST_MOVE_TIMEOUT_SECONDS, forfeitRaceMatch, getMatch, submitScore, subscribeToMatch, updateLiveScore, type Match, type MatchPlayer } from '@/lib/matchmaking';
import { getMyBestSinglePlayer, saveSinglePlayerRun } from '@/lib/singlePlayer';

const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ['●', '▲', '■', '◆', '★'],
  emojis: ['🍓', '🥑', '🫐', '🖤', '🍋'],
  cards: ['♥', '♣', '♦', '♠', '★'],
  letters: ['A', 'B', 'C', 'D', 'E'],
} as const;

function getColorBlindToken(mode: ColorBlindMode, index: number) {
  return COLOR_BLIND_TOKENS[mode][index] ?? '?';
}

type BoardLayout = { x: number; y: number; width: number; height: number };

const DraggableBlock = ({
  index,
  gradient,
  blockCount,
  boardLayout,
  measureBoardLayout,
  gridSize,
  onDrop,
  onPickup,
  onDragUpdate
}: {
  index: number;
  gradient: readonly [string, string];
  blockCount: number;
  boardLayout: BoardLayout | null;
  measureBoardLayout: () => Promise<BoardLayout | null>;
  gridSize: number;
  onDrop: (row: number, col: number, colorIndex: number) => void;
  onPickup: () => void;
  onDragUpdate: (row: number | null, col: number | null) => void;
}) => {
  const { colorBlindEnabled, colorBlindMode } = useSettings();
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [isDragging, setIsDragging] = useState(false);
  const token = colorBlindEnabled ? getColorBlindToken(colorBlindMode, index) : null;
  const lastDragCellRef = useRef<{ row: number | null; col: number | null }>({ row: null, col: null });
  const dragTargetOffsetY = 50;

  const latest = useRef({
    boardLayout,
    blockCount,
    gridSize,
    measureBoardLayout,
    onDragUpdate,
    onDrop,
    onPickup,
  });

  useEffect(() => {
    latest.current = {
      boardLayout,
      blockCount,
      gridSize,
      measureBoardLayout,
      onDragUpdate,
      onDrop,
      onPickup,
    };
  }, [boardLayout, blockCount, gridSize, measureBoardLayout, onDragUpdate, onDrop, onPickup]);

  const getCellFromPoint = (touchX: number, touchY: number, layout: BoardLayout) => {
    const boardPadding = 6;
    const cellMargin = 1.5;
    const cellWidth = 27;
    const cellHeight = 30;
    const stepX = cellWidth + cellMargin * 2;
    const stepY = cellHeight + cellMargin * 2;

    const innerWidth = Math.max(1, layout.width - boardPadding * 2);
    const innerHeight = Math.max(1, layout.height - boardPadding * 2);
    const gridPixelWidth = latest.current.gridSize * stepX;
    const gridPixelHeight = latest.current.gridSize * stepY;

    const extraX = Math.max(0, (innerWidth - gridPixelWidth) / 2);
    const extraY = Math.max(0, innerHeight - gridPixelHeight) > 0.5 ? Math.max(0, (innerHeight - gridPixelHeight) / 2) : 0;

    const originX = layout.x + boardPadding + extraX + cellMargin;
    const originY = layout.y + boardPadding + extraY + cellMargin;

    const localX = touchX - originX;
    const localY = touchY - originY;
    const col = Math.floor(localX / stepX);
    const row = Math.floor(localY / stepY);

    if (row < 0 || row >= latest.current.gridSize || col < 0 || col >= latest.current.gridSize) {
      return { row: null, col: null };
    }
    return { row, col };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.blockCount > 0,
      onPanResponderGrant: () => {
        setIsDragging(true);
        lastDragCellRef.current = { row: null, col: null };
        latest.current.onPickup();
      },
      onPanResponderMove: (e: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        pan.setValue({ x: gestureState.dx, y: gestureState.dy });

        const layout = latest.current.boardLayout;
        if (!layout) return;

        const touchX = (e.nativeEvent as any).pageX ?? gestureState.moveX;
        const touchY = (e.nativeEvent as any).pageY ?? gestureState.moveY;
        const { row, col } = getCellFromPoint(touchX, touchY - dragTargetOffsetY, layout);

        const last = lastDragCellRef.current;
        if (last.row === row && last.col === col) return;
        lastDragCellRef.current = { row, col };
        latest.current.onDragUpdate(row, col);
      },
      onPanResponderRelease: (e: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        setIsDragging(false);
        const dropX = (e.nativeEvent as any).pageX ?? gestureState.moveX;
        const dropY = (e.nativeEvent as any).pageY ?? gestureState.moveY;

        void (async () => {
          const measuredLayout = await latest.current.measureBoardLayout();
          const layoutToUse = measuredLayout ?? latest.current.boardLayout;
          if (!layoutToUse) return;
          const { row, col } = getCellFromPoint(dropX, dropY - dragTargetOffsetY, layoutToUse);
          if (row !== null && col !== null) {
            latest.current.onDrop(row, col, index);
          }
        })();

        lastDragCellRef.current = { row: null, col: null };
        latest.current.onDragUpdate(null, null);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
        lastDragCellRef.current = { row: null, col: null };
        latest.current.onDragUpdate(null, null);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      }
    })
  ).current;

  return (
    <View style={styles.colorBlockWrapper}>
      {/* Background stack - stays behind */}
      <View style={[styles.colorBlock, { opacity: blockCount > 0 ? 1 : 0.5 }]}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientColorBlock}
        >
          {token ? <Text style={styles.colorBlindBlockTokenCorner}>{blockCount}</Text> : null}
          <Text style={token ? styles.colorBlindBlockTokenCenter : styles.blockText}>{token ? token : blockCount}</Text>
        </LinearGradient>
      </View>

      {/* Floating draggable block */}
      <Animated.View
        style={[
          styles.colorBlock,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            transform: pan.getTranslateTransform(),
            zIndex: isDragging ? 1000 : 1,
            elevation: isDragging ? 10 : 0,
          }
        ]}
        {...panResponder.panHandlers}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientColorBlock}
        >
          {/* Hide number when dragging for "picking one" look */}
          {token ? <Text style={styles.colorBlindBlockTokenCorner}>{blockCount}</Text> : null}
          {!isDragging && <Text style={token ? styles.colorBlindBlockTokenCenter : styles.blockText}>{token ? token : blockCount}</Text>}
          {isDragging && token && <Text style={styles.colorBlindBlockTokenCenter}>{token}</Text>}
        </LinearGradient>
      </Animated.View>
    </View>
  );
};

const PaletteBlock = ({
  index,
  gradient,
  blockCount,
  selected,
  onPress,
}: {
  index: number;
  gradient: readonly [string, string];
  blockCount: number;
  selected: boolean;
  onPress: () => void;
}) => {
  const { colorBlindEnabled, colorBlindMode } = useSettings();
  const token = colorBlindEnabled ? getColorBlindToken(colorBlindMode, index) : null;
  const disabled = blockCount <= 0;

  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.colorBlockWrapper}>
      <View
        style={[
          styles.colorBlock,
          {
            opacity: disabled ? 0.5 : 1,
            borderWidth: selected ? 2 : 0,
            borderColor: selected ? '#4A9EFF' : 'transparent',
          },
        ]}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientColorBlock}
        >
          {token ? <Text style={styles.colorBlindBlockTokenCorner}>{blockCount}</Text> : null}
          <Text style={token ? styles.colorBlindBlockTokenCenter : styles.blockText}>{token ? token : blockCount}</Text>
        </LinearGradient>
      </View>
    </Pressable>
  );
};

const GAME_TUTORIAL_SEEN_KEY = 'palindrome_game_tutorial_v1_seen';

const VIDEO_GUIDE_SEEN_KEY = 'palindrome_video_guide_v1_seen';

const GUIDE_SLIDES = [
  {
    video: require('../../assets/demo/5_counter_first.mp4'),
    title: 'First Move',
    description: 'Place two blocks that form a multi-color odd palindrome of length 5 or more.',
  },
  {
    video: require('../../assets/demo/dog_counter_first.mp4'),
    title: 'Bulldog Cells',
    description: 'Special cells block your placements — plan your moves around them!',
  },
  {
    video: require('../../assets/demo/right_counter_first.mp4'),
    title: 'Scoring Palindromes',
    description: 'Create odd-length color palindromes in rows, columns, or L-shapes to score points.',
  },
];

const GameSpotlightTourProvider = SpotlightTourProvider as React.ComponentType<any>;

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
          accessibilityLabel="Skip tutorial"
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
            accessibilityLabel={props.isLast ? 'Finish tutorial' : 'Next step'}
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

function GameTourSpotSync(props: {
  tour: any;
  topInset: number;
  scoreBoxRef: React.RefObject<View | null>;
  timerBoxRef: React.RefObject<View | null>;
  hintsBoxRef: React.RefObject<View | null>;
  blocksBoxRef: React.RefObject<View | null>;
  boardRef: React.RefObject<View | null>;
  controlsRowRef: React.RefObject<View | null>;
}) {
  const { current, status, changeSpot } = props.tour ?? {};
  const { scoreBoxRef, timerBoxRef, hintsBoxRef, blocksBoxRef, boardRef, controlsRowRef } = props;
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
      const getRef = () =>
        current === 0
          ? scoreBoxRef
          : current === 1
            ? timerBoxRef
            : current === 2
              ? hintsBoxRef
              : current === 3
                ? blocksBoxRef
                : current === 4
                  ? boardRef
                  : controlsRowRef;

      let didSet = false;
      const delays = [0, 40, 90, 160, 260, 420];
      for (const d of delays) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, d)));
        if (cancelled) return;
        const ref = getRef();
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
        changeSpot({ x, y, width: 4, height: 4 });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [blocksBoxRef, boardRef, changeSpot, controlsRowRef, current, hintsBoxRef, scoreBoxRef, status, timerBoxRef, windowHeight, windowWidth, yOffset]);

  return null;
}

function VideoGuideOverlay(props: {
  open: boolean
  slideIndex: number
  accentColor: string
  isDark: boolean
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onDone: () => void
}) {
  const { open, slideIndex, accentColor, isDark, onBack, onNext, onSkip, onDone } = props
  const videoRefs = useRef<(Video | null)[]>([])
  const slide = GUIDE_SLIDES[slideIndex]
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()

  useEffect(() => {
    if (!open) {
      videoRefs.current.forEach((v) => {
        if (!v) return
        v.pauseAsync().catch(() => {})
        v.setPositionAsync(0).catch(() => {})
      })
      return
    }
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i === slideIndex) {
        v.playFromPositionAsync(0).catch(() => {})
      } else {
        v.pauseAsync().catch(() => {})
      }
    })
  }, [open, slideIndex])

  if (!open || !slide) return null

  const isLast = slideIndex === GUIDE_SLIDES.length - 1
  const cardW = Math.min(windowWidth - 24, 440)
  const vidMaxH = Math.max(180, windowHeight - 320)

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999 }} pointerEvents="auto">
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)' }} />

      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
        <View style={{
          width: cardW,
          maxHeight: windowHeight - 24,
          backgroundColor: isDark ? 'rgba(10,10,28,0.98)' : 'rgba(255,255,255,0.98)',
          borderRadius: 24,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 20 },
          elevation: 16,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
        }}>
          <View style={{ padding: 20, paddingBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontFamily: 'Geist-Bold', fontSize: 20, lineHeight: 24, color: isDark ? '#FFFFFF' : '#111111' }}>{slide.title}</Text>
              <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2 }}>
                <Text style={{ fontSize: 13, color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(17,17,17,0.55)', fontFamily: 'Geist-Bold' }}>{slideIndex + 1}/{GUIDE_SLIDES.length}</Text>
              </View>
            </View>
            <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 21, color: isDark ? 'rgba(255,255,255,0.78)' : 'rgba(17,17,17,0.72)', fontFamily: 'Geist-Regular' }}>{slide.description}</Text>
          </View>

          <View style={{ position: 'relative', width: '100%', height: vidMaxH, backgroundColor: isDark ? 'rgba(10,10,28,1)' : '#111111' }}>
            {GUIDE_SLIDES.map((s, i) => (
              <View key={s.title} style={{
                position: i === slideIndex ? 'relative' : 'absolute',
                left: 0, right: 0, top: 0, bottom: 0,
                opacity: i === slideIndex ? 1 : 0,
                zIndex: i === slideIndex ? 2 : 1,
              }}>
                <Video
                  ref={(el: Video | null) => { videoRefs.current[i] = el }}
                  source={s.video}
                  resizeMode={ResizeMode.CONTAIN}
                  isLooping
                  isMuted
                  shouldPlay={i === slideIndex && open}
                  style={{ width: '100%', height: vidMaxH }}
                />
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 14 }}>
            {GUIDE_SLIDES.map((_, i) => (
              <View key={i} style={{
                width: i === slideIndex ? 22 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === slideIndex ? accentColor : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.14)'),
              }} />
            ))}
          </View>

          <View style={{ paddingHorizontal: 22, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={onSkip} style={{ borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.16)', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 }}>
              <Text style={{ fontFamily: 'Geist-Regular', fontSize: 14, color: isDark ? '#FFFFFF' : '#111111' }}>Skip</Text>
            </Pressable>

            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {slideIndex > 0 ? (
                <Pressable onPress={onBack} style={{ borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.16)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 }}>
                  <Text style={{ fontFamily: 'Geist-Regular', fontSize: 14, color: isDark ? '#FFFFFF' : '#111111' }}>Back</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={isLast ? onDone : onNext} style={{ backgroundColor: accentColor, borderWidth: 1, borderColor: accentColor, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 }}>
                <Text style={{ fontFamily: 'Geist-Bold', fontSize: 14, color: '#FFFFFF' }}>{isLast ? 'Start Playing' : 'Next'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export default function GameLayout() {
  const { matchId: routeMatchId, returnTo: routeReturnTo } = useLocalSearchParams<{ matchId?: string; returnTo?: string }>();
  const matchId = typeof routeMatchId === 'string' ? routeMatchId : undefined;
  const returnTo = typeof routeReturnTo === 'string' ? routeReturnTo : Array.isArray(routeReturnTo) ? routeReturnTo[0] : undefined;

  // ✅ Get theme and toggle function from context
  const { theme, toggleTheme, colors } = useThemeContext();
  const { soundEnabled, hapticsEnabled, palindromeAnimationsEnabled, colorBlindEnabled, colorBlindMode, interactionMode, customGameColors, setSoundEnabled, setHapticsEnabled, setPalindromeAnimationsEnabled, setColorBlindEnabled, setInteractionMode } = useSettings();
  const colorGradients = customGameColors ?? [...DEFAULT_GAME_GRADIENTS];
  const { playPickupSound, playDropSound, playErrorSound, playSuccessSound } = useSound();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const settingsCardHeight = Math.min(windowHeight * 0.78, windowHeight - insets.top - insets.bottom - 48);

  const [score, setScore] = useState(0);
  const [hints, setHints] = useState(2);
  const [time, setTime] = useState('00:00');
  const [bulldogPositions, setBulldogPositions] = useState<{ row: number; col: number }[]>([]);
  const [pause, setPause] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [gameOver, setGameOver] = useState<{ status: 'win' | 'lose'; message: string } | null>(null);
  const [newHighScore, setNewHighScore] = useState(false);
  const [restartConfirmationVisible, setRestartConfirmationVisible] = useState(false);
  const [homeConfirmationVisible, setHomeConfirmationVisible] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideSlideIndex, setGuideSlideIndex] = useState(0);
  
  const [firstMoveActive, setFirstMoveActive] = useState(false);
  const [firstMovePlacements, setFirstMovePlacements] = useState<{ row: number; col: number; colorIndex: number }[]>([]);
  
  const tourRef = useRef<any>(null);

  const [multiplayerMatch, setMultiplayerMatch] = useState<Match | null>(null);
  const [opponentScore, setOpponentScore] = useState<number | null>(null);
  const [opponentName, setOpponentName] = useState<string>('Opponent');
  const [opponentAvatar, setOpponentAvatar] = useState<string | null>(null);
  const [multiplayerTimeLimit, setMultiplayerTimeLimit] = useState<number | null>(null);
  const [multiplayerJoinedAt, setMultiplayerJoinedAt] = useState<number | null>(null);
  const [multiplayerFirstMoveAt, setMultiplayerFirstMoveAt] = useState<number | null>(null);
  const [firstMoveCountdown, setFirstMoveCountdown] = useState<number | null>(null);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const multiplayerInitDone = useRef(false);

  const scoreBoxRef = useRef<View | null>(null);
  const hintsBoxRef = useRef<View | null>(null);
  const timerBoxRef = useRef<View | null>(null);
  const blocksBoxRef = useRef<View | null>(null);
  const playBtnRef = useRef<View | null>(null);
  const pauseBtnRef = useRef<View | null>(null);
  const settingsBtnRef = useRef<View | null>(null);
  const controlsRowRef = useRef<View | null>(null);

  // ✅ Local state sync with context
  const [darkModeEnabled, setDarkModeEnabled] = useState(theme === 'dark');
  const [userName, setUserName] = useState('User');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [pickTargetCell, setPickTargetCell] = useState<{ row: number; col: number } | null>(null);
  const [pickSelectedColor, setPickSelectedColor] = useState<number | null>(null);
  const noHintsAnim = useRef(new Animated.Value(0)).current;

  const triggerHaptic = useCallback((kind: 'pickup' | 'drop' | 'error' | 'success') => {
    if (!hapticsEnabled) return;
    try {
      if (kind === 'error') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (kind === 'success') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      return;
    }
  }, [hapticsEnabled]);

  const markTourSeen = useCallback(() => {
    void AsyncStorage.setItem(GAME_TUTORIAL_SEEN_KEY, '1');
  }, []);

  const openGuide = useCallback(() => {
    setGuideSlideIndex(0);
    setGuideVisible(true);
  }, []);

  const skipGuide = useCallback(() => {
    void AsyncStorage.setItem(VIDEO_GUIDE_SEEN_KEY, '1');
    setGuideVisible(false);
  }, []);

  const doneGuide = useCallback(() => {
    void AsyncStorage.setItem(VIDEO_GUIDE_SEEN_KEY, '1');
    setGuideVisible(false);
  }, []);

  const nextGuide = useCallback(() => {
    setGuideSlideIndex((i) => {
      if (i >= GUIDE_SLIDES.length - 1) {
        doneGuide();
        return i;
      }
      return i + 1;
    });
  }, [doneGuide]);

  const backGuide = useCallback(() => {
    setGuideSlideIndex((i) => Math.max(0, i - 1));
  }, []);

  const flashNoHintsFace = useCallback(() => {
    noHintsAnim.stopAnimation();
    noHintsAnim.setValue(0);
    Animated.sequence([
      Animated.timing(noHintsAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1000),
      Animated.timing(noHintsAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [noHintsAnim]);

  const tourSteps = useMemo<TourStep[]>(() => {
    const stepsCount = 6;

    const step = (cfg: { title: string; description: string }): TourStep => {
      return {
        arrow: false,
        shape: { type: 'rectangle', padding: 10 },
        render: ({ current, isFirst, isLast, next, previous, stop }) => (
          <TourCard
            title={cfg.title}
            description={cfg.description}
            stepIndex={current}
            stepsCount={stepsCount}
            isDark={theme === 'dark'}
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
        title: 'Score',
        description: 'Your score increases when you create odd-length palindromes with at least two colors.',
      }),
      step({
        title: 'Timer',
        description: 'The timer starts with your first move. Use it to track your pace.',
      }),
      step({
        title: 'Hints',
        description: 'Use hints to highlight a strong move on the board when you get stuck.',
      }),
      step({
        title: 'Blocks',
        description: 'Drag a colored block from here onto an empty cell.',
      }),
      step({
        title: 'Game Board',
        description: 'Place blocks to form multi-color palindromes in a row or column. Only 3, 5, 7, ... count.',
      }),
      step({
        title: 'Controls',
        description: 'Play resumes, Pause stops the timer, Settings manages preferences.',
      }),
    ];
  }, [colors.accent, theme]);

  useEffect(() => {
    if (matchId) {
      setGuideVisible(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const guideSeen = await AsyncStorage.getItem(VIDEO_GUIDE_SEEN_KEY);
        if (guideSeen === '1') return;
        if (cancelled) return;
        timer = setTimeout(() => {
          setGuideSlideIndex(0);
          setGuideVisible(true);
        }, 600);
      } catch {
        return;
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [matchId]);

  // Game Logic State
  const gridSize = 11;
  const [gridState, setGridState] = useState<(number | null)[][]>(
    Array.from({ length: gridSize }, () => Array(gridSize).fill(null))
  );
  const [blockCounts, setBlockCounts] = useState<number[]>([16, 16, 16, 16, 16]);
  const [activeHint, setActiveHint] = useState<{ row: number; col: number; colorIndex: number } | null>(null);
  const [feedback, setFeedback] = useState<{ text: string, color: string, id: number } | null>(null);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null);
  const [, setDraggedColor] = useState<number | null>(null);
  const [wrongForcedTries, setWrongForcedTries] = useState(0);

  const [scoredCells, setScoredCells] = useState<string[]>([]);
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const scoringInProgressRef = useRef(false);
  const scoredCellsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scoredCellsTimerRef.current) {
        clearTimeout(scoredCellsTimerRef.current);
        scoredCellsTimerRef.current = null;
      }
    };
  }, []);

  const [boardLayout, setBoardLayout] = useState<BoardLayout | null>(null);
  const boardRef = useRef<View | null>(null);
  const gridStateRef = useRef(gridState);
  const blockCountsRef = useRef(blockCounts);
  const hintsRef = useRef(hints);
  const wrongForcedTriesRef = useRef(wrongForcedTries);
  const scoreRef = useRef(score);
  const secondsElapsedRef = useRef(secondsElapsed);
  const singlePlayerSavedRef = useRef(false);
  const multiplayerFirstMoveAtRef = useRef<number | null>(null);
  const raceFinalizePendingRef = useRef<{ score: number } | null>(null);
  const pendingMatchResultRef = useRef<{ matchId: string; returnTo?: string } | null>(null);
  const racePausedMsRef = useRef(0);
  const racePauseStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    gridStateRef.current = gridState;
  }, [gridState]);

  useEffect(() => {
    blockCountsRef.current = blockCounts;
  }, [blockCounts]);

  useEffect(() => {
    hintsRef.current = hints;
  }, [hints]);

  useEffect(() => {
    wrongForcedTriesRef.current = wrongForcedTries;
  }, [wrongForcedTries]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    secondsElapsedRef.current = secondsElapsed;
  }, [secondsElapsed]);

  useEffect(() => {
    setPickTargetCell(null);
    setPickSelectedColor(null);
    setDragOverCell(null);
    setDraggedColor(null);
  }, [interactionMode]);

  const measureBoardLayout = useCallback((): Promise<BoardLayout | null> => {
    return new Promise((resolve) => {
      const node = boardRef.current as any;
      if (!node?.measureInWindow) {
        resolve(null);
        return;
      }
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        resolve({ x, y, width, height });
      });
    });
  }, []);

  const center = Math.floor(gridSize / 2);
  const word = 'PALINDROME®';
  const halfWord = Math.floor(word.length / 2);

  const initializeGame = useCallback(() => {
    const initialState = createSinglePlayerInitialState();
    setGridState(initialState.grid.map((r) => [...r]));
    setBlockCounts([...initialState.blockCounts]);
    setBulldogPositions([...initialState.bulldogPositions]);
    setFirstMovePlacements([]);
    setFirstMoveActive(true);

    setScore(0);
    setHints(2);
    setTime('00:00');
    setSecondsElapsed(0);
    setIsTimerRunning(false);
    setPause(false);
    setGameOver(null);
    setNewHighScore(false);
    setFeedback(null);
    setDragOverCell(null);
    setActiveHint(null);
    setWrongForcedTries(0);
    wrongForcedTriesRef.current = 0;
    singlePlayerSavedRef.current = false;
    setScoredCells([]);
    scoringInProgressRef.current = false;
    setScoringInProgress(false);
    racePausedMsRef.current = 0;
    racePauseStartedAtRef.current = null;
    if (scoredCellsTimerRef.current) {
      clearTimeout(scoredCellsTimerRef.current);
      scoredCellsTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (matchId) return;
    initializeGame();
  }, [initializeGame, matchId]);

  const persistSinglePlayerRun = useCallback(async () => {
    if (matchId) return;
    if (singlePlayerSavedRef.current) return;
    const finalScore = scoreRef.current;
    const finalTimeSeconds = secondsElapsedRef.current;
    if (finalScore <= 0 && finalTimeSeconds <= 0) return;
    try {
      const user = await authService.getSessionUser();
      if (!user) return;
      singlePlayerSavedRef.current = true;
      const previousBest = await getMyBestSinglePlayer(user.id);
      setNewHighScore(!!previousBest && finalScore > previousBest.best_score);
      await saveSinglePlayerRun(user.id, finalScore, finalTimeSeconds);
    } catch (e) {
      singlePlayerSavedRef.current = false;
      console.error('Failed to save single-player run:', e);
    }
  }, [matchId]);

  useEffect(() => {
    if (matchId) return;
    if (!gameOver) return;
    setIsTimerRunning(false);
    setPause(false);
    void persistSinglePlayerRun();
  }, [gameOver, matchId, persistSinglePlayerRun]);

  useEffect(() => {
    if (!matchId || multiplayerInitDone.current) return;
    let cancelled = false;
    (async () => {
      const m = await getMatch(matchId);
      if (cancelled || !m) return;
      multiplayerInitDone.current = true;
      setMultiplayerMatch(m);
      setMultiplayerTimeLimit(m.time_limit_seconds);
      setMultiplayerJoinedAt(Date.now());
      const initialState = createInitialState(m.seed);
      setGridState(initialState.grid.map(r => [...r]));
      setBlockCounts([...initialState.blockCounts]);
      setBulldogPositions([...initialState.bulldogPositions]);
      setScore(initialState.score);
      scoreRef.current = initialState.score;
      setFirstMoveActive(false);
      setFirstMovePlacements([]);
      racePausedMsRef.current = 0;
      racePauseStartedAtRef.current = null;
      const user = await authService.getSessionUser();
      const other = (m.match_players ?? []).find((p: MatchPlayer) => p.user_id !== user?.id);
      if (other) {
        setOpponentScore(other.score ?? 0);
        const profile = await authService.getProfile(other.user_id);
        if (profile?.full_name) setOpponentName(profile.full_name);
        if (profile?.avatar_url) setOpponentAvatar(profile.avatar_url);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeToMatch(matchId, (m) => {
      setMultiplayerMatch(m);
      const me = authService.getSessionUser();
      void me.then(async (user) => {
        const other = (m.match_players ?? []).find((p: MatchPlayer) => p.user_id !== user?.id);
        if (other) {
          setOpponentScore(other.score ?? 0);
          const profile = await authService.getProfile(other.user_id);
          if (profile?.full_name) setOpponentName(profile.full_name);
          if (profile?.avatar_url) setOpponentAvatar(profile.avatar_url);
          if (m.status === 'finished') {
            const nextResult = { matchId: m.id, ...(returnTo ? { returnTo } : {}) };
            if (scoringInProgressRef.current) {
              pendingMatchResultRef.current = nextResult;
            } else {
              router.replace({ pathname: '/matchresult' as any, params: nextResult });
            }
          }
        }
      });
    });
    return unsub;
  }, [matchId, returnTo]);

  // Timer useEffect (single player: count up)
  useEffect(() => {
    if (matchId) return;
    let interval: any;
    if (isTimerRunning && !pause && !scoringInProgress) {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => {
          const next = prev + 1;
          const mins = Math.floor(next / 60).toString().padStart(2, "0");
          const secs = (next % 60).toString().padStart(2, "0");
          setTime(`${mins}:${secs}`);
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [matchId, isTimerRunning, pause, scoringInProgress]);

  const submitRaceScoreWhenReady = useCallback((finalScore: number) => {
    if (!matchId) return;
    if (scoreSubmitted && !raceFinalizePendingRef.current) return;
    raceFinalizePendingRef.current = { score: finalScore };
    if (scoringInProgressRef.current) return;

    const pending = raceFinalizePendingRef.current;
    raceFinalizePendingRef.current = null;
    setScoreSubmitted(true);
    authService.getSessionUser().then((user) => {
      if (user) submitScore(matchId, user.id, pending.score);
    });
  }, [matchId, scoreSubmitted]);

  const flushDeferredRaceCompletion = useCallback(() => {
    const pendingScore = raceFinalizePendingRef.current;
    if (pendingScore && matchId) {
      raceFinalizePendingRef.current = null;
      setScoreSubmitted(true);
      authService.getSessionUser().then((user) => {
        if (user) submitScore(matchId, user.id, pendingScore.score);
      });
    }

    const pendingResult = pendingMatchResultRef.current;
    if (pendingResult) {
      pendingMatchResultRef.current = null;
      router.replace({ pathname: '/matchresult' as any, params: { matchId: pendingResult.matchId, ...(pendingResult.returnTo ? { returnTo: pendingResult.returnTo } : {}) } });
    }
  }, [matchId]);

  // Multiplayer: first move countdown (15 sec) - forfeit if no move
  useEffect(() => {
    if (!matchId || !multiplayerJoinedAt || multiplayerFirstMoveAt != null || scoreSubmitted) return;
    const joinedAt = multiplayerJoinedAt;
    const firstMoveDeadline = joinedAt + FIRST_MOVE_TIMEOUT_SECONDS * 1000;

    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((firstMoveDeadline - now) / 1000));
      setFirstMoveCountdown(remaining);
      setTime(`0:${remaining.toString().padStart(2, '0')}`);
      if (remaining <= 0) {
        submitRaceScoreWhenReady(0);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [matchId, multiplayerJoinedAt, multiplayerFirstMoveAt, scoreSubmitted, submitRaceScoreWhenReady]);

  // Multiplayer: 5 min game timer - starts on first move
  useEffect(() => {
    if (!matchId || multiplayerFirstMoveAt == null || multiplayerTimeLimit == null || scoreSubmitted) return;
    const endAt = multiplayerFirstMoveAt + multiplayerTimeLimit * 1000;

    const tick = () => {
      if (scoringInProgressRef.current) return;
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((endAt + racePausedMsRef.current - now) / 1000));
      const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
      const secs = (remaining % 60).toString().padStart(2, '0');
      setTime(`${mins}:${secs}`);
      if (remaining <= 0) {
        submitRaceScoreWhenReady(scoreRef.current);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [matchId, multiplayerFirstMoveAt, multiplayerTimeLimit, scoreSubmitted, submitRaceScoreWhenReady]);

  // Fetch/Refresh user profile
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const user = await authService.getSessionUser();
        if (user) {
          // Try to load from cache first
          const cached = await authService.getCachedProfile(user.id);
          if (cached) {
            setUserName(cached.full_name || user.email?.split('@')[0] || 'User');
            setProfileImage(cached.avatar_url);
          }

          // Fetch fresh profile data
          const profile = await authService.getProfile(user.id);
          if (profile) {
            setUserName(profile.full_name || user.email?.split('@')[0] || 'User');
            setProfileImage(profile.avatar_url);
          }
        }
      } catch (error) {
        console.error('Error fetching profile in game settings:', error);
      }
    };

    if (settingsVisible) {
      fetchProfile();
    }
    // Initial fetch on mount as well
    fetchProfile();
  }, [settingsVisible]);

  const checkAndProcessPalindromes = (
    anchors: { row: number; col: number }[],
    currentGrid: (number | null)[][],
    dryRun = false,
    minLength = 3,
    previousGrid?: (number | null)[][]
  ) => {
    const { score: scoreFound, events } = scoreNewPalindromes(
      anchors,
      currentGrid,
      bulldogPositions,
      minLength,
      previousGrid
    );

    if (scoreFound > 0 && !dryRun) {
      triggerHaptic('success');
      playSuccessSound();

      if (!palindromeAnimationsEnabled) {
        flushDeferredRaceCompletion();
        return scoreFound;
      }

      let feedbackText = "GOOD!";
      let feedbackColor = "#4ADE80";
      const topEvent = events[0];
      if (topEvent?.segmentLength === 5) {
        feedbackText = "GREAT!";
        feedbackColor = "#60A5FA";
      } else if (topEvent?.segmentLength === 7) {
        feedbackText = "AMAZING!";
        feedbackColor = "#A78BFA";
      } else if ((topEvent?.segmentLength ?? 0) >= 9) {
        feedbackText = "LEGENDARY!";
        feedbackColor = "#F472B6";
      }

      setFeedback({ text: feedbackText, color: feedbackColor, id: Date.now() });
      setTimeout(() => setFeedback(null), 2000);

      scoringInProgressRef.current = true;
      if (matchId && racePauseStartedAtRef.current == null) {
        racePauseStartedAtRef.current = Date.now();
      }
      setScoringInProgress(true);

      const keys = events[0]?.segment.map((tile) => `${tile.r},${tile.c}`) ?? [];
      setScoredCells(keys.length ? keys : [...new Set(events.flatMap((event) => event.segment.map((tile) => `${tile.r},${tile.c}`)))]);
      if (scoredCellsTimerRef.current) clearTimeout(scoredCellsTimerRef.current);
      scoredCellsTimerRef.current = setTimeout(() => {
        setScoredCells([]);
        scoredCellsTimerRef.current = null;
        scoringInProgressRef.current = false;
        if (matchId && racePauseStartedAtRef.current != null) {
          racePausedMsRef.current += Date.now() - racePauseStartedAtRef.current;
          racePauseStartedAtRef.current = null;
        }
        setScoringInProgress(false);
        flushDeferredRaceCompletion();
      }, 2000);
    }

    return scoreFound;
  };

  const findFirstScoringMove = (minLength: number) => {
    const colorGradientsCount = 5;
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (gridStateRef.current[r][c] !== null) continue;
        for (let colorIdx = 0; colorIdx < colorGradientsCount; colorIdx++) {
          if (blockCountsRef.current[colorIdx] <= 0) continue;
          const tempGrid = gridStateRef.current.map((rowArr) => [...rowArr]);
          tempGrid[r][c] = colorIdx;
          const sc = checkAndProcessPalindromes([{ row: r, col: c }], tempGrid, true, minLength, gridStateRef.current);
          if (sc > 0) {
            return { row: r, col: c, colorIndex: colorIdx };
          }
        }
      }
    }
    return null;
  };

  const findHint = () => {
    if (hintsRef.current <= 0) return;
    const minLen = !matchId && firstMoveActive ? 5 : 3;
    const move = findFirstScoringMove(minLen);
    if (move) {
      setHints((prev) => prev - 1);
      setActiveHint(move);
      setTimeout(() => setActiveHint(null), 3000);
      return;
    }
    playErrorSound();
    triggerHaptic('error');
  };

  const handleDrop = (row: number, col: number, colorIndex: number) => {
    setDragOverCell(null);
    setDraggedColor(null);

    if (gameOver || pause || settingsVisible || scoringInProgressRef.current) {
      return false;
    }

    if (gridStateRef.current[row][col] !== null) {
      playErrorSound();
      triggerHaptic('error');
      return false;
    }

    if (blockCountsRef.current[colorIndex] <= 0) {
      playErrorSound();
      triggerHaptic('error');
      return false;
    }

    let scoreFound = 0;
    let newScore = scoreRef.current;
    let nextBlockCounts = [...blockCountsRef.current];
    let newGrid = gridStateRef.current.map((r) => [...r]);

    if (!matchId && firstMoveActive) {
      const nextPlacements = [...firstMovePlacements, { row, col, colorIndex }];
      newGrid[row][col] = colorIndex;
      nextBlockCounts[colorIndex] = Math.max(0, nextBlockCounts[colorIndex] - 1);

      setGridState(newGrid);
      setBlockCounts(nextBlockCounts);
      setFirstMovePlacements(nextPlacements);

      playDropSound();
      triggerHaptic('drop');

      if (nextPlacements.length < 2) {
        return true;
      }

      const a = nextPlacements[0];
      const b = nextPlacements[1];
      const attemptedScore = checkAndProcessPalindromes(
        [
          { row: a.row, col: a.col },
          { row: b.row, col: b.col },
        ],
        newGrid,
        true,
        5
      );

      if (attemptedScore <= 0) {
        const revertedGrid = newGrid.map((r) => [...r]);
        const revertedCounts = [...nextBlockCounts];
        for (const p of nextPlacements) {
          revertedGrid[p.row][p.col] = null;
          revertedCounts[p.colorIndex] = revertedCounts[p.colorIndex] + 1;
        }
        setGridState(revertedGrid);
        setBlockCounts(revertedCounts);
        setFirstMovePlacements([]);

        const nextWrongTries = wrongForcedTriesRef.current + 1;
        const nextValue = nextWrongTries >= 3 ? 0 : nextWrongTries;
        wrongForcedTriesRef.current = nextValue;
        setWrongForcedTries(nextValue);

        playErrorSound();
        triggerHaptic('error');

        if (nextWrongTries >= 3) {
          if (hintsRef.current > 0) {
            const hintMove = findFirstScoringMove(5);
            if (hintMove) {
              setHints((prev) => Math.max(0, prev - 1));
              setActiveHint(hintMove);
              setTimeout(() => setActiveHint(null), 3000);
            } else {
              flashNoHintsFace();
            }
          } else {
            flashNoHintsFace();
          }
        }
        return false;
      }

      scoreFound = checkAndProcessPalindromes(
        [
          { row: a.row, col: a.col },
          { row: b.row, col: b.col },
        ],
        newGrid,
        false,
        5
      );

      setScore((prev) => prev + scoreFound);
      newScore = scoreRef.current + scoreFound;
      scoreRef.current = newScore;
      setFirstMoveActive(false);
      setFirstMovePlacements([]);
    } else {
      const hadAnyScoringMoveBefore = !matchId ? !!findFirstScoringMove(3) : true;
      newGrid[row][col] = colorIndex;
      const attemptedScore = checkAndProcessPalindromes([{ row, col }], newGrid, true, 3, gridStateRef.current);

      if (attemptedScore <= 0) {
        if (!matchId && !hadAnyScoringMoveBefore) {
          nextBlockCounts[colorIndex] = Math.max(0, nextBlockCounts[colorIndex] - 1);
          setGridState(newGrid);
          setBlockCounts(nextBlockCounts);
          playDropSound();
          triggerHaptic('drop');
        } else {
          const nextWrongTries = wrongForcedTriesRef.current + 1;
          const nextValue = nextWrongTries >= 3 ? 0 : nextWrongTries;
          wrongForcedTriesRef.current = nextValue;
          setWrongForcedTries(nextValue);

          playErrorSound();
          triggerHaptic('error');

          if (nextWrongTries >= 3) {
            if (hintsRef.current > 0) {
              const hintMove = findFirstScoringMove(3);
              if (hintMove) {
                setHints((prev) => Math.max(0, prev - 1));
                setActiveHint(hintMove);
                setTimeout(() => setActiveHint(null), 3000);
              } else {
                flashNoHintsFace();
              }
            } else {
              flashNoHintsFace();
            }
          }
          return false;
        }
      } else {
        nextBlockCounts[colorIndex] = Math.max(0, nextBlockCounts[colorIndex] - 1);
        setGridState(newGrid);
        setBlockCounts(nextBlockCounts);

        playDropSound();
        triggerHaptic('drop');

        scoreFound = checkAndProcessPalindromes([{ row, col }], newGrid, false, 3, gridStateRef.current);
        setScore((prev) => prev + scoreFound);
        newScore = scoreRef.current + scoreFound;
        scoreRef.current = newScore;
      }
    }
    
    if (matchId && scoreFound > 0 && !scoreSubmitted) {
      authService.getSessionUser().then((user) => {
        if (user) void updateLiveScore(matchId, user.id, newScore);
      });
    }
    if (wrongForcedTriesRef.current !== 0) {
      wrongForcedTriesRef.current = 0;
      setWrongForcedTries(0);
    }
    if (matchId && multiplayerFirstMoveAtRef.current == null) {
      multiplayerFirstMoveAtRef.current = Date.now();
      setMultiplayerFirstMoveAt(Date.now());
      setFirstMoveCountdown(null);
    }
    if (matchId && nextBlockCounts.every((c) => c === 0) && !scoreSubmitted) {
      submitRaceScoreWhenReady(newScore);
    }
    if (!matchId) {
      if (nextBlockCounts.every((c) => c === 0)) {
        setIsTimerRunning(false);
        setPause(false);
        setGameOver({ status: 'win', message: 'All counters used.' });
      } else if (newGrid.every((r) => r.every((cell) => cell !== null))) {
        setIsTimerRunning(false);
        setPause(false);
        setGameOver({ status: 'lose', message: 'Board is full.' });
      }
    }
    return true;
  };

  const handlePickColor = (colorIndex: number) => {
    if (interactionMode !== 'pick') return;
    if (!pickTargetCell) {
      playErrorSound();
      triggerHaptic('error');
      return;
    }

    setPickSelectedColor(colorIndex);
    playPickupSound();
    triggerHaptic('pickup');
    if (!isTimerRunning) setIsTimerRunning(true);

    const didPlace = handleDrop(pickTargetCell.row, pickTargetCell.col, colorIndex);
    if (didPlace) {
      setPickTargetCell(null);
    }
    setTimeout(() => setPickSelectedColor(null), 150);
  };


  const grid = Array.from({ length: gridSize }, (_, row) => (
    <View key={row} style={styles.row}>
      {Array.from({ length: gridSize }, (_, col) => {
        const isBulldog = bulldogPositions.some(pos => pos.row === row && pos.col === col);
        let letter: string | null = null;
        if (row === center && col >= center - halfWord && col < center - halfWord + word.length) {
          letter = word[col - (center - halfWord)];
        }
        if (col === center && row >= center - halfWord && row < center - halfWord + word.length) {
          letter = word[row - (center - halfWord)];
        }

        return (
          <Pressable
            key={col}
            style={[
              styles.cell,
              {
                backgroundColor:
                  theme === 'dark' ? 'rgba(25,25,91,0.7)' : '#FFFFFF',
                borderColor: theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#CCDAE466',
              },
              (dragOverCell?.row === row && dragOverCell?.col === col) && {
                backgroundColor: theme === 'dark' ? 'rgba(100, 200, 255, 0.4)' : 'rgba(100, 200, 255, 0.3)',
                borderColor: '#4A9EFF',
                borderWidth: 2,
              }
              ,
              (interactionMode === 'pick' && pickTargetCell?.row === row && pickTargetCell?.col === col) && {
                backgroundColor: theme === 'dark' ? 'rgba(100, 200, 255, 0.25)' : 'rgba(100, 200, 255, 0.18)',
                borderColor: '#4A9EFF',
                borderWidth: 2,
              },
              (activeHint?.row === row && activeHint?.col === col) && {
                backgroundColor: theme === 'dark' ? 'rgba(100, 200, 255, 0.4)' : 'rgba(100, 200, 255, 0.3)',
                borderColor: '#FFD700',
                borderWidth: 2,
                shadowColor: '#FFD700',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.8,
                shadowRadius: 10,
                elevation: 3,
              },
              scoredCells.includes(`${row},${col}`) && {
                borderColor: '#FACC15',
                borderWidth: 2,
                shadowColor: '#FACC15',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 10,
                elevation: 4,
              },
            ]}
            onPress={() => {
              if (interactionMode === 'pick') {
                if (gridStateRef.current[row][col] !== null) {
                  playErrorSound();
                  triggerHaptic('error');
                  return;
                }
                setPickTargetCell((prev) => {
                  if (prev?.row === row && prev?.col === col) return null;
                  return { row, col };
                });
                triggerHaptic('pickup');
                return;
              }
            }}
          >
            {gridState[row][col] !== null && (
              <LinearGradient
                colors={colorGradients[gridState[row][col]!]}
                style={StyleSheet.absoluteFill}
              />
            )}
            {activeHint?.row === row && activeHint?.col === col && (
              <LinearGradient
                colors={colorGradients[activeHint.colorIndex]}
                style={[StyleSheet.absoluteFill, { opacity: 0.6 }]}
              />
            )}
            {activeHint?.row === row && activeHint?.col === col && colorBlindEnabled && (
              <View pointerEvents="none" style={styles.colorBlindTokenOverlay}>
                <Text style={styles.colorBlindTokenText}>
                  {getColorBlindToken(colorBlindMode, activeHint.colorIndex)}
                </Text>
              </View>
            )}
            {gridState[row][col] !== null && colorBlindEnabled && !letter && (
              <View pointerEvents="none" style={styles.colorBlindTokenOverlay}>
                <Text style={styles.colorBlindTokenText}>
                  {getColorBlindToken(colorBlindMode, gridState[row][col]!)}
                </Text>
              </View>
            )}
            {gridState[row][col] !== null && colorBlindEnabled && letter && (
              <Text style={styles.colorBlindTokenCorner}>
                {getColorBlindToken(colorBlindMode, gridState[row][col]!)}
              </Text>
            )}
            {isBulldog && (
              <Image
                source={require('../../assets/images/bulldog.png')}
                style={styles.bulldogImage}
                resizeMode="contain"
              />
            )}
            {letter && (
              <Text
                style={[
                  styles.letterText,
                  { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                ]}
              >
                {letter}
              </Text>
            )}
            <View style={styles.innerShadow} />
          </Pressable>
        );
      })}
    </View>
  ));

  const blocks = colorGradients.map((gradient, index) => (
    interactionMode === 'pick' ? (
      <PaletteBlock
        key={index}
        index={index}
        gradient={gradient}
        blockCount={blockCounts[index]}
        selected={pickSelectedColor === index}
        onPress={() => handlePickColor(index)}
      />
    ) : (
      <DraggableBlock
        key={index}
        index={index}
        gradient={gradient}
        blockCount={blockCounts[index]}
        boardLayout={boardLayout}
        measureBoardLayout={measureBoardLayout}
        gridSize={gridSize}
        onDrop={handleDrop}
        onPickup={() => {
          playPickupSound();
          triggerHaptic('pickup');
          setDraggedColor(index);
          if (!isTimerRunning) setIsTimerRunning(true);
        }}
        onDragUpdate={(row: number | null, col: number | null) => {
          setDragOverCell((prev) => {
            if (row === null || col === null) return prev ? null : prev;
            const isEmpty = gridStateRef.current[row]?.[col] === null;
            if (!isEmpty) return prev ? null : prev;
            if (prev?.row === row && prev?.col === col) return prev;
            return { row, col };
          });
        }}
      />
    )
  ));

  return (
    <GameSpotlightTourProvider
      ref={tourRef}
      steps={tourSteps}
      overlayColor={'#000000'}
      overlayOpacity={0.72}
      arrow={false}
      shape={{ type: 'rectangle', padding: 10 }}
      onBackdropPress={() => {}}
      onStop={(_values: TourState) => markTourSeen()}
    >
    {(tour: any) => (
      <>
        <GameTourSpotSync
          tour={tour}
          topInset={insets.top}
          scoreBoxRef={scoreBoxRef}
          timerBoxRef={timerBoxRef}
          hintsBoxRef={hintsBoxRef}
          blocksBoxRef={blocksBoxRef}
          boardRef={boardRef}
          controlsRowRef={controlsRowRef}
        />
        <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={
          theme === 'dark'
            ? ['rgba(0, 0, 23, 1)', 'rgba(0, 0, 116, 1)'] // dark mode colors
            : ['#FFFFFF', '#FFFFFF'] // light mode colors
        }
        style={styles.background}
      />
      <Text style={[styles.title, { color: theme === 'dark' ? '#FFFFFF' : '#0060FF' }]}>
        PALINDROME®
      </Text>

      {matchId && scoreSubmitted && multiplayerMatch?.status !== 'finished' ? (
        <View style={styles.waitingOverlay}>
          <View style={[styles.waitingOverlayCard, { backgroundColor: theme === 'dark' ? 'rgba(25,25,91,0.95)' : 'rgba(255,255,255,0.95)' }]}>
            <Text style={[styles.waitingOverlayTitle, { color: theme === 'dark' ? '#FFFFFF' : '#111111' }]}>Game over!</Text>
            <Text style={[styles.waitingOverlaySubtitle, { color: theme === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(17,17,17,0.7)' }]}>
              Waiting for opponent to finish...
            </Text>
            <Text style={[styles.waitingOverlayScore, { color: colors.accent }]}>Your score: {score}</Text>
          </View>
        </View>
      ) : null}
      {matchId ? (
        <View
          style={[
            styles.opponentBar,
            {
              backgroundColor: theme === 'dark' ? 'rgba(25,25,91,0.5)' : 'rgba(229,236,241,0.6)',
              borderColor: theme === 'dark' ? 'rgba(255,255,255,0.15)' : '#C7D5DF',
            },
          ]}
        >
          <Image
            source={opponentAvatar ? { uri: opponentAvatar } : require('../../assets/images/profile_ph.png')}
            style={styles.opponentAvatar}
          />
          <View style={styles.opponentBarText}>
            <Text style={[styles.opponentLabel, { color: theme === 'dark' ? 'rgba(255,255,255,0.8)' : '#4C575F' }]}>
              {opponentName}
            </Text>
            <Text style={[styles.opponentScore, { color: theme === 'dark' ? '#FFFFFF' : '#0060FF' }]}>
              {opponentScore ?? '—'}
            </Text>
          </View>
        </View>
      ) : null}

      <View
        ref={scoreBoxRef}
        collapsable={false}
        style={[
          styles.rectangleLeft,
          {
            backgroundColor:
              theme === 'dark' ? 'rgba(25,25,91,0.7)' : 'rgba(229,236,241,0.5)',
            borderColor: theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#C7D5DF',
          },
        ]}
      >
        <Text style={[styles.rectangleLabel, { color: theme === 'dark' ? '#FFFFFF' : '#4C575F' }]}>
          Score
        </Text>
        <Text
          style={[
            styles.rectangleValue,
            { color: theme === 'dark' ? '#FFFFFF' : '#0060FF' },
          ]}
        >
          {score}
        </Text>
      </View>

      <Pressable
        ref={hintsBoxRef as any}
        collapsable={false}
        onPress={findHint}
        style={[
          styles.rectangleRight,
          {
            backgroundColor:
              theme === 'dark' ? 'rgba(25,25,91,0.7)' : 'rgba(229,236,241,0.5)',
            borderColor: theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#C7D5DF',
          },
        ]}
      >
        <Text style={[styles.rectangleLabel, { color: theme === 'dark' ? '#FFFFFF' : '#4C575F' }]}>
          Hints
        </Text>
        <View style={{ position: 'relative', height: 28, justifyContent: 'center', alignItems: 'center' }}>
          <Animated.Text
            style={[
              styles.rectangleValue,
              {
                color: '#C35DD9',
                position: 'absolute',
                opacity: noHintsAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                transform: [{ scale: noHintsAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }) }],
              },
            ]}
          >
            {hints}
          </Animated.Text>
          <Animated.Text
            style={[
              styles.rectangleValue,
              {
                color: '#C35DD9',
                position: 'absolute',
                opacity: noHintsAnim,
                transform: [{ scale: noHintsAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }],
              },
            ]}
          >
            (¬_¬)
          </Animated.Text>
        </View>
      </Pressable>

      {matchId && firstMoveCountdown != null ? (
        <View style={[styles.firstMoveBanner, { backgroundColor: firstMoveCountdown <= 5 ? (theme === 'dark' ? 'rgba(220,38,38,0.9)' : 'rgba(239,68,68,0.9)') : (theme === 'dark' ? 'rgba(34,197,94,0.9)' : 'rgba(34,197,94,0.9)') }]}>
          <Text style={styles.firstMoveBannerText}>
            Make your first move! {firstMoveCountdown}s
          </Text>
        </View>
      ) : null}
      <View ref={timerBoxRef} collapsable={false} style={styles.timerContainer}>
        <Svg height="40" width="300">
          <Defs>
            <SvgLinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#95DEFE" stopOpacity="1" />
              <Stop offset="1" stopColor="#419EEF" stopOpacity="1" />
            </SvgLinearGradient>
          </Defs>
          <SvgText
            fill="url(#grad)"
            fontSize="24"
            fontWeight="bold"
            x="50%"
            y="60%"
            textAnchor="middle"
          >
            {time}
          </SvgText>
        </Svg>
      </View>

      <View
        ref={boardRef}
        collapsable={false}
        onLayout={() => {
          boardRef.current?.measureInWindow((x, y, width, height) => {
            setBoardLayout({ x, y, width, height });
          });
        }}
        style={[
          styles.board,
          { backgroundColor: theme === 'dark' ? 'rgba(25,25,91,0.7)' : '#E4EBF0' },
        ]}
      >
        {grid}
        {feedback && (
          <View pointerEvents="none" style={styles.feedbackContainer}>
            <Text style={[styles.feedbackText, { color: feedback.color }]}>
              {feedback.text}
            </Text>
          </View>
        )}
      </View>

      <View
        ref={blocksBoxRef}
        collapsable={false}
        style={[
          styles.colorBlocksContainer,
          { backgroundColor: theme === 'dark' ? 'rgba(25,25,91,0.7)' : '#E4EBF0' },
        ]}
      >
        <View style={styles.colorBlocksRow}>{blocks}</View>
      </View>

      <View ref={controlsRowRef} collapsable={false} style={styles.controlsRow}>
        <Pressable
          ref={playBtnRef as any}
          collapsable={false}
          onPress={() => {
            if (pause) setPause(false);
            if (!isTimerRunning) setIsTimerRunning(true);
          }}
        >
          <LinearGradient colors={['#8ed9fc', '#3c8dea']} style={styles.gradientButton}>
            <Ionicons name="play" size={20} color="#1a63cc" />
          </LinearGradient>
        </Pressable>

        <Pressable ref={pauseBtnRef as any} collapsable={false} onPress={() => setPause(true)}>
          <LinearGradient colors={['#ffee60', '#ffa40b']} style={styles.gradientButton}>
            <Ionicons name="pause" size={20} color="#de5f07" />
          </LinearGradient>
        </Pressable>

        <Pressable
          collapsable={false}
          onPress={() => {
            if (matchId) return;
            setRestartConfirmationVisible(true);
          }}
          disabled={!!matchId}
          style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }, matchId && { opacity: 0.4 }]}
        >
          <LinearGradient colors={['#22c55e', '#16a34a']} style={styles.gradientButton}>
            <Ionicons name="refresh" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>

        <Pressable
          collapsable={false}
          onPress={() => setHomeConfirmationVisible(true)}
          style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
        >
          <LinearGradient colors={['#f59e0b', '#d97706']} style={styles.gradientButton}>
            <Ionicons name="home" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>

        <Pressable ref={settingsBtnRef as any} collapsable={false} onPress={() => setSettingsVisible(true)}>
          <LinearGradient colors={['#8ed9fc', '#3c8dea']} style={styles.gradientButton}>
            <Ionicons name="settings" size={20} color="#1a63cc" />
          </LinearGradient>
        </Pressable>

        <Pressable onPress={openGuide}>
          <LinearGradient colors={['#C35DD7', '#E879F9']} style={styles.gradientButton}>
            <Ionicons name="film-outline" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>

        <Pressable onPress={() => setRulesVisible(true)}>
          <LinearGradient colors={['#111111', '#3C3C3C']} style={styles.gradientButton}>
            <Ionicons name="book-outline" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>

      {/* ⚙️ Settings Modal */}
      {settingsVisible && (
        <View style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={20}
            tint={theme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.settingsOverlay}>
              <LinearGradient
                colors={
                  theme === 'dark'
                    ? ['rgba(0, 0, 23, 1)', 'rgba(0, 0, 116, 1)'] // Dark gradient
                    : ['#FFFFFF', '#FFFFFF'] // Light theme pure white
                }
                style={[styles.settingsCard, { padding: 20, borderRadius: 20, height: settingsCardHeight }]}
              >
                <View style={styles.headerRow}>
                  <View style={styles.headerSpacer} />
                  <Text
                    style={[
                      styles.settingsTitle,
                      { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                    ]}
                  >
                    Settings
                  </Text>
                  <Pressable onPress={() => setSettingsVisible(false)} style={styles.closeButton}>
                    <Text style={[styles.closeIcon, { color: '#007AFF' }]}>×</Text>
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.settingsScroll}
                  contentContainerStyle={styles.settingsScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.profileSection}>
                    <Image
                      source={profileImage ? { uri: profileImage } : require('../../assets/images/profile_ph.png')}
                      style={styles.profileImage}
                    />
                    <View style={styles.profileTextContainer}>
                      <Text
                        style={[
                          styles.profileName,
                          { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                        ]}
                      >
                        {userName}
                      </Text>
                      <Pressable
                        onPress={() => {
                          setSettingsVisible(false);
                          setTimeout(() => router.push('/profile'), 50);
                        }}
                      >
                        <Text style={styles.profileLink}>Edit Profile</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.optionRow}>
                    <Text
                      style={[
                        styles.optionLabel,
                        { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                      ]}
                    >
                      Sound Effects
                    </Text>
                    <Switch
                      value={soundEnabled}
                      onValueChange={setSoundEnabled}
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

                  <View style={styles.optionRow}>
                    <Text
                      style={[
                        styles.optionLabel,
                        { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                      ]}
                    >
                      Haptic Feedback
                    </Text>
                    <Switch
                      value={hapticsEnabled}
                      onValueChange={setHapticsEnabled}
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

                  <View style={styles.optionRow}>
                    <View style={{ flexDirection: 'column', flex: 1, paddingRight: 14 }}>
                      <Text
                        style={[
                          styles.optionLabel,
                          { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                        ]}
                      >
                        Palindrome Animations
                      </Text>
                      <Text style={{ fontSize: 12, marginTop: 4, color: theme === 'dark' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)' }}>
                        {palindromeAnimationsEnabled ? 'Animated scoring' : 'Instant scoring'}
                      </Text>
                    </View>
                    <Switch
                      value={palindromeAnimationsEnabled}
                      onValueChange={setPalindromeAnimationsEnabled}
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

                  <View style={styles.optionRow}>
                    <View style={{ flexDirection: 'column', flex: 1, paddingRight: 14 }}>
                      <Text
                        style={[
                          styles.optionLabel,
                          { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                        ]}
                      >
                        Interaction Mode
                      </Text>
                      <Text style={{ fontSize: 12, marginTop: 4, color: theme === 'dark' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)' }}>
                        {interactionMode === 'pick' ? 'Pick and Drop' : 'Drag and Drop'}
                      </Text>
                    </View>
                    <Switch
                      value={interactionMode === 'pick'}
                      onValueChange={(v) => setInteractionMode(v ? 'pick' : 'drag')}
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

                  <View style={styles.optionRow}>
                    <View style={{ flexDirection: 'column', flex: 1, paddingRight: 14 }}>
                      <Text
                        style={[
                          styles.optionLabel,
                          { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                        ]}
                      >
                        Color Blind Mode
                      </Text>
                      <Text style={{ fontSize: 12, marginTop: 4, color: theme === 'dark' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)' }}>
                        Preference: {colorBlindMode === 'symbols' ? 'Symbols' : colorBlindMode === 'emojis' ? 'Emojis' : colorBlindMode === 'cards' ? 'Cards' : 'Letters'}
                      </Text>
                    </View>
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

                  <View style={styles.optionRow}>
                    <Text
                      style={[
                        styles.optionLabel,
                        { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                      ]}
                    >
                      Dark Mode
                    </Text>
                    <Switch
                      value={darkModeEnabled}
                      onValueChange={() => {
                        toggleTheme();
                        setDarkModeEnabled(prev => !prev);
                      }}
                      disabled={false}
                      activeText=""
                      inActiveText=""
                      circleSize={18}
                      barHeight={22}
                      circleBorderWidth={0}
                      backgroundActive="#0060FF"
                      backgroundInactive="#E5E5E5"
                      circleActiveColor="#FFFFFF"
                      circleInActiveColor="#FFFFFF"
                      changeValueImmediately={true}
                      switchWidthMultiplier={2.5}
                    />
                  </View>

                  <Pressable style={styles.linkRow} onPress={() => router.push('/privacy' as any)}>
                    <Text
                      style={[
                        styles.linkText,
                        { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                      ]}
                    >
                      Privacy Policy
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color="#0060FF" />
                  </Pressable>

                  <Pressable style={[styles.linkRow, { borderBottomWidth: 0 }]} onPress={() => router.push('/terms' as any)}>
                    <Text
                      style={[
                        styles.linkText,
                        { color: theme === 'dark' ? '#FFFFFF' : '#000000' },
                      ]}
                    >
                      Terms & Conditions
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color="#0060FF" />
                  </Pressable>
                </ScrollView>
              </LinearGradient>
            </View>

          </BlurView>
        </View>
      )}

      {/* Pause Overlay */}
      {pause && !gameOver && (
        <View style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={20}
            tint={theme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.pauseOverlay}>
            <View style={styles.pauseCard}>
              <Text style={styles.pauseTitle}>Game Paused</Text>
              <Pressable onPress={() => setPause(false)} style={styles.resumeButton}>
                <Text style={styles.resumeButtonText}>Resume</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Game Over Modal (single-player only) */}
      {!matchId && gameOver && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <BlurView
            intensity={20}
            tint={theme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.gameOverOverlay}>
            <LinearGradient
              colors={
                theme === 'dark'
                  ? ['#000017', '#000074']
                  : ['#FFFFFF', '#FFFFFF']
              }
              style={styles.gameOverCard}
            >
              <View
                style={[
                  styles.gameOverIconCircle,
                  gameOver.status === 'win'
                    ? { backgroundColor: '#16a34a' }
                    : { backgroundColor: '#ef4444' },
                ]}
              >
                <Ionicons
                  name={gameOver.status === 'win' ? 'trophy' : 'alert'}
                  size={34}
                  color="#FFFFFF"
                />
              </View>

              <Text
                style={[
                  styles.gameOverTitle,
                  { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' },
                ]}
              >
                Game Over
              </Text>

              {newHighScore && (
                <View style={styles.newHighScoreBadge}>
                  <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                  <Text style={styles.newHighScoreText}>New High-Score</Text>
                </View>
              )}

              <Text
                style={[
                  styles.gameOverMessage,
                  { color: theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.75)' },
                ]}
              >
                {gameOver.message}
              </Text>

              <View
                style={[
                  styles.gameOverScoreChip,
                  {
                    backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                    borderColor: theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.gameOverScoreLabel,
                    { color: theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.7)' },
                  ]}
                >
                  Final score
                </Text>
                <Text style={styles.gameOverScoreValue}>{score}</Text>
              </View>

              <View style={styles.gameOverButtonRow}>
                <Pressable
                  onPress={async () => {
                    await persistSinglePlayerRun();
                    initializeGame();
                  }}
                  style={({ pressed }) => [
                    styles.gameOverPrimaryButton,
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <LinearGradient
                    colors={['#1177FE', '#48B7FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.gameOverPrimaryGradient}
                  >
                    <Text style={styles.gameOverPrimaryText}>Play again</Text>
                  </LinearGradient>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    await persistSinglePlayerRun();
                    setGameOver(null);
                    router.push('/main');
                  }}
                  style={({ pressed }) => [
                    styles.gameOverSecondaryButton,
                    {
                      backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text
                    style={[
                      styles.gameOverSecondaryText,
                      { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' },
                    ]}
                  >
                    Home
                  </Text>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </View>
      )}

      {/* Rules / How to Play Modal */}
      {rulesVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <BlurView
            intensity={20}
            tint={theme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.rulesOverlay}>
            <LinearGradient
              colors={theme === 'dark' ? ['#000017', '#000074'] : ['#FFFFFF', '#FFFFFF']}
              style={[styles.rulesCard, { maxHeight: windowHeight * 0.78 }]}
            >
              <View style={styles.rulesHeader}>
                <View style={styles.rulesHeaderLeft}>
                  <Ionicons name="book-outline" size={22} color="#0060FF" />
                  <Text style={[styles.rulesTitle, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                    How to Play
                  </Text>
                </View>
                <Pressable
                  onPress={() => setRulesVisible(false)}
                  style={[
                    styles.rulesCloseButton,
                    { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
                  ]}
                >
                  <Text style={[styles.rulesCloseIcon, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                    ×
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.rulesScroll}
                contentContainerStyle={styles.rulesScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {[
                  {
                    title: 'Goal',
                    body: 'Place blocks to form color palindromes. Use all counters.',
                  },
                  {
                    title: 'Palindrome',
                    body: 'A sequence that reads the same forwards and backwards. Only odd lengths count (3, 5, 7, ...), and all-one-color lines do not score.',
                  },
                  {
                    title: 'Valid Move',
                    body: 'Your placement must create a multi-color odd palindrome in a row, column, or a single 90° right-angle (L-shape).',
                  },
                  {
                    title: 'First Move',
                    body: 'At the start you place two blocks. After the second placement you must have created a multi-color 5+ odd palindrome.',
                  },
                  {
                    title: 'Scoring',
                    body: 'Each scoring placement adds the palindrome length to your score. Placing on a Bulldog cell adds a +10 bonus.',
                  },
                  {
                    title: 'Hints & Timer',
                    body: 'You start with 2 hints — they highlight a strong move. The timer starts on your first placement and tracks your pace.',
                  },
                ].map((section) => (
                  <View
                    key={section.title}
                    style={[
                      styles.rulesSection,
                      {
                        backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                        borderColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      },
                    ]}
                  >
                    <Text style={[styles.rulesSectionTitle, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                      {section.title}
                    </Text>
                    <Text style={[styles.rulesSectionBody, { color: theme === 'dark' ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.78)' }]}>
                      {section.body}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.rulesFooter}>
                <Pressable
                  onPress={() => setRulesVisible(false)}
                  style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}
                >
                  <LinearGradient colors={['#1177FE', '#48B7FF']} style={styles.rulesDoneButton}>
                    <Text style={styles.rulesDoneText}>Got it</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </View>
      )}

      {/* Restart Confirmation Modal (single-player only) */}
      {!matchId && restartConfirmationVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <BlurView
            intensity={20}
            tint={theme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.confirmOverlay}>
            <LinearGradient
              colors={theme === 'dark' ? ['#000017', '#000074'] : ['#FFFFFF', '#FFFFFF']}
              style={styles.confirmCard}
            >
              <View style={[styles.confirmIconCircle, { backgroundColor: '#f59e0b' }]}>
                <Ionicons name="refresh" size={28} color="#FFFFFF" />
              </View>
              <Text style={[styles.confirmTitle, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                Restart Game?
              </Text>
              <Text style={[styles.confirmMessage, { color: theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.75)' }]}>
                Are you sure you want to restart? Current progress will be lost.
              </Text>
              <View style={styles.confirmButtonRow}>
                <Pressable
                  onPress={() => setRestartConfirmationVisible(false)}
                  style={({ pressed }) => [
                    styles.confirmSecondaryButton,
                    { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.confirmSecondaryText, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await persistSinglePlayerRun();
                    setRestartConfirmationVisible(false);
                    initializeGame();
                  }}
                  style={({ pressed }) => [
                    styles.confirmPrimaryButton,
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <LinearGradient colors={['#f59e0b', '#d97706']} style={styles.confirmPrimaryGradient}>
                    <Text style={styles.confirmPrimaryText}>Restart</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </View>
      )}

      {/* Home Confirmation Modal */}
      {homeConfirmationVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <BlurView
            intensity={20}
            tint={theme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.confirmOverlay}>
            <LinearGradient
              colors={theme === 'dark' ? ['#000017', '#000074'] : ['#FFFFFF', '#FFFFFF']}
              style={styles.confirmCard}
            >
              <View style={[styles.confirmIconCircle, { backgroundColor: '#ef4444' }]}>
                <Ionicons name="home" size={28} color="#FFFFFF" />
              </View>
              <Text style={[styles.confirmTitle, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                Leave Game?
              </Text>
              <Text style={[styles.confirmMessage, { color: theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.75)' }]}>
                {matchId
                  ? 'Leaving will forfeit the match.'
                  : 'Are you sure you want to go home? Current progress will be lost.'}
              </Text>
              <View style={styles.confirmButtonRow}>
                <Pressable
                  onPress={() => setHomeConfirmationVisible(false)}
                  style={({ pressed }) => [
                    styles.confirmSecondaryButton,
                    { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.confirmSecondaryText, { color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    if (matchId) {
                      const user = await authService.getSessionUser();
                      if (user) await forfeitRaceMatch(matchId, user.id);
                    } else {
                      await persistSinglePlayerRun();
                    }
                    setHomeConfirmationVisible(false);
                    router.push('/main');
                  }}
                  style={({ pressed }) => [
                    styles.confirmPrimaryButton,
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.confirmPrimaryGradient}>
                    <Text style={styles.confirmPrimaryText}>Leave</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </View>
      )}
    </SafeAreaView>
      <VideoGuideOverlay
        open={guideVisible}
        slideIndex={guideSlideIndex}
        accentColor={colors.accent}
        isDark={theme === 'dark'}
        onBack={backGuide}
        onNext={nextGuide}
        onSkip={skipGuide}
        onDone={doneGuide}
      />
      </>
    )}
    </GameSpotlightTourProvider>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  title: { position: 'absolute', top: 70, fontFamily: 'Geist-Bold', fontSize: 26, color: '#0060FF' },
  rectangleLeft: { position: 'absolute', top: 140, left: '55%', marginLeft: -134 / 2 - 124.5, width: 104, height: 64, backgroundColor: 'rgba(229,236,241,0.5)', borderWidth: 1, borderColor: '#C7D5DF', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rectangleRight: { position: 'absolute', top: 140, left: '45%', marginLeft: 137.5 - 104 / 2, width: 104, height: 64, backgroundColor: 'rgba(229,236,241,0.5)', borderWidth: 1, borderColor: '#C7D5DF', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rectangleLabel: { fontSize: 14, color: '#4C575F' },
  rectangleValue: { fontSize: 24, fontWeight: '900', color: '#0060FF' },
  opponentBar: {
    position: 'absolute',
    top: 88,
    left: 16,
    right: 16,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  opponentAvatar: { width: 28, height: 28, borderRadius: 14 },
  opponentBarText: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  opponentLabel: { fontSize: 13, fontFamily: 'Geist-Regular' },
  opponentScore: { fontSize: 18, fontFamily: 'Geist-Bold' },
  firstMoveBanner: {
    position: 'absolute',
    top: 145,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  firstMoveBannerText: {
    fontFamily: 'Geist-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  waitingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  waitingOverlayCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 260,
  },
  waitingOverlayTitle: { fontFamily: 'Geist-Bold', fontSize: 18, marginBottom: 8 },
  waitingOverlaySubtitle: { fontFamily: 'Geist-Regular', fontSize: 14, marginBottom: 12 },
  waitingOverlayScore: { fontFamily: 'Geist-Bold', fontSize: 20 },
  timerContainer: { position: 'absolute', top: 160, alignSelf: 'center' },
  board: { position: 'relative', top: 200, width: 350, height: 376, backgroundColor: '#E4EBF0', borderRadius: 16, padding: 6, alignItems: 'center' },
  row: { flexDirection: 'row' },
  cell: { width: 27, height: 30, borderWidth: 1, borderColor: '#CCDAE466', backgroundColor: '#FFFFFF', margin: 1.5, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  letterText: { fontFamily: 'Geist-Bold', color: '#000', fontSize: 14 },
  innerShadow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 6 },
  bulldogImage: { width: 20, height: 20, position: 'absolute', top: 4, left: 4 },
  colorBlocksContainer: { position: 'absolute', top: 630, width: 320, height: 70, backgroundColor: '#E4EBF0', borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  colorBlocksRow: { flexDirection: 'row', justifyContent: 'space-between', width: 300 },
  colorBlock: { width: 50, height: 50, borderRadius: 8 },
  colorBlockWrapper: { width: 50, height: 50, marginHorizontal: 4 },
  gradientColorBlock: { flex: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  blockText: { color: '#fff', fontSize: 20, fontWeight: '500' },
  colorBlindBlockTokenCorner: { position: 'absolute', top: 5, left: 7, color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  colorBlindBlockTokenCenter: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  colorBlindTokenOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 2, justifyContent: 'center', alignItems: 'center' },
  colorBlindTokenText: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  colorBlindTokenCorner: { position: 'absolute', zIndex: 2, bottom: 3, right: 4, color: '#FFFFFF', fontSize: 10, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  controlsRow: { position: 'absolute', top: 720, width: 300, flexDirection: 'row', justifyContent: 'space-around' },
  gradientButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // ⚙️ Settings Styles
  settingsOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  settingsCard: { width: '100%', maxWidth: 340, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  headerSpacer: {
    flex: 1,
  },

  closeButton: {
    flex: 1,
    alignItems: 'flex-end',
  },

  settingsTitle: { fontSize: 24, fontWeight: '900', fontFamily: 'Geist-Regular', color: '#000', marginTop: -10 },
  closeIcon: { fontSize: 32, color: '#007AFF', marginTop: -10 },
  profileSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  profileImage: { width: 70, height: 70, borderRadius: 35, marginBottom: 10, marginRight: 12 },
  profileName: { fontWeight: '500', fontSize: 18, color: '#000', fontFamily: 'Geist-Bold', marginBottom: 4 },
  profileLink: { color: '#007AFF', fontSize: 14, fontWeight: '400' },
  profileTextContainer: { flexDirection: 'column', justifyContent: 'center' },
  optionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  optionLabel: { fontSize: 16, color: '#000', fontWeight: '500' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  linkText: { color: '#000', fontSize: 16, fontWeight: '500' },
  settingsScroll: { flex: 1 },
  settingsScrollContent: { paddingBottom: 6 },
  pauseOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  pauseCard: {
    width: '70%',                // reduce length
    maxWidth: 320,               // optional, for desktop/web scaling
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,                // Android shadow
  },

  pauseTitle: {
    fontSize: 22,
    fontWeight: '500',
    color: '#000000ff',
    fontFamily: 'Geist-Bold',
    textAlign: 'center',
    marginBottom: 20,
  },

  resumeButton: {
    backgroundColor: '#0060FF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },

  resumeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    fontFamily: 'Geist-Regular',
  },

  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  gameOverCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 26,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  gameOverIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  gameOverTitle: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  newHighScoreBadge: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f59e0b',
  },
  newHighScoreText: {
    color: '#FFFFFF',
    fontFamily: 'Geist-Bold',
    fontWeight: '900',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  gameOverMessage: {
    marginTop: 6,
    fontSize: 15,
    fontFamily: 'Geist-Regular',
    textAlign: 'center',
    lineHeight: 21,
  },
  gameOverScoreChip: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
  },
  gameOverScoreLabel: {
    fontSize: 14,
    fontFamily: 'Geist-Regular',
    fontWeight: '600',
  },
  gameOverScoreValue: {
    fontSize: 18,
    fontFamily: 'Geist-Bold',
    fontWeight: '800',
    color: '#0060FF',
  },
  gameOverButtonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 18,
  },
  gameOverPrimaryButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#1177FE',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  gameOverPrimaryGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameOverPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
  },
  gameOverSecondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameOverSecondaryText: {
    fontSize: 16,
    fontFamily: 'Geist-Regular',
    fontWeight: '700',
  },

  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  confirmCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  confirmIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    textAlign: 'center',
  },
  confirmMessage: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: 'Geist-Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 20,
  },
  confirmSecondaryButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmSecondaryText: {
    fontSize: 15,
    fontFamily: 'Geist-Regular',
    fontWeight: '700',
  },
  confirmPrimaryButton: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  confirmPrimaryGradient: {
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
  },

  rulesOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  rulesCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  rulesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  rulesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rulesTitle: {
    fontSize: 20,
    fontWeight: '900',
    fontFamily: 'Geist-Bold',
  },
  rulesCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rulesCloseIcon: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  rulesScroll: {
    flexGrow: 0,
  },
  rulesScrollContent: {
    gap: 10,
    paddingBottom: 4,
  },
  rulesSection: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  rulesSectionTitle: {
    fontSize: 14,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
    marginBottom: 6,
  },
  rulesSectionBody: {
    fontSize: 13,
    fontFamily: 'Geist-Regular',
    lineHeight: 18,
  },
  rulesFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  rulesDoneButton: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  rulesDoneText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
  },

  feedbackContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  feedbackText: {
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  toastContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(17,17,17,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Geist-Regular',
    textAlign: 'center',
  },
});
