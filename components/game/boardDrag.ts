/**
 * Native-only drag-and-drop plumbing for the game boards.
 *
 * Drag tracking runs on the UI thread (react-native-gesture-handler + Reanimated),
 * so moving a block never re-renders the game screen. Only the final drop (and
 * pickup / drag start-end flags) cross back to JS.
 *
 * Web screens (*.web.tsx) never import this file.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  measure,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import type { View } from 'react-native';

export const NO_CELL = -1;
/** Movement (points) that separates a tap on the counter from a drag. */
const TAP_SLOP = 8;

export type BoardGeometry = {
  gridSize: number;
  cellWidth: number;
  cellHeight: number;
  cellMargin: number;
  cellRadius: number;
};

export function boardPixelSize(g: BoardGeometry) {
  return {
    width: g.gridSize * (g.cellWidth + g.cellMargin * 2),
    height: g.gridSize * (g.cellHeight + g.cellMargin * 2),
  };
}

/**
 * Shared values describing the board for UI-thread consumers:
 * - hoverCell: flat index (row * gridSize + col) of the highlighted drop target, or NO_CELL
 * - occupied: flat array, 1 where a cell already holds a block
 */
export function useBoardSharedState(grid: (number | null)[][]) {
  const hoverCell = useSharedValue<number>(NO_CELL);
  const occupied = useSharedValue<number[]>([]);

  useEffect(() => {
    const flat: number[] = [];
    for (const row of grid) {
      for (const cell of row) flat.push(cell === null || cell === undefined ? 0 : 1);
    }
    occupied.value = flat;
  }, [grid, occupied]);

  return { hoverCell, occupied };
}

type UseBoardDragOptions = {
  enabled: boolean;
  geometry: BoardGeometry;
  /** Ref to the Animated.View that wraps exactly the grid canvas (origin = top-left of first cell's margin box). */
  gridRef: AnimatedRef<View>;
  /** Ref to the Animated.View of the draggable block itself. */
  blockRef: AnimatedRef<View>;
  hoverCell: SharedValue<number>;
  occupied: SharedValue<number[]>;
  /** Size of the draggable block view in points (used to shrink it to cell size while dragging). */
  blockSize: number;
  /** When true, only empty cells are highlighted while hovering. */
  hoverOnlyEmpty: boolean;
  onPickup: () => void;
  onDrop: (row: number, col: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  /** Tap (no real drag) on the counter: used for "tap a square, then a colour" placement. */
  onTap?: () => void;
};

export function useBoardDrag(options: UseBoardDragOptions) {
  const { enabled, geometry, gridRef, blockRef, hoverCell, occupied, hoverOnlyEmpty, blockSize: dragBlockSize } = options;

  const latest = useRef(options);
  latest.current = options;

  const handlePickup = useCallback(() => latest.current.onPickup(), []);
  const handleDrop = useCallback((row: number, col: number) => latest.current.onDrop(row, col), []);
  const handleDraggingChange = useCallback((dragging: boolean) => latest.current.onDraggingChange(dragging), []);
  const handleTap = useCallback(() => latest.current.onTap?.(), []);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);
  // Center of the dragged block relative to the grid's first cell origin, at gesture start.
  // The block moves with the finger, so its center + translation is the drop target:
  // the highlighted cell is always the one directly under the block.
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const tracking = useSharedValue(0);
  // Finger position at touch-down. Gesture Handler's translation on Android starts at activation
  // (the first move), not touch-down, so movement is measured from here instead.
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);

  const { gridSize, cellWidth, cellHeight, cellMargin } = geometry;
  const stepX = cellWidth + cellMargin * 2;
  const stepY = cellHeight + cellMargin * 2;

  const gesture = useMemo(() => {
    const cellAt = (x: number, y: number) => {
      'worklet';
      const col = Math.floor(x / stepX);
      const row = Math.floor(y / stepY);
      if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return NO_CELL;
      return row * gridSize + col;
    };

    // Tap on the counter ("tap a square, then a colour"); races the drag below.
    const tap = Gesture.Tap()
      .enabled(enabled)
      .maxDistance(TAP_SLOP)
      .onEnd((_e, success) => {
        if (success) runOnJS(handleTap)();
      });

    const pan = Gesture.Pan()
      .enabled(enabled)
      .minDistance(TAP_SLOP)
      .onBegin((e) => {
        downX.value = e.absoluteX;
        downY.value = e.absoluteY;
      })
      .onStart(() => {
        const grid = measure(gridRef);
        const block = measure(blockRef);
        if (grid && block) {
          originX.value = block.pageX + block.width / 2 - grid.pageX - cellMargin;
          originY.value = block.pageY + block.height / 2 - grid.pageY - cellMargin;
          tracking.value = 1;
        } else {
          tracking.value = 0;
        }
        dragging.value = 1;
        hoverCell.value = NO_CELL;
        runOnJS(handleDraggingChange)(true);
        runOnJS(handlePickup)();
      })
      .onUpdate((e) => {
        const dx = e.absoluteX - downX.value;
        const dy = e.absoluteY - downY.value;
        translateX.value = dx;
        translateY.value = dy;
        if (!tracking.value) return;
        let idx = cellAt(originX.value + dx, originY.value + dy);
        if (idx !== NO_CELL && hoverOnlyEmpty && occupied.value[idx] === 1) idx = NO_CELL;
        if (idx !== hoverCell.value) hoverCell.value = idx;
      })
      .onEnd((e) => {
        if (!tracking.value) return;
        const idx = cellAt(originX.value + e.absoluteX - downX.value, originY.value + e.absoluteY - downY.value);
        if (idx !== NO_CELL) {
          runOnJS(handleDrop)(Math.floor(idx / gridSize), idx % gridSize);
        }
      })
      .onFinalize(() => {
        tracking.value = 0;
        hoverCell.value = NO_CELL;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        if (dragging.value) {
          dragging.value = 0;
          runOnJS(handleDraggingChange)(false);
        }
      });

    return Gesture.Race(pan, tap);
  }, [
    blockRef,
    cellMargin,
    downX,
    downY,
    dragging,
    enabled,
    gridRef,
    gridSize,
    handleDraggingChange,
    handleDrop,
    handlePickup,
    handleTap,
    hoverCell,
    hoverOnlyEmpty,
    occupied,
    originX,
    originY,
    stepX,
    stepY,
    tracking,
    translateX,
    translateY,
  ]);

  // While dragging, the block shrinks to roughly cell size and turns slightly see-through,
  // so the highlighted cell underneath (the drop target) stays visible.
  const liftScale = Math.min(1, (Math.max(cellWidth, cellHeight) + 2) / dragBlockSize);
  const translateStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.value ? 0.8 : 1, { duration: 120 }),
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: withTiming(dragging.value ? liftScale : 1, { duration: 120 }) },
    ],
  }));

  return { gesture, translateStyle, dragging };
}
