/**
 * Native replacement for react-native-spotlight-tour's provider.
 *
 * Same API surface the app uses (provider props, render-prop `tour` object, ref.start/stop,
 * step `render` + `before`), but the overlay is drawn differently:
 * - the dimmed backdrop + spotlight hole is a single Skia path whose hole rect is driven by
 *   Reanimated shared values, so moving between steps animates on the UI thread;
 * - the tooltip fades/slides with Reanimated instead of the JS-driven Animated API;
 * - no full-screen react-native-svg mask re-rendered every frame (the old source of jank).
 *
 * Web keeps the original library (see SpotlightTour.web.tsx).
 */
import { Canvas, FillType, Path, Skia } from '@shopify/react-native-skia';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BackHandler, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { TourState, TourStep } from 'react-native-spotlight-tour';

export type { TourState, TourStep } from 'react-native-spotlight-tour';

type Spot = { x: number; y: number; width: number; height: number };
type TourStatus = 'idle' | 'running';

export type SpotlightTour = {
  current: number | undefined;
  status: TourStatus;
  spot: Spot;
  steps: TourStep[];
  changeSpot: (spot: Spot) => void;
  start: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
};

export type SpotlightTourHandle = Pick<SpotlightTour, 'current' | 'status' | 'start' | 'stop' | 'next' | 'previous' | 'goTo'>;

type ShapeOption = string | { type?: string; padding?: number };

type Props = {
  steps: TourStep[];
  children: ReactNode | ((tour: SpotlightTour) => ReactNode);
  overlayColor?: string;
  overlayOpacity?: number;
  shape?: ShapeOption;
  /** Accepted for API compatibility; the app never shows tooltip arrows. */
  arrow?: unknown;
  onBackdropPress?: () => void;
  onStop?: (state: TourState) => void;
};

const ZERO_SPOT: Spot = { x: 0, y: 0, width: 0, height: 0 };
const HOLE_RADIUS = 4;
const TOOLTIP_GAP = 12;
const EDGE_MARGIN = 12;
const MOVE_MS = 320;
const FADE_MS = 180;
const MOVE_EASING = Easing.out(Easing.cubic);

function paddingOf(shape: ShapeOption | undefined) {
  if (shape && typeof shape === 'object' && typeof shape.padding === 'number') return shape.padding;
  return 16;
}

