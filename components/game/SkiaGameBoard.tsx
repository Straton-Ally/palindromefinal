/**
 * Skia-rendered game board for the native app.
 *
 * Replaces the old 121-View grid (each cell with its own LinearGradient/Image/Text
 * native views). The whole board is one Canvas; drag hover and the opponent-move
 * shimmer are driven by Reanimated shared values, so they animate without React
 * re-renders. Each cell is a memoized component taking only primitive props, so a
 * placement re-renders just the cells that changed instead of the whole board.
 *
 * Web screens (*.web.tsx) never import this file (see SkiaGameBoard.web.tsx).
 */
import {
  BlurMask,
  Canvas,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Paragraph,
  Rect,
  RoundedRect,
  Skia,
  Text as SkiaText,
  TextAlign,
  rect,
  rrect,
  useFont,
  useImage,
  vec,
  type SkFont,
  type SkImage,
  type SkParagraph,
} from '@shopify/react-native-skia';
import React, { memo, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, type GestureResponderEvent, type View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';

import type { ColorBlindMode } from '@/context/SettingsContext';
import { DARK_COUNTER_OUTLINE } from '@/lib/gameColors';
import { NO_CELL, boardPixelSize, type BoardGeometry } from './boardDrag';

const WORD = 'PALINDROME®';

export const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ['●', '▲', '■', '◆', '★'],
  emojis: ['🍓', '🥑', '🫐', '🖤', '🍋'],
  cards: ['♥', '♣', '♦', '♠', '★'],
  letters: ['A', 'B', 'C', 'D', 'E'],
} as const;

const BULLDOG = require('../../assets/images/bulldog.png');
const GEIST_BOLD = require('../../assets/fonts/Geist-Bold.ttf');

const HOVER_BORDER = '#4A9EFF';
const SCORED_BORDER = '#FACC15';
const HINT_BORDER = '#FFD700';

type Cell = { row: number; col: number };

/**
 * 'classic' = single player / race screen (gamelayout), 'turn' = turn-based screen.
 * They draw a few things differently (gradient direction, bulldog placement, tokens).
 */
export type BoardVariant = 'classic' | 'turn';

export type SkiaGameBoardProps = {
  variant: BoardVariant;
  geometry: BoardGeometry;
  gridRef: AnimatedRef<View>;
  grid: (number | null)[][];
  gradients: readonly (readonly [string, string])[];
  bulldogs: readonly Cell[];
  isDark: boolean;
  colorBlindEnabled: boolean;
  colorBlindMode: ColorBlindMode;
  hoverCell: SharedValue<number>;
  scoredCells: readonly string[];
  /** turn variant: toggles the scored-cell scale between runs */
  scoredRun?: number;
  /** classic variant */
  hint?: { row: number; col: number; colorIndex: number } | null;
  /** classic variant (tap-to-place mode) */
  pickTarget?: Cell | null;
  /** turn variant: cells placed by the opponent, swept by a shimmer */
  shimmerCells?: readonly string[];
  shimmerProgress?: SharedValue<number>;
  /** Tap on a cell (tap-to-place mode). When omitted the board ignores taps. */
  onCellPress?: (row: number, col: number) => void;
};

function letterAt(row: number, col: number, gridSize: number): string | null {
  const center = Math.floor(gridSize / 2);
  const half = Math.floor(WORD.length / 2);
  let letter: string | null = null;
  if (row === center && col >= center - half && col < center - half + WORD.length) {
    letter = WORD[col - (center - half)];
  }
  if (col === center && row >= center - half && row < center - half + WORD.length) {
    letter = WORD[row - (center - half)];
  }
  return letter;
}

function makeTokenParagraph(text: string, fontSize: number, width: number): SkParagraph {
  const builder = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center });
  builder.pushStyle({
    color: Skia.Color('#FFFFFF'),
    fontSize,
    fontStyle: { weight: 900 },
    shadows: [{ color: Skia.Color('rgba(0,0,0,0.45)'), offset: { x: 0, y: 1 }, blurRadius: 4 }],
  });
  builder.addText(text);
  const paragraph = builder.build();
  paragraph.layout(width);
  return paragraph;
}

type CellBox = { x: number; y: number; w: number; h: number; r: number };

