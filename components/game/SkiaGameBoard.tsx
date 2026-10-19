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
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, type GestureResponderEvent, type View } from 'react-native';
import Animated, { useDerivedValue, type AnimatedRef, type SharedValue } from 'react-native-reanimated';

import type { ColorBlindMode } from '@/context/SettingsContext';
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
      {hint}
      {bulldog}
      {letter}
      {tokens}
      {hintToken}
      {outline}
    </>
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

  // Per-cell elements. Building this array is cheap; React then only re-renders
  // the memoized cells whose props actually changed.
  const bases: React.ReactNode[] = [];
  const contents: React.ReactNode[] = [];
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
      const isPick = !isTurn && pickTarget?.row === row && pickTarget?.col === col;
      const gradient = colorIndex !== null ? gradients[colorIndex] : undefined;
      const hintGradient = isHint && hint ? gradients[hint.colorIndex] : undefined;
      const outline = isScored ? 'scored' : isHint ? 'hint' : isPick ? 'pick' : 'none';

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

      contents.push(
        <CellContent
          key={key}
          x={x}
          y={y}
          w={cw}
          h={ch}
          r={radius}
          isTurn={isTurn}
          fillA={gradient ? gradient[0] : null}
          fillB={gradient ? gradient[1] : null}
          fillScale={isTurn && isScored ? (scoredRun % 2 === 0 ? 1.14 : 1.1) : 1}
          fillOpacity={isTurn && isScored && scoredIndex % 2 === 1 ? 0.96 : 1}
          hintA={hintGradient ? hintGradient[0] : null}
          hintB={hintGradient ? hintGradient[1] : null}
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
          outline={outline}
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
