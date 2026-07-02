"use client"

import { authService } from "@/authService"
import { ColorBlindMode, useSettings } from "@/context/SettingsContext"
import { useThemeContext } from "@/context/ThemeContext"
import { useSound } from "@/hooks/use-sound"
import { DEFAULT_GAME_GRADIENTS } from "@/lib/gameColors"
import { checkAllPalindromes, createInitialState, createSinglePlayerInitialState, type ScoringResult } from "@/lib/gameEngine"
import { FIRST_MOVE_TIMEOUT_SECONDS, forfeitRaceMatch, getMatch, submitScore, subscribeToMatch, updateLiveScore, type Match, type MatchPlayer } from "@/lib/matchmaking"
import { getMyBestSinglePlayer, saveSinglePlayerRun } from "@/lib/singlePlayer"
import { Ionicons } from "@expo/vector-icons"
import { BlurView } from "expo-blur"
import { useLocalSearchParams, useRouter } from "expo-router"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Dimensions,
  Image,
  Pressable, // Keeps Pressable for unified event handling or allows simple onClick
  StyleSheet,
} from "react-native"
import { Switch } from "react-native-switch"

const { width } = Dimensions.get("window")

// Responsive layout configuration based on screen size
const getLayoutConfig = () => {
  const vw = typeof window !== "undefined" ? window.innerWidth : width
  const vh = typeof window !== "undefined" ? window.innerHeight : 800
  const TOP_BAR = 52
  const PAD = 12
  const GAP = 10

  if (vw >= 900) {
    // Desktop 3-column: LEFT | BOARD | RIGHT
    const leftW  = Math.min(200, Math.max(140, Math.floor(vw * 0.13)))
    const rightW = Math.min(260, Math.max(180, Math.floor(vw * 0.16)))
    const availW = vw - leftW - rightW - GAP * 2 - PAD * 2
    const availH = vh - TOP_BAR - PAD * 2 - 40
    const boardSize = Math.max(Math.min(availW, availH, 600), 280)
    const cellSize  = Math.max(Math.floor((boardSize - 108) / 11), 22)
    // Larger color blocks - use more of the left panel width
    const squareSize = Math.min(leftW - 24, 90, Math.floor(availH / 7))
    return {
      boardSize, cellSize,
      colorBlock:        { width: squareSize, height: squareSize },
      colorBlockWrapper: { width: squareSize, height: squareSize + 4 },
      leftPanelW: leftW, rightPanelW: rightW,
      statusGap: 0, mainLayoutGap: 0, controlsBottom: 0,
      statusMargin: { top: 0, bottom: 0 },
    }
  }

  if (vw >= 600) {
    // Tablet 2-column: BOARD | RIGHT  (blocks below board)
    const rightW = Math.min(190, Math.max(150, Math.floor(vw * 0.23)))
    const availW = vw - rightW - GAP * 3 - PAD * 2
    const availH = Math.floor(vh * 0.52)
    const boardSize = Math.max(Math.min(availW, availH, 480), 240)
    const cellSize  = Math.max(Math.floor((boardSize - 108) / 11), 19)
    return {
      boardSize, cellSize,
      colorBlock:        { width: 58, height: 54 },
      colorBlockWrapper: { width: 58, height: 58 },
      leftPanelW: 0, rightPanelW: rightW,
      statusGap: 0, mainLayoutGap: 0, controlsBottom: 0,
      statusMargin: { top: 0, bottom: 0 },
    }
  }

  // Mobile single-column
  const boardSize = Math.max(Math.min(vw - 16, Math.floor(vh * 0.45), 360), 240)
  const cellSize  = Math.max(Math.floor((boardSize - 108) / 11), 15)
  return {
    boardSize, cellSize,
    colorBlock:        { width: 48, height: 44 },
    colorBlockWrapper: { width: 48, height: 48 },
    leftPanelW: 0, rightPanelW: 0,
    statusGap: 0, mainLayoutGap: 0, controlsBottom: 0,
    statusMargin: { top: 0, bottom: 0 },
  }
}

const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ["●", "▲", "■", "◆", "★"],
  emojis: ["🍓", "🥑", "🫐", "🖤", "🍋"],
  cards: ["♥", "♣", "♦", "♠", "★"],
  letters: ["A", "B", "C", "D", "E"],
} as const

function getColorBlindToken(mode: ColorBlindMode, index: number) {
  return COLOR_BLIND_TOKENS[mode][index] ?? "?"
}

const DraggableBlock = ({
  colorIndex,
  gradient,
  count,
  layoutConfig,
  onDragStart,
}: {
  colorIndex: number
  gradient: readonly [string, string]
  count: number
  layoutConfig: any
  onDragStart: (colorIndex: number) => void
}) => {
  const { colorBlindEnabled, colorBlindMode } = useSettings()
  const [isDragging, setIsDragging] = useState(false)
  const token = colorBlindEnabled ? getColorBlindToken(colorBlindMode, colorIndex) : null

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (count > 0) {
      e.dataTransfer.setData("color", colorIndex.toString())
      e.dataTransfer.effectAllowed = "copy"
      setIsDragging(true)
      onDragStart(colorIndex)
    } else {
      e.preventDefault()
    }
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  return (
    <div
      style={{
        width: layoutConfig.colorBlock.width,
        height: layoutConfig.colorBlock.height,
        position: "relative",
        zIndex: isDragging ? 2000 : 1,
      }}
    >
      {/* Static Block (The Stack) */}
      {count > 1 && (
        <div
          style={{
            position: "absolute",
            width: layoutConfig.colorBlock.width,
            height: layoutConfig.colorBlock.height,
            borderRadius: 32,
            boxShadow: "none",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <div
            style={{
              background: `linear-gradient(to right bottom, ${gradient[0]}, ${gradient[1]})`,
              width: "100%",
              height: "100%",
              borderRadius: 10,
              position: "relative",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {token ? (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  left: 10,
                  color: "#fff",
                  fontWeight: "700",
                  fontSize: 14,
                  userSelect: "none",
                }}
              >
                {count}
              </span>
            ) : null}
            <span
              style={{
                color: "#fff",
                fontWeight: token ? "900" : "700",
                fontSize: token ? (layoutConfig.colorBlock.width > 90 ? 34 : 28) : (layoutConfig.colorBlock.width > 90 ? 24 : 20),
                textShadow: token ? "0 1px 4px rgba(0,0,0,0.45)" : "none",
                userSelect: "none",
              }}
            >
              {token ? token : count}
            </span>
          </div>
        </div>
      )}

      {/* Draggable Block */}
      <div
        draggable={count > 0}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{
          width: layoutConfig.colorBlock.width,
          height: layoutConfig.colorBlock.height,
          borderRadius: 32,
          boxShadow: "none",
          zIndex: isDragging ? 9999 : 2,
          opacity: count > 0 ? 1 : 0.5,
          cursor: count > 0 ? "grab" : "default",
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "Geist-Regular, system-ui",
        }}
      >
        <div
          style={{
            background: `linear-gradient(to right bottom, ${gradient[0]}, ${gradient[1]})`,
            width: "100%",
            height: "100%",
            borderRadius: 10,
            position: "relative",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            userSelect: "none",
          }}
        >
          {token ? (
            <span
              style={{
                position: "absolute",
                top: 8,
                left: 10,
                color: "#fff",
                fontWeight: "700",
                fontSize: 14,
                userSelect: "none",
              }}
            >
              {count}
            </span>
          ) : null}
          <span
            style={{
              color: "#fff",
              fontWeight: token ? "900" : "700",
              fontSize: token ? (layoutConfig.colorBlock.width > 90 ? 34 : 28) : (layoutConfig.colorBlock.width > 90 ? 24 : 20),
              textShadow: token ? "0 1px 4px rgba(0,0,0,0.45)" : "none",
              userSelect: "none",
            }}
          >
            {token ? token : count}
          </span>
        </div>
      </div>
    </div>
  )
}

function RacePlayerCard({
  name,
  avatar,
  score,
  time,
  isYou,
  isActive,
  theme,
  colors,
}: {
  name: string
  avatar: string | null
  score: number | null
  time: string
  isYou: boolean
  isActive: boolean
  theme: string
  colors: any
}) {
  const isDark = theme === "dark"
  const borderColor = isActive ? (isYou ? "#22c55e" : "#ef4444") : "transparent"
  const glowColor = isActive ? (isYou ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)") : "transparent"

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      padding: "12px 10px",
      borderRadius: 16,
      background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
      border: `2px solid ${borderColor}`,
      boxShadow: isActive ? `0 0 20px ${glowColor}` : (isDark ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)"),
      width: "100%",
      transition: "all 0.3s ease",
      fontFamily: "Geist-Regular, system-ui, sans-serif",
    }}>
      <div style={{ position: "relative" }}>
        <Image
          source={avatar ? { uri: avatar } : require("../../assets/images/profile_ph.png")}
          style={{ width: 44, height: 44, borderRadius: 22, resizeMode: "contain", borderWidth: 2.5, borderColor: isActive ? borderColor : colors.accent }}
          accessibilityLabel={isYou ? "Your profile" : "Opponent profile"}
        />
        {isYou ? (
        <div style={{ position: "absolute", bottom: -2, right: -2, background: colors.accent, borderRadius: 8, padding: "1px 5px", fontSize: 8, fontWeight: 800, color: "#fff", fontFamily: "Geist-Bold, system-ui, sans-serif" }}>YOU</div>
      ) : null}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: colors.text, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120, fontFamily: "Geist-Bold, system-ui, sans-serif" }}>
        {name}
      </span>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: colors.secondaryText, fontFamily: "Geist-Regular, system-ui, sans-serif" }}>Score</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.accent, fontFamily: "Geist-Bold, system-ui, sans-serif" }}>{score ?? "--"}</div>
        </div>
        <div style={{ width: 1, height: 28, background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: colors.secondaryText, fontFamily: "Geist-Regular, system-ui, sans-serif" }}>Time</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#95DEFE", fontFamily: "Geist-Bold, system-ui, sans-serif" }}>{time}</div>
        </div>
      </div>
    </div>
  )
}

type GameTutorialMode = "modal" | "coach"

type GameTutorialStep = {
  title: string
  description: string
  targetId?: string
  mode: GameTutorialMode
  showBack?: boolean
  showPrimary?: boolean
  primaryLabel?: string
}

type GameTutorialPhase = "ui" | "placeFirst" | "makeScore" | "complete"

const GAME_TUTORIAL_SEEN_KEY = "palindrome_game_tutorial_v1_seen"

function safeGetGameTutorialSeen(): boolean {
  try {
    if (typeof window === "undefined") return true
    return window.localStorage.getItem(GAME_TUTORIAL_SEEN_KEY) === "1"
  } catch {
    return true
  }
}