/** Cell background + idle border (drawn under the hover highlight). */
const CellBase = memo(function CellBase(props: CellBox & { bg: string; border: string | null }) {
  const { x, y, w, h, r, bg, border } = props;
  return (
    <>
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color={bg} />
      {border ? (
        <RoundedRect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} r={r - 0.5} color={border} style="stroke" strokeWidth={1} />
      ) : null}
    </>
  );
});

type CellContentProps = CellBox & {
  isTurn: boolean;
  fillA: string | null;
  fillB: string | null;
  /** turn variant: scale + opacity for scored cells */
  fillScale: number;
  fillOpacity: number;
  hintA: string | null;
  hintB: string | null;
  bulldog: SkImage | null;
  bulldogMode: 'none' | 'corner' | 'center' | 'centerFaded';
  letter: string | null;
  letterColor: string;
  font: SkFont | null;
  token: SkParagraph | null;
  tokenCorner: SkParagraph | null;
  hintToken: SkParagraph | null;
  outline: 'none' | 'scored' | 'hint' | 'pick';
  /** Light ring around a dark counter in dark mode (null = none). */
  counterOutline: string | null;
};

/** Everything drawn above the hover highlight for one cell. */
const CellContent = memo(function CellContent(props: CellContentProps) {
  const { x, y, w, h, r, isTurn, fillA, fillB, fillScale, fillOpacity, hintA, hintB } = props;
  const cx = x + w / 2;
  const cy = y + h / 2;

  let fill: React.ReactNode = null;
  if (fillA && fillB) {
    fill = isTurn ? (
      <Group clip={rrect(rect(x, y, w, h), r, r)} opacity={fillOpacity} origin={vec(cx, cy)} transform={[{ scale: fillScale }]}>
        <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r}>
          <LinearGradient start={vec(x, y)} end={vec(x + w, y + h)} colors={[fillA, fillB]} />
        </RoundedRect>
      </Group>
    ) : (
      <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1}>
        <LinearGradient start={vec(cx, y)} end={vec(cx, y + h)} colors={[fillA, fillB]} />
      </RoundedRect>
    );
  }
  const counterRing =
    fillA && fillB && props.counterOutline ? (
      <RoundedRect x={x + 1.75} y={y + 1.75} width={w - 3.5} height={h - 3.5} r={r - 1.5} color={props.counterOutline} style="stroke" strokeWidth={1.5} />
    ) : null;

  const hint =
    hintA && hintB ? (
      <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1} opacity={0.6}>
        <LinearGradient start={vec(cx, y)} end={vec(cx, y + h)} colors={[hintA, hintB]} />
      </RoundedRect>
    ) : null;

  let bulldog: React.ReactNode = null;
  if (props.bulldog && props.bulldogMode !== 'none') {
    if (props.bulldogMode === 'corner') {
      bulldog = <SkiaImage image={props.bulldog} x={x + 5} y={y + 5} width={20} height={20} fit="contain" />;
    } else {
      const filled = props.bulldogMode === 'centerFaded';
      const size = filled ? Math.max(12, w - 10) : w - 8;
      bulldog = (
        <SkiaImage
          image={props.bulldog}
          x={cx - size / 2}
          y={cy - size / 2}
          width={size}
          height={size}
          fit="contain"
          opacity={filled ? 0.72 : 1}
        />
      );
    }
  }

  let letter: React.ReactNode = null;
  if (props.letter && props.font) {
    const textWidth = props.font.measureText(props.letter).width;
    const metrics = props.font.getMetrics();
    const baseline = cy - (metrics.ascent + metrics.descent) / 2;
    letter = <SkiaText x={cx - textWidth / 2} y={baseline} text={props.letter} font={props.font} color={props.letterColor} />;
  }

  let tokens: React.ReactNode = null;
  if (props.token) {
    tokens = <Paragraph paragraph={props.token} x={x} y={cy - props.token.getHeight() / 2} width={w} />;
  } else if (props.tokenCorner) {
    const p = props.tokenCorner;
    const tokenWidth = p.getLongestLine();
    tokens = (
      <Paragraph paragraph={p} x={x + w - 5 - tokenWidth - (w - tokenWidth) / 2} y={y + h - 4 - p.getHeight()} width={w} />
    );
  }
  const hintToken = props.hintToken ? (
    <Paragraph paragraph={props.hintToken} x={x} y={cy - props.hintToken.getHeight() / 2} width={w} />
  ) : null;

  let outline: React.ReactNode = null;
  if (props.outline === 'scored' || props.outline === 'hint') {
    const color = props.outline === 'scored' ? SCORED_BORDER : HINT_BORDER;
    outline = (
      <>
        <RoundedRect x={x} y={y} width={w} height={h} r={r} color={color} style="stroke" strokeWidth={3} opacity={props.outline === 'scored' ? 0.9 : 0.8}>
          <BlurMask blur={6} style="outer" />
        </RoundedRect>
        <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1} color={color} style="stroke" strokeWidth={2} />
      </>
    );
  } else if (props.outline === 'pick') {
    outline = <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1} color={HOVER_BORDER} style="stroke" strokeWidth={2} />;
  }

  return (
    <>
      {fill}
      {counterRing}
      {hint}
      {bulldog}
      {letter}
      {tokens}
      {hintToken}
      {outline}
    </>
  );
});

