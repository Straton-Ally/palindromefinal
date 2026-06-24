"use client"

import { authService } from "@/authService"
import { ColorBlindMode, useSettings } from "@/context/SettingsContext"
import { useThemeContext } from "@/context/ThemeContext"
import { useSound } from "@/hooks/use-sound"
import { DEFAULT_GAME_GRADIENTS } from "@/lib/gameColors"
import { GRID_SIZE, NUM_COLORS, scoreNewPalindromes } from "@/lib/gameEngine"
import {
  getTurnMatchState, initTurnBoard, submitTurnMove,
  forfeitTurnMatch, subscribeToTurnState, ensureTurnMatchReady, expireTurnClock,
  type TurnMatchState, TURN_TIME_LIMIT_MS,
} from "@/lib/turnMatchmaking"
import { getMatch, type Match } from "@/lib/matchmaking"
import { Ionicons } from "@expo/vector-icons"
import { BlurView } from "expo-blur"
import { useLocalSearchParams, useRouter } from "expo-router"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Image, Pressable, StyleSheet } from "react-native"

// ── Layout helpers ──────────────────────────────────────
const getLayoutConfig = () => {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024
  const vh = typeof window !== "undefined" ? window.innerHeight : 800
  const TOP_BAR = 52, PAD = 12, GAP = 10

  if (vw >= 900) {
    const leftW = Math.min(220, Math.max(160, Math.floor(vw * 0.14)))
    const rightW = Math.min(220, Math.max(160, Math.floor(vw * 0.14)))
    const availW = vw - leftW - rightW - GAP * 2 - PAD * 2
    const availH = vh - TOP_BAR - PAD * 2 - 40
    const boardSize = Math.max(Math.min(availW, availH, 600), 280)
    const cellSize = Math.max(Math.floor((boardSize - 108) / 11), 22)
    const squareSize = Math.min(leftW - 24, 70, Math.floor(availH / 8))
    return { boardSize, cellSize, colorBlock: { width: squareSize, height: squareSize }, leftPanelW: leftW, rightPanelW: rightW }
  }
  if (vw >= 600) {
    const boardSize = Math.max(Math.min(vw - 60, Math.floor(vh * 0.44), 480), 240)
    const cellSize = Math.max(Math.floor((boardSize - 108) / 11), 19)
    return { boardSize, cellSize, colorBlock: { width: 50, height: 46 }, leftPanelW: 0, rightPanelW: 0 }
  }
  const boardSize = Math.max(Math.min(vw - 16, Math.floor(vh * 0.40), 360), 240)
  const cellSize = Math.max(Math.floor((boardSize - 108) / 11), 15)
  return { boardSize, cellSize, colorBlock: { width: 44, height: 40 }, leftPanelW: 0, rightPanelW: 0 }
}

const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ["●", "▲", "■", "◆", "★"], emojis: ["🍓", "🥑", "🫐", "🖤", "🍋"],
  cards: ["♥", "♣", "♦", "♠", "★"], letters: ["A", "B", "C", "D", "E"],
} as const

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function getTurnStartedAtMs(state: TurnMatchState | null): number {
  if (!state?.turn_started_at) return Date.now()
  const parsed = Date.parse(state.turn_started_at)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

type GameOverInfo = { winner: string | null; reason: string | null; myScore: number; opScore: number }

function getGameOverTitle(info: GameOverInfo, userId: string | null): string {
  if (info.winner === userId) return "You Win!"
  if (info.winner === null) return "It's a Draw!"
  return "You Lose!"
}

function getGameOverReason(info: GameOverInfo, userId: string | null): string {
  const didWin = info.winner === userId
  const didDraw = info.winner === null
  if (info.reason === "timeout") return didWin ? "Opponent lost on time" : "You lost on time"
  if (info.reason === "forfeit") return didWin ? "Opponent forfeited" : "You forfeited"
  if (info.reason === "score" || info.reason === "blocks_used") {
    if (didDraw) return "Draw by score"
    return didWin ? "You won by score" : "You lost by score"
  }
  if (info.reason === "board_full") {
    if (didDraw) return "Board full, draw by score"
    return didWin ? "Board full, you won by score" : "Board full, you lost by score"
  }
  return didDraw ? "Draw" : didWin ? "You won by score" : "You lost by score"
}

// ── Draggable Block ─────────────────────────────────────
function DraggableBlock({ colorIndex, gradient, count, layoutConfig, onDragStart, disabled }: {
  colorIndex: number; gradient: readonly [string, string]; count: number
  layoutConfig: any; onDragStart: (c: number) => void; disabled: boolean
}) {
  const { colorBlindEnabled, colorBlindMode } = useSettings()
  const token = colorBlindEnabled ? COLOR_BLIND_TOKENS[colorBlindMode][colorIndex] ?? "?" : null
  const canDrag = count > 0 && !disabled

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => { if (canDrag) { e.dataTransfer.setData("color", colorIndex.toString()); e.dataTransfer.effectAllowed = "copy"; onDragStart(colorIndex) } else e.preventDefault() }}
      style={{
        width: layoutConfig.colorBlock.width, height: layoutConfig.colorBlock.height,
        borderRadius: 10, position: "relative", display: "flex", justifyContent: "center", alignItems: "center",
        opacity: canDrag ? 1 : 0.35, cursor: canDrag ? "grab" : "not-allowed",
        background: `linear-gradient(to right bottom, ${gradient[0]}, ${gradient[1]})`,
        userSelect: "none", fontFamily: "Geist-Regular, system-ui",
      }}
    >
      {token && <span style={{ position: "absolute", top: 4, left: 6, color: "#fff", fontWeight: "700", fontSize: 12, userSelect: "none" }}>{count}</span>}
      <span style={{ color: "#fff", fontWeight: token ? "900" : "700", fontSize: token ? 24 : 18, textShadow: token ? "0 1px 3px rgba(0,0,0,0.4)" : "none", userSelect: "none" }}>{token ? token : count}</span>
    </div>
  )
}