function safeSetGameTutorialSeen(): void {
  try {
    if (typeof window === "undefined") return
    window.localStorage.setItem(GAME_TUTORIAL_SEEN_KEY, "1")
  } catch {
    return
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

const VIDEO_GUIDE_SEEN_KEY = "palindrome_video_guide_v1_seen"

const GUIDE_SLIDES = [
  {
    video: "/demo/5_counter_first.mp4",
    title: "First Move",
    description: "Place two blocks that form a multi-color odd palindrome of length 5 or more.",
  },
  {
    video: "/demo/dog_counter_first.mp4",
    title: "Bulldog Cells",
    description: "Special cells block your placements — plan your moves around them!",
  },
  {
    video: "/demo/right_counter_first.mp4",
    title: "Scoring Palindromes",
    description: "Create odd-length color palindromes in rows, columns, or L-shapes to score points.",
  },
]

function safeGetVideoGuideSeen(): boolean {
  try {
    if (typeof window === "undefined") return true
    return window.localStorage.getItem(VIDEO_GUIDE_SEEN_KEY) === "1"
  } catch {
    return true
  }
}

function safeSetVideoGuideSeen(): void {
  try {
    if (typeof window === "undefined") return
    window.localStorage.setItem(VIDEO_GUIDE_SEEN_KEY, "1")
  } catch {
    return
  }
}

function GameTutorialOverlay(props: {
  open: boolean
  step: GameTutorialStep | null
  stepIndex: number
  stepsCount: number
  accentColor: string
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onDone: () => void
}) {
  const { open, step, stepIndex, stepsCount, accentColor, onBack, onNext, onSkip, onDone } = props
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!open) return

    const update = () => {
      if (!step?.targetId) {
        setRect(null)
        return
      }
      const el = document.getElementById(step.targetId)
      if (!el) {
        setRect(null)
        return
      }
      setRect(el.getBoundingClientRect())
    }

    const raf = requestAnimationFrame(() => {
      if (step?.targetId) {
        const el = document.getElementById(step.targetId)
        el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
      }
      update()
      setTimeout(update, 240)
      setTimeout(update, 600)
    })

    const interval = window.setInterval(update, 160)
    const killInterval = window.setTimeout(() => window.clearInterval(interval), 1400)

    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(interval)
      window.clearTimeout(killInterval)
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update)
    }
  }, [open, step?.targetId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip()
      if (e.key === "ArrowRight" || e.key === "Enter") onNext()
      if (e.key === "ArrowLeft") onBack()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onBack, onNext, onSkip])

  if (!open || !step) return null

  const isLast = stepIndex >= stepsCount - 1
  const viewportW = typeof window === "undefined" ? 1024 : window.innerWidth
  const viewportH = typeof window === "undefined" ? 768 : window.innerHeight
  const smallScreen = viewportW < 420 || viewportH < 520

  const highlightPad = 10
  const highlight = rect
    ? {
        left: rect.left - highlightPad,
        top: rect.top - highlightPad,
        width: rect.width + highlightPad * 2,
        height: rect.height + highlightPad * 2,
      }
    : null

  const tooltipW = smallScreen ? Math.max(240, viewportW - 32) : Math.min(420, viewportW - 32)
  const tooltipH = 190

  const baseLeft = highlight ? highlight.left + highlight.width / 2 - tooltipW / 2 : viewportW / 2 - tooltipW / 2
  const preferTop = highlight ? highlight.top > viewportH * 0.6 : false
  const baseTop = highlight
    ? preferTop
      ? highlight.top - tooltipH - 18
      : highlight.top + highlight.height + 18
    : viewportH / 2 - tooltipH / 2

  const tooltipLeft = smallScreen ? 16 : clamp(baseLeft, 16, viewportW - tooltipW - 16)
  const tooltipTop = smallScreen ? Math.max(16, viewportH - tooltipH - 16) : clamp(baseTop, 16, viewportH - tooltipH - 16)

  const blocksInteraction = step.mode === "modal"
  const showBack = step.showBack ?? false
  const showPrimary = step.showPrimary ?? true
  const primaryLabel = step.primaryLabel ?? (isLast ? "Continue" : "Next")

  return (
    <div
      role="dialog"
      aria-modal={blocksInteraction}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        fontFamily: "Geist-Regular, system-ui",
        pointerEvents: blocksInteraction ? "auto" : "none",
      }}
    >
      {highlight ? (
        <svg
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          <defs>
            <mask id="spotlight-mask-game">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={highlight.left}
                y={highlight.top}
                width={highlight.width}
                height={highlight.height}
                rx="22"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill={blocksInteraction ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.35)"}
            mask="url(#spotlight-mask-game)"
            style={{ backdropFilter: "blur(2px)" }}
          />
        </svg>
      ) : (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: blocksInteraction ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.35)",
            backdropFilter: "blur(2px)",
            pointerEvents: blocksInteraction ? "auto" : "none",
            zIndex: 1,
          }}
        />
      )}

      {highlight ? (
        <div
          style={{
            position: "fixed",
            left: highlight.left,
            top: highlight.top,
            width: highlight.width,
            height: highlight.height,
            borderRadius: 22,
            boxShadow: `0 0 0 2px ${accentColor}, 0 16px 40px rgba(0,0,0,0.35)`,
            background: "rgba(255,255,255,0.02)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      ) : null}

      <div
        style={{
          position: "fixed",
          left: tooltipLeft,
          top: tooltipTop,
          width: tooltipW,
          maxWidth: "calc(100vw - 32px)",
          background: "rgba(255,255,255,0.96)",
          borderRadius: 18,
          padding: 16,
          boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
          border: "1px solid rgba(0,0,0,0.10)",
          color: "#111111",
          pointerEvents: "auto",
          zIndex: 3,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontFamily: "Geist-Bold, system-ui", fontSize: 15, lineHeight: 1.2 }}>{step.title}</div>
          {stepsCount > 0 ? (
            <div style={{ fontSize: 12, color: "rgba(17,17,17,0.6)" }}>
              {Math.min(stepIndex + 1, stepsCount)}/{stepsCount}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45, color: "rgba(17,17,17,0.78)" }}>
          {step.description}
        </div>

        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <button
            onClick={onSkip}
            style={{
              border: "1px solid rgba(17,17,17,0.16)",
              background: "transparent",
              borderRadius: 12,
              padding: "10px 12px",
              cursor: "pointer",
              fontFamily: "Geist-Regular, system-ui",
              fontSize: 13,
            }}
          >
            Skip
          </button>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {showBack ? (
              <button
                onClick={onBack}
                disabled={stepIndex <= 0}
                style={{
                  border: "1px solid rgba(17,17,17,0.16)",
                  background: "transparent",
                  opacity: stepIndex <= 0 ? 0.5 : 1,
                  borderRadius: 12,
                  padding: "10px 12px",
                  cursor: stepIndex <= 0 ? "default" : "pointer",
                  fontFamily: "Geist-Regular, system-ui",
                  fontSize: 13,
                }}
              >
                Back
              </button>
            ) : null}

            {showPrimary ? (
              <button
                onClick={isLast ? onDone : onNext}
                style={{
                  border: `1px solid ${accentColor}`,
                  background: accentColor,
                  color: "#FFFFFF",
                  borderRadius: 12,
                  padding: "10px 14px",
                  cursor: "pointer",
                  fontFamily: "Geist-Bold, system-ui",
                  fontSize: 13,
                }}
              >
                {primaryLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
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
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const slide = GUIDE_SLIDES[slideIndex]

  useEffect(() => {
    if (!open) return
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i === slideIndex) {
        v.currentTime = 0
        v.play().catch(() => {})
      } else {
        v.pause()
      }
    })
  }, [open, slideIndex])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip()
      if (e.key === "ArrowRight" || e.key === "Enter") onNext()
      if (e.key === "ArrowLeft") onBack()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onBack, onNext, onSkip])

  if (!open || !slide) return null

  const isLast = slideIndex === GUIDE_SLIDES.length - 1
  const viewportW = typeof window === "undefined" ? 1024 : window.innerWidth
  const viewportH = typeof window === "undefined" ? 768 : window.innerHeight
  const smallScreen = viewportW < 420
  const cardW = smallScreen ? Math.min(viewportW - 24, 440) : Math.min(620, viewportW - 48)
  const maxCardH = viewportH - 32

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        fontFamily: "Geist-Regular, system-ui",
      }}
    >
      <div style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(10px)",
        zIndex: 1,
      }} />

      <div style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
        padding: 16,
      }}>
        <div style={{
          width: cardW,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: maxCardH,
          background: isDark ? "rgba(10,10,28,0.98)" : "rgba(255,255,255,0.98)",
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 28px 70px rgba(0,0,0,0.55)",
          border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,0,0,0.10)",
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{ padding: "20px 22px 14px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontFamily: "Geist-Bold, system-ui", fontSize: 20, lineHeight: 1.2, color: isDark ? "#FFFFFF" : "#111111" }}>{slide.title}</div>
              <div style={{ fontSize: 13, color: isDark ? "rgba(255,255,255,0.55)" : "rgba(17,17,17,0.55)", background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: 8, padding: "2px 10px" }}>{slideIndex + 1}/{GUIDE_SLIDES.length}</div>
            </div>
            <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: isDark ? "rgba(255,255,255,0.78)" : "rgba(17,17,17,0.72)" }}>{slide.description}</div>
          </div>

          <div style={{ position: "relative", width: "100%", background: isDark ? "rgba(10,10,28,1)" : "#111111", flexShrink: 0 }}>
            {GUIDE_SLIDES.map((s, i) => (
              <div key={s.video} style={{
                position: i === slideIndex ? "relative" : "absolute",
                inset: i === slideIndex ? undefined : 0,
                opacity: i === slideIndex ? 1 : 0,
                transition: "opacity 0.35s ease",
                pointerEvents: i === slideIndex ? "auto" : "none",
                zIndex: i === slideIndex ? 2 : 1,
              }}>
                <video
                  ref={(el) => { videoRefs.current[i] = el }}
                  src={s.video}
                  autoPlay={i === slideIndex}
                  loop
                  muted
                  playsInline
                  preload="auto"
                  style={{ width: "100%", maxHeight: `calc(${maxCardH}px - 180px)`, objectFit: "cover", display: "block" }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "14px 0 6px", flexShrink: 0 }}>
            {GUIDE_SLIDES.map((_, i) => (
              <div key={i} style={{
                width: i === slideIndex ? 22 : 8,
                height: 8,
                borderRadius: 4,
                background: i === slideIndex ? accentColor : (isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.14)"),
                transition: "all 0.25s ease",
              }} />
            ))}
          </div>

          <div style={{ padding: "6px 22px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button onClick={onSkip} style={{
              border: isDark ? "1px solid rgba(255,255,255,0.16)" : "1px solid rgba(17,17,17,0.16)",
              background: "transparent",
              borderRadius: 12,
              padding: "11px 18px",
              cursor: "pointer",
              fontFamily: "Geist-Regular, system-ui",
              fontSize: 14,
              color: isDark ? "#FFFFFF" : "#111111",
            }}>Skip</button>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {slideIndex > 0 ? (
                <button onClick={onBack} style={{
                  border: isDark ? "1px solid rgba(255,255,255,0.16)" : "1px solid rgba(17,17,17,0.16)",
                  background: "transparent",
                  borderRadius: 12,
                  padding: "11px 16px",
                  cursor: "pointer",
                  fontFamily: "Geist-Regular, system-ui",
                  fontSize: 14,
                  color: isDark ? "#FFFFFF" : "#111111",
                }}>Back</button>
              ) : null}
              <button onClick={isLast ? onDone : onNext} style={{
                border: `1px solid ${accentColor}`,
                background: accentColor,
                color: "#FFFFFF",
                borderRadius: 12,
                padding: "11px 22px",
                cursor: "pointer",
                fontFamily: "Geist-Bold, system-ui",
                fontSize: 14,
              }}>{isLast ? "Start Playing" : "Next"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GameLayoutWeb() {
  const router = useRouter()
  const { matchId: routeMatchId, returnTo: routeReturnTo } = useLocalSearchParams<{ matchId?: string; returnTo?: string }>()
  const matchId = typeof routeMatchId === "string" ? routeMatchId : undefined
  const returnTo = typeof routeReturnTo === "string" ? routeReturnTo : Array.isArray(routeReturnTo) ? routeReturnTo[0] : undefined

  const { theme, colors, toggleTheme } = useThemeContext()
  const { soundEnabled, hapticsEnabled, palindromeAnimationsEnabled, colorBlindEnabled, colorBlindMode, customGameColors, setSoundEnabled, setHapticsEnabled, setPalindromeAnimationsEnabled, setColorBlindEnabled } = useSettings()
  const { playPickupSound, playDropSound, playErrorSound, playSuccessSound } = useSound()

  const [score, setScore] = useState(0)
  const [hints, setHints] = useState(2)
  const [time, setTime] = useState("00:00")
  const [bulldogPositions, setBulldogPositions] = useState<{ row: number; col: number }[]>([])
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [pause, setPause] = useState(false)
  const [gameOver, setGameOver] = useState<{ status: "win" | "lose"; message: string } | null>(null)
  const [newHighScore, setNewHighScore] = useState(false)
  const pendingGameOverRef = useRef<{ status: "win" | "lose"; message: string } | null>(null)
  const [firstMoveActive, setFirstMoveActive] = useState(false)
  const [firstMovePlacements, setFirstMovePlacements] = useState<{ row: number; col: number; colorIndex: number }[]>([])

  const [avatar, setAvatar] = useState<string | null>(null)
  const [userName, setUserName] = useState("John Doe")
  const [restartConfirmationVisible, setRestartConfirmationVisible] = useState(false)
  const [homeConfirmationVisible, setHomeConfirmationVisible] = useState(false)
  const [rulesVisible, setRulesVisible] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialPhase, setTutorialPhase] = useState<GameTutorialPhase>("ui")
  const [tutorialUiIndex, setTutorialUiIndex] = useState(0)
  const [noHintsFaceVisible, setNoHintsFaceVisible] = useState(false)
  const noHintsFaceTimerRef = useRef<any>(null)
  const [guideVisible, setGuideVisible] = useState(false)
  const [guideSlideIndex, setGuideSlideIndex] = useState(0)

  const [opponentScore, setOpponentScore] = useState<number | null>(null)
  const [opponentName, setOpponentName] = useState<string>("Opponent")
  const [opponentAvatar, setOpponentAvatar] = useState<string | null>(null)
  const [multiplayerTimeLimit, setMultiplayerTimeLimit] = useState<number | null>(null)
  const [multiplayerJoinedAt, setMultiplayerJoinedAt] = useState<number | null>(null)
  const [multiplayerFirstMoveAt, setMultiplayerFirstMoveAt] = useState<number | null>(null)
  const [firstMoveCountdown, setFirstMoveCountdown] = useState<number | null>(null)
  const [scoreSubmitted, setScoreSubmitted] = useState(false)
  const [multiplayerMatch, setMultiplayerMatch] = useState<Match | null>(null)
  const multiplayerInitDone = useRef(false)
  const scoreRef = useRef(score)
  const multiplayerFirstMoveAtRef = useRef<number | null>(null)
  const singlePlayerSavedRef = useRef(false)
  const raceFinalizePendingRef = useRef<{ score: number } | null>(null)
  const pendingMatchResultRef = useRef<{ matchId: string; returnTo?: string } | null>(null)
  const racePausedMsRef = useRef(0)
  const racePauseStartedAtRef = useRef<number | null>(null)

  const triggerHaptic = useCallback((pattern: number | number[]) => {
    if (!hapticsEnabled) return
    if (typeof navigator === "undefined") return
    if (!("vibrate" in navigator)) return
    navigator.vibrate(pattern)
  }, [hapticsEnabled])

  const flashNoHintsFace = useCallback(() => {
    if (noHintsFaceTimerRef.current) {
      clearTimeout(noHintsFaceTimerRef.current)
      noHintsFaceTimerRef.current = null
    }
    setNoHintsFaceVisible(true)
    noHintsFaceTimerRef.current = setTimeout(() => {
      setNoHintsFaceVisible(false)
      noHintsFaceTimerRef.current = null
    }, 1200)
  }, [])

  useEffect(() => {
    return () => {
      if (noHintsFaceTimerRef.current) {
        clearTimeout(noHintsFaceTimerRef.current)
        noHintsFaceTimerRef.current = null
      }
    }
  }, [matchId])

  const uiSteps: GameTutorialStep[] = [
    {
      title: "Welcome to Palindrome",
      description: "Quick tour of the screen, then we’ll practice one move together.",
      mode: "modal",
      showBack: true,
    },
    {
      title: "Score",
      description: "Your score increases when you create odd-length palindromes with at least two colors.",
      targetId: "tour-game-status-score",
      mode: "modal",
      showBack: true,
    },
    {
      title: "Timer",
      description: "The timer starts with your first move. Use it to track your pace.",
      targetId: "tour-game-timer",
      mode: "modal",
      showBack: true,
    },
    {
      title: "Hints",
      description: "Use hints to highlight a strong move on the board when you get stuck.",
      targetId: "tour-game-status-hints",
      mode: "modal",
      showBack: true,
    },
    {
      title: "Blocks",
      description: "Drag a colored block from here onto an empty cell.",
      targetId: "tour-game-blocks",
      mode: "modal",
      showBack: true,
    },
    {
      title: "Game Board",
      description: "Place blocks to form multi-color palindromes in a row or column. Only 3, 5, 7, ... count.",
      targetId: "tour-game-board",
      mode: "modal",
      showBack: true,
    },
    {
      title: "Controls",
      description: "Play resumes, Pause stops the timer, Settings manages preferences.",
      targetId: "tour-game-btn-play",
      mode: "modal",
      showBack: true,
      primaryLabel: "Start Tutorial",
    },
  ]

  useEffect(() => {
    if (safeGetGameTutorialSeen()) return
    const t = setTimeout(() => {
      setTutorialPhase("ui")
      setTutorialUiIndex(0)
      setTutorialOpen(true)
    }, 450)
    return () => clearTimeout(t)
  }, [])

  const skipTutorial = useCallback(() => {
    safeSetGameTutorialSeen()
    setTutorialOpen(false)
  }, [])

  const doneTutorial = useCallback(() => {
    safeSetGameTutorialSeen()
    setTutorialOpen(false)
  }, [])

  const backTutorial = useCallback(() => {
    if (tutorialPhase !== "ui") return
    setTutorialUiIndex((i) => Math.max(0, i - 1))
  }, [tutorialPhase])

  const nextTutorial = useCallback(() => {
    if (tutorialPhase !== "ui") return
    setTutorialUiIndex((i) => {
      const next = i + 1
      if (next >= uiSteps.length) {
        setTutorialPhase("placeFirst")
        return i
      }
      return next
    })
  }, [tutorialPhase, uiSteps.length])

  const openTutorial = useCallback(() => {
    setTutorialPhase("ui")
    setTutorialUiIndex(0)
    setTutorialOpen(true)
  }, [])

  const openGuide = useCallback(() => {
    setGuideSlideIndex(0)
    setGuideVisible(true)
  }, [])

  const skipGuide = useCallback(() => {
    safeSetVideoGuideSeen()
    setGuideVisible(false)
  }, [])

  const doneGuide = useCallback(() => {
    safeSetVideoGuideSeen()
    setGuideVisible(false)
  }, [])

  const nextGuide = useCallback(() => {
    setGuideSlideIndex((i) => {
      if (i >= GUIDE_SLIDES.length - 1) {
        doneGuide()
        return i
      }
      return i + 1
    })
  }, [doneGuide])

  const backGuide = useCallback(() => {
    setGuideSlideIndex((i) => Math.max(0, i - 1))
  }, [])

  useEffect(() => {
    if (safeGetVideoGuideSeen()) return
    if (matchId) return
    if (safeGetGameTutorialSeen()) {
      const t = setTimeout(() => {
        setGuideSlideIndex(0)
        setGuideVisible(true)
      }, 600)
      return () => clearTimeout(t)
    }
  }, [matchId])

  useEffect(() => {
    // Fetch user profile data from Supabase
    const fetchProfile = async () => {
      try {
        const user = await authService.getSessionUser();
        if (user) {
          // Try to load from cache first
          const cached = await authService.getCachedProfile(user.id);
          if (cached) {
            setUserName(cached.full_name || user.email?.split('@')[0] || 'User');
            setAvatar(cached.avatar_url);
          }

          // Fetch fresh profile data
          const profile = await authService.getProfile(user.id);
          if (profile) {
            setUserName(profile.full_name || user.email?.split('@')[0] || 'User');
            setAvatar(profile.avatar_url);
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

  // Drag State
  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null)
  const [, setDraggedColor] = useState<number | null>(null)
  const [activeHint, setActiveHint] = useState<{ row: number; col: number; colorIndex: number } | null>(null)
  const [wrongForcedTries, setWrongForcedTries] = useState(0)
  const wrongForcedTriesRef = useRef(0)
  const [scoredCells, setScoredCells] = useState<string[]>([])
  const [scoredCellsRun, setScoredCellsRun] = useState(0)
  const scoredCellsTimerRef = useRef<any[]>([])
  const [scoringInProgress, setScoringInProgress] = useState(false)
  const scoringInProgressRef = useRef(false)

  // Feedback State
  const [feedback, setFeedback] = useState<{ text: string, color: string, id: number } | null>(null)
  const [scoreBursts, setScoreBursts] = useState<{ id: number; points: number }[]>([])

  type ScoringEvent = ScoringResult & {
    segment: NonNullable<ScoringResult["segment"]>
    segmentLength: number
  }

  const clearScoringFeedbackTimers = useCallback((syncDisplayedScore = false) => {
    scoredCellsTimerRef.current.forEach((timer) => clearTimeout(timer))
    scoredCellsTimerRef.current = []
    setScoreBursts([])
    scoringInProgressRef.current = false
    setScoringInProgress(false)
    if (syncDisplayedScore) setScore(scoreRef.current)
  }, [])

  const submitRaceScoreWhenReady = useCallback((finalScore: number) => {
    if (!matchId) return
    if (scoreSubmitted && !raceFinalizePendingRef.current) return

    raceFinalizePendingRef.current = { score: finalScore }
    if (scoringInProgressRef.current) return

    const pending = raceFinalizePendingRef.current
    raceFinalizePendingRef.current = null
    setScoreSubmitted(true)
    authService.getSessionUser().then((user) => {
      if (user) submitScore(matchId, user.id, pending.score)
    })
  }, [matchId, scoreSubmitted])

  const flushDeferredRaceCompletion = useCallback(() => {
    const pendingScore = raceFinalizePendingRef.current
    if (pendingScore && matchId) {
      raceFinalizePendingRef.current = null
      setScoreSubmitted(true)
      authService.getSessionUser().then((user) => {
        if (user) submitScore(matchId, user.id, pendingScore.score)
      })
    }

    const pendingResult = pendingMatchResultRef.current
    if (pendingResult) {
      pendingMatchResultRef.current = null
      router.replace({
        pathname: "/matchresult",
        params: { matchId: pendingResult.matchId, ...(pendingResult.returnTo ? { returnTo: pendingResult.returnTo } : {}) },
      })
    }
  }, [matchId, router])

  const finishGameOver = useCallback((nextGameOver: { status: "win" | "lose"; message: string } | null) => {
    if (!nextGameOver) return
    pendingGameOverRef.current = null
    setPause(false)
    setIsTimerRunning(false)
    setGameOver(nextGameOver)
  }, [])

  const queueGameOver = useCallback((nextGameOver: { status: "win" | "lose"; message: string } | null) => {
    if (!nextGameOver) return
    if (scoringInProgressRef.current) {
      pendingGameOverRef.current = nextGameOver
      return
    }
    finishGameOver(nextGameOver)
  }, [finishGameOver])

  // Timer State
  const [secondsElapsed, setSecondsElapsed] = useState(0)
  const [isTimerRunning, setIsTimerRunning] = useState(false)

  // Game Logic State
  const gridSize = 11
  const [gridState, setGridState] = useState<(number | null)[][]>(
    Array.from({ length: gridSize }, () => Array(gridSize).fill(null)),
  )
  const [blockCounts, setBlockCounts] = useState<number[]>([16, 16, 16, 16, 16])

  const boardRef = useRef<HTMLDivElement>(null)
  const [, setBoardLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  
  useEffect(() => {
    wrongForcedTriesRef.current = wrongForcedTries
  }, [wrongForcedTries])

  const secondsElapsedRef = useRef(secondsElapsed)
  useEffect(() => {
    secondsElapsedRef.current = secondsElapsed
  }, [secondsElapsed])

  const persistSinglePlayerRun = useCallback(async () => {
    if (matchId) return
    if (singlePlayerSavedRef.current) return

    const finalScore = scoreRef.current
    const finalTimeSeconds = secondsElapsedRef.current
    if (finalScore <= 0 && finalTimeSeconds <= 0) return

    try {
      const user = await authService.getSessionUser()
      if (!user) return
      singlePlayerSavedRef.current = true
      const previousBest = await getMyBestSinglePlayer(user.id)
      setNewHighScore(!!previousBest && finalScore > previousBest.best_score)
      await saveSinglePlayerRun(user.id, finalScore, finalTimeSeconds)
    } catch (e) {
      singlePlayerSavedRef.current = false
      console.error('Failed to save single-player run:', e)
    }
  }, [matchId])

  useEffect(() => {
    if (matchId) return
    if (!gameOver) return
    setIsTimerRunning(false)
    setPause(false)
    void persistSinglePlayerRun()
  }, [gameOver, matchId, persistSinglePlayerRun])

  useEffect(() => {
    return () => {
      clearScoringFeedbackTimers(true)
    }
  }, [clearScoringFeedbackTimers])

  const center = Math.floor(gridSize / 2)
  const word = "PALINDROME®"
  const halfWord = Math.floor(word.length / 2)

  const [, forceUpdateLayout] = useState(0)
  useEffect(() => {
    const onResize = () => forceUpdateLayout(n => n + 1)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const layoutConfig = getLayoutConfig()

  const colorGradients = customGameColors ?? [...DEFAULT_GAME_GRADIENTS]

  const initializeGame = useCallback(() => {
    const initialState = createSinglePlayerInitialState()
    setGridState(initialState.grid.map((r) => [...r]))
    setBlockCounts([...initialState.blockCounts])
    setBulldogPositions([...initialState.bulldogPositions])
    setFirstMovePlacements([])
    setFirstMoveActive(true)
    setGameOver(null)
    setNewHighScore(false)
    pendingGameOverRef.current = null
    singlePlayerSavedRef.current = false

    scoreRef.current = 0
    setScore(0)
    setHints(2)
    setTime("00:00")
    setSecondsElapsed(0)
    setIsTimerRunning(false)
    setPause(false)
    clearScoringFeedbackTimers()
    setScoredCells([])
    setScoredCellsRun(0)
    setFeedback(null)
    setDragOverCell(null)
    setActiveHint(null)
    racePausedMsRef.current = 0
    racePauseStartedAtRef.current = null
  }, [clearScoringFeedbackTimers])

  useEffect(() => {
    if (matchId) return
    initializeGame()
  }, [initializeGame, matchId])

  useEffect(() => {
    if (!matchId || multiplayerInitDone.current) return
    let cancelled = false
    ;(async () => {
      const m = await getMatch(matchId)
      if (cancelled || !m) return
      multiplayerInitDone.current = true
      setMultiplayerMatch(m)
      setMultiplayerTimeLimit(m.time_limit_seconds)
      setMultiplayerJoinedAt(Date.now())
      const initialState = createInitialState(m.seed)
      setGridState(initialState.grid.map((r) => [...r]))
      setBlockCounts([...initialState.blockCounts])
      setBulldogPositions([...initialState.bulldogPositions])
      scoreRef.current = initialState.score
      setScore(initialState.score)
      setFirstMoveActive(false)
      setFirstMovePlacements([])
      racePausedMsRef.current = 0
      racePauseStartedAtRef.current = null
      const user = await authService.getSessionUser()
      const other = (m.match_players ?? []).find((p: MatchPlayer) => p.user_id !== user?.id)
      if (other) {
        setOpponentScore(other.score ?? 0)
        const profile = await authService.getProfile(other.user_id)
        if (profile?.full_name) setOpponentName(profile.full_name)
        if (profile?.avatar_url) setOpponentAvatar(profile.avatar_url)
      }
    })()
    return () => { cancelled = true }
  }, [matchId])

  useEffect(() => {
    if (!matchId) return
    const unsub = subscribeToMatch(matchId, (m) => {
      setMultiplayerMatch(m)
      void authService.getSessionUser().then(async (user) => {
        const other = (m.match_players ?? []).find((p: MatchPlayer) => p.user_id !== user?.id)
        if (other) {
          setOpponentScore(other.score ?? 0)
          const profile = await authService.getProfile(other.user_id)
          if (profile?.full_name) setOpponentName(profile.full_name)
          if (profile?.avatar_url) setOpponentAvatar(profile.avatar_url)
          if (m.status === "finished") {
            const nextResult = { matchId: m.id, ...(returnTo ? { returnTo } : {}) }
            if (scoringInProgressRef.current) {
              pendingMatchResultRef.current = { matchId: m.id, ...(returnTo ? { returnTo } : {}) }
            } else {
              router.replace({ pathname: "/matchresult", params: nextResult })
            }
          }
        }
      })
    })
    return unsub
  }, [matchId, router, returnTo])

  useEffect(() => {
    if (!matchId || !multiplayerJoinedAt || multiplayerFirstMoveAt != null || scoreSubmitted) return
    const joinedAt = multiplayerJoinedAt
    const firstMoveDeadline = joinedAt + FIRST_MOVE_TIMEOUT_SECONDS * 1000

    const tick = () => {
      const now = Date.now()
      const remaining = Math.max(0, Math.ceil((firstMoveDeadline - now) / 1000))
      setFirstMoveCountdown(remaining)
      setTime(`0:${remaining.toString().padStart(2, "0")}`)
      if (remaining <= 0) {
        submitRaceScoreWhenReady(0)
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [matchId, multiplayerJoinedAt, multiplayerFirstMoveAt, scoreSubmitted, submitRaceScoreWhenReady])

  useEffect(() => {
    if (!matchId || multiplayerFirstMoveAt == null || multiplayerTimeLimit == null || scoreSubmitted) return
    const endAt = multiplayerFirstMoveAt + multiplayerTimeLimit * 1000

    const tick = () => {
      if (scoringInProgressRef.current) return
      const now = Date.now()
      const remaining = Math.max(0, Math.ceil((endAt + racePausedMsRef.current - now) / 1000))
      const mins = Math.floor(remaining / 60).toString().padStart(2, "0")
      const secs = (remaining % 60).toString().padStart(2, "0")
      setTime(`${mins}:${secs}`)
      if (remaining <= 0) {
        submitRaceScoreWhenReady(scoreRef.current)
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [matchId, multiplayerFirstMoveAt, multiplayerTimeLimit, scoreSubmitted, submitRaceScoreWhenReady])



  useEffect(() => {
    const measureBoard = () => {
      if (boardRef.current) {
        const rect = boardRef.current.getBoundingClientRect()
        setBoardLayout({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        })
      }
    }

    const timer = setTimeout(measureBoard, 200)
    window.addEventListener('resize', measureBoard)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', measureBoard)
    }
  }, [])

  useEffect(() => {
    if (matchId) return
    let interval: any
    if (isTimerRunning && !pause && !scoringInProgress) {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => {
          const next = prev + 1
          const mins = Math.floor(next / 60).toString().padStart(2, "0")
          const secs = (next % 60).toString().padStart(2, "0")
          setTime(`${mins}:${secs}`)
          return next
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [matchId, isTimerRunning, pause, scoringInProgress])

  const handleDragStart = (colorIndex: number) => {
    playPickupSound()
    triggerHaptic(10)
    setDraggedColor(colorIndex)
    if (!isTimerRunning) {
      setIsTimerRunning(true)
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, row: number, col: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"

    // Only highlight if empty
    if (gridState[row][col] === null) {
      setDragOverCell({ row, col })
    } else {
      setDragOverCell(null)
    }
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, row: number, col: number) => {
    e.preventDefault()
    if (gridState[row][col] === null) {
      setDragOverCell({ row, col })
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    // We clear dragOverCell only if we are leaving the currently highlighted cell?
    // Or just clear it. But since enter/leave bubble, it's safer to rely on Enter/Over updates.
    // However, if we leave a cell, we should clear it *if* it matches.
    setDragOverCell(null)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, row: number, col: number): Promise<boolean> => {
    e.preventDefault()
    setDragOverCell(null)
    setDraggedColor(null)
    if (pause || settingsVisible || gameOver || scoringInProgressRef.current) return false

    const transferredColor = e.dataTransfer.getData("color")
    if (!transferredColor) {
      playErrorSound()
      triggerHaptic([0, 30, 20, 30])
      return false
    }

    const colorIndex = parseInt(transferredColor, 10)

    if (isNaN(colorIndex) || colorIndex < 0 || colorIndex >= colorGradients.length) {
      playErrorSound()
      triggerHaptic([0, 30, 20, 30])
      return false
    }

    if (gridState[row][col] !== null) {
      playErrorSound()
      triggerHaptic([0, 30, 20, 30])
      return false
    }

    if (blockCounts[colorIndex] <= 0) {
      playErrorSound()
      triggerHaptic([0, 30, 20, 30])
      return false
    }

    let scoreFound = 0
    let newScore = scoreRef.current
    let nextBlockCounts: number[] = [...blockCounts]
    let nextGrid: (number | null)[][] = gridState.map((r) => [...r])

    if (!matchId && firstMoveActive) {
      const nextPlacements = [...firstMovePlacements, { row, col, colorIndex }]
      nextGrid[row][col] = colorIndex
      nextBlockCounts[colorIndex] = Math.max(0, nextBlockCounts[colorIndex] - 1)

      setGridState(nextGrid)
      setBlockCounts(nextBlockCounts)
      setFirstMovePlacements(nextPlacements)

      playDropSound()
      triggerHaptic(14)

      if (nextPlacements.length < 2) {
        return true
      }

      const a = nextPlacements[0]
      const b = nextPlacements[1]
      const attemptedScore = checkAndProcessPalindromes(
        [
          { row: a.row, col: a.col },
          { row: b.row, col: b.col },
        ],
        nextGrid,
        true,
        5
      )

      if (attemptedScore <= 0) {
        const revertedGrid = nextGrid.map((r) => [...r])
        const revertedCounts = [...nextBlockCounts]
        for (const p of nextPlacements) {
          revertedGrid[p.row][p.col] = null
          revertedCounts[p.colorIndex] = revertedCounts[p.colorIndex] + 1
        }
        setGridState(revertedGrid)
        setBlockCounts(revertedCounts)
        setFirstMovePlacements([])

        const nextWrongTries = wrongForcedTriesRef.current + 1
        const nextValue = nextWrongTries >= 3 ? 0 : nextWrongTries
        wrongForcedTriesRef.current = nextValue
        setWrongForcedTries(nextValue)

        playErrorSound()
        triggerHaptic([0, 30, 20, 30])

        if (nextWrongTries >= 3) {
          if (hints > 0) {
            const hintMove = findFirstScoringMove(5, revertedGrid, revertedCounts)
            if (hintMove) {
              setHints((prev) => Math.max(0, prev - 1))
              setActiveHint(hintMove)
              setTimeout(() => setActiveHint(null), 3000)
            } else {
              flashNoHintsFace()
            }
          } else {
            flashNoHintsFace()
          }
        }
        return false
      }

      scoreFound = checkAndProcessPalindromes(
        [
          { row: a.row, col: a.col },
          { row: b.row, col: b.col },
        ],
        nextGrid,
        false,
        5
      )

      newScore = scoreRef.current + scoreFound
      scoreRef.current = newScore
      setFirstMoveActive(false)
      setFirstMovePlacements([])
      if (wrongForcedTriesRef.current !== 0) {
        wrongForcedTriesRef.current = 0
        setWrongForcedTries(0)
      }
      if (nextBlockCounts.every((c) => c === 0)) {
        queueGameOver({ status: "win", message: "All counters used." })
      } else if (nextGrid.every((r) => r.every((cell) => cell !== null))) {
        queueGameOver({ status: "lose", message: "Board is full." })
      }
    } else {
      const hadAnyScoringMoveBefore = !matchId ? !!findFirstScoringMove(3, gridState, blockCounts) : true
      nextGrid[row][col] = colorIndex
      const attemptedScore = checkAndProcessPalindromes([{ row, col }], nextGrid, true, 3, gridState)
      if (attemptedScore <= 0) {
        if (!matchId && !hadAnyScoringMoveBefore) {
          nextBlockCounts[colorIndex] = Math.max(0, nextBlockCounts[colorIndex] - 1)
          setGridState(nextGrid)
          setBlockCounts(nextBlockCounts)

          playDropSound()
          triggerHaptic(14)

          if (wrongForcedTriesRef.current !== 0) {
            wrongForcedTriesRef.current = 0
            setWrongForcedTries(0)
          }

          if (nextBlockCounts.every((c) => c === 0)) {
            queueGameOver({ status: "win", message: "All counters used." })
          } else if (nextGrid.every((r) => r.every((cell) => cell !== null))) {
            queueGameOver({ status: "lose", message: "Board is full." })
          }

          return true
        }

        const nextWrongTries = wrongForcedTriesRef.current + 1
        const nextValue = nextWrongTries >= 3 ? 0 : nextWrongTries
        wrongForcedTriesRef.current = nextValue
        setWrongForcedTries(nextValue)

        playErrorSound()
        triggerHaptic([0, 30, 20, 30])

        if (nextWrongTries >= 3) {
          if (hints > 0) {
            const hintMove = findFirstScoringMove(3, gridState, blockCounts)
            if (hintMove) {
              setHints((prev) => Math.max(0, prev - 1))
              setActiveHint(hintMove)
              setTimeout(() => setActiveHint(null), 3000)
            } else {
              flashNoHintsFace()
            }
          } else {
            flashNoHintsFace()
          }
        }
        return false
      }

      nextBlockCounts[colorIndex] = Math.max(0, nextBlockCounts[colorIndex] - 1)
      setGridState(nextGrid)
      setBlockCounts(nextBlockCounts)

      playDropSound()
      triggerHaptic(14)
      console.log(`Successfully placed color ${colorIndex} at ${row},${col}`)

      scoreFound = checkAndProcessPalindromes([{ row, col }], nextGrid, false, 3, gridState)
      newScore = scoreRef.current + scoreFound
      scoreRef.current = newScore

      if (wrongForcedTriesRef.current !== 0) {
        wrongForcedTriesRef.current = 0
        setWrongForcedTries(0)
      }

      if (!matchId) {
        if (nextBlockCounts.every((c) => c === 0)) {
          queueGameOver({ status: "win", message: "All counters used." })
        } else if (nextGrid.every((r) => r.every((cell) => cell !== null))) {
          queueGameOver({ status: "lose", message: "Board is full." })
        }
      }
    }

    if (tutorialOpen) {
      if (tutorialPhase === "placeFirst") {
        setTutorialPhase("makeScore")
      } else if (tutorialPhase === "makeScore" && scoreFound > 0) {
        setTutorialPhase("complete")
      }
    }

    if (matchId && multiplayerFirstMoveAtRef.current == null) {
      multiplayerFirstMoveAtRef.current = Date.now()
      setMultiplayerFirstMoveAt(Date.now())
      setFirstMoveCountdown(null)
    }

    if (matchId && !scoreSubmitted) {
      authService.getSessionUser().then((user) => {
        if (user) void updateLiveScore(matchId, user.id, newScore)
      })
    }

    if (matchId && nextBlockCounts.every((c) => c === 0) && !scoreSubmitted) {
      submitRaceScoreWhenReady(newScore)
    }

    return true
  }

  const getScoringFeedback = (length: number) => {
    if (length === 5) return { text: "GREAT!", color: "#60A5FA" }
    if (length === 7) return { text: "AMAZING!", color: "#A78BFA" }
    if (length >= 9) return { text: "LEGENDARY!", color: "#F472B6" }
    return { text: "GOOD!", color: "#4ADE80" }
  }

  const getScoringEvents = (
    anchors: { row: number; col: number }[],
    currentGrid: (number | null)[][],
    minLength = 3,
    previousGrid?: (number | null)[][]
  ): ScoringEvent[] => {
    const anchorKeys = new Set(anchors.map(({ row, col }) => `${row},${col}`))
    const orderSegmentFromAnchor = (event: ScoringEvent): ScoringEvent => {
      const anchorIndex = event.segment.findIndex((tile) => anchorKeys.has(`${tile.r},${tile.c}`))
      if (anchorIndex < 0) return event

      const ordered: NonNullable<ScoringResult["segment"]> = []
      const seen = new Set<string>()
      for (let distance = 0; distance < event.segment.length; distance++) {
        const left = anchorIndex - distance
        const right = anchorIndex + distance

        if (left >= 0) {
          const tile = event.segment[left]
          const key = `${tile.r},${tile.c}`
          if (!seen.has(key)) {
            seen.add(key)
            ordered.push(tile)
          }
        }

        if (right < event.segment.length) {
          const tile = event.segment[right]
          const key = `${tile.r},${tile.c}`
          if (!seen.has(key)) {
            seen.add(key)
            ordered.push(tile)
          }
        }
      }

      return { ...event, segment: ordered }
    }

    const collectEvents = (scanGrid: (number | null)[][]) => {
      const eventsByKey = new Map<string, ScoringEvent>()
      const scanAnchors = previousGrid
        ? scanGrid.flatMap((rowArr, r) =>
            rowArr.flatMap((cell, c) => (cell == null ? [] : [{ row: r, col: c }]))
          )
        : anchors

      scanAnchors.forEach(({ row, col }) => {
        checkAllPalindromes(scanGrid, row, col, bulldogPositions, minLength).forEach((result) => {
          if (!result.segment || !result.segmentLength || result.score <= 0) return
          const key = `${result.kind}:${result.segment.map((t) => `${t.r},${t.c}`).join("|")}`
          if (!eventsByKey.has(key)) {
            eventsByKey.set(key, {
              ...result,
              segment: result.segment,
              segmentLength: result.segmentLength,
            })
          }
        })
      })

      return eventsByKey
    }

    const eventsByKey = collectEvents(currentGrid)
    if (previousGrid) {
      const previousEventsByKey = collectEvents(previousGrid)
      previousEventsByKey.forEach((_event, key) => {
        eventsByKey.delete(key)
      })
    }

    return [...eventsByKey.values()]
      .sort((a, b) => {
        if (b.segmentLength !== a.segmentLength) return b.segmentLength - a.segmentLength
        return b.score - a.score
      })
      .map(orderSegmentFromAnchor)
  }

  const checkAndProcessPalindromes = (
    anchors: { row: number; col: number }[],
    currentGrid: (number | null)[][],
    dryRun = false,
    minLength = 3,
    previousGrid?: (number | null)[][]
  ) => {
    const events = getScoringEvents(anchors, currentGrid, minLength, previousGrid)
    const scoreFound = events.reduce((total, event) => total + event.score, 0)

    if (scoreFound > 0 && !dryRun) {
      if (!palindromeAnimationsEnabled) {
        const burstId = Date.now()
        clearScoringFeedbackTimers()
        setScore((prev) => prev + scoreFound)
        setScoreBursts([{ id: burstId, points: scoreFound }])
        const burstClearTimer = setTimeout(() => {
          setScoreBursts((prev) => prev.filter((burst) => burst.id !== burstId))
        }, 1200)
        scoredCellsTimerRef.current.push(burstClearTimer)
        playSuccessSound()
        triggerHaptic([0, 12, 10, 12])
        finishGameOver(pendingGameOverRef.current)
        flushDeferredRaceCompletion()
        return scoreFound
      }

      clearScoringFeedbackTimers()
      scoringInProgressRef.current = true
      if (matchId && racePauseStartedAtRef.current == null) {
        racePauseStartedAtRef.current = Date.now()
      }
      setScoringInProgress(true)
      setFeedback(null)
      const scoringRunId = Date.now()

      events.forEach((event, index) => {
        const burstId = scoringRunId + index
        const timer = setTimeout(() => {
          const feedbackForLength = getScoringFeedback(event.segmentLength)
          const keys = event.segment.map((t) => `${t.r},${t.c}`)
          setScoredCells(keys)
          setScoredCellsRun(scoringRunId + index)
          setScore((prev) => {
            const next = prev + event.score
            return next
          })
          setScoreBursts((prev) => [...prev, { id: burstId, points: event.score }])
          setFeedback({ text: feedbackForLength.text, color: feedbackForLength.color, id: burstId })
          playSuccessSound()
          triggerHaptic([0, 12, 10, 12])
        }, index * 900)
        scoredCellsTimerRef.current.push(timer)

        const burstClearTimer = setTimeout(() => {
          setScoreBursts((prev) => prev.filter((burst) => burst.id !== burstId))
        }, index * 900 + 1200)
        scoredCellsTimerRef.current.push(burstClearTimer)
      })

      const clearTimer = setTimeout(() => {
        setScoredCells([])
        scoredCellsTimerRef.current = []
        scoringInProgressRef.current = false
        if (matchId && racePauseStartedAtRef.current != null) {
          racePausedMsRef.current += Date.now() - racePauseStartedAtRef.current
          racePauseStartedAtRef.current = null
        }
        setScoringInProgress(false)
        setFeedback(null)
        finishGameOver(pendingGameOverRef.current)
        flushDeferredRaceCompletion()
      }, (events.length - 1) * 900 + 2000)
      scoredCellsTimerRef.current.push(clearTimer)
    }

    return scoreFound
  }

  const findFirstScoringMove = (minLength: number, grid: (number | null)[][], counts: number[]) => {
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (grid[r][c] !== null) continue
        for (let colorIdx = 0; colorIdx < colorGradients.length; colorIdx++) {
          if (counts[colorIdx] <= 0) continue
          const tempGrid = grid.map((rowArr) => [...rowArr])
          tempGrid[r][c] = colorIdx
          const sc = checkAndProcessPalindromes([{ row: r, col: c }], tempGrid, true, minLength, grid)
          if (sc > 0) {
            return { row: r, col: c, colorIndex: colorIdx }
          }
        }
      }
    }
    return null
  }

  const findHint = () => {
    if (hints <= 0) return
    const minLen = !matchId && firstMoveActive ? 5 : 3
    const move = findFirstScoringMove(minLen, gridState, blockCounts)
    if (move) {
      setHints((prev) => prev - 1)
      setActiveHint(move)
      setTimeout(() => setActiveHint(null), 3000)
      return
    }

    playErrorSound()
    triggerHaptic([0, 30, 20, 30])
  }

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    height: "100vh",
    overflow: "hidden",
    background: theme === "dark"
      ? "linear-gradient(135deg, #00000f 0%, #00004a 60%, #000074 100%)"
      : "linear-gradient(135deg, #eef2ff 0%, #f5f0ff 60%, #fff 100%)",
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 10px 0",
    gap: 0,
    fontFamily: "Geist-Regular, system-ui, sans-serif",
  }

  const tutorialStep: GameTutorialStep | null =
    tutorialPhase === "ui"
      ? uiSteps[tutorialUiIndex] ?? null
      : tutorialPhase === "placeFirst"
        ? {
            title: "Your First Move",
            description: "Drag any block onto an empty cell on the board.",
            targetId: "tour-game-blocks",
            mode: "coach",
            showPrimary: false,
            showBack: false,
          }
        : tutorialPhase === "makeScore"
          ? {
              title: "Make Your First Score",
              description: "Keep placing blocks until you create a multi-color odd palindrome in a row or column.",
              targetId: "tour-game-board",
              mode: "coach",
              showPrimary: false,
              showBack: false,
            }
          : {
              title: "Great Job",
              description: "You scored your first palindrome. You’re ready to play.",
              targetId: "tour-game-status-score",
              mode: "modal",
              showPrimary: true,
              showBack: false,
              primaryLabel: "Continue",
            }

  const tutorialStepsCount = tutorialPhase === "ui" ? uiSteps.length : 1
  const tutorialStepIndex = tutorialPhase === "ui" ? tutorialUiIndex : 0

  return (
    <div style={containerStyle}>
        {!matchId && gameOver ? (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
          }}>
            <BlurView
              intensity={20}
              tint="default"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            >
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 30px",
                height: "100%",
                width: "100%",
                backgroundColor: "rgba(0,0,0,0.4)",
              }}>
                <div style={{
                  width: "100%",
                  maxWidth: 420,
                  borderRadius: 32,
                  padding: 32,
                  boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.4)",
                  background: theme === "dark"
                    ? "linear-gradient(to right bottom, #000017, #000074)"
                    : "#FFFFFF",
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid rgba(255,255,255,0.1)",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <div style={{
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: gameOver.status === "win"
                      ? "linear-gradient(to right, #22c55e, #16a34a)"
                      : "linear-gradient(to right, #ff4b4b, #ff0000)",
                    boxShadow: gameOver.status === "win"
                      ? "0 10px 20px rgba(34,197,94,0.25)"
                      : "0 10px 20px rgba(255,0,0,0.25)",
                    marginBottom: 6,
                  }}>
                    <Ionicons name={gameOver.status === "win" ? "trophy" : "alert"} size={34} color="#FFFFFF" />
                  </div>

                  <h2 style={{
                    fontSize: 26,
                    fontWeight: "800",
                    color: colors.text,
                    fontFamily: "Geist-Regular, system-ui",
                    margin: 0,
                    textAlign: "center",
                    letterSpacing: -0.2,
                  }}>
                    Game Over
                  </h2>

                  {newHighScore && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 12px",
                      borderRadius: 999,
                      backgroundColor: "#f59e0b",
                      color: "#fff",
                      fontSize: 12,
                      fontFamily: "Geist-Bold, system-ui",
                      fontWeight: 900,
                      textTransform: "uppercase",
                    }}>
                      <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                      <span>New High-Score</span>
                    </div>
                  )}

                  <p style={{
                    fontSize: 16,
                    color: colors.text,
                    opacity: 0.82,
                    fontFamily: "Geist-Regular, system-ui",
                    margin: 0,
                    textAlign: "center",
                    lineHeight: "22px",
                  }}>
                    {gameOver.message}
                  </p>

                  <div style={{
                    marginTop: 6,
                    padding: "10px 14px",
                    borderRadius: 16,
                    backgroundColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                    border: theme === "dark" ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    width: "100%",
                  }}>
                    <span style={{ fontSize: 14, fontFamily: "Geist-Regular, system-ui", fontWeight: "600", color: colors.text, opacity: 0.8 }}>Final score</span>
                    <span style={{ fontSize: 18, fontFamily: "Geist-Bold, system-ui", fontWeight: "800", color: colors.accent }}>{score}</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "row", gap: 14, width: "100%", marginTop: 18 }}>
                    <Pressable
                      onPress={async () => {
                        await persistSinglePlayerRun()
                        setGameOver(null)
                        initializeGame()
                      }}
                      style={{ flex: 1 }}
                    >
                      <div style={{
                        padding: "16px",
                        borderRadius: 16,
                        background: "linear-gradient(to right, #1177FE, #48B7FF)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 6px 16px rgba(17, 119, 254, 0.28)",
                        transition: "transform 0.1s",
                      }}
                        onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
                        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                      >
                        <span style={{ fontSize: 16, fontFamily: "Geist-Regular, system-ui", fontWeight: "700", color: "#fff" }}>Play again</span>
                      </div>
                    </Pressable>

                    <Pressable
                      onPress={async () => {
                        await persistSinglePlayerRun()
                        setGameOver(null)
                        router.push("/")
                      }}
                      style={{ flex: 1 }}
                    >
                      <div style={{
                        padding: "16px",
                        borderRadius: 16,
                        backgroundColor: "rgba(0,0,0,0.05)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: "background-color 0.2s",
                      }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                      >
                        <span style={{ fontSize: 16, fontFamily: "Geist-Regular, system-ui", fontWeight: "700", color: colors.text }}>Home</span>
                      </div>
                    </Pressable>
                  </div>
                </div>
              </div>
            </BlurView>
          </div>
        ) : null}
        {matchId && scoreSubmitted && multiplayerMatch?.status !== "finished" ? (
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 100,
          }}>
            <div style={{
              padding: 24,
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: 260,
              backgroundColor: theme === "dark" ? "rgba(25,25,91,0.95)" : "rgba(255,255,255,0.95)",
              textAlign: "center",
            }}>
              <span style={{ fontFamily: "Geist-Bold", fontSize: 18, marginBottom: 8, color: theme === "dark" ? "#FFFFFF" : "#111111", display: "block" }}>Game over!</span>
              <span style={{ fontFamily: "Geist-Regular", fontSize: 14, marginBottom: 12, color: theme === "dark" ? "rgba(255,255,255,0.7)" : "rgba(17,17,17,0.7)", display: "block" }}>
                Waiting for opponent to finish...
              </span>
              <span style={{ fontFamily: "Geist-Bold", fontSize: 20, color: colors.accent }}>Your score: {score}</span>
            </div>
          </div>
        ) : null}
        <style>{`
          * { box-sizing: border-box; }
          @keyframes popIn {
            0% { transform: scale(0); opacity: 0; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes floatUp {
            0% { transform: translateY(0px); opacity: 1; }
            100% { transform: translateY(-60px); opacity: 0; }
          }
          @keyframes pulse {
            0% { opacity: 0.3; transform: scale(0.95); }
            50% { opacity: 0.72; transform: scale(1.05); }
            100% { opacity: 0.3; transform: scale(0.95); }
          }
          @keyframes scorePulse {
            0% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); }
            35% { box-shadow: 0 0 26px rgba(255,215,0,0.9); transform: scale(1.14); }
            70% { box-shadow: 0 0 18px rgba(255,215,0,0.55); transform: scale(1.08); }
            100% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); }
          }
          @keyframes scorePulseAlt {
            0% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); }
            35% { box-shadow: 0 0 26px rgba(255,215,0,0.9); transform: scale(1.14); }
            70% { box-shadow: 0 0 18px rgba(255,215,0,0.55); transform: scale(1.08); }
            100% { box-shadow: 0 0 0 rgba(255,215,0,0); transform: scale(1); }
          }
          @keyframes scoredBlockZoom {
            0% { transform: scale(1); filter: brightness(1); }
            35% { transform: scale(1.2); filter: brightness(1.22); }
            70% { transform: scale(1.1); filter: brightness(1.1); }
            100% { transform: scale(1); filter: brightness(1); }
          }
          @keyframes scoredBlockZoomAlt {
            0% { transform: scale(1); filter: brightness(1); }
            35% { transform: scale(1.2); filter: brightness(1.22); }
            70% { transform: scale(1.1); filter: brightness(1.1); }
            100% { transform: scale(1); filter: brightness(1); }
          }
          @keyframes scoreShimmer {
            0% { opacity: 0; transform: translateX(-120%) skewX(-18deg); }
            30% { opacity: 0.85; }
            100% { opacity: 0; transform: translateX(120%) skewX(-18deg); }
          }
          @keyframes scoreShimmerAlt {
            0% { opacity: 0; transform: translateX(-120%) skewX(-18deg); }
            30% { opacity: 0.85; }
            100% { opacity: 0; transform: translateX(120%) skewX(-18deg); }
          }
          @keyframes scoreValuePop {
            0% { transform: scale(1); }
            35% { transform: scale(1.18); }
            100% { transform: scale(1); }
          }
          @keyframes scoreBurst {
            0% { opacity: 0; transform: translate(-50%, 8px) scale(0.7); }
            18% { opacity: 1; transform: translate(-50%, -4px) scale(1.08); }
            100% { opacity: 0; transform: translate(-50%, -34px) scale(1); }
          }
          @keyframes hudFadeIn {
            0% { opacity: 0; transform: translateY(-8px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes boardGlow {
            0% { box-shadow: 0 0 0 1px rgba(100,120,255,0.15), 0 24px 64px rgba(0,0,0,0.55); }
            50% { box-shadow: 0 0 0 1px rgba(100,120,255,0.3), 0 24px 64px rgba(0,0,0,0.55), 0 0 40px rgba(80,100,255,0.1); }
            100% { box-shadow: 0 0 0 1px rgba(100,120,255,0.15), 0 24px 64px rgba(0,0,0,0.55); }
          }
        `}</style>

        {/* ── Thin Top Bar ── */}
        <div style={{
          width: "100%", maxWidth: 1600,
          height: 52, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 4px", position: "relative",
        }}>
          {matchId ? (
            <Pressable onPress={() => setHomeConfirmationVisible(true)} style={{ position: "absolute", left: 8 }}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ) : null}
          <span style={{
            fontSize: "clamp(20px, 2.8vw, 32px)", fontWeight: 900,
            color: colors.accent, fontFamily: "system-ui", letterSpacing: -1,
          }}>PALINDROME®</span>
          {matchId ? (
            <div style={{
              position: "absolute",
              right: 8,
              padding: "6px 14px",
              borderRadius: 12,
              background: scoreSubmitted ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.2)",
              border: scoreSubmitted ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(34,197,94,0.4)",
              animation: scoreSubmitted ? "none" : "pulse 2s infinite",
            }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: scoreSubmitted ? "#f59e0b" : "#22c55e" }}>
                {scoreSubmitted ? "FINISHING..." : "RACE MODE"}
              </span>
            </div>
          ) : null}
        </div>

        {/* ── Main 3-Column Area ── */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "row",
          gap: 6, padding: "8px 12px 10px",
          width: "100%", maxWidth: 1400,
          minHeight: 0, overflow: "hidden",
          boxSizing: "border-box",
          justifyContent: "center",
        }}>

          {/* ── LEFT PANEL: Player + Color Blocks ── */}
          {layoutConfig.leftPanelW > 0 && (
            <div style={{
              width: layoutConfig.leftPanelW, flexShrink: 0,
              display: "flex", flexDirection: "column", gap: 10,
              justifyContent: "center", alignItems: "center",
              paddingRight: 8,
            }}>
              {matchId ? (
                <RacePlayerCard
                  name={userName}
                  avatar={avatar}
                  score={score}
                  time={time}
                  isYou={true}
                  isActive={!scoreSubmitted}
                  theme={theme}
                  colors={colors}
                />
              ) : (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                  padding: "12px 8px", borderRadius: 16,
                  background: theme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
                  border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                  boxShadow: theme === "dark" ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)",
                  width: "100%", maxWidth: layoutConfig.leftPanelW - 16,
                }}>
                  <Image
                    source={avatar ? { uri: avatar } : require("../../assets/images/profile_ph.png")}
                    style={{ width: 48, height: 48, borderRadius: 24, resizeMode: "contain", borderWidth: 2.5, borderColor: colors.accent }}
                    accessibilityLabel="Profile"
                  />
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: colors.text, fontFamily: "system-ui",
                    textAlign: "center", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", maxWidth: layoutConfig.leftPanelW - 20,
                  }}>{userName}</span>
                </div>
              )}

              {/* Vertical color blocks */}
              <div id="tour-game-blocks" style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "16px 10px", gap: 10,
                borderRadius: 16,
                background: theme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                boxShadow: theme === "dark" ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)",
                width: "100%", maxWidth: layoutConfig.leftPanelW - 16,
              }}>
                {colorGradients.map((gradient, i) => (
                  <DraggableBlock key={`left-${i}`} colorIndex={i} gradient={gradient}
                    count={blockCounts[i]} layoutConfig={layoutConfig} onDragStart={handleDragStart} />
                ))}
              </div>
            </div>
          )}

          {/* ── CENTER: Board (+ blocks below on tablet/mobile) ── */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10, minWidth: 0, minHeight: 0,
          }}>
            {matchId && layoutConfig.leftPanelW === 0 && (
              <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: layoutConfig.boardSize, justifyContent: "space-between" }}>
                <div style={{ flex: 1 }}>
                  <RacePlayerCard name={userName} avatar={avatar} score={score} time={time} isYou={true} isActive={!scoreSubmitted} theme={theme} colors={colors} />
                </div>
                <div style={{ flex: 1 }}>
                  <RacePlayerCard name={opponentName} avatar={opponentAvatar} score={opponentScore} time={time} isYou={false} isActive={!scoreSubmitted} theme={theme} colors={colors} />
                </div>
              </div>
            )}

            {/* Game Board */}
            <div
              id="tour-game-board"
              ref={boardRef}
              style={{
                borderRadius: 24, padding: 10,
                display: "flex", justifyContent: "center", alignItems: "center",
                background: theme === "dark"
                  ? "linear-gradient(145deg, rgba(18,18,75,0.92) 0%, rgba(8,8,44,0.97) 100%)"
                  : "linear-gradient(145deg, #f4f6ff 0%, #e8eaf0 100%)",
                boxShadow: theme === "dark"
                  ? "0 0 0 1px rgba(100,120,255,0.18), 0 20px 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.04)"
                  : "0 0 0 1px rgba(0,0,0,0.07), 0 20px 60px rgba(0,0,0,0.13), inset 0 1px 0 rgba(255,255,255,0.9)",
                width: "fit-content", height: "fit-content",
                zIndex: 1, position: "relative", flexShrink: 0,
              }}
            >
              {/* Feedback Overlay */}
              {feedback && (
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  zIndex: 9999, pointerEvents: "none", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <div key={feedback.id} style={{ animation: "popIn 0.5s ease-out forwards, floatUp 1.5s ease-in 1s forwards", width: "100%", textAlign: "center" }}>
                    <h2 style={{ fontSize: 56, fontWeight: "900", color: feedback.color, textShadow: "0px 4px 20px rgba(0,0,0,0.4)", margin: 0, fontFamily: "Geist-Regular, system-ui", whiteSpace: "nowrap" }}>
                      {feedback.text}
                    </h2>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column" }}>
                {Array.from({ length: gridSize }, (_, row) => (
                  <div key={row} style={{ display: "flex", flexDirection: "row" }}>
                    {Array.from({ length: gridSize }, (_, col) => {
                      const isBulldog = bulldogPositions.some((pos) => pos.row === row && pos.col === col)
                      let letter: string | null = null
                      if (row === center && col >= center - halfWord && col < center - halfWord + word.length) {
                        letter = word[col - (center - halfWord)]
                      }
                      if (col === center && row >= center - halfWord && row < center - halfWord + word.length) {
                        letter = word[row - (center - halfWord)]
                      }
                      const cellColorIndex = gridState[row][col]
                      const isHovered = dragOverCell?.row === row && dragOverCell?.col === col
                      const cellStyle: React.CSSProperties = {
                        width: layoutConfig.cellSize, height: layoutConfig.cellSize,
                        borderWidth: 1, borderStyle: "solid", borderColor: "#CCDAE466",
                        borderRadius: 8, margin: 3,
                        display: "flex", justifyContent: "center", alignItems: "center",
                        backgroundColor: theme === "dark" ? "rgba(25, 25, 91, 0.7)" : "#ffffffff",
                        transition: "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                        position: "relative", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)",
                      }
                      const isHint = activeHint?.row === row && activeHint?.col === col
                      const isScored = scoredCells.includes(`${row},${col}`)
                      const scoreIndex = isScored ? scoredCells.indexOf(`${row},${col}`) : 0
                      const scorePulseName = scoredCellsRun % 2 === 0 ? "scorePulse" : "scorePulseAlt"
                      const scoredBlockZoomName = scoredCellsRun % 2 === 0 ? "scoredBlockZoom" : "scoredBlockZoomAlt"
                      const scoreShimmerName = scoredCellsRun % 2 === 0 ? "scoreShimmer" : "scoreShimmerAlt"
                      if (isHovered || isHint) {
                        cellStyle.backgroundColor = theme === "dark" ? "rgba(100, 200, 255, 0.4)" : "rgba(100, 200, 255, 0.3)"
                        cellStyle.borderColor = theme === "dark" ? "rgba(100, 200, 255, 0.8)" : "rgba(50, 150, 255, 0.6)"
                        cellStyle.borderWidth = 2
                        cellStyle.boxShadow = "0 0 12px rgba(74, 158, 255, 0.5)"
                        cellStyle.transform = "scale(1.05)"
                        cellStyle.zIndex = 10
                      }
                      if (isHint) {
                        cellStyle.borderColor = "#FFD700"
                        cellStyle.boxShadow = "0 0 20px rgba(255, 215, 0, 0.6)"
                      }
                      if (isScored) {
                        cellStyle.borderColor = "rgba(255, 215, 0, 0.95)"
                        cellStyle.borderWidth = 2
                        cellStyle.animation = `${scorePulseName} 0.8s ease-out ${scoreIndex * 0.15}s both`
                        cellStyle.zIndex = 12
                      }
                      return (
                        <div key={col}
                          onDragOver={(e) => handleDragOver(e, row, col)}
                          onDragEnter={(e) => handleDragEnter(e, row, col)}
                          onDragLeave={(e) => handleDragLeave(e)}
                          onDrop={(e) => handleDrop(e, row, col)}
                          style={cellStyle}
                        >
                          {cellColorIndex !== null && (
                            <div style={{
                              width: "100%", height: "100%", borderRadius: 6,
                              background: `linear-gradient(to right bottom, ${colorGradients[cellColorIndex][0]}, ${colorGradients[cellColorIndex][1]})`,
                              position: "absolute", top: 0, left: 0, zIndex: 0,
                              boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
                              transformOrigin: "center",
                              animation: isScored ? `${scoredBlockZoomName} 0.8s ease-out ${scoreIndex * 0.15}s both` : undefined,
                            }} />
                          )}
                          {isHint && activeHint && (
                            <div style={{
                              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                              background: `linear-gradient(to right bottom, ${colorGradients[activeHint.colorIndex][0]}, ${colorGradients[activeHint.colorIndex][1]})`,
                              borderRadius: 6, animation: "pulse 1.5s infinite", zIndex: 1,
                            }} />
                          )}
                          {isScored && (
                            <div style={{ position: "absolute", inset: 0, borderRadius: 6, overflow: "hidden", zIndex: 1, pointerEvents: "none" }}>
                              <div style={{
                                position: "absolute", top: "-20%", bottom: "-20%", width: "60%",
                                background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.85), rgba(255,255,255,0))",
                                animation: `${scoreShimmerName} 0.8s ease-out ${scoreIndex * 0.15}s both`,
                              }} />
                            </div>
                          )}
                          <div style={{ zIndex: 2, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
                            {isHint && activeHint && colorBlindEnabled && cellColorIndex === null && (
                              <span style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", color: "#FFFFFF", fontWeight: "900", fontSize: layoutConfig.cellSize > 40 ? 28 : 22, textShadow: "0 1px 4px rgba(0,0,0,0.45)", userSelect: "none" }}>
                                {getColorBlindToken(colorBlindMode, activeHint.colorIndex)}
                              </span>
                            )}
                            {cellColorIndex !== null && colorBlindEnabled && !letter && (
                              <span style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", color: "#FFFFFF", fontWeight: "900", fontSize: layoutConfig.cellSize > 40 ? 28 : 22, textShadow: "0 1px 4px rgba(0,0,0,0.45)", userSelect: "none" }}>
                                {getColorBlindToken(colorBlindMode, cellColorIndex)}
                              </span>
                            )}
                            {cellColorIndex !== null && colorBlindEnabled && letter && (
                              <span style={{ position: "absolute", right: 4, bottom: 3, color: "#FFFFFF", fontWeight: "900", fontSize: 10, textShadow: "0 1px 4px rgba(0,0,0,0.45)", userSelect: "none" }}>
                                {getColorBlindToken(colorBlindMode, cellColorIndex)}
                              </span>
                            )}
                            {isBulldog && (
                              <img src="/bulldog.png" style={{ width: layoutConfig.cellSize - 10, height: layoutConfig.cellSize - 10, objectFit: "contain", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }} alt="bulldog" />
                            )}
                            {letter && (
                              <span style={{ color: colors.text, fontSize: layoutConfig.cellSize > 40 ? 18 : 15, fontWeight: "800", fontFamily: "system-ui", textShadow: cellColorIndex !== null ? "0 1px 2px rgba(0,0,0,0.3)" : "none" }}>
                                {letter}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Blocks below board — tablet/mobile only */}
            {layoutConfig.leftPanelW === 0 && (
              <div id="tour-game-blocks" style={{
                display: "flex", flexDirection: "row", flexWrap: "wrap",
                alignItems: "center", justifyContent: "center",
                gap: "clamp(8px, 1.5vw, 16px)",
                padding: "10px clamp(12px, 2vw, 28px)",
                background: theme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.8)",
                backdropFilter: "blur(16px)",
                borderRadius: 18,
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                boxShadow: theme === "dark" ? "0 6px 24px rgba(0,0,0,0.35)" : "0 6px 24px rgba(0,0,0,0.08)",
                maxWidth: layoutConfig.boardSize, boxSizing: "border-box",
              }}>
                {colorGradients.map((gradient, i) => (
                  <DraggableBlock key={`bot-${i}`} colorIndex={i} gradient={gradient}
                    count={blockCounts[i]} layoutConfig={layoutConfig} onDragStart={handleDragStart} />
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL: Stats + Controls ── */}
          {layoutConfig.rightPanelW > 0 && (
            <div style={{
              width: layoutConfig.rightPanelW, flexShrink: 0,
              display: "flex", flexDirection: "column", gap: 10,
              justifyContent: "center", alignItems: "center",
              paddingLeft: 8,
            }}>

              {matchId ? (
                <>
                  <RacePlayerCard
                    name={opponentName}
                    avatar={opponentAvatar}
                    score={opponentScore}
                    time={time}
                    isYou={false}
                    isActive={!scoreSubmitted}
                    theme={theme}
                    colors={colors}
                  />

                  <div style={{
                    padding: "14px 16px",
                    borderRadius: 16,
                    background: scoreSubmitted ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)",
                    border: scoreSubmitted ? "2px solid rgba(245,158,11,0.4)" : "2px solid rgba(34,197,94,0.4)",
                    width: "100%",
                    textAlign: "center",
                    animation: scoreSubmitted ? "none" : "pulse 2s infinite",
                  }}>
                    <Ionicons name={scoreSubmitted ? "hourglass-outline" : "flash"} size={24} color={scoreSubmitted ? "#f59e0b" : "#22c55e"} />
                    <div style={{ fontSize: 14, fontWeight: 800, color: scoreSubmitted ? "#f59e0b" : "#22c55e", marginTop: 4 }}>
                      {scoreSubmitted ? "WAITING..." : "LIVE RACE"}
                    </div>
                  </div>

                  {firstMoveCountdown != null ? (
                    <div style={{ padding: "10px 14px", borderRadius: 14, textAlign: "center", width: "100%", backgroundColor: firstMoveCountdown <= 5 ? "rgba(239,68,68,0.9)" : "rgba(34,197,94,0.9)" }}>
                      <span style={{ fontFamily: "Geist-Bold", fontSize: 12, color: "#FFFFFF" }}>First move in {firstMoveCountdown}s</span>
                    </div>
                  ) : null}

                  <div style={{ height: 1, background: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", width: "100%" }} />

                  <div style={{ display: "flex", gap: 8, width: "100%" }}>
                    <Pressable onPress={() => setHomeConfirmationVisible(true)} style={{ flex: 1 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "11px 6px", borderRadius: 14, cursor: "pointer", background: "linear-gradient(135deg, #ef4444, #dc2626)", transition: "transform 0.1s" }}
                        onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                      >
                        <Ionicons name="flag" size={20} color="#fff" />
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", letterSpacing: 0.5 }}>LEAVE</span>
                      </div>
                    </Pressable>
                    <Pressable onPress={() => router.push("/")} style={{ flex: 1 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "11px 6px", borderRadius: 14, cursor: "pointer", background: theme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)", border: theme === "dark" ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)" }}
                        onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                      >
                        <Ionicons name="home" size={20} color={colors.text} />
                        <span style={{ fontSize: 9, fontWeight: 700, color: colors.text, letterSpacing: 0.5, opacity: 0.8 }}>HOME</span>
                      </div>
                    </Pressable>
                  </div>

                  <div style={{ display: "flex", gap: 8, width: "100%" }}>
                    {[
                      { icon: "settings-sharp" as const, onPress: () => setSettingsVisible(true), label: "SETTINGS" },
                      { icon: "film-outline" as const, onPress: openGuide, label: "GUIDE" },
                      { icon: "book-outline" as const, onPress: () => setRulesVisible(true), label: "RULES" },
                    ].map(({ icon, onPress, label }) => (
                      <Pressable key={label} onPress={onPress} style={{ flex: 1 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "9px 4px", borderRadius: 14, cursor: "pointer", background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)", transition: "transform 0.1s" }}
                          onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                          onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                          onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                        >
                          <Ionicons name={icon} size={18} color={colors.text} />
                          <span style={{ fontSize: 8, fontWeight: 700, color: colors.text, letterSpacing: 0.5, opacity: 0.7 }}>{label}</span>
                        </div>
                      </Pressable>
                    ))}
                  </div>
                </>
              ) : (
                <>
              {/* Score card */}
              <div id="tour-game-status-score" style={{
                display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                borderRadius: 16,
                background: theme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                boxShadow: theme === "dark" ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)",
                width: "100%", maxWidth: layoutConfig.rightPanelW - 16,
                position: "relative",
                overflow: "visible",
              }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #FFC300, #FF8C00)", boxShadow: "0 4px 10px rgba(255,140,0,0.35)" }}>
                  <Ionicons name="trophy" size={22} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, color: colors.secondaryText, fontFamily: "system-ui" }}>Score</div>
                  <div style={{
                    fontSize: "clamp(26px, 2.6vw, 36px)",
                    fontWeight: 800,
                    color: colors.accent,
                    fontFamily: "system-ui",
                    lineHeight: 1.1,
                    display: "inline-block",
                    animation: scoreBursts.length ? "scoreValuePop 0.42s ease-out" : undefined,
                  }}>{score}</div>
                </div>
                {scoreBursts.map((burst, index) => (
                  <div
                    key={burst.id}
                    style={{
                      position: "absolute",
                      left: "68%",
                      top: 12 + index * 3,
                      transform: "translateX(-50%)",
                      color: "#22C55E",
                      fontFamily: "system-ui",
                      fontWeight: 900,
                      fontSize: 18,
                      textShadow: theme === "dark" ? "0 2px 10px rgba(0,0,0,0.55)" : "0 2px 10px rgba(255,255,255,0.75)",
                      pointerEvents: "none",
                      animation: "scoreBurst 1.15s ease-out forwards",
                    }}
                  >
                    +{burst.points}
                  </div>
                ))}
              </div>

              {/* Timer card */}
              <div id="tour-game-timer" style={{
                display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                borderRadius: 16,
                background: theme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                boxShadow: theme === "dark" ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)",
                width: "100%", maxWidth: layoutConfig.rightPanelW - 16,
              }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #3fa7e0, #0f6fb5)", boxShadow: "0 4px 10px rgba(63,167,224,0.35)" }}>
                  <Ionicons name="time-outline" size={22} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, color: colors.secondaryText, fontFamily: "system-ui" }}>Time</div>
                  <div style={{ fontSize: "clamp(26px, 2.6vw, 36px)", fontWeight: 800, color: "#95DEFE", fontFamily: "system-ui", lineHeight: 1.1 }}>{time}</div>
                </div>
              </div>

              {/* Hints card */}
              <div id="tour-game-status-hints" onClick={findHint} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                borderRadius: 16,
                background: theme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                boxShadow: theme === "dark" ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)",
                cursor: hints > 0 ? "pointer" : "not-allowed", opacity: hints > 0 ? 1 : 0.6,
                transition: "transform 0.15s",
                width: "100%", maxWidth: layoutConfig.rightPanelW - 16,
              }}
                onMouseEnter={(e) => { if (hints > 0) e.currentTarget.style.transform = "scale(1.02)" }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)" }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #d06ee0, #8b1fa8)", boxShadow: "0 4px 10px rgba(195,93,217,0.35)" }}>
                  <Ionicons name="bulb-outline" size={22} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, color: colors.secondaryText, fontFamily: "system-ui" }}>Hints</div>
                  <div style={{ position: "relative", height: 36, display: "flex", alignItems: "center" }}>
                    <span style={{ position: "absolute", fontSize: "clamp(26px, 2.6vw, 36px)", fontWeight: 800, color: "#C35DD9", fontFamily: "system-ui", lineHeight: 1.1, opacity: noHintsFaceVisible ? 0 : 1, transition: "opacity 200ms ease" }}>{hints}</span>
                    <span style={{ position: "absolute", fontSize: 15, fontWeight: 700, color: "#C35DD9", fontFamily: "system-ui", opacity: noHintsFaceVisible ? 1 : 0, transition: "opacity 200ms ease", whiteSpace: "nowrap" }}>(¬_¬)</span>
                  </div>
                </div>
              </div>

              {matchId && firstMoveCountdown != null ? (
                <div style={{ padding: "8px 12px", borderRadius: 10, textAlign: "center", backgroundColor: firstMoveCountdown <= 5 ? "rgba(239,68,68,0.9)" : "rgba(34,197,94,0.9)" }}>
                  <span style={{ fontFamily: "Geist-Bold", fontSize: 12, color: "#FFFFFF" }}>Move! {firstMoveCountdown}s</span>
                </div>
              ) : null}

              <div style={{ height: 1, background: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", margin: "2px 0", flexShrink: 0 }} />

              {/* Play / Pause */}
              <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: layoutConfig.rightPanelW - 16 }}>
                <Pressable onPress={() => { if (pause) setPause(false); if (!isTimerRunning) setIsTimerRunning(true) }} style={{ flex: 1 }}>
                  <div id="tour-game-btn-play" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "13px 6px", borderRadius: 14, cursor: "pointer", background: "linear-gradient(135deg, #8ed9fc 0%, #3c8dea 100%)", boxShadow: "0 4px 14px rgba(60,141,234,0.4)", transition: "transform 0.1s" }}
                    onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                    onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  >
                    <Ionicons name="play" size={24} color="#fff" />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: 0.5, fontFamily: "system-ui" }}>PLAY</span>
                  </div>
                </Pressable>
                <Pressable onPress={() => setPause(true)} style={{ flex: 1 }}>
                  <div id="tour-game-btn-pause" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "13px 6px", borderRadius: 14, cursor: "pointer", background: "linear-gradient(135deg, #ffee60 0%, #ffa40b 100%)", boxShadow: "0 4px 14px rgba(255,164,11,0.4)", transition: "transform 0.1s" }}
                    onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                    onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  >
                    <Ionicons name="pause" size={24} color="#fff" />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: 0.5, fontFamily: "system-ui" }}>PAUSE</span>
                  </div>
                </Pressable>
              </div>

              {/* Restart / Home */}
              <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: layoutConfig.rightPanelW - 16 }}>
                {[
                  { id: "tour-game-btn-restart", icon: "refresh" as const, label: "RESTART", onPress: () => setRestartConfirmationVisible(true) },
                  { id: "tour-game-btn-home",    icon: "home"    as const, label: "HOME",    onPress: () => setHomeConfirmationVisible(true) },
                ].map(({ id, icon, label, onPress }) => (
                  <Pressable key={id} onPress={onPress} style={{ flex: 1 }}>
                    <div id={id} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "11px 6px", borderRadius: 14, cursor: "pointer", background: theme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)", border: theme === "dark" ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)", transition: "transform 0.1s" }}
                      onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                      onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                    >
                      <Ionicons name={icon} size={20} color={colors.text} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: colors.text, letterSpacing: 0.5, fontFamily: "system-ui", opacity: 0.8 }}>{label}</span>
                    </div>
                  </Pressable>
                ))}
              </div>

              {/* Settings / Guide / Tour / Rules */}
              <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: layoutConfig.rightPanelW - 16 }}>
                {[
                  { icon: "settings-sharp" as const, onPress: () => setSettingsVisible(true), id: "tour-game-btn-settings", label: "SETTINGS" },
                  { icon: "film-outline" as const, onPress: openGuide, id: undefined, label: "GUIDE" },
                  { icon: "help-circle-outline" as const, onPress: openTutorial, id: undefined, label: "TOUR" },
                  { icon: "book-outline" as const, onPress: () => setRulesVisible(true), id: undefined, label: "RULES" },
                ].map(({ icon, onPress, id, label }, i) => (
                  <Pressable key={i} onPress={onPress} style={{ flex: 1 }}>
                    <div id={id} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "9px 4px", borderRadius: 14, cursor: "pointer", background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)", transition: "transform 0.1s" }}
                      onMouseDown={e => e.currentTarget.style.transform = "scale(0.93)"}
                      onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                    >
                      <Ionicons name={icon} size={18} color={colors.text} />
                      <span style={{ fontSize: 8, fontWeight: 700, color: colors.text, letterSpacing: 0.5, fontFamily: "system-ui", opacity: 0.7 }}>{label}</span>
                    </div>
                  </Pressable>
                ))}
              </div>
                </>
              )}
            </div>
          )}

          {/* Mobile right panel: compact floating bottom bar */}
          {layoutConfig.rightPanelW === 0 && (
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-around",
                padding: "6px 12px",
                background: theme === "dark" ? "rgba(5,5,30,0.97)" : "rgba(255,255,255,0.97)",
                borderTop: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
              }}>
                {matchId ? (
                  <>
                    <div style={{ padding: "4px 10px", borderRadius: 8, background: scoreSubmitted ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.2)" }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: scoreSubmitted ? "#f59e0b" : "#22c55e" }}>{scoreSubmitted ? "WAITING" : "RACING"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, position: "relative", overflow: "visible" }}>
                      <Ionicons name="trophy" size={13} color="#FFD700" />
                      <span style={{ fontSize: 15, fontWeight: 800, color: colors.accent, fontFamily: "system-ui" }}>{score}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Ionicons name="time-outline" size={13} color="#95DEFE" />
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#95DEFE", fontFamily: "system-ui" }}>{time}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: colors.secondaryText }}>OPP {opponentScore ?? "--"}</span>
                    <Pressable onPress={() => setHomeConfirmationVisible(true)}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(239,68,68,0.2)" }}>
                        <Ionicons name="flag" size={15} color="#ef4444" />
                      </div>
                    </Pressable>
                    <Pressable onPress={() => setSettingsVisible(true)}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)" }}>
                        <Ionicons name="settings-sharp" size={15} color={colors.text} />
                      </div>
                    </Pressable>
                  </>
                ) : (
                  <>
                <div id="tour-game-status-score" style={{ display: "flex", alignItems: "center", gap: 5, position: "relative", overflow: "visible" }}>
                  <Ionicons name="trophy" size={13} color="#FFD700" />
                  <span style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: colors.accent,
                    fontFamily: "system-ui",
                    display: "inline-block",
                    animation: scoreBursts.length ? "scoreValuePop 0.42s ease-out" : undefined,
                  }}>{score}</span>
                  {scoreBursts.map((burst, index) => (
                    <span
                      key={burst.id}
                      style={{
                        position: "absolute",
                        left: "70%",
                        top: -8 - index * 2,
                        color: "#22C55E",
                        fontFamily: "system-ui",
                        fontWeight: 900,
                        fontSize: 13,
                        textShadow: theme === "dark" ? "0 2px 8px rgba(0,0,0,0.65)" : "0 2px 8px rgba(255,255,255,0.8)",
                        pointerEvents: "none",
                        animation: "scoreBurst 1.15s ease-out forwards",
                      }}
                    >
                      +{burst.points}
                    </span>
                  ))}
                </div>
                <div id="tour-game-timer" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Ionicons name="time-outline" size={13} color="#95DEFE" />
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#95DEFE", fontFamily: "system-ui" }}>{time}</span>
                </div>
                <div id="tour-game-status-hints" onClick={findHint} style={{ display: "flex", alignItems: "center", gap: 5, cursor: hints > 0 ? "pointer" : "not-allowed", opacity: hints > 0 ? 1 : 0.5 }}>
                  <Ionicons name="bulb-outline" size={13} color="#C35DD9" />
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#C35DD9", fontFamily: "system-ui" }}>{noHintsFaceVisible ? "(¬_¬)" : hints}</span>
                </div>
                {[
                  { id: "tour-game-btn-play",     icon: "play"                as const, onPress: () => { if (pause) setPause(false); if (!isTimerRunning) setIsTimerRunning(true) }, gradient: "linear-gradient(135deg,#8ed9fc,#3c8dea)" },
                  { id: "tour-game-btn-pause",    icon: "pause"               as const, onPress: () => setPause(true),                      gradient: "linear-gradient(135deg,#ffee60,#ffa40b)" },
                  { id: "tour-game-btn-restart",  icon: "refresh"             as const, onPress: () => setRestartConfirmationVisible(true), gradient: "" },
                  { id: "tour-game-btn-home",     icon: "home"                as const, onPress: () => setHomeConfirmationVisible(true),    gradient: "" },
                  { id: "tour-game-btn-settings", icon: "settings-sharp"      as const, onPress: () => setSettingsVisible(true),            gradient: "" },
                  { id: undefined,                icon: "film-outline"        as const, onPress: openGuide,                                   gradient: "" },
                  { id: undefined,                icon: "help-circle-outline" as const, onPress: openTutorial,                              gradient: "" },
                  { id: undefined,                icon: "book-outline"        as const, onPress: () => setRulesVisible(true),               gradient: "" },
                ].map(({ id, icon, onPress, gradient }, idx) => (
                  <Pressable key={id ?? idx} onPress={onPress}>
                    <div id={id} style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: gradient || (theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)"), border: gradient ? "none" : (theme === "dark" ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)") }}>
                      <Ionicons name={icon} size={15} color={gradient ? "#fff" : colors.text} />
                    </div>
                  </Pressable>
                ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>


        {rulesVisible && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
          }}>
            <BlurView
              intensity={20}
              tint="default"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            >
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 18px",
                height: "100%",
                width: "100%",
                backgroundColor: "rgba(0,0,0,0.4)"
              }}>
                <div style={{
                  width: "100%",
                  maxWidth: 520,
                  maxHeight: "78vh",
                  borderRadius: 32,
                  padding: 26,
                  boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.4)",
                  background: theme === "dark"
                    ? "linear-gradient(to right bottom, #000017, #000074)"
                    : "#FFFFFF",
                  display: 'flex',
                  flexDirection: 'column',
                  border: "1px solid rgba(255,255,255,0.1)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                    gap: 12,
                  }}>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="book-outline" size={22} color={colors.accent} />
                      <span style={{ fontSize: 22, fontWeight: "900", fontFamily: "Geist-Regular, system-ui", color: colors.text }}>
                        How to Play
                      </span>
                    </div>
                    <Pressable onPress={() => setRulesVisible(false)} style={{
                      width: 40,
                      height: 40,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      borderRadius: 20,
                      cursor: "pointer",
                    }}>
                      <span style={{ fontSize: 24, fontWeight: "800", color: colors.text, lineHeight: 1 }}>×</span>
                    </Pressable>
                  </div>

                  <div style={{
                    overflowY: "auto",
                    paddingRight: 6,
                    paddingBottom: 4,
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{
                        padding: 14,
                        borderRadius: 18,
                        backgroundColor: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)",
                      }}>
                        <div style={{ fontSize: 14, fontFamily: "Geist-Bold, system-ui", color: colors.text, marginBottom: 6 }}>Goal</div>
                        <div style={{ fontSize: 13, fontFamily: "Geist-Regular, system-ui", color: colors.text, opacity: 0.82, lineHeight: "18px" }}>
                          Place blocks to form color palindromes. Use all counters.
                        </div>
                      </div>

                      <div style={{
                        padding: 14,
                        borderRadius: 18,
                        backgroundColor: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)",
                      }}>
                        <div style={{ fontSize: 14, fontFamily: "Geist-Bold, system-ui", color: colors.text, marginBottom: 6 }}>Palindrome</div>
                        <div style={{ fontSize: 13, fontFamily: "Geist-Regular, system-ui", color: colors.text, opacity: 0.82, lineHeight: "18px" }}>
                          A sequence that reads the same forwards and backwards. Only odd lengths count (3, 5, 7, ...), and all-one-color lines do not score.
                        </div>
                      </div>

                      <div style={{
                        padding: 14,
                        borderRadius: 18,
                        backgroundColor: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)",
                      }}>
                        <div style={{ fontSize: 14, fontFamily: "Geist-Bold, system-ui", color: colors.text, marginBottom: 6 }}>Valid Move</div>
                        <div style={{ fontSize: 13, fontFamily: "Geist-Regular, system-ui", color: colors.text, opacity: 0.82, lineHeight: "18px" }}>
                          Your placement must create a multi-color odd palindrome in a row, column, or a single 90° right-angle (L-shape).
                        </div>
                      </div>

                      <div style={{
                        padding: 14,
                        borderRadius: 18,
                        backgroundColor: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)",
                      }}>
                        <div style={{ fontSize: 14, fontFamily: "Geist-Bold, system-ui", color: colors.text, marginBottom: 6 }}>First Move</div>
                        <div style={{ fontSize: 13, fontFamily: "Geist-Regular, system-ui", color: colors.text, opacity: 0.82, lineHeight: "18px" }}>
                          At the start you place two blocks. After the second placement you must have created a multi-color 5+ odd palindrome.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                    <Pressable onPress={() => setRulesVisible(false)}>
                      <div style={{
                        padding: "12px 14px",
                        borderRadius: 16,
                        background: "linear-gradient(to right, #1177FE, #48B7FF)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 6px 16px rgba(17, 119, 254, 0.28)",
                      }}>
                        <span style={{ fontSize: 15, fontFamily: "Geist-Regular, system-ui", fontWeight: "700", color: "#fff" }}>Got it</span>
                      </div>
                    </Pressable>
                  </div>
                </div>
              </div>
            </BlurView>
          </div>
        )}

        {/* Settings Modal */}
        {settingsVisible && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
          }}>
            <BlurView
              intensity={20}
              tint="default"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            >
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 30px",
                height: "100%", 
                width: "100%",
                backgroundColor: "rgba(0,0,0,0.4)"
              }}>
                <div style={{
                  width: "100%",
                  maxWidth: 400,
                  borderRadius: 32,
                  padding: 32,
                  boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.4)",
                  background: theme === "dark"
                    ? "linear-gradient(to right bottom, #000017, #000074)"
                    : "#FFFFFF",
                  display: 'flex',
                  flexDirection: 'column',
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 24,
                  }}>
                    <span style={{
                      fontSize: 28,
                      fontWeight: "900",
                      fontFamily: "Geist-Regular, system-ui",
                      color: colors.text,
                    }}>Settings</span>
                    <Pressable onPress={() => setSettingsVisible(false)} style={{ 
                        width: 40, height: 40, alignItems: "center", justifyContent: "center",
                        backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 20
                    }}>
                      <span style={{
                        fontSize: 24,
                        fontWeight: "700",
                        color: colors.text,
                        cursor: 'pointer',
                        lineHeight: 1
                      }}>×</span>
                    </Pressable>
                  </div>

                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 30,
                    padding: 15,
                    backgroundColor: "rgba(0,0,0,0.03)",
                    borderRadius: 20
                  }}>
                    <Image
                      source={avatar ? { uri: avatar } : require("../../assets/images/profile_ph.png")}
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 30,
                        marginRight: 20,
                        resizeMode: 'contain'
                      }}
                      accessibilityLabel="Profile"
                    />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <span style={{
                        fontSize: 18,
                        fontWeight: "700",
                        color: colors.text,
                        fontFamily: "Geist-Regular, system-ui"
                      }}>{userName}</span>
                      <Pressable onPress={() => router.push("/profile")}>
                        <span style={{
                          fontSize: 14,
                          fontWeight: "600",
                          marginTop: 4,
                          color: colors.accent,
                          cursor: 'pointer',
                          fontFamily: "Geist-Regular, system-ui"
                        }}>View Profile</span>
                      </Pressable>
                    </div>
                  </div>

                  {/* Options */}
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 18,
                    marginTop: 10,
                  }}>
                    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 34, gap: 18 }}>
                      <span style={{ fontSize: 16, color: colors.text, fontFamily: "Geist-Regular, system-ui" }}>Sound Effects</span>
                      <Switch
                        value={soundEnabled}
                        onValueChange={setSoundEnabled}
                        circleSize={18}
                        barHeight={22}
                        backgroundActive={colors.accent}
                        backgroundInactive="#ccc"
                        circleActiveColor="#fff"
                        circleInActiveColor="#fff"
                        switchWidthMultiplier={2.5}
                        renderActiveText={false}
                        renderInActiveText={false}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 34, gap: 18 }}>
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 16, color: colors.text, fontFamily: "Geist-Regular, system-ui" }}>Palindrome Animations</span>
                        <span style={{ fontSize: 12, marginTop: 4, color: theme === "dark" ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)", fontFamily: "Geist-Regular, system-ui" }}>
                          {palindromeAnimationsEnabled ? "Animated scoring" : "Instant scoring"}
                        </span>
                      </div>
                      <Switch
                        value={palindromeAnimationsEnabled}
                        onValueChange={setPalindromeAnimationsEnabled}
                        circleSize={18}
                        barHeight={22}
                        backgroundActive={colors.accent}
                        backgroundInactive="#ccc"
                        circleActiveColor="#fff"
                        circleInActiveColor="#fff"
                        switchWidthMultiplier={2.5}
                        renderActiveText={false}
                        renderInActiveText={false}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 34, gap: 18 }}>
                      <span style={{ fontSize: 16, color: colors.text, fontFamily: "Geist-Regular, system-ui" }}>Haptic Feedback</span>
                      <Switch
                        value={hapticsEnabled}
                        onValueChange={setHapticsEnabled}
                        circleSize={18}
                        barHeight={22}
                        backgroundActive={colors.accent}
                        backgroundInactive="#ccc"
                        circleActiveColor="#fff"
                        circleInActiveColor="#fff"
                        switchWidthMultiplier={2.5}
                        renderActiveText={false}
                        renderInActiveText={false}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 34, gap: 18 }}>
                      <span style={{ fontSize: 16, color: colors.text, fontFamily: "Geist-Regular, system-ui" }}>Dark Mode</span>
                      <Switch
                        value={theme === "dark"}
                        onValueChange={toggleTheme}
                        circleSize={18}
                        barHeight={22}
                        backgroundActive={colors.accent}
                        backgroundInactive="#E5E5E5"
                        circleActiveColor="#fff"
                        circleInActiveColor="#fff"
                        switchWidthMultiplier={2.5}
                        renderActiveText={false}
                        renderInActiveText={false}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 34, gap: 18 }}>
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 16, color: colors.text, fontFamily: "Geist-Regular, system-ui" }}>Color Blind Mode</span>
                        <span style={{ fontSize: 12, marginTop: 4, color: theme === "dark" ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)", fontFamily: "Geist-Regular, system-ui" }}>
                          Preference: {colorBlindMode === "symbols" ? "Symbols" : colorBlindMode === "emojis" ? "Emojis" : colorBlindMode === "cards" ? "Cards" : "Letters"}
                        </span>
                      </div>
                      <Switch
                        value={colorBlindEnabled}
                        onValueChange={setColorBlindEnabled}
                        circleSize={18}
                        barHeight={22}
                        backgroundActive={colors.accent}
                        backgroundInactive="#ccc"
                        circleActiveColor="#fff"
                        circleInActiveColor="#fff"
                        switchWidthMultiplier={2.5}
                        renderActiveText={false}
                        renderInActiveText={false}
                      />
                    </div>
                  </div>

                  {/* Preferences Link - Opens Profile Page */}
                  <Pressable 
                    onPress={() => {
                      setSettingsVisible(false);
                      router.push("/profile");
                    }}
                    style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 28,
                    marginBottom: 6,
                    padding: 14,
                    backgroundColor: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    borderRadius: 14,
                    cursor: 'pointer'
                  }}>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Ionicons name="settings-sharp" size={20} color={colors.accent} />
                      <span style={{ fontSize: 16, color: colors.text, fontFamily: "Geist-Regular, system-ui", fontWeight: "600" }}>Preferences</span>
                    </div>
                    <span style={{ fontSize: 22, fontWeight: "600", color: colors.accent, fontFamily: "Geist-Regular, system-ui" }}>›</span>
                  </Pressable>
                </div>
              </div>
            </BlurView>
          </div>
        )}

        {/* Restart Confirmation Modal */}
        {restartConfirmationVisible && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
          }}>
            <BlurView
              intensity={20}
              tint="default"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            >
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 30px",
                height: "100%", 
                width: "100%",
                backgroundColor: "rgba(0,0,0,0.4)"
              }}>
                <div style={{
                  width: "100%",
                  maxWidth: 400,
                  borderRadius: 32,
                  padding: 32,
                  boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.4)",
                  background: theme === "dark"
                    ? "linear-gradient(to right bottom, #000017, #000074)"
                    : "#FFFFFF",
                  display: 'flex',
                  flexDirection: 'column',
                  border: "1px solid rgba(255,255,255,0.1)",
                  alignItems: "center",
                }}>
                  <h2 style={{
                    fontSize: 24,
                    fontWeight: "700",
                    color: colors.text,
                    fontFamily: "Geist-Regular, system-ui",
                    marginBottom: 16,
                    textAlign: "center",
                    marginTop: 0,
                  }}>Restart Game?</h2>
                  <p style={{
                    fontSize: 16,
                    color: colors.text,
                    opacity: 0.8,
                    fontFamily: "Geist-Regular, system-ui",
                    marginBottom: 32,
                    textAlign: "center",
                  }}>
                    Are you sure you want to restart? Current progress will be lost.
                  </p>
                  
                  <div style={{ display: "flex", flexDirection: "row", gap: 20, width: "100%" }}>
                    <Pressable 
                        onPress={() => setRestartConfirmationVisible(false)}
                        style={{ flex: 1 }}
                    >
                        <div style={{
                            padding: "16px",
                            borderRadius: 16,
                            backgroundColor: "rgba(0,0,0,0.05)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            transition: "background-color 0.2s"
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                        >
                            <span style={{ fontSize: 16, fontFamily: "Geist-Regular, system-ui", fontWeight: "600", color: colors.text }}>Cancel</span>
                        </div>
                    </Pressable>

                    <Pressable 
                        onPress={async () => {
                            await persistSinglePlayerRun()
                            initializeGame()
                            setRestartConfirmationVisible(false)
                        }}
                        style={{ flex: 1 }}
                    >
                        <div style={{
                            padding: "16px",
                            borderRadius: 16,
                            background: "linear-gradient(to right, #ff4b4b, #ff0000)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            boxShadow: "0 4px 12px rgba(255, 0, 0, 0.3)",
                            transition: "transform 0.1s"
                        }}
                        onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
                        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                        >
                            <span style={{ fontSize: 16, fontFamily: "Geist-Regular, system-ui", fontWeight: "600", color: "#fff" }}>Restart</span>
                        </div>
                    </Pressable>
                  </div>
                </div>
              </div>
            </BlurView>
          </div>
        )}

        {/* Home Confirmation Modal */}
        {homeConfirmationVisible && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
          }}>
            <BlurView
              intensity={20}
              tint="default"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            >
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 30px",
                height: "100%", 
                width: "100%",
                backgroundColor: "rgba(0,0,0,0.4)"
              }}>
                <div style={{
                  width: "100%",
                  maxWidth: 400,
                  borderRadius: 32,
                  padding: 32,
                  boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.4)",
                  background: theme === "dark"
                    ? "linear-gradient(to right bottom, #000017, #000074)"
                    : "#FFFFFF",
                  display: 'flex',
                  flexDirection: 'column',
                  border: "1px solid rgba(255,255,255,0.1)",
                  alignItems: "center",
                }}>
                  <h2 style={{
                    fontSize: 24,
                    fontWeight: "700",
                    color: colors.text,
                    fontFamily: "Geist-Regular, system-ui",
                    marginBottom: 16,
                    textAlign: "center",
                    marginTop: 0,
                  }}>{matchId ? "Leave Game?" : "Return to Main Menu?"}</h2>
                  <p style={{
                    fontSize: 16,
                    color: colors.text,
                    opacity: 0.8,
                    fontFamily: "Geist-Regular, system-ui",
                    marginBottom: 32,
                    textAlign: "center",
                  }}>
                    {matchId ? "Leaving will forfeit the match." : "Are you sure you want to leave? Current game progress will be lost."}
                  </p>
                  
                  <div style={{ display: "flex", flexDirection: "row", gap: 20, width: "100%" }}>
                    <Pressable 
                        onPress={() => setHomeConfirmationVisible(false)}
                        style={{ flex: 1 }}
                    >
                        <div style={{
                            padding: "16px",
                            borderRadius: 16,
                            backgroundColor: "rgba(0,0,0,0.05)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            transition: "background-color 0.2s"
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                        >
                            <span style={{ fontSize: 16, fontFamily: "Geist-Regular, system-ui", fontWeight: "600", color: colors.text }}>Cancel</span>
                        </div>
                    </Pressable>

                    <Pressable 
                        onPress={async () => {
                            if (matchId) {
                              const user = await authService.getSessionUser()
                              if (user) await forfeitRaceMatch(matchId, user.id)
                              setHomeConfirmationVisible(false)
                              router.replace({ pathname: "/matchresult" as any, params: { matchId, ...(returnTo ? { returnTo } : {}) } })
                              return
                            } else {
                              await persistSinglePlayerRun()
                            }
                            setHomeConfirmationVisible(false)
                            router.push("/")
                        }}
                        style={{ flex: 1 }}
                    >
                        <div style={{
                            padding: "16px",
                            borderRadius: 16,
                            background: "linear-gradient(to right, #ff4b4b, #ff0000)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            boxShadow: "0 4px 12px rgba(255, 0, 0, 0.3)",
                            transition: "transform 0.1s"
                        }}
                        onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
                        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                        >
                            <span style={{ fontSize: 16, fontFamily: "Geist-Regular, system-ui", fontWeight: "600", color: "#fff" }}>Leave</span>
                        </div>
                    </Pressable>
                  </div>
                </div>
              </div>
            </BlurView>
          </div>
        )}
        {pause && !gameOver && !matchId && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
          }}>
            <BlurView
              intensity={20}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <div style={{
                padding: 60,
                borderRadius: 16,
                display: "flex",
                flexDirection: 'column',
                alignItems: "center",
                boxShadow: "0px 8px 8px rgba(0, 0, 0, 0.1)",
                backgroundColor: colors.card,
              }}>
                <span style={{
                  fontSize: 32,
                  fontWeight: "bold",
                  marginBottom: 12,
                  color: colors.text,
                  fontFamily: "system-ui"
                }}>Game Paused</span>
                <Pressable onPress={() => setPause(false)} style={{
                  backgroundColor: "#0060FF",
                  paddingVertical: 15,
                  paddingHorizontal: 30,
                  borderRadius: 12,
                  cursor: 'pointer'
                }}>
                  <span style={{ color: "#fff", fontWeight: "700", fontSize: 16, fontFamily: "system-ui" }}>Resume</span>
                </Pressable>
              </div>
            </div>
          </div>
        )}

        <GameTutorialOverlay
          open={tutorialOpen}
          step={tutorialOpen ? tutorialStep : null}
          stepIndex={tutorialStepIndex}
          stepsCount={tutorialStepsCount}
          accentColor={colors.accent}
          onBack={backTutorial}
          onNext={nextTutorial}
          onSkip={skipTutorial}
          onDone={() => {
            if (tutorialPhase === "ui") {
              setTutorialPhase("placeFirst")
              return
            }
            doneTutorial()
          }}
        />

        <VideoGuideOverlay
          open={guideVisible}
          slideIndex={guideSlideIndex}
          accentColor={colors.accent}
          isDark={theme === "dark"}
          onBack={backGuide}
          onNext={nextGuide}
          onSkip={skipGuide}
          onDone={doneGuide}
        />
      </div>
  )
}