export const SpotlightTourProvider = forwardRef<SpotlightTourHandle, Props>(function SpotlightTourProvider(props, ref) {
  const { steps, children, overlayColor = 'black', overlayOpacity = 0.45, shape, onBackdropPress, onStop } = props;
  const padding = paddingOf(shape);

  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [spot, setSpot] = useState<Spot>(ZERO_SPOT);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  const rootRef = useRef<View | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  // ── UI-thread state ──
  const holeX = useSharedValue(0);
  const holeY = useSharedValue(0);
  const holeW = useSharedValue(0);
  const holeH = useSharedValue(0);
  const overlayFade = useSharedValue(0);
  const tooltipFade = useSharedValue(0);
  const hasHole = useRef(false);

  const status: TourStatus = current === undefined ? 'idle' : 'running';

  const hideTooltip = useCallback(() => {
    return new Promise<void>((resolve) => {
      if (tooltipFade.value === 0) {
        resolve();
        return;
      }
      tooltipFade.value = withTiming(0, { duration: FADE_MS }, () => {
        runOnJS(resolve)();
      });
    });
  }, [tooltipFade]);

  const renderStep = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step) return;
      void Promise.all([hideTooltip(), Promise.resolve().then(step.before)]).then(() => {
        setCardSize(null);
        setCurrent(index);
      });
    },
    [hideTooltip, steps]
  );

  // Spots arrive in window coordinates; convert to this provider's coordinates.
  const changeSpot = useCallback((next: Spot) => {
    const node = rootRef.current as any;
    if (!node?.measureInWindow) {
      setSpot(next);
      return;
    }
    node.measureInWindow((rx: number, ry: number) => {
      setSpot({ x: next.x - rx, y: next.y - ry, width: next.width, height: next.height });
    });
  }, []);

  const start = useCallback(() => {
    hasHole.current = false;
    overlayFade.value = withTiming(1, { duration: FADE_MS });
    renderStep(0);
  }, [overlayFade, renderStep]);

  const stop = useCallback(() => {
    const prev = currentRef.current;
    if (prev !== undefined) {
      onStop?.({ index: prev, isLast: prev === steps.length - 1 });
    }
    tooltipFade.value = withTiming(0, { duration: FADE_MS });
    overlayFade.value = withTiming(0, { duration: FADE_MS }, (finished) => {
      if (finished) runOnJS(setCurrent)(undefined);
    });
    setSpot(ZERO_SPOT);
    hasHole.current = false;
  }, [onStop, overlayFade, steps.length, tooltipFade]);

  const next = useCallback(() => {
    const idx = currentRef.current;
    if (idx === undefined) return;
    if (idx === steps.length - 1) stop();
    else renderStep(idx + 1);
  }, [renderStep, steps.length, stop]);

  const previous = useCallback(() => {
    const idx = currentRef.current;
    if (idx !== undefined && idx > 0) renderStep(idx - 1);
  }, [renderStep]);

  const goTo = useCallback((index: number) => renderStep(index), [renderStep]);

  // Move the spotlight hole on the UI thread whenever the spot changes.
  useEffect(() => {
    if (spot.width <= 0 || spot.height <= 0) return;
    const x = spot.x - padding / 2;
    const y = spot.y - padding / 2;
    const w = spot.width + padding;
    const h = spot.height + padding;
    if (!hasHole.current) {
      // First spot of the tour: appear in place rather than flying in from the corner.
      holeX.value = x;
      holeY.value = y;
      holeW.value = w;
      holeH.value = h;
      hasHole.current = true;
      return;
    }
    const cfg = { duration: MOVE_MS, easing: MOVE_EASING };
    holeX.value = withTiming(x, cfg);
    holeY.value = withTiming(y, cfg);
    holeW.value = withTiming(w, cfg);
    holeH.value = withTiming(h, cfg);
  }, [holeH, holeW, holeX, holeY, padding, spot]);

  // Show the tooltip once both the spot and the card size are known.
  useEffect(() => {
    if (current === undefined || !cardSize || spot.width <= 0) return;
    tooltipFade.value = withTiming(1, { duration: FADE_MS + 40 });
  }, [cardSize, current, spot, tooltipFade]);

  // While the tour is up, the hardware back button does nothing (same as the old modal overlay).
  useEffect(() => {
    if (current === undefined) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [current]);

  const tour = useMemo<SpotlightTour>(
    () => ({ current, status, spot, steps, changeSpot, start, stop, next, previous, goTo }),
    [changeSpot, current, goTo, next, previous, spot, start, status, steps, stop]
  );

  useImperativeHandle(ref, () => ({ current, status, start, stop, next, previous, goTo }), [
    current,
    goTo,
    next,
    previous,
    start,
    status,
    stop,
  ]);

  // ── Backdrop path (outer rect with an even-odd rounded hole), built on the UI thread ──
  const { width: overlayW, height: overlayH } = overlaySize;
  const backdropPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    path.addRect(Skia.XYWHRect(0, 0, overlayW, overlayH));
    if (holeW.value > 0 && holeH.value > 0) {
      path.addRRect(Skia.RRectXY(Skia.XYWHRect(holeX.value, holeY.value, holeW.value, holeH.value), HOLE_RADIUS, HOLE_RADIUS));
    }
    path.setFillType(FillType.EvenOdd);
    return path;
  });

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayFade.value }));
  const tooltipStyle = useAnimatedStyle(() => ({
    opacity: tooltipFade.value,
    transform: [{ translateY: (1 - tooltipFade.value) * 6 }],
  }));

  // Tooltip placement: below the spot, flipped above when it doesn't fit, clamped to the screen.
  let tooltipLeft = EDGE_MARGIN;
  let tooltipTop = EDGE_MARGIN;
  if (cardSize && overlayW > 0) {
    const holeTop = spot.y - padding / 2;
    const holeBottom = spot.y + spot.height + padding / 2;
    const centerX = spot.x + spot.width / 2;
    tooltipLeft = Math.min(Math.max(centerX - cardSize.width / 2, EDGE_MARGIN), Math.max(EDGE_MARGIN, overlayW - cardSize.width - EDGE_MARGIN));
    tooltipTop = holeBottom + TOOLTIP_GAP;
    if (tooltipTop + cardSize.height > overlayH - EDGE_MARGIN) {
      const above = holeTop - TOOLTIP_GAP - cardSize.height;
      tooltipTop = above >= EDGE_MARGIN ? above : Math.max(EDGE_MARGIN, overlayH - EDGE_MARGIN - cardSize.height);
    }
  }

  const step = current !== undefined ? steps[current] : undefined;

  const onOverlayLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setOverlaySize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const onCardLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCardSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  return (
    <View ref={rootRef} collapsable={false} style={styles.root}>
      {typeof children === 'function' ? children(tour) : children}
      {current !== undefined && step ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
          onLayout={onOverlayLayout}
          onStartShouldSetResponder={() => true}
          onResponderRelease={() => onBackdropPress?.()}
        >
          {overlayW > 0 ? (
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Path path={backdropPath} color={overlayColor} opacity={overlayOpacity} />
            </Canvas>
          ) : null}
          <Animated.View
            onLayout={onCardLayout}
            style={[styles.tooltip, { left: tooltipLeft, top: tooltipTop, maxWidth: Math.max(0, overlayW - EDGE_MARGIN * 2) }, tooltipStyle]}
          >
            {step.render({
              current,
              isFirst: current === 0,
              isLast: current === steps.length - 1,
              next,
              previous,
              stop,
              goTo,
              pause: stop,
              resume: start,
            } as any)}
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { zIndex: 10000, elevation: 10000 },
  tooltip: { position: 'absolute' },
});