// ── Player Card ─────────────────────────────────────────
function PlayerCard({ name, avatar, score, timeMs, isActive, isYou, theme, colors }: {
  name: string; avatar: string | null; score: number; timeMs: number
  isActive: boolean; isYou: boolean; theme: string; colors: any
}) {
  const isDark = theme === "dark"
  const borderColor = isActive ? (isYou ? "#22c55e" : "#ef4444") : "transparent"
  const glowColor = isActive ? (isYou ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)") : "none"

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      padding: "12px 10px", borderRadius: 16,
      background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
      border: `2px solid ${borderColor}`, boxShadow: isActive ? `0 0 20px ${glowColor}` : (isDark ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)"),
      width: "100%", transition: "all 0.3s ease",
    }}>
      <div style={{ position: "relative" }}>
        <Image source={avatar ? { uri: avatar } : require("../../assets/images/profile_ph.png")}
          style={{ width: 44, height: 44, borderRadius: 22, resizeMode: "contain", borderWidth: 2.5, borderColor: isActive ? borderColor : colors.accent } as any} />
        {isYou && <div style={{ position: "absolute", bottom: -2, right: -2, background: colors.accent, borderRadius: 8, padding: "1px 5px", fontSize: 8, fontWeight: 800, color: "#fff" }}>YOU</div>}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: colors.text, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{name}</span>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: colors.secondaryText }}>Score</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.accent }}>{score}</div>
        </div>
        <div style={{ width: 1, height: 28, background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: colors.secondaryText }}>Time</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: timeMs < 30000 ? "#ef4444" : timeMs < 60000 ? "#f59e0b" : "#95DEFE", fontFamily: "system-ui" }}>{formatTime(timeMs)}</div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function TurnGameWeb() {
  const router = useRouter()
  const { matchId: routeMatchId } = useLocalSearchParams<{ matchId?: string }>()
  const matchId = typeof routeMatchId === "string" ? routeMatchId : undefined

  const { theme, colors } = useThemeContext()
  const { palindromeAnimationsEnabled, colorBlindEnabled, colorBlindMode, customGameColors } = useSettings()
  const { playPickupSound, playDropSound, playErrorSound, playSuccessSound } = useSound()

  // ── State ──
  const [turnState, setTurnState] = useState<TurnMatchState | null>(null)
  const [match, setMatch] = useState<Match | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [myName, setMyName] = useState("You")
  const [myAvatar, setMyAvatar] = useState<string | null>(null)
  const [opponentName, setOpponentName] = useState("Opponent")
  const [opponentAvatar, setOpponentAvatar] = useState<string | null>(null)
  const [boardInitialized, setBoardInitialized] = useState(false)
  const [forfeitConfirm, setForfeitConfirm] = useState(false)
  const [gameOverInfo, setGameOverInfo] = useState<GameOverInfo | null>(null)

  const [localTimeP1, setLocalTimeP1] = useState(TURN_TIME_LIMIT_MS)
  const [localTimeP2, setLocalTimeP2] = useState(TURN_TIME_LIMIT_MS)
  const turnStartedLocal = useRef<number>(Date.now())
  const lastMoveTime = useRef<number>(Date.now())

  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null)
  const [pendingPlacedCell, setPendingPlacedCell] = useState<{ row: number; col: number; colorIndex: number } | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; color: string; id: number } | null>(null)
  const [scoredCells, setScoredCells] = useState<string[]>([])
  const [scoredCellsRun, setScoredCellsRun] = useState(0)
  const scoredCellsTimerRef = useRef<any>(null)
  const [scoringInProgress, setScoringInProgress] = useState(false)
  const scoringInProgressRef = useRef(false)
  const pendingGameOverInfoRef = useRef<GameOverInfo | null>(null)
  const timeoutSubmittingRef = useRef(false)
  const previousBoardRef = useRef<(number | null)[][] | null>(null)
  const opponentShimmerTimerRef = useRef<any>(null)
  const [opponentChangedCells, setOpponentChangedCells] = useState<string[]>([])
  const [, forceUpdate] = useState(0)

  const gridSize = GRID_SIZE
  const colorGradients = useMemo(() => customGameColors ?? [...DEFAULT_GAME_GRADIENTS], [customGameColors])
  const center = Math.floor(gridSize / 2)
  const word = "PALINDROME®"
  const halfWord = Math.floor(word.length / 2)

  // Derived state
  const isPlayer1 = turnState ? userId === turnState.player1_user_id : false
  const isMyTurn = turnState ? turnState.current_turn_user_id === userId : false
  const isGameOver = turnState ? turnState.finished_reason !== null : false
  const myBlocks = useMemo(
    () => (turnState ? (isPlayer1 ? turnState.player1_blocks : turnState.player2_blocks) : [8, 8, 8, 8, 8]),
    [isPlayer1, turnState]
  )
  const myScore = turnState ? (isPlayer1 ? turnState.player1_score : turnState.player2_score) : 0
  const opScore = turnState ? (isPlayer1 ? turnState.player2_score : turnState.player1_score) : 0
  const board: (number | null)[][] = turnState?.board?.length === gridSize ? turnState.board : Array.from({ length: gridSize }, () => Array(gridSize).fill(null))
  const bulldogPositions = useMemo(() => turnState?.bulldog_positions ?? [], [turnState])

  const showOpponentMoveShimmer = useCallback((cells: string[]) => {
    if (cells.length === 0) return
    if (opponentShimmerTimerRef.current) clearTimeout(opponentShimmerTimerRef.current)
    setOpponentChangedCells(cells)
    opponentShimmerTimerRef.current = setTimeout(() => {
      setOpponentChangedCells([])
      opponentShimmerTimerRef.current = null
    }, 1300)
  }, [])

  const captureOpponentBoardChanges = useCallback((nextState: TurnMatchState) => {
    const previousBoard = previousBoardRef.current
    const previousTurn = turnState?.current_turn_user_id
    previousBoardRef.current = nextState.board
    if (!previousBoard || !userId) return
    if (previousTurn === userId || nextState.current_turn_user_id !== userId) return

    const changed: string[] = []
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        if (previousBoard[row]?.[col] == null && nextState.board[row]?.[col] != null) {
          changed.push(`${row},${col}`)
        }
      }
    }
    showOpponentMoveShimmer(changed)
  }, [gridSize, showOpponentMoveShimmer, turnState?.current_turn_user_id, userId])

  const finishTurnScoring = useCallback(() => {
    if (scoredCellsTimerRef.current) clearTimeout(scoredCellsTimerRef.current)
    scoredCellsTimerRef.current = null
    setScoredCells([])
    setFeedback(null)
    scoringInProgressRef.current = false
    setScoringInProgress(false)
    if (pendingGameOverInfoRef.current) {
      setGameOverInfo(pendingGameOverInfoRef.current)
      pendingGameOverInfoRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (scoredCellsTimerRef.current) clearTimeout(scoredCellsTimerRef.current)
      if (opponentShimmerTimerRef.current) clearTimeout(opponentShimmerTimerRef.current)
    }
  }, [])

  // ── Layout ──
  useEffect(() => { const h = () => forceUpdate(n => n + 1); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h) }, [])
  const layoutConfig = getLayoutConfig()

  // ── Auth ──
  useEffect(() => {
    (async () => {
      const user = await authService.getSessionUser()
      if (user) {
        setUserId(user.id)
        const p = await authService.getProfile(user.id)
        if (p?.full_name) setMyName(p.full_name)
        if (p?.avatar_url) setMyAvatar(p.avatar_url)
      }
    })()
  }, [])

  // ── Load match + state ──
  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    ;(async () => {
      const m = await getMatch(matchId)
      if (cancelled || !m) return
      setMatch(m)
      const s = await getTurnMatchState(matchId)
      if (cancelled || !s) return
      const readyState = (await ensureTurnMatchReady(matchId, m.seed)) ?? s
      if (cancelled) return
      setTurnState(readyState)
      setLocalTimeP1(readyState.player1_time_ms)
      setLocalTimeP2(readyState.player2_time_ms)
      turnStartedLocal.current = getTurnStartedAtMs(readyState)
      lastMoveTime.current = getTurnStartedAtMs(readyState)

      // Init board if needed
      if (m.status === "active" && (!readyState.board || (Array.isArray(readyState.board) && readyState.board.length === 0))) {
        await initTurnBoard(matchId, m.seed)
        await ensureTurnMatchReady(matchId, m.seed)
        setBoardInitialized(true)
        // Refetch after init
        const s2 = await getTurnMatchState(matchId)
        if (s2 && !cancelled) {
          setTurnState(s2)
          setLocalTimeP1(s2.player1_time_ms)
          setLocalTimeP2(s2.player2_time_ms)
          turnStartedLocal.current = getTurnStartedAtMs(s2)
          lastMoveTime.current = getTurnStartedAtMs(s2)
        }
      } else {
        setBoardInitialized(true)
      }

      // Load opponent profile
      const user = await authService.getSessionUser()
      const latestState = (await getTurnMatchState(matchId)) ?? readyState
      if (!cancelled) {
        previousBoardRef.current = latestState.board
        setTurnState(latestState)
      }
      const opId = latestState.player1_user_id === user?.id ? latestState.player2_user_id : latestState.player1_user_id
      if (opId && opId !== user?.id) {
        const opProfile = await authService.getProfile(opId)
        if (opProfile?.full_name && !cancelled) setOpponentName(opProfile.full_name)
        if (opProfile?.avatar_url && !cancelled) setOpponentAvatar(opProfile.avatar_url)
      }
    })()
    return () => { cancelled = true }
  }, [matchId])

  // ── Realtime subscription ──
  useEffect(() => {
    if (!matchId) return
    const unsub = subscribeToTurnState(matchId, (s) => {
      captureOpponentBoardChanges(s)
      setTurnState(s)
      setLocalTimeP1(s.player1_time_ms)
      setLocalTimeP2(s.player2_time_ms)
      turnStartedLocal.current = getTurnStartedAtMs(s)
      lastMoveTime.current = getTurnStartedAtMs(s)
      if (s.finished_reason && !gameOverInfo) {
        const isP1 = userId === s.player1_user_id
        const nextGameOverInfo = {
          winner: s.winner_user_id,
          reason: s.finished_reason,
          myScore: isP1 ? s.player1_score : s.player2_score,
          opScore: isP1 ? s.player2_score : s.player1_score,
        }
        if (scoringInProgressRef.current) pendingGameOverInfoRef.current = nextGameOverInfo
        else setGameOverInfo(nextGameOverInfo)
      }
    })
    return unsub
  }, [captureOpponentBoardChanges, matchId, userId, gameOverInfo])

  // ── Chess clock tick ──
  useEffect(() => {
    if (!turnState || isGameOver || !turnState.current_turn_user_id || scoringInProgress) return
    const interval = setInterval(() => {
      const elapsed = Math.max(0, Date.now() - turnStartedLocal.current)
      const isP1Turn = turnState.current_turn_user_id === turnState.player1_user_id
      const activeUserId = turnState.current_turn_user_id
      const expireActiveClock = () => {
        if (!matchId || !activeUserId || timeoutSubmittingRef.current) return
        timeoutSubmittingRef.current = true
        expireTurnClock(matchId, activeUserId)
          .then((s) => {
            setTurnState(s)
            setLocalTimeP1(s.player1_time_ms)
            setLocalTimeP2(s.player2_time_ms)
          })
          .catch(console.error)
          .finally(() => {
            timeoutSubmittingRef.current = false
          })
      }
      if (isP1Turn) {
        const newTime = Math.max(0, turnState.player1_time_ms - elapsed)
        setLocalTimeP1(newTime)
        if (newTime <= 0) expireActiveClock()
      } else {
        const newTime = Math.max(0, turnState.player2_time_ms - elapsed)
        setLocalTimeP2(newTime)
        if (newTime <= 0) expireActiveClock()
      }
    }, 100)
    return () => clearInterval(interval)
  }, [turnState, isGameOver, matchId, scoringInProgress])

  // ── Game over detection ──
  useEffect(() => {
    if (turnState?.finished_reason && !gameOverInfo && userId) {
      const isP1 = userId === turnState.player1_user_id
      const nextGameOverInfo = {
        winner: turnState.winner_user_id,
        reason: turnState.finished_reason,
        myScore: isP1 ? turnState.player1_score : turnState.player2_score,
        opScore: isP1 ? turnState.player2_score : turnState.player1_score,
      }
      if (scoringInProgressRef.current) pendingGameOverInfoRef.current = nextGameOverInfo
      else setGameOverInfo(nextGameOverInfo)
    }
  }, [turnState, gameOverInfo, userId])

  // ── Palindrome check (client-side for scoring) ──
  const checkAndScore = useCallback((row: number, col: number, _colorIdx: number, currentGrid: (number | null)[][], previousGrid?: (number | null)[][]): {
    scoreFound: number
    events: { score: number; segment: { r: number; c: number }[]; segmentLength: number }[]
  } => {
    const { score, events } = scoreNewPalindromes([{ row, col }], currentGrid, bulldogPositions, 3, previousGrid)
    return {
      scoreFound: score,
      events: events.map((event) => ({
        score: event.score,
        segment: event.segment,
        segmentLength: event.segmentLength,
      })),
    }
  }, [bulldogPositions])

  const getScoringFeedback = (length: number) => {
    if (length >= 9) return { text: "LEGENDARY!", color: "#F472B6" }
    if (length === 7) return { text: "AMAZING!", color: "#A78BFA" }
    if (length === 5) return { text: "GREAT!", color: "#60A5FA" }
    return { text: "GOOD!", color: "#4ADE80" }
  }

  const waitForTurnScoringFrame = (ms: number) => new Promise<void>((resolve) => {
    if (scoredCellsTimerRef.current) clearTimeout(scoredCellsTimerRef.current)
    scoredCellsTimerRef.current = setTimeout(() => {
      scoredCellsTimerRef.current = null
      resolve()
    }, ms)
  })

  // ── Handle drop ──
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, row: number, col: number) => {
    e.preventDefault()
    setDragOverCell(null)
    if (!isMyTurn || isGameOver || !matchId || !userId || !turnState || scoringInProgressRef.current) { playErrorSound(); return }

    const colorIndex = parseInt(e.dataTransfer.getData("color"), 10)
    if (isNaN(colorIndex) || colorIndex < 0 || colorIndex >= NUM_COLORS) { playErrorSound(); return }
    if (board[row][col] !== null) { playErrorSound(); return }
    if (myBlocks[colorIndex] <= 0) { playErrorSound(); return }

    // Client-side scoring check
    const tempGrid = board.map(r => [...r])
    tempGrid[row][col] = colorIndex
    const { scoreFound: scoreDelta, events: scoringEvents } = checkAndScore(row, col, colorIndex, tempGrid, board)
    const isLastOwnBlock = myBlocks.reduce((total, count) => total + count, 0) === 1

    if (scoreDelta <= 0 && !isLastOwnBlock) {
      playErrorSound()
      return
    }

    playDropSound()
    const timeSpent = Math.max(0, Date.now() - getTurnStartedAtMs(turnState))
    lastMoveTime.current = Date.now()
    setPendingPlacedCell({ row, col, colorIndex })

    if (palindromeAnimationsEnabled) {
      scoringInProgressRef.current = true
      setScoringInProgress(true)
      const eventsToAnimate = scoringEvents.length > 0
        ? scoringEvents
        : [{ score: 0, segment: [{ r: row, c: col }], segmentLength: 0 }]

      for (let index = 0; index < eventsToAnimate.length; index += 1) {
        const event = eventsToAnimate[index]
        const feedbackForLength = scoreDelta <= 0
          ? { text: "DONE!", color: "#95DEFE" }
          : getScoringFeedback(event.segmentLength)
        setFeedback({ text: feedbackForLength.text, color: feedbackForLength.color, id: Date.now() + index })
        setScoredCells(event.segment.map((tile) => `${tile.r},${tile.c}`))
        setScoredCellsRun(Date.now() + index)
        await waitForTurnScoringFrame(index === eventsToAnimate.length - 1 ? 2000 : 900)
      }

      finishTurnScoring()
    }

    try {
      playSuccessSound()
      const newState = await submitTurnMove(matchId, userId, row, col, colorIndex, scoreDelta, timeSpent)
      previousBoardRef.current = newState.board
      setTurnState(newState)
      setLocalTimeP1(newState.player1_time_ms)
      setLocalTimeP2(newState.player2_time_ms)
      turnStartedLocal.current = getTurnStartedAtMs(newState)
      lastMoveTime.current = getTurnStartedAtMs(newState)
      setPendingPlacedCell(null)
    } catch (err) {
      console.error("Move submit error:", err)
      setPendingPlacedCell(null)
      playErrorSound()
    }
  }

  const handleForfeit = async () => {
    if (!matchId || !userId) return
    try { await forfeitTurnMatch(matchId, userId) } catch (e) { console.error(e) }
    setForfeitConfirm(false)
  }

  // ── My / opponent display values ──
  const myTimeMs = isPlayer1 ? localTimeP1 : localTimeP2
  const opTimeMs = isPlayer1 ? localTimeP2 : localTimeP1
  const opAvatar = opponentAvatar
  const opName = opponentName

  const isDark = theme === "dark"

  // ── Waiting state ──
  if (!turnState || !boardInitialized || !match || match.status === "waiting") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: isDark ? "#0a0a1c" : "#f0f4ff", fontFamily: "Geist-Regular, system-ui" }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: colors.accent, marginBottom: 20 }}>PALINDROME®</div>
        <div style={{ fontSize: 18, color: colors.text, marginBottom: 12 }}>Loading turn match...</div>
        <div style={{ width: 40, height: 40, border: `3px solid ${colors.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", height: "100vh", overflow: "hidden",
      background: isDark ? "linear-gradient(135deg, #00000f 0%, #00004a 60%, #000074 100%)" : "linear-gradient(135deg, #eef2ff 0%, #f5f0ff 60%, #fff 100%)",
      width: "100%", boxSizing: "border-box", padding: "10px 10px 0", fontFamily: "Geist-Regular, system-ui",
    }}>
      {/* Game Over Overlay */}
      {gameOverInfo && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
          <BlurView intensity={20} tint="default" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 30px", height: "100%", width: "100%", backgroundColor: "rgba(0,0,0,0.4)" }}>
              <div style={{ width: "100%", maxWidth: 420, borderRadius: 32, padding: 32, boxShadow: "0px 20px 40px rgba(0,0,0,0.4)", background: isDark ? "linear-gradient(to right bottom, #000017, #000074)" : "#FFFFFF", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.1)", alignItems: "center", gap: 10 }}>
                <div style={{ width: 72, height: 72, borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", background: gameOverInfo.winner === userId ? "linear-gradient(to right, #22c55e, #16a34a)" : gameOverInfo.winner === null ? "linear-gradient(to right, #f59e0b, #d97706)" : "linear-gradient(to right, #ef4444, #dc2626)", marginBottom: 6 }}>
                  <Ionicons name={gameOverInfo.winner === userId ? "trophy" : gameOverInfo.winner === null ? "remove" : "close-circle"} size={34} color="#fff" />
                </div>
                <h2 style={{ fontSize: 26, fontWeight: 800, color: colors.text, margin: 0, textAlign: "center" }}>
                  {getGameOverTitle(gameOverInfo, userId)}
                </h2>
                <p style={{ fontSize: 14, color: colors.text, opacity: 0.7, margin: 0, textAlign: "center" }}>
                  {getGameOverReason(gameOverInfo, userId)}
                </p>
                <div style={{ display: "flex", gap: 20, width: "100%", marginTop: 8 }}>
                  <div style={{ flex: 1, padding: "10px", borderRadius: 16, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)", textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: colors.secondaryText }}>Your Score</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: colors.accent }}>{gameOverInfo.myScore}</div>
                  </div>
                  <div style={{ flex: 1, padding: "10px", borderRadius: 16, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)", textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: colors.secondaryText }}>Opponent</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#ef4444" }}>{gameOverInfo.opScore}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, width: "100%", marginTop: 14 }}>
                  <Pressable onPress={() => router.push("/multiplayer")} style={{ flex: 1 }}>
                    <div style={{ padding: 16, borderRadius: 16, background: "linear-gradient(to right, #7C3AED, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Play Again</span>
                    </div>
                  </Pressable>
                  <Pressable onPress={() => router.push("/")} style={{ flex: 1 }}>
                    <div style={{ padding: 16, borderRadius: 16, background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>Home</span>
                    </div>
                  </Pressable>
                </div>
              </div>
            </div>
          </BlurView>
        </div>
      )}

      {/* Forfeit Confirmation */}
      {forfeitConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
          <BlurView intensity={20} tint="default" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 30px", height: "100%", width: "100%", backgroundColor: "rgba(0,0,0,0.4)" }}>
              <div style={{ width: "100%", maxWidth: 400, borderRadius: 32, padding: 32, background: isDark ? "linear-gradient(to right bottom, #000017, #000074)" : "#FFFFFF", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.1)", alignItems: "center" }}>
                <h2 style={{ fontSize: 24, fontWeight: 700, color: colors.text, marginBottom: 16, textAlign: "center", marginTop: 0 }}>Forfeit Match?</h2>
                <p style={{ fontSize: 16, color: colors.text, opacity: 0.8, marginBottom: 32, textAlign: "center" }}>Your opponent will win. This cannot be undone.</p>
                <div style={{ display: "flex", gap: 20, width: "100%" }}>
                  <Pressable onPress={() => setForfeitConfirm(false)} style={{ flex: 1 }}>
                    <div style={{ padding: 16, borderRadius: 16, background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <span style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Cancel</span>
                    </div>
                  </Pressable>
                  <Pressable onPress={handleForfeit} style={{ flex: 1 }}>
                    <div style={{ padding: 16, borderRadius: 16, background: "linear-gradient(to right, #ef4444, #dc2626)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Forfeit</span>
                    </div>
                  </Pressable>
                </div>
              </div>
            </div>
          </BlurView>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        @keyframes popIn { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes floatUp { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-60px); opacity: 0; } }
        @keyframes pulse { 0%,100% { opacity: 0.5; transform: scale(0.97); } 50% { opacity: 1; transform: scale(1.03); } }
        @keyframes scorePulse { 0% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); } 35% { box-shadow: 0 0 22px rgba(255,215,0,0.85); transform: scale(1.06); } 100% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); } }
        @keyframes scorePulseAlt { 0% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); } 35% { box-shadow: 0 0 22px rgba(255,215,0,0.85); transform: scale(1.06); } 100% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); } }
        @keyframes scoredBlockZoom { 0% { transform: scale(1); filter: brightness(1); } 35% { transform: scale(1.2); filter: brightness(1.22); } 70% { transform: scale(1.1); filter: brightness(1.1); } 100% { transform: scale(1); filter: brightness(1); } }
        @keyframes scoredBlockZoomAlt { 0% { transform: scale(1); filter: brightness(1); } 35% { transform: scale(1.2); filter: brightness(1.22); } 70% { transform: scale(1.1); filter: brightness(1.1); } 100% { transform: scale(1); filter: brightness(1); } }
        @keyframes scoreShimmer { 0% { opacity: 0; transform: translateX(-120%) skewX(-18deg); } 30% { opacity: 0.85; } 100% { opacity: 0; transform: translateX(120%) skewX(-18deg); } }
        @keyframes scoreShimmerAlt { 0% { opacity: 0; transform: translateX(-120%) skewX(-18deg); } 30% { opacity: 0.85; } 100% { opacity: 0; transform: translateX(120%) skewX(-18deg); } }
        @keyframes opponentMoveShimmer { 0% { opacity: 0; transform: translateX(-120%) skewX(-18deg); } 30% { opacity: 0.85; } 100% { opacity: 0; transform: translateX(120%) skewX(-18deg); } }
      `}</style>

      {/* Top Bar */}
      <div style={{ width: "100%", maxWidth: 1400, height: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <Pressable onPress={() => setForfeitConfirm(true)} style={{ position: "absolute", left: 8 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <span style={{ fontSize: "clamp(20px, 2.8vw, 32px)", fontWeight: 900, color: colors.accent, letterSpacing: -1 }}>PALINDROME®</span>
      </div>

      {/* Main 3-column Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "row", gap: 6, padding: "8px 12px 10px", width: "100%", maxWidth: 1400, minHeight: 0, overflow: "hidden", justifyContent: "center" }}>

        {/* LEFT: Your player card + blocks */}
        {layoutConfig.leftPanelW > 0 && (
          <div style={{ width: layoutConfig.leftPanelW, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, justifyContent: "center", alignItems: "center", paddingRight: 8 }}>
            <PlayerCard name={myName} avatar={myAvatar} score={myScore} timeMs={myTimeMs} isActive={isMyTurn} isYou={true} theme={theme} colors={colors} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 8px", borderRadius: 16, background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)", border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)", width: "100%", opacity: isMyTurn ? 1 : 0.5, transition: "opacity 0.3s" }}>
              {colorGradients.map((g, i) => <DraggableBlock key={i} colorIndex={i} gradient={g} count={myBlocks[i]} layoutConfig={layoutConfig} onDragStart={playPickupSound} disabled={!isMyTurn || isGameOver} />)}
            </div>
          </div>
        )}

        {/* CENTER: Board */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, minWidth: 0, minHeight: 0 }}>
          {/* Mobile: player cards above board */}
          {layoutConfig.leftPanelW === 0 && (
            <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: layoutConfig.boardSize, justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}><PlayerCard name={myName} avatar={myAvatar} score={myScore} timeMs={myTimeMs} isActive={isMyTurn} isYou={true} theme={theme} colors={colors} /></div>
              <div style={{ flex: 1 }}><PlayerCard name={opName} avatar={opAvatar} score={opScore} timeMs={opTimeMs} isActive={!isMyTurn && !isGameOver} isYou={false} theme={theme} colors={colors} /></div>
            </div>
          )}

          <div style={{
            borderRadius: 24, padding: 10, display: "flex", justifyContent: "center", alignItems: "center",
            background: isDark ? "linear-gradient(145deg, rgba(18,18,75,0.92), rgba(8,8,44,0.97))" : "linear-gradient(145deg, #f4f6ff, #e8eaf0)",
            boxShadow: isDark ? "0 0 0 1px rgba(100,120,255,0.18), 0 20px 60px rgba(0,0,0,0.65)" : "0 0 0 1px rgba(0,0,0,0.07), 0 20px 60px rgba(0,0,0,0.13)",
            width: "fit-content", height: "fit-content", position: "relative", flexShrink: 0,
          }}>
            {feedback && (
              <div style={{ position: "absolute", inset: 0, zIndex: 9999, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div key={feedback.id} style={{ animation: "popIn 0.5s ease-out forwards, floatUp 1.5s ease-in 1s forwards", width: "100%", textAlign: "center" }}>
                  <h2 style={{ fontSize: 56, fontWeight: 900, color: feedback.color, textShadow: "0px 4px 20px rgba(0,0,0,0.4)", margin: 0, whiteSpace: "nowrap" }}>{feedback.text}</h2>
                </div>
              </div>
            )}
            {/* Not your turn overlay */}
            {!isMyTurn && !isGameOver && (
              <div style={{ position: "absolute", inset: 0, zIndex: 100, borderRadius: 24, background: "rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.5)", padding: "8px 20px", borderRadius: 12 }}>Opponent&apos;s turn...</span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              {Array.from({ length: gridSize }, (_, row) => (
                <div key={row} style={{ display: "flex", flexDirection: "row" }}>
                  {Array.from({ length: gridSize }, (_, col) => {
                    const isBulldog = bulldogPositions.some(p => p.row === row && p.col === col)
                    let letter: string | null = null
                    if (row === center && col >= center - halfWord && col < center - halfWord + word.length) letter = word[col - (center - halfWord)]
                    if (col === center && row >= center - halfWord && row < center - halfWord + word.length) letter = word[row - (center - halfWord)]
                    const cellColor = pendingPlacedCell?.row === row && pendingPlacedCell.col === col
                      ? pendingPlacedCell.colorIndex
                      : board[row]?.[col] ?? null
                    const isHovered = dragOverCell?.row === row && dragOverCell?.col === col
                    const isScored = scoredCells.includes(`${row},${col}`)
                    const hasOpponentShimmer = opponentChangedCells.includes(`${row},${col}`)
                    const scoreIndex = isScored ? scoredCells.indexOf(`${row},${col}`) : 0
                    const scorePulseName = scoredCellsRun % 2 === 0 ? "scorePulse" : "scorePulseAlt"
                    const scoredBlockZoomName = scoredCellsRun % 2 === 0 ? "scoredBlockZoom" : "scoredBlockZoomAlt"
                    const scoreShimmerName = scoredCellsRun % 2 === 0 ? "scoreShimmer" : "scoreShimmerAlt"
                    const cellStyle: React.CSSProperties = {
                      width: layoutConfig.cellSize, height: layoutConfig.cellSize,
                      borderWidth: 1, borderStyle: "solid", borderColor: "#CCDAE466", borderRadius: 8, margin: 3,
                      display: "flex", justifyContent: "center", alignItems: "center",
                      backgroundColor: isDark ? "rgba(25,25,91,0.7)" : "#fff",
                      transition: "all 0.15s", position: "relative", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)",
                    }
                    if (isHovered) { cellStyle.backgroundColor = isDark ? "rgba(100,200,255,0.4)" : "rgba(100,200,255,0.3)"; cellStyle.borderColor = isDark ? "rgba(100,200,255,0.8)" : "rgba(50,150,255,0.6)"; cellStyle.transform = "scale(1.05)" }
                    if (isScored) { cellStyle.borderColor = "rgba(255,215,0,0.95)"; cellStyle.borderWidth = 2; cellStyle.animation = `${scorePulseName} 0.8s ease-out ${scoreIndex * 0.15}s both` }

                    return (
                      <div key={col}
                        onDragOver={(e) => { e.preventDefault(); if (board[row][col] === null) setDragOverCell({ row, col }); else setDragOverCell(null) }}
                        onDragEnter={(e) => { e.preventDefault(); if (board[row][col] === null) setDragOverCell({ row, col }) }}
                        onDragLeave={() => setDragOverCell(null)}
                        onDrop={(e) => handleDrop(e, row, col)}
                        style={cellStyle}
                      >
                        {cellColor !== null && <div style={{ width: "100%", height: "100%", borderRadius: 6, background: `linear-gradient(to right bottom, ${colorGradients[cellColor][0]}, ${colorGradients[cellColor][1]})`, position: "absolute", top: 0, left: 0, boxShadow: "0 2px 5px rgba(0,0,0,0.2)", transformOrigin: "center", animation: isScored ? `${scoredBlockZoomName} 0.8s ease-out ${scoreIndex * 0.15}s both` : undefined }} />}
                        {isScored && (
                          <div style={{ position: "absolute", inset: 0, borderRadius: 6, overflow: "hidden", zIndex: 1, pointerEvents: "none" }}>
                            <div style={{
                              position: "absolute", top: "-20%", bottom: "-20%", width: "60%",
                              background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.85), rgba(255,255,255,0))",
                              animation: `${scoreShimmerName} 0.8s ease-out ${scoreIndex * 0.15}s both`,
                            }} />
                          </div>
                        )}
                        {hasOpponentShimmer && (
                          <div style={{ position: "absolute", inset: 0, borderRadius: 6, overflow: "hidden", zIndex: 1, pointerEvents: "none" }}>
                            <div style={{
                              position: "absolute", top: "-20%", bottom: "-20%", width: "60%",
                              background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.85), rgba(255,255,255,0))",
                              animation: "opponentMoveShimmer 1.1s ease-out both",
                            }} />
                          </div>
                        )}
                        <div style={{ zIndex: 2, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
                          {cellColor !== null && colorBlindEnabled && !letter && (
                            <span style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", color: "#fff", fontWeight: 900, fontSize: layoutConfig.cellSize > 40 ? 28 : 22, textShadow: "0 1px 4px rgba(0,0,0,0.45)", userSelect: "none" }}>
                              {COLOR_BLIND_TOKENS[colorBlindMode][cellColor]}
                            </span>
                          )}
                          {isBulldog && <img src="/bulldog.png" style={{ width: layoutConfig.cellSize - 10, height: layoutConfig.cellSize - 10, objectFit: "contain", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }} alt="bulldog" />}
                          {letter && <span style={{ color: colors.text, fontSize: layoutConfig.cellSize > 40 ? 18 : 15, fontWeight: 800, textShadow: cellColor !== null ? "0 1px 2px rgba(0,0,0,0.3)" : "none" }}>{letter}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Mobile: blocks below board */}
          {layoutConfig.leftPanelW === 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 16px", background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.8)", borderRadius: 18, opacity: isMyTurn ? 1 : 0.5, maxWidth: layoutConfig.boardSize }}>
              {colorGradients.map((g, i) => <DraggableBlock key={i} colorIndex={i} gradient={g} count={myBlocks[i]} layoutConfig={layoutConfig} onDragStart={playPickupSound} disabled={!isMyTurn || isGameOver} />)}
            </div>
          )}
        </div>

        {/* RIGHT: Opponent card + controls */}
        {layoutConfig.rightPanelW > 0 && (
          <div style={{ width: layoutConfig.rightPanelW, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, justifyContent: "center", alignItems: "center", paddingLeft: 8 }}>
            <PlayerCard name={opName} avatar={opAvatar} score={opScore} timeMs={opTimeMs} isActive={!isMyTurn && !isGameOver} isYou={false} theme={theme} colors={colors} />
            {/* Turn indicator card */}
            <div style={{ padding: "14px 16px", borderRadius: 16, background: isMyTurn ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", border: isMyTurn ? "2px solid rgba(34,197,94,0.4)" : "2px solid rgba(239,68,68,0.3)", width: "100%", textAlign: "center", animation: isMyTurn ? "pulse 2s infinite" : "none" }}>
              <Ionicons name={isMyTurn ? "hand-right" : "time-outline"} size={24} color={isMyTurn ? "#22c55e" : "#ef4444"} />
              <div style={{ fontSize: 14, fontWeight: 800, color: isMyTurn ? "#22c55e" : "#ef4444", marginTop: 4 }}>{isMyTurn ? "YOUR TURN" : "WAITING..."}</div>
            </div>
            {/* Move counter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 14, background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)", border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)", width: "100%" }}>
              <Ionicons name="analytics" size={18} color={colors.accent} />
              <span style={{ fontSize: 12, color: colors.secondaryText }}>Move</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: colors.accent, marginLeft: "auto" }}>{turnState.move_number}</span>
            </div>
            <div style={{ height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", width: "100%" }} />
            {/* Forfeit + Home */}
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <Pressable onPress={() => setForfeitConfirm(true)} style={{ flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "11px 6px", borderRadius: 14, cursor: "pointer", background: "linear-gradient(135deg, #ef4444, #dc2626)", transition: "transform 0.1s" }}
                  onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"} onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}>
                  <Ionicons name="flag" size={20} color="#fff" />
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", letterSpacing: 0.5 }}>FORFEIT</span>
                </div>
              </Pressable>
              <Pressable onPress={() => setForfeitConfirm(true)} style={{ flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "11px 6px", borderRadius: 14, cursor: "pointer", background: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)", border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)" }}
                  onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"} onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}>
                  <Ionicons name="home" size={20} color={colors.text} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: colors.text, letterSpacing: 0.5, opacity: 0.8 }}>HOME</span>
                </div>
              </Pressable>
            </div>
          </div>
        )}

        {/* Mobile bottom bar */}
        {layoutConfig.leftPanelW === 0 && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", padding: "8px 12px", background: isDark ? "rgba(5,5,30,0.97)" : "rgba(255,255,255,0.97)", borderTop: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)" }}>
              <div style={{ padding: "4px 10px", borderRadius: 8, background: isMyTurn ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: isMyTurn ? "#22c55e" : "#ef4444" }}>{isMyTurn ? "YOUR TURN" : "WAITING"}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: colors.secondaryText }}>Move {turnState.move_number}</span>
              <Pressable onPress={() => setForfeitConfirm(true)}>
                <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(239,68,68,0.2)" }}>
                  <Ionicons name="flag" size={15} color="#ef4444" />
                </div>
              </Pressable>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