// -- Scoring celebration (mirrors the web game's CSS keyframes) --
// Each scored tile animates for SCORE_FX_MS, staggered by SCORE_FX_STAGGER_MS from the placed block outward.
const SCORE_FX_MS = 800;
const SCORE_FX_STAGGER_MS = 150;
const FX_STOPS = [0, 0.35, 0.7, 1];

function useTileProgress(clock: SharedValue<number>, index: number) {
  return useDerivedValue(() => {
    const t = (clock.value - index * SCORE_FX_STAGGER_MS) / SCORE_FX_MS;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    return Easing.out(Easing.quad)(clamped);
  });
}

type ScoredFxProps = CellBox & {
  index: number;
  clock: SharedValue<number>;
  isTurn: boolean;
  fillA: string | null;
  fillB: string | null;
  counterOutline: string | null;
};

/** Glow + zooming block + brightness flash + shimmer sweep for one scored tile (drawn under its letter). */
const ScoredFx = memo(function ScoredFx(props: ScoredFxProps) {
  const { x, y, w, h, r, index, clock, isTurn, fillA, fillB, counterOutline } = props;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const p = useTileProgress(clock, index);

  // web scorePulse (cell): scale 1 > 1.14 > 1.08 > 1, glow 0 > 0.9 > 0.55 > 0
  const cellTransform = useDerivedValue(() => [{ scale: interpolate(p.value, FX_STOPS, [1, 1.14, 1.08, 1]) }]);
  const glowOpacity = useDerivedValue(() => interpolate(p.value, FX_STOPS, [0, 0.9, 0.55, 0]));
  // web scoredBlockZoom: scale 1 > 1.2 > 1.1 > 1, brightness 1 > 1.22 > 1.1 > 1
  const blockTransform = useDerivedValue(() => [{ scale: interpolate(p.value, FX_STOPS, [1, 1.2, 1.1, 1]) }]);
  const brightness = useDerivedValue(() => interpolate(p.value, FX_STOPS, [0, 0.22, 0.1, 0]));
  // web scoreShimmer: translateX -120% > 120%, opacity 0 > 0.85 (at 30%) > 0, skewX(-18deg)
  const bandW = w * 0.6;
  const shimmerTransform = useDerivedValue(() => [
    { translateX: interpolate(p.value, [0, 1], [-1.2 * w, 1.2 * w]) },
    { skewX: (-18 * Math.PI) / 180 },
  ]);
  const shimmerOpacity = useDerivedValue(() => interpolate(p.value, [0, 0.3, 1], [0, 0.85, 0]));

  const gradStart = isTurn ? vec(x, y) : vec(cx, y);
  const gradEnd = isTurn ? vec(x + w, y + h) : vec(cx, y + h);

  return (
    <Group origin={vec(cx, cy)} transform={cellTransform}>
      <RoundedRect x={x} y={y} width={w} height={h} r={r} color={SCORED_BORDER} style="stroke" strokeWidth={4} opacity={glowOpacity}>
        <BlurMask blur={9} style="outer" />
      </RoundedRect>
      {fillA && fillB ? (
        <Group origin={vec(cx, cy)} transform={blockTransform}>
          <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1}>
            <LinearGradient start={gradStart} end={gradEnd} colors={[fillA, fillB]} />
          </RoundedRect>
          <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1} color="#FFFFFF" opacity={brightness} />
          {counterOutline ? (
            <RoundedRect x={x + 1.75} y={y + 1.75} width={w - 3.5} height={h - 3.5} r={r - 1.5} color={counterOutline} style="stroke" strokeWidth={1.5} />
          ) : null}
        </Group>
      ) : null}
      <Group clip={rrect(rect(x, y, w, h), r, r)}>
        <Group origin={vec(cx, cy)} transform={shimmerTransform} opacity={shimmerOpacity}>
          <Rect x={cx - bandW / 2} y={y - h * 0.2} width={bandW} height={h * 1.4}>
            <LinearGradient
              start={vec(cx - bandW / 2, cy)}
              end={vec(cx + bandW / 2, cy)}
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            />
          </Rect>
        </Group>
      </Group>
    </Group>
  );
});

