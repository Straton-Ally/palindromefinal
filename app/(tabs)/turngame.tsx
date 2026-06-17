import { authService } from '@/authService';
import { ColorBlindMode, useSettings } from '@/context/SettingsContext';
import { useThemeContext } from '@/context/ThemeContext';
import { useSound } from '@/hooks/use-sound';
import { DEFAULT_GAME_GRADIENTS } from '@/lib/gameColors';
import { GRID_SIZE, NUM_COLORS, scoreNewPalindromes } from '@/lib/gameEngine';
import { getMatch, type Match } from '@/lib/matchmaking';
import {
  forfeitTurnMatch,
  expireTurnClock,
  ensureTurnMatchReady,
  getTurnMatchState,
  initTurnBoard,
  submitTurnMove,
  subscribeToTurnState,
  TURN_TIME_LIMIT_MS,
  type TurnMatchState,
} from '@/lib/turnMatchmaking';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ['●', '▲', '■', '◆', '★'],
  emojis: ['🍓', '🥑', '🫐', '🖤', '🍋'],
  cards: ['♥', '♣', '♦', '♠', '★'],
  letters: ['A', 'B', 'C', 'D', 'E'],
} as const;

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTurnStartedAtMs(state: TurnMatchState | null): number {
  if (!state?.turn_started_at) return Date.now();
  const parsed = Date.parse(state.turn_started_at);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

type GameOverInfo = { winner: string | null; reason: string | null; myScore: number; opScore: number };

function getGameOverTitle(info: GameOverInfo, userId: string | null): string {
  if (info.winner === userId) return 'You Win!';
  if (info.winner === null) return "It's a Draw!";
  return 'You Lose!';
}

function getGameOverReason(info: GameOverInfo, userId: string | null): string {
  const didWin = info.winner === userId;
  const didDraw = info.winner === null;
  if (info.reason === 'timeout') return didWin ? 'Opponent lost on time' : 'You lost on time';
  if (info.reason === 'forfeit') return didWin ? 'Opponent forfeited' : 'You forfeited';
  if (info.reason === 'score' || info.reason === 'blocks_used') {
    if (didDraw) return 'Draw by score';
    return didWin ? 'You won by score' : 'You lost by score';
  }
  if (info.reason === 'board_full') {
    if (didDraw) return 'Board full, draw by score';
    return didWin ? 'Board full, you won by score' : 'Board full, you lost by score';
  }
  return didDraw ? 'Draw' : didWin ? 'You won by score' : 'You lost by score';
}

type BoardLayout = { x: number; y: number; width: number; height: number };

// ── Player Card ─────────────────────────────────────────
function PlayerCard({
  name,
  avatar,
  score,
  timeMs,
  isActive,
  isYou,
  isDark,
}: {
  name: string;
  avatar: string | null;
  score: number;
  timeMs: number;
  isActive: boolean;
  isYou: boolean;
  isDark: boolean;
}) {
  const borderColor = isActive ? (isYou ? '#22c55e' : '#ef4444') : 'transparent';
  const timeColor = timeMs < 30000 ? '#ef4444' : timeMs < 60000 ? '#f59e0b' : '#95DEFE';

  return (
    <View
      style={[
        styles.playerCard,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.85)',
          borderColor,
        },
      ]}
    >
      <View style={{ position: 'relative' }}>
        <Image
          source={avatar ? { uri: avatar } : require('../../assets/images/profile_ph.png')}
          style={[
            styles.playerAvatar,
            { borderColor: isActive ? borderColor : '#0060FF' },
          ]}
        />
        {isYou && (
          <View style={styles.youBadge}>
            <Text style={styles.youBadgeText}>YOU</Text>
          </View>
        )}
      </View>
      <Text
        style={[styles.playerName, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
        numberOfLines={1}
      >
        {name}
      </Text>
      <View style={styles.playerStatsRow}>
        <View style={styles.playerStatBlock}>
          <Text style={[styles.playerStatLabel, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.6)' }]}>
            SCORE
          </Text>
          <Text style={[styles.playerStatValue, { color: '#0060FF' }]}>{score}</Text>
        </View>
        <View
          style={[
            styles.playerStatDivider,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
          ]}
        />
        <View style={styles.playerStatBlock}>
          <Text style={[styles.playerStatLabel, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.6)' }]}>
            TIME
          </Text>
          <Text style={[styles.playerStatValue, { color: timeColor }]}>{formatTime(timeMs)}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Draggable Block (PanResponder) ──────────────────────
function DraggableBlock({
  colorIndex,
  gradient,
  count,
  blockSize,
  cellSize,
  boardLayout,
  measureBoardLayout,
  onPickup,
  onDragUpdate,
  onDrop,
  disabled,
  colorBlindEnabled,
  colorBlindMode,
}: {
  colorIndex: number;
  gradient: readonly [string, string];
  count: number;
  blockSize: number;
  cellSize: number;
  boardLayout: BoardLayout | null;
  measureBoardLayout: () => Promise<BoardLayout | null>;
  onPickup: () => void;
  onDragUpdate: (cell: { row: number; col: number } | null) => void;
  onDrop: (row: number, col: number, colorIndex: number) => void;
  disabled: boolean;
  colorBlindEnabled: boolean;
  colorBlindMode: ColorBlindMode;
}) {
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [isDragging, setIsDragging] = useState(false);
  const lastCellRef = useRef<{ row: number; col: number } | null>(null);
  const dragOffsetY = 50;

  const latest = useRef({ boardLayout, count, disabled, measureBoardLayout, onDragUpdate, onDrop, onPickup });
  useEffect(() => {
    latest.current = { boardLayout, count, disabled, measureBoardLayout, onDragUpdate, onDrop, onPickup };
  }, [boardLayout, count, disabled, measureBoardLayout, onDragUpdate, onDrop, onPickup]);

  const cellMargin = 3;
  const stepXY = cellSize + cellMargin * 2;
  const boardPadding = 10;

  const getCellFromPoint = useCallback(
    (touchX: number, touchY: number, layout: BoardLayout) => {
      const innerWidth = Math.max(1, layout.width - boardPadding * 2);
      const innerHeight = Math.max(1, layout.height - boardPadding * 2);
      const gridPixelW = GRID_SIZE * stepXY;
      const gridPixelH = GRID_SIZE * stepXY;
      const extraX = Math.max(0, (innerWidth - gridPixelW) / 2);
      const extraY = Math.max(0, (innerHeight - gridPixelH) / 2);

      const originX = layout.x + boardPadding + extraX + cellMargin;
      const originY = layout.y + boardPadding + extraY + cellMargin;

      const localX = touchX - originX;
      const localY = touchY - originY - dragOffsetY;
      const col = Math.floor(localX / stepXY);
      const row = Math.floor(localY / stepXY);

      if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return null;
      return { row, col };
    },
    [stepXY]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled && latest.current.count > 0,
      onMoveShouldSetPanResponder: () => !latest.current.disabled && latest.current.count > 0,
      onPanResponderGrant: () => {
        if (latest.current.disabled || latest.current.count <= 0) return;
        setIsDragging(true);
        latest.current.onPickup();
        void latest.current.measureBoardLayout();
      },
      onPanResponderMove: (evt, gesture) => {
        pan.setValue({ x: gesture.dx, y: gesture.dy });
        const layout = latest.current.boardLayout;
        if (!layout) return;
        const cell = getCellFromPoint(evt.nativeEvent.pageX, evt.nativeEvent.pageY, layout);
        const lastCell = lastCellRef.current;
        if (cell?.row !== lastCell?.row || cell?.col !== lastCell?.col) {
          lastCellRef.current = cell;
          latest.current.onDragUpdate(cell);
        }
      },
      onPanResponderRelease: (evt) => {
        const layout = latest.current.boardLayout;
        if (layout) {
          const cell = getCellFromPoint(evt.nativeEvent.pageX, evt.nativeEvent.pageY, layout);
          if (cell) {
            latest.current.onDrop(cell.row, cell.col, colorIndex);
          }
        }
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        setIsDragging(false);
        lastCellRef.current = null;
        latest.current.onDragUpdate(null);
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        setIsDragging(false);
        lastCellRef.current = null;
        latest.current.onDragUpdate(null);
      },
    })
  ).current;

  const canDrag = !disabled && count > 0;
  const token = colorBlindEnabled ? COLOR_BLIND_TOKENS[colorBlindMode][colorIndex] ?? '?' : null;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        width: blockSize,
        height: blockSize,
        opacity: canDrag ? 1 : 0.35,
        transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: isDragging ? 1.1 : 1 }],
        zIndex: isDragging ? 999 : 1,
      }}
    >
      <LinearGradient colors={[gradient[0], gradient[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.draggableGradient}>
        {token ? (
          <>
            <Text style={styles.draggableTokenCount}>{count}</Text>
            <Text style={styles.draggableTokenSymbol}>{token}</Text>
          </>
        ) : (
          <Text style={styles.draggableCount}>{count}</Text>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function TurnGameNative() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { matchId: routeMatchId } = useLocalSearchParams<{ matchId?: string }>();
  const matchId = typeof routeMatchId === 'string' ? routeMatchId : Array.isArray(routeMatchId) ? routeMatchId[0] : undefined;

  const { theme } = useThemeContext();
  const { hapticsEnabled, palindromeAnimationsEnabled, colorBlindEnabled, colorBlindMode, customGameColors } = useSettings();
  const { playPickupSound, playDropSound, playErrorSound, playSuccessSound } = useSound();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const isDark = theme === 'dark';

  const triggerHaptic = useCallback(
    (style: 'light' | 'success' | 'error') => {
      if (!hapticsEnabled) return;
      try {
        if (style === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        else if (style === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // ignore
      }
    },
    [hapticsEnabled]
  );

  // ── State ──
  const [turnState, setTurnState] = useState<TurnMatchState | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [myName, setMyName] = useState('You');
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [opponentName, setOpponentName] = useState('Opponent');
  const [opponentAvatar, setOpponentAvatar] = useState<string | null>(null);
  const [boardInitialized, setBoardInitialized] = useState(false);
  const [forfeitConfirm, setForfeitConfirm] = useState(false);
  const [gameOverInfo, setGameOverInfo] = useState<GameOverInfo | null>(null);

  const [localTimeP1, setLocalTimeP1] = useState(TURN_TIME_LIMIT_MS);
  const [localTimeP2, setLocalTimeP2] = useState(TURN_TIME_LIMIT_MS);
  const turnStartedLocal = useRef<number>(Date.now());
  const lastMoveTime = useRef<number>(Date.now());

  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null);
  const [pendingPlacedCell, setPendingPlacedCell] = useState<{ row: number; col: number; colorIndex: number } | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; color: string; id: number } | null>(null);
  const [scoredCells, setScoredCells] = useState<string[]>([]);
  const [scoredCellsRun, setScoredCellsRun] = useState(0);
  const scoredCellsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const scoringInProgressRef = useRef(false);
  const pendingGameOverInfoRef = useRef<GameOverInfo | null>(null);
  const timeoutSubmittingRef = useRef(false);
  const previousBoardRef = useRef<(number | null)[][] | null>(null);
  const opponentShimmerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opponentShimmerProgress = useRef(new Animated.Value(0)).current;
  const [opponentChangedCells, setOpponentChangedCells] = useState<string[]>([]);

  const gridSize = GRID_SIZE;
  const colorGradients = useMemo(
    () => (customGameColors ?? [...DEFAULT_GAME_GRADIENTS]) as readonly [string, string][],
    [customGameColors]
  );
  const center = Math.floor(gridSize / 2);
  const word = ' PALINDROME';
  const halfWord = Math.floor(word.length / 2);

  // Derived state
  const isPlayer1 = turnState ? userId === turnState.player1_user_id : false;
  const isMyTurn = turnState ? turnState.current_turn_user_id === userId : false;
  const isGameOver = turnState ? turnState.finished_reason !== null : false;
  const myBlocks = useMemo(
    () => (turnState ? (isPlayer1 ? turnState.player1_blocks : turnState.player2_blocks) : [8, 8, 8, 8, 8]),
    [isPlayer1, turnState]
  );
  const myScore = turnState ? (isPlayer1 ? turnState.player1_score : turnState.player2_score) : 0;
  const opScore = turnState ? (isPlayer1 ? turnState.player2_score : turnState.player1_score) : 0;
  const board: (number | null)[][] =
    turnState?.board?.length === gridSize
      ? turnState.board
      : Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
  const bulldogPositions = useMemo(() => turnState?.bulldog_positions ?? [], [turnState]);

  const showOpponentMoveShimmer = useCallback((cells: string[]) => {
    if (cells.length === 0) return;
    if (opponentShimmerTimerRef.current) clearTimeout(opponentShimmerTimerRef.current);
    setOpponentChangedCells(cells);
    opponentShimmerProgress.setValue(0);
    Animated.timing(opponentShimmerProgress, {
      toValue: 1,
      duration: 1100,
      useNativeDriver: true,
    }).start();
    opponentShimmerTimerRef.current = setTimeout(() => {
      setOpponentChangedCells([]);
      opponentShimmerTimerRef.current = null;
    }, 1300);
  }, [opponentShimmerProgress]);

  const captureOpponentBoardChanges = useCallback((nextState: TurnMatchState) => {
    const previousBoard = previousBoardRef.current;
    const previousTurn = turnState?.current_turn_user_id;
    previousBoardRef.current = nextState.board;
    if (!previousBoard || !userId) return;
    if (previousTurn === userId || nextState.current_turn_user_id !== userId) return;

    const changed: string[] = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        if (previousBoard[row]?.[col] == null && nextState.board[row]?.[col] != null) {
          changed.push(`${row},${col}`);
        }
      }
    }
    showOpponentMoveShimmer(changed);
  }, [gridSize, showOpponentMoveShimmer, turnState?.current_turn_user_id, userId]);

  const finishTurnScoring = useCallback(() => {
    if (scoredCellsTimerRef.current) clearTimeout(scoredCellsTimerRef.current);
    scoredCellsTimerRef.current = null;
    setScoredCells([]);
    setFeedback(null);
    scoringInProgressRef.current = false;
    setScoringInProgress(false);
    if (pendingGameOverInfoRef.current) {
      setGameOverInfo(pendingGameOverInfoRef.current);
      pendingGameOverInfoRef.current = null;
    }
  }, []);

  // ── Layout ──
  const boardSize = useMemo(() => {
    const horizontalPad = 16;
    const verticalReserved = insets.top + insets.bottom + 280; // top bar + player cards + blocks bar + bottom bar
    const maxByWidth = windowWidth - horizontalPad * 2;
    const maxByHeight = windowHeight - verticalReserved;
    return Math.max(240, Math.min(maxByWidth, maxByHeight, 480));
  }, [insets.bottom, insets.top, windowHeight, windowWidth]);
  const cellSize = Math.floor((boardSize - 20) / gridSize) - 6;
  const blockSize = Math.min(48, Math.floor((windowWidth - 64) / 5) - 8);

  // Board layout for drop hit-testing
  const boardRef = useRef<View | null>(null);
  const [boardLayout, setBoardLayout] = useState<BoardLayout | null>(null);

  const measureBoardLayout = useCallback((): Promise<BoardLayout | null> => {
    return new Promise((resolve) => {
      const node = boardRef.current as any;
      if (!node?.measureInWindow) {
        resolve(null);
        return;
      }
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        const layout = { x, y, width, height };
        setBoardLayout(layout);
        resolve(layout);
      });
    });
  }, []);

  // ── Auth ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await authService.getSessionUser();
      if (cancelled || !user) return;
      setUserId(user.id);
      const p = await authService.getProfile(user.id);
      if (cancelled) return;
      if (p?.full_name) setMyName(p.full_name);
      if (p?.avatar_url) setMyAvatar(p.avatar_url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load match + state, init board if needed ──
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      const m = await getMatch(matchId);
      if (cancelled || !m) return;
      setMatch(m);
      const s = await getTurnMatchState(matchId);
      if (cancelled || !s) return;
      const readyState = (await ensureTurnMatchReady(matchId, m.seed)) ?? s;
      if (cancelled) return;
      setTurnState(readyState);
      setLocalTimeP1(readyState.player1_time_ms);
      setLocalTimeP2(readyState.player2_time_ms);
      turnStartedLocal.current = getTurnStartedAtMs(readyState);
      lastMoveTime.current = getTurnStartedAtMs(readyState);

      if (m.status === 'active' && (!readyState.board || (Array.isArray(readyState.board) && readyState.board.length === 0))) {
        try {
          await initTurnBoard(matchId, m.seed);
          await ensureTurnMatchReady(matchId, m.seed);
        } catch (e) {
          console.error('initTurnBoard failed:', e);
        }
        if (!cancelled) {
          setBoardInitialized(true);
          const s2 = await getTurnMatchState(matchId);
          if (s2 && !cancelled) {
            setTurnState(s2);
            setLocalTimeP1(s2.player1_time_ms);
            setLocalTimeP2(s2.player2_time_ms);
            turnStartedLocal.current = getTurnStartedAtMs(s2);
            lastMoveTime.current = getTurnStartedAtMs(s2);
          }
        }
      } else if (!cancelled) {
        setBoardInitialized(true);
      }

      const user = await authService.getSessionUser();
      const latestState = (await getTurnMatchState(matchId)) ?? readyState;
      if (!cancelled) {
        previousBoardRef.current = latestState.board;
        setTurnState(latestState);
      }
      const opId = latestState.player1_user_id === user?.id ? latestState.player2_user_id : latestState.player1_user_id;
      if (opId && opId !== user?.id) {
        const opProfile = await authService.getProfile(opId);
        if (cancelled) return;
        if (opProfile?.full_name) setOpponentName(opProfile.full_name);
        if (opProfile?.avatar_url) setOpponentAvatar(opProfile.avatar_url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // ── Realtime subscription ──
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeToTurnState(matchId, (s) => {
      captureOpponentBoardChanges(s);
      setTurnState(s);
      setLocalTimeP1(s.player1_time_ms);
      setLocalTimeP2(s.player2_time_ms);
      turnStartedLocal.current = getTurnStartedAtMs(s);
      lastMoveTime.current = getTurnStartedAtMs(s);
    });
    return unsub;
  }, [captureOpponentBoardChanges, matchId]);

  // ── Game-over detection ──
  useEffect(() => {
    if (turnState?.finished_reason && !gameOverInfo && userId) {
      const isP1 = userId === turnState.player1_user_id;
      const nextGameOverInfo = {
        winner: turnState.winner_user_id,
        reason: turnState.finished_reason,
        myScore: isP1 ? turnState.player1_score : turnState.player2_score,
        opScore: isP1 ? turnState.player2_score : turnState.player1_score,
      };
      if (scoringInProgressRef.current) pendingGameOverInfoRef.current = nextGameOverInfo;
      else setGameOverInfo(nextGameOverInfo);
    }
  }, [turnState, gameOverInfo, userId]);

  // ── Chess clock tick ──
  useEffect(() => {
    if (!turnState || isGameOver || !turnState.current_turn_user_id || scoringInProgress) return;
    const interval = setInterval(() => {
      const elapsed = Math.max(0, Date.now() - turnStartedLocal.current);
      const isP1Turn = turnState.current_turn_user_id === turnState.player1_user_id;
      const activeUserId = turnState.current_turn_user_id;
      const expireActiveClock = () => {
        if (!matchId || !activeUserId || timeoutSubmittingRef.current) return;
        timeoutSubmittingRef.current = true;
        expireTurnClock(matchId, activeUserId)
          .then((s) => {
            setTurnState(s);
            setLocalTimeP1(s.player1_time_ms);
            setLocalTimeP2(s.player2_time_ms);
          })
          .catch((e) => console.error(e))
          .finally(() => {
            timeoutSubmittingRef.current = false;
          });
      };
      if (isP1Turn) {
        const newTime = Math.max(0, turnState.player1_time_ms - elapsed);
        setLocalTimeP1(newTime);
        if (newTime <= 0) expireActiveClock();
      } else {
        const newTime = Math.max(0, turnState.player2_time_ms - elapsed);
        setLocalTimeP2(newTime);
        if (newTime <= 0) expireActiveClock();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [turnState, isGameOver, matchId, scoringInProgress]);

  // Cleanup scoredCells timer
  useEffect(() => {
    return () => {
      if (scoredCellsTimerRef.current) {
        clearTimeout(scoredCellsTimerRef.current);
        scoredCellsTimerRef.current = null;
      }
      if (opponentShimmerTimerRef.current) {
        clearTimeout(opponentShimmerTimerRef.current);
        opponentShimmerTimerRef.current = null;
      }
    };
  }, []);

  // ── Palindrome scoring (client-side) ──
  const checkAndScore = useCallback(
    (
      row: number,
      col: number,
      _colorIdx: number,
      currentGrid: (number | null)[][],
      previousGrid?: (number | null)[][]
    ): { scoreFound: number; events: { score: number; segment: { r: number; c: number }[]; segmentLength: number }[] } => {
      const { score, events } = scoreNewPalindromes([{ row, col }], currentGrid, bulldogPositions, 3, previousGrid);
      return {
        scoreFound: score,
        events: events.map((event) => ({
          score: event.score,
          segment: event.segment,
          segmentLength: event.segmentLength,
        })),
      };
    },
    [bulldogPositions]
  );

  const getScoringFeedback = useCallback((length: number) => {
    if (length >= 9) return { text: 'LEGENDARY!', color: '#F472B6' };
    if (length === 7) return { text: 'AMAZING!', color: '#A78BFA' };
    if (length === 5) return { text: 'GREAT!', color: '#60A5FA' };
    return { text: 'GOOD!', color: '#4ADE80' };
  }, []);

  const waitForTurnScoringFrame = useCallback((ms: number) => new Promise<void>((resolve) => {
    if (scoredCellsTimerRef.current) clearTimeout(scoredCellsTimerRef.current);
    scoredCellsTimerRef.current = setTimeout(() => {
      scoredCellsTimerRef.current = null;
      resolve();
    }, ms);
  }), []);

  // ── Handle drop ──
  const handleDrop = useCallback(
    async (row: number, col: number, colorIndex: number) => {
      setDragOverCell(null);
      if (!isMyTurn || isGameOver || !matchId || !userId || !turnState || scoringInProgressRef.current) {
        playErrorSound();
        triggerHaptic('error');
        return;
      }
      if (colorIndex < 0 || colorIndex >= NUM_COLORS) {
        playErrorSound();
        triggerHaptic('error');
        return;
      }
      if (board[row][col] !== null) {
        playErrorSound();
        triggerHaptic('error');
        return;
      }
      if (myBlocks[colorIndex] <= 0) {
        playErrorSound();
        triggerHaptic('error');
        return;
      }

      const tempGrid = board.map((r) => [...r]);
      tempGrid[row][col] = colorIndex;
      const { scoreFound: scoreDelta, events: scoringEvents } = checkAndScore(row, col, colorIndex, tempGrid, board);
      const isLastOwnBlock = myBlocks.reduce((total, count) => total + count, 0) === 1;

      if (scoreDelta <= 0 && !isLastOwnBlock) {
        playErrorSound();
        triggerHaptic('error');
        return;
      }

      playDropSound();
      triggerHaptic('light');
      const timeSpent = Math.max(0, Date.now() - getTurnStartedAtMs(turnState));
      lastMoveTime.current = Date.now();
      setPendingPlacedCell({ row, col, colorIndex });

      if (palindromeAnimationsEnabled) {
        scoringInProgressRef.current = true;
        setScoringInProgress(true);
        const eventsToAnimate = scoringEvents.length > 0
          ? scoringEvents
          : [{ score: 0, segment: [{ r: row, c: col }], segmentLength: 0 }];

        for (let index = 0; index < eventsToAnimate.length; index += 1) {
          const event = eventsToAnimate[index];
          const feedbackForLength = scoreDelta <= 0 ? { text: 'DONE!', color: '#95DEFE' } : getScoringFeedback(event.segmentLength);
          setFeedback({ text: feedbackForLength.text, color: feedbackForLength.color, id: Date.now() + index });
          setScoredCells(event.segment.map((tile) => `${tile.r},${tile.c}`));
          setScoredCellsRun(Date.now() + index);
          await waitForTurnScoringFrame(index === eventsToAnimate.length - 1 ? 2000 : 900);
        }
        finishTurnScoring();
      }

      try {
        playSuccessSound();
        triggerHaptic('success');
        const newState = await submitTurnMove(matchId, userId, row, col, colorIndex, scoreDelta, timeSpent);
        previousBoardRef.current = newState.board;
        setTurnState(newState);
        setLocalTimeP1(newState.player1_time_ms);
        setLocalTimeP2(newState.player2_time_ms);
        turnStartedLocal.current = getTurnStartedAtMs(newState);
        lastMoveTime.current = getTurnStartedAtMs(newState);
        setPendingPlacedCell(null);
      } catch (err) {
        console.error('Move submit error:', err);
        setPendingPlacedCell(null);
        playErrorSound();
        triggerHaptic('error');
      }
    },
    [
      board,
      checkAndScore,
      isGameOver,
      isMyTurn,
      matchId,
      myBlocks,
      playDropSound,
      playErrorSound,
      playSuccessSound,
      palindromeAnimationsEnabled,
      finishTurnScoring,
      getScoringFeedback,
      triggerHaptic,
      turnState,
      userId,
      waitForTurnScoringFrame,
    ]
  );

  const handleForfeit = useCallback(async () => {
    if (!matchId || !userId) return;
    try {
      await forfeitTurnMatch(matchId, userId);
    } catch (e) {
      console.error(e);
    }
    setForfeitConfirm(false);
  }, [matchId, userId]);

  const myTimeMs = isPlayer1 ? localTimeP1 : localTimeP2;
  const opTimeMs = isPlayer1 ? localTimeP2 : localTimeP1;

  // ── Loading state ──
  if (!turnState || !boardInitialized || !match || match.status === 'waiting') {
    return (
      <SafeAreaView style={[styles.loadingScreen, { backgroundColor: isDark ? '#0a0a1c' : '#f0f4ff' }]}>
        <Text style={[styles.loadingTitle, { color: '#0060FF' }]}>PALINDROME®</Text>
        <Text style={[styles.loadingSubtitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>Loading turn match...</Text>
        <ActivityIndicator size="large" color="#0060FF" style={{ marginTop: 16 }} />
      </SafeAreaView>
    );
  }

  return (
    <LinearGradient
      colors={isDark ? ['#00000f', '#00004a', '#000074'] : ['#eef2ff', '#f5f0ff', '#ffffff']}
      style={styles.root}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Pressable onPress={() => setForfeitConfirm(true)} style={styles.topBarBack}>
            <Ionicons name="arrow-back" size={24} color={isDark ? '#FFFFFF' : '#0F172A'} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: '#0060FF' }]}>PALINDROME®</Text>
          <View style={styles.topBarBack} />
        </View>

        {/* Player Cards */}
        <View style={[styles.playerCardRow, { paddingHorizontal: 12 }]}>
          <View style={{ flex: 1 }}>
            <PlayerCard
              name={myName}
              avatar={myAvatar}
              score={myScore}
              timeMs={myTimeMs}
              isActive={isMyTurn && !isGameOver}
              isYou
              isDark={isDark}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PlayerCard
              name={opponentName}
              avatar={opponentAvatar}
              score={opScore}
              timeMs={opTimeMs}
              isActive={!isMyTurn && !isGameOver}
              isYou={false}
              isDark={isDark}
            />
          </View>
        </View>

        {/* Board */}
        <View style={styles.boardWrapper}>
          <View
            ref={boardRef}
            collapsable={false}
            onLayout={() => void measureBoardLayout()}
            style={[
              styles.board,
              {
                width: boardSize,
                height: boardSize,
                backgroundColor: isDark ? 'rgba(18,18,75,0.92)' : '#f4f6ff',
                borderColor: isDark ? 'rgba(100,120,255,0.18)' : 'rgba(0,0,0,0.07)',
              },
            ]}
          >
            {Array.from({ length: gridSize }, (_, row) => (
              <View key={row} style={styles.boardRow}>
                {Array.from({ length: gridSize }, (_, col) => {
                  const isBulldog = bulldogPositions.some((p) => p.row === row && p.col === col);
                  let letter: string | null = null;
                  if (row === center && col >= center - halfWord && col < center - halfWord + word.length) {
                    letter = word[col - (center - halfWord)];
                  }
                  if (col === center && row >= center - halfWord && row < center - halfWord + word.length) {
                    letter = word[row - (center - halfWord)];
                  }
                  const cellColor = pendingPlacedCell?.row === row && pendingPlacedCell.col === col
                    ? pendingPlacedCell.colorIndex
                    : board[row]?.[col] ?? null;
                  const isHovered = dragOverCell?.row === row && dragOverCell?.col === col;
                  const isScored = scoredCells.includes(`${row},${col}`);
                  const hasOpponentShimmer = opponentChangedCells.includes(`${row},${col}`);
                  const scoreIndex = isScored ? scoredCells.indexOf(`${row},${col}`) : 0;
                  const scoredScale = isScored ? (scoredCellsRun % 2 === 0 ? 1.14 : 1.1) : 1;
                  const shimmerTranslateX = opponentShimmerProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-cellSize, cellSize],
                  });

                  return (
                    <View
                      key={col}
                      style={[
                        styles.boardCell,
                        {
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: isDark ? 'rgba(25,25,91,0.7)' : '#FFFFFF',
                          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(204,218,228,0.4)',
                        },
                        isHovered && {
                          backgroundColor: isDark ? 'rgba(100,200,255,0.4)' : 'rgba(100,200,255,0.3)',
                          borderColor: '#4A9EFF',
                          borderWidth: 2,
                        },
                        isScored && {
                          borderColor: '#FACC15',
                          borderWidth: 2,
                          shadowColor: '#FACC15',
                          shadowOffset: { width: 0, height: 0 },
                          shadowOpacity: 0.9,
                          shadowRadius: 10,
                          elevation: 4,
                        },
                      ]}
                    >
                      {cellColor !== null && (
                        <LinearGradient
                          colors={[colorGradients[cellColor][0], colorGradients[cellColor][1]]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[
                            StyleSheet.absoluteFill,
                            {
                              borderRadius: 6,
                              transform: [{ scale: scoredScale }],
                              opacity: isScored && scoreIndex % 2 === 1 ? 0.96 : 1,
                            },
                          ]}
                        />
                      )}
                      {hasOpponentShimmer && (
                        <Animated.View
                          pointerEvents="none"
                          style={[
                            styles.opponentShimmer,
                            {
                              width: Math.max(12, cellSize * 0.45),
                              transform: [{ translateX: shimmerTranslateX }, { rotate: '18deg' }],
                            },
                          ]}
                        />
                      )}
                      {cellColor !== null && colorBlindEnabled && !letter && (
                        <Text style={[styles.cellToken, { fontSize: cellSize > 26 ? 18 : 14 }]}>
                          {COLOR_BLIND_TOKENS[colorBlindMode][cellColor]}
                        </Text>
                      )}
                      {isBulldog && !letter && cellColor === null && (
                        <Image
                          source={require('../../assets/images/bulldog.png')}
                          style={{ width: cellSize - 8, height: cellSize - 8, resizeMode: 'contain' }}
                        />
                      )}
                      {letter && (
                        <Text
                          style={[
                            styles.cellLetter,
                            {
                              color: cellColor !== null ? '#FFFFFF' : isDark ? '#FFFFFF' : '#0F172A',
                              fontSize: cellSize > 26 ? 14 : 11,
                            },
                          ]}
                        >
                          {letter}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}

            {/* Feedback overlay */}
            {feedback && (
              <View pointerEvents="none" style={styles.feedbackContainer}>
                <Text style={[styles.feedbackText, { color: feedback.color }]}>{feedback.text}</Text>
              </View>
            )}

            {/* Not-your-turn dim overlay */}
            {!isMyTurn && !isGameOver && (
              <View pointerEvents="auto" style={styles.notYourTurnOverlay}>
                <Text style={styles.notYourTurnText}>Opponent&apos;s turn...</Text>
              </View>
            )}
          </View>
        </View>

        {/* Blocks bar */}
        <View
          style={[
            styles.blocksBar,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.85)',
              opacity: isMyTurn && !isGameOver ? 1 : 0.5,
            },
          ]}
        >
          {colorGradients.map((g, i) => (
            <DraggableBlock
              key={i}
              colorIndex={i}
              gradient={g}
              count={myBlocks[i] ?? 0}
              blockSize={blockSize}
              cellSize={cellSize}
              boardLayout={boardLayout}
              measureBoardLayout={measureBoardLayout}
              onPickup={() => {
                playPickupSound();
                triggerHaptic('light');
              }}
              onDragUpdate={setDragOverCell}
              onDrop={handleDrop}
              disabled={!isMyTurn || isGameOver}
              colorBlindEnabled={colorBlindEnabled}
              colorBlindMode={colorBlindMode}
            />
          ))}
        </View>

        {/* Bottom bar — move counter + forfeit */}
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: isDark ? 'rgba(5,5,30,0.95)' : 'rgba(255,255,255,0.95)',
              borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          <View
            style={[
              styles.bottomTurnPill,
              { backgroundColor: isMyTurn ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)' },
            ]}
          >
            <Text style={[styles.bottomTurnText, { color: isMyTurn ? '#22c55e' : '#ef4444' }]}>
              {isMyTurn ? 'YOUR TURN' : 'WAITING'}
            </Text>
          </View>
          <Text style={[styles.bottomMoveText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.6)' }]}>
            Move {turnState.move_number}
          </Text>
          <Pressable onPress={() => setForfeitConfirm(true)} style={styles.bottomForfeitBtn}>
            <Ionicons name="flag" size={18} color="#ef4444" />
          </Pressable>
        </View>

        {/* Forfeit Confirmation */}
        {forfeitConfirm && (
          <View style={StyleSheet.absoluteFill} pointerEvents="auto">
            <BlurView
              intensity={20}
              tint={isDark ? 'dark' : 'light'}
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.modalOverlay}>
              <LinearGradient
                colors={isDark ? ['#000017', '#000074'] : ['#FFFFFF', '#FFFFFF']}
                style={styles.modalCard}
              >
                <View style={[styles.modalIconCircle, { backgroundColor: '#ef4444' }]}>
                  <Ionicons name="flag" size={28} color="#FFFFFF" />
                </View>
                <Text style={[styles.modalTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                  Forfeit Match?
                </Text>
                <Text style={[styles.modalMessage, { color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.75)' }]}>
                  Your opponent will win. This cannot be undone.
                </Text>
                <View style={styles.modalButtonRow}>
                  <Pressable
                    onPress={() => setForfeitConfirm(false)}
                    style={({ pressed }) => [
                      styles.modalSecondaryButton,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.modalSecondaryText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable onPress={handleForfeit} style={({ pressed }) => [styles.modalPrimaryButton, pressed && { transform: [{ scale: 0.98 }] }]}>
                    <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.modalPrimaryGradient}>
                      <Text style={styles.modalPrimaryText}>Forfeit</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </LinearGradient>
            </View>
          </View>
        )}

        {/* Game Over */}
        {gameOverInfo && (
          <View style={StyleSheet.absoluteFill} pointerEvents="auto">
            <BlurView
              intensity={20}
              tint={isDark ? 'dark' : 'light'}
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.modalOverlay}>
              <LinearGradient
                colors={isDark ? ['#000017', '#000074'] : ['#FFFFFF', '#FFFFFF']}
                style={styles.modalCard}
              >
                <View
                  style={[
                    styles.modalIconCircle,
                    {
                      backgroundColor:
                        gameOverInfo.winner === userId ? '#16a34a' : gameOverInfo.winner === null ? '#d97706' : '#dc2626',
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      gameOverInfo.winner === userId
                        ? 'trophy'
                        : gameOverInfo.winner === null
                          ? 'remove'
                          : 'close-circle'
                    }
                    size={34}
                    color="#FFFFFF"
                  />
                </View>
                <Text style={[styles.gameOverTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                  {getGameOverTitle(gameOverInfo, userId)}
                </Text>
                <Text style={[styles.gameOverReason, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.7)' }]}>
                  {getGameOverReason(gameOverInfo, userId)}
                </Text>
                <View style={styles.gameOverScoreRow}>
                  <View
                    style={[
                      styles.gameOverScoreBox,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                    ]}
                  >
                    <Text style={[styles.gameOverScoreLabel, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.6)' }]}>
                      Your Score
                    </Text>
                    <Text style={[styles.gameOverScoreValue, { color: '#0060FF' }]}>{gameOverInfo.myScore}</Text>
                  </View>
                  <View
                    style={[
                      styles.gameOverScoreBox,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                    ]}
                  >
                    <Text style={[styles.gameOverScoreLabel, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.6)' }]}>
                      Opponent
                    </Text>
                    <Text style={[styles.gameOverScoreValue, { color: '#ef4444' }]}>{gameOverInfo.opScore}</Text>
                  </View>
                </View>
                <View style={styles.modalButtonRow}>
                  <Pressable onPress={() => router.replace('/multiplayer')} style={({ pressed }) => [styles.modalPrimaryButton, pressed && { transform: [{ scale: 0.98 }] }]}>
                    <LinearGradient colors={['#7C3AED', '#A78BFA']} style={styles.modalPrimaryGradient}>
                      <Text style={styles.modalPrimaryText}>Play Again</Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable
                    onPress={() => router.replace('/main')}
                    style={({ pressed }) => [
                      styles.modalSecondaryButton,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.modalSecondaryText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                      Home
                    </Text>
                  </Pressable>
                </View>
              </LinearGradient>
            </View>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },

  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingTitle: { fontSize: 32, fontFamily: 'Geist-Bold', fontWeight: '900', marginBottom: 18 },
  loadingSubtitle: { fontSize: 16, fontFamily: 'Geist-Regular' },

  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  topBarBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 22,
    fontFamily: 'Geist-Bold',
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  turnPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  turnPillText: { fontSize: 11, fontFamily: 'Geist-Bold', fontWeight: '800' },

  playerCardRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 6,
  },

  playerCard: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    gap: 4,
  },
  playerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    resizeMode: 'cover',
  },
  youBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#0060FF',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  youBadgeText: { fontSize: 8, fontWeight: '800', color: '#FFFFFF' },
  playerName: {
    fontSize: 12,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
    maxWidth: 120,
  },
  playerStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerStatBlock: { alignItems: 'center' },
  playerStatLabel: { fontSize: 8, letterSpacing: 1, fontFamily: 'Geist-Regular' },
  playerStatValue: { fontSize: 18, fontFamily: 'Geist-Bold', fontWeight: '800' },
  playerStatDivider: { width: 1, height: 24 },

  boardWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  board: {
    borderRadius: 18,
    padding: 10,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardRow: { flexDirection: 'row' },
  boardCell: {
    margin: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cellLetter: {
    fontFamily: 'Geist-Bold',
    fontWeight: '800',
    zIndex: 2,
  },
  cellToken: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontFamily: 'Geist-Bold',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
    zIndex: 2,
  },
  opponentShimmer: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    backgroundColor: 'rgba(255,255,255,0.72)',
    zIndex: 1,
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
    fontSize: 44,
    fontWeight: '900',
    fontFamily: 'Geist-Bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 14,
  },

  notYourTurnOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notYourTurnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },

  blocksBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 12,
    borderRadius: 16,
  },
  draggableGradient: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draggableCount: {
    color: '#FFFFFF',
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
    fontSize: 16,
  },
  draggableTokenSymbol: {
    color: '#FFFFFF',
    fontFamily: 'Geist-Bold',
    fontWeight: '900',
    fontSize: 22,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
  draggableTokenCount: {
    position: 'absolute',
    top: 4,
    left: 6,
    color: '#FFFFFF',
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
    fontSize: 11,
  },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
  },
  bottomTurnPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bottomTurnText: { fontSize: 11, fontFamily: 'Geist-Bold', fontWeight: '800' },
  bottomMoveText: { fontSize: 12, fontFamily: 'Geist-Bold', fontWeight: '700' },
  bottomForfeitBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.2)',
  },

  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalCard: {
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
    elevation: 14,
  },
  modalIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: 'Geist-Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 18,
  },
  modalSecondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryText: {
    fontSize: 15,
    fontFamily: 'Geist-Regular',
    fontWeight: '700',
  },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalPrimaryGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Geist-Bold',
    fontWeight: '700',
  },

  gameOverTitle: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: 'Geist-Bold',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  gameOverReason: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: 'Geist-Regular',
    textAlign: 'center',
  },
  gameOverScoreRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 14,
  },
  gameOverScoreBox: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  gameOverScoreLabel: {
    fontSize: 11,
    fontFamily: 'Geist-Regular',
    fontWeight: '600',
  },
  gameOverScoreValue: {
    fontSize: 22,
    fontFamily: 'Geist-Bold',
    fontWeight: '800',
    marginTop: 2,
  },
});