/** Gold border of a scored tile; pulses with the same scale as its glow (drawn above the letter). */
const ScoredBorder = memo(function ScoredBorder(props: CellBox & { index: number; clock: SharedValue<number> }) {
  const { x, y, w, h, r, index, clock } = props;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const p = useTileProgress(clock, index);
  const transform = useDerivedValue(() => [{ scale: interpolate(p.value, FX_STOPS, [1, 1.14, 1.08, 1]) }]);
  return (
    <Group origin={vec(cx, cy)} transform={transform}>
      <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1} color={SCORED_BORDER} style="stroke" strokeWidth={2} />
    </Group>
  );
});

/** Hint preview that breathes like the web game (opacity 0.3 > 0.72, scale 0.95 > 1.05, 1.5 s loop). */
const HintFx = memo(function HintFx(props: CellBox & { hintA: string; hintB: string; counterOutline: string | null }) {
  const { x, y, w, h, r, hintA, hintB, counterOutline } = props;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pulse = useSharedValue(0);
  useEffect(() => {
    const half = { duration: 750, easing: Easing.inOut(Easing.ease) };
    pulse.value = withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1);
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const opacity = useDerivedValue(() => interpolate(pulse.value, [0, 1], [0.3, 0.72]));
  const transform = useDerivedValue(() => [{ scale: interpolate(pulse.value, [0, 1], [0.95, 1.05]) }]);
  return (
    <Group origin={vec(cx, cy)} transform={transform} opacity={opacity}>
      <RoundedRect x={x + 1} y={y + 1} width={w - 2} height={h - 2} r={r - 1}>
        <LinearGradient start={vec(cx, y)} end={vec(cx, y + h)} colors={[hintA, hintB]} />
      </RoundedRect>
      {counterOutline ? (
        <RoundedRect x={x + 1.75} y={y + 1.75} width={w - 3.5} height={h - 3.5} r={r - 1.5} color={counterOutline} style="stroke" strokeWidth={1.5} />
      ) : null}
    </Group>
  );
});

function SkiaGameBoardImpl(props: SkiaGameBoardProps) {
  const {
    variant,
    geometry,
    gridRef,
    grid,
    gradients,
    bulldogs,
    isDark,
    colorBlindEnabled,
    colorBlindMode,
    hoverCell,
    scoredCells,
    scoredRun = 0,
    hint = null,
    pickTarget = null,
    shimmerCells,
    shimmerProgress,
    onCellPress,
  } = props;

  const { gridSize, cellWidth: cw, cellHeight: ch, cellMargin: m, cellRadius: radius } = geometry;
  const stepX = cw + m * 2;
  const stepY = ch + m * 2;
  const { width, height } = boardPixelSize(geometry);
  const isTurn = variant === 'turn';

  const letterSize = isTurn ? (cw > 26 ? 14 : 11) : 14;
  const font = useFont(GEIST_BOLD, letterSize);
  const bulldogImage = useImage(BULLDOG);

  const cellBg = isDark ? 'rgba(25,25,91,0.7)' : '#FFFFFF';
  const cellBorder = isTurn
    ? isDark ? 'rgba(255,255,255,0.1)' : 'rgba(204,218,228,0.4)'
    : isDark ? 'rgba(255,255,255,0.1)' : '#CCDAE466';
  const hoverBg = isDark ? 'rgba(100, 200, 255, 0.4)' : 'rgba(100, 200, 255, 0.3)';
  const pickBg = isDark ? 'rgba(100, 200, 255, 0.25)' : 'rgba(100, 200, 255, 0.18)';

  // Color-blind token paragraphs, built once per mode/size.
  const tokenParagraphs = useMemo(() => {
    if (!colorBlindEnabled) return null;
    const tokens = COLOR_BLIND_TOKENS[colorBlindMode];
    const centerSize = isTurn ? (cw > 26 ? 18 : 14) : 26;
    return {
      center: tokens.map((t) => makeTokenParagraph(t, centerSize, cw)),
      corner: isTurn ? null : tokens.map((t) => makeTokenParagraph(t, 10, cw)),
    };
  }, [colorBlindEnabled, colorBlindMode, cw, isTurn]);

  const bulldogSet = useMemo(() => new Set(bulldogs.map((b) => `${b.row},${b.col}`)), [bulldogs]);
  const scoredMap = useMemo(() => new Map(scoredCells.map((key, i) => [key, i] as const)), [scoredCells]);
  const shimmerSet = useMemo(() => new Set(shimmerCells ?? []), [shimmerCells]);

  // Scoring celebration clock: restarts whenever a new set of scored tiles arrives.
  const scoreClock = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(scoreClock);
    scoreClock.value = 0;
    if (scoredCells.length === 0) return;
    const total = (scoredCells.length - 1) * SCORE_FX_STAGGER_MS + SCORE_FX_MS;
    scoreClock.value = withTiming(total, { duration: total, easing: Easing.linear });
  }, [scoreClock, scoredCells, scoredRun]);

  // Per-cell elements. Building this array is cheap; React then only re-renders
  // the memoized cells whose props actually changed.
  const bases: React.ReactNode[] = [];
  const contents: React.ReactNode[] = [];
  // Scored tiles are drawn above their neighbours (like the web's z-index): fx, then their letters, then borders.
  const scoredFx: React.ReactNode[] = [];
  const scoredContents: React.ReactNode[] = [];
  const scoredBorders: React.ReactNode[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const key = `${row},${col}`;
      const x = col * stepX + m;
      const y = row * stepY + m;
      const colorIndex = grid[row]?.[col] ?? null;
      const letter = letterAt(row, col, gridSize);
      const isBulldog = bulldogSet.has(key);
      const scoredIndex = scoredMap.get(key);
      const isScored = scoredIndex !== undefined;
      const isHint = !isTurn && hint?.row === row && hint?.col === col;
      const isPick = pickTarget?.row === row && pickTarget?.col === col;
      const gradient = colorIndex !== null ? gradients[colorIndex] : undefined;
      const hintGradient = isHint && hint ? gradients[hint.colorIndex] : undefined;
      const outline = isScored ? 'scored' : isHint ? 'hint' : isPick ? 'pick' : 'none';
      const counterOutline = isDark && gradient ? DARK_COUNTER_OUTLINE : null;

      bases.push(
        <CellBase
          key={key}
          x={x}
          y={y}
          w={cw}
          h={ch}
          r={radius}
          bg={isHint ? hoverBg : isPick ? pickBg : cellBg}
          border={outline === 'none' ? cellBorder : null}
        />
      );

      let bulldogMode: CellContentProps['bulldogMode'] = 'none';
      if (isBulldog) {
        if (!isTurn) bulldogMode = 'corner';
        else if (!letter) bulldogMode = colorIndex !== null ? 'centerFaded' : 'center';
      }

      if (hintGradient) {
        contents.push(
          <HintFx
            key={`hfx${key}`}
            x={x}
            y={y}
            w={cw}
            h={ch}
            r={radius}
            hintA={hintGradient[0]}
            hintB={hintGradient[1]}
            counterOutline={isDark ? DARK_COUNTER_OUTLINE : null}
          />
        );
      }
      if (isScored) {
        scoredFx.push(
          <ScoredFx
            key={`sfx${key}`}
            x={x}
            y={y}
            w={cw}
            h={ch}
            r={radius}
            index={scoredIndex}
            clock={scoreClock}
            isTurn={isTurn}
            fillA={gradient ? gradient[0] : null}
            fillB={gradient ? gradient[1] : null}
            counterOutline={counterOutline}
          />
        );
        scoredBorders.push(<ScoredBorder key={`sb${key}`} x={x} y={y} w={cw} h={ch} r={radius} index={scoredIndex} clock={scoreClock} />);
      }

      (isScored ? scoredContents : contents).push(
        <CellContent
          key={key}
          x={x}
          y={y}
          w={cw}
          h={ch}
          r={radius}
          isTurn={isTurn}
          fillA={gradient && !isScored ? gradient[0] : null}
          fillB={gradient && !isScored ? gradient[1] : null}
          fillScale={1}
          fillOpacity={1}
          hintA={null}
          hintB={null}
          bulldog={bulldogMode === 'none' ? null : bulldogImage}
          bulldogMode={bulldogMode}
          letter={letter}
          letterColor={
            isTurn
              ? colorIndex !== null ? '#FFFFFF' : isDark ? '#FFFFFF' : '#0F172A'
              : isDark ? '#FFFFFF' : '#000000'
          }
          font={letter ? font : null}
          token={tokenParagraphs && colorIndex !== null && !letter ? tokenParagraphs.center[colorIndex] ?? null : null}
          tokenCorner={
            tokenParagraphs?.corner && colorIndex !== null && letter ? tokenParagraphs.corner[colorIndex] ?? null : null
          }
          hintToken={tokenParagraphs && isHint && hint ? tokenParagraphs.center[hint.colorIndex] ?? null : null}
          outline={isScored ? 'none' : outline}
          counterOutline={isScored ? null : counterOutline}
        />
      );
    }
  }

  // ── Animated hover highlight (UI thread only) ──
  const hoverX = useDerivedValue(() => (hoverCell.value === NO_CELL ? -1000 : (hoverCell.value % gridSize) * stepX + m));
  const hoverY = useDerivedValue(() => (hoverCell.value === NO_CELL ? -1000 : Math.floor(hoverCell.value / gridSize) * stepY + m));
  const hoverBorderX = useDerivedValue(() => hoverX.value + 1);
  const hoverBorderY = useDerivedValue(() => hoverY.value + 1);

  // ── Opponent-move shimmer (turn variant) ──
  const shimmerTransform = useDerivedValue(() => {
    const p = shimmerProgress ? shimmerProgress.value : 0;
    return [{ translateX: -cw + 2 * cw * p }, { rotate: (18 * Math.PI) / 180 }];
  });
  const shimmerWidth = Math.max(12, cw * 0.45);
  const shimmerLayer = useMemo(() => {
    if (!isTurn || shimmerSet.size === 0) return null;
    return [...shimmerSet].map((key) => {
      const [row, col] = key.split(',').map(Number);
      const x = col * stepX + m;
      const y = row * stepY + m;
      const cx = x + cw / 2;
      const cy = y + ch / 2;
      return (
        <Group key={`sh${key}`} clip={rrect(rect(x, y, cw, ch), radius, radius)}>
          <Group origin={vec(cx, cy)} transform={shimmerTransform}>
            <Rect x={cx - shimmerWidth / 2} y={y - 10} width={shimmerWidth} height={ch + 20} color="rgba(255,255,255,0.72)" />
          </Group>
        </Group>
      );
    });
  }, [ch, cw, isTurn, m, radius, shimmerSet, shimmerTransform, shimmerWidth, stepX, stepY]);

  const canvas = (
    <Canvas style={{ width, height }} pointerEvents="none">
      {bases}
      <RoundedRect x={hoverX} y={hoverY} width={cw} height={ch} r={radius} color={hoverBg} />
      {contents}
      {scoredFx}
      {scoredContents}
      {scoredBorders}
      {shimmerLayer}
      <RoundedRect
        x={hoverBorderX}
        y={hoverBorderY}
        width={cw - 2}
        height={ch - 2}
        r={radius - 1}
        color={HOVER_BORDER}
        style="stroke"
        strokeWidth={2}
      />
    </Canvas>
  );

  const handlePress = onCellPress
    ? (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        const col = Math.floor(locationX / stepX);
        const row = Math.floor(locationY / stepY);
        if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return;
        onCellPress(row, col);
      }
    : undefined;

  return (
    <Animated.View ref={gridRef} collapsable={false} style={[styles.grid, { width, height }]}>
      {handlePress ? (
        <Pressable onPress={handlePress} style={StyleSheet.absoluteFill}>
          {canvas}
        </Pressable>
      ) : (
        canvas
      )}
    </Animated.View>
  );
}

export const SkiaGameBoard = memo(SkiaGameBoardImpl);

const styles = StyleSheet.create({
  grid: { position: 'relative' },
});
