/**
 * Native scoring celebration UI (Reanimated, UI thread), mirroring the web game's keyframes:
 * - ScoreFeedback: "GOOD!/GREAT!/..." pops in (0 > 1.2 > 1, 0.5 s) then floats up 60 and fades (after 1 s).
 * - AnimatedScore: score value pops (1 > 1.18 > 1, 0.42 s) and a green "+N" rises and fades (1.15 s).
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, type StyleProp, type TextStyle, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export function ScoreFeedback(props: { text: string; color: string; style?: StyleProp<TextStyle> }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const rise = useSharedValue(0);

  useEffect(() => {
    // popIn 0.5s ease-out
    scale.value = withSequence(
      withTiming(1.2, { duration: 250, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) })
    );
    // floatUp 1.5s ease-in, starting at 1s
    opacity.value = withSequence(
      withTiming(1, { duration: 250 }),
      withDelay(750, withTiming(0, { duration: 1500, easing: Easing.in(Easing.quad) }))
    );
    rise.value = withDelay(1000, withTiming(-60, { duration: 1500, easing: Easing.in(Easing.quad) }));
  }, [opacity, rise, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }, { scale: scale.value }],
  }));

  return (
    <Animated.Text style={[styles.feedback, props.style, { color: props.color }, animatedStyle]} numberOfLines={1}>
      {props.text}
    </Animated.Text>
  );
}

type Burst = { id: number; points: number };

function ScoreBurst(props: { points: number; color: string; onDone: () => void }) {
  const progress = useSharedValue(0);
  const onDoneRef = useRef(props.onDone);
  onDoneRef.current = props.onDone;
  useEffect(() => {
    progress.value = withTiming(1, { duration: 1150, easing: Easing.out(Easing.quad) });
    const timer = setTimeout(() => onDoneRef.current(), 1200);
    return () => clearTimeout(timer);
  }, [progress]);

  // web scoreBurst: 0% (y 8, scale .7, op 0) > 18% (y -4, scale 1.08, op 1) > 100% (y -34, scale 1, op 0)
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const head = p < 0.18;
    const k = head ? p / 0.18 : (p - 0.18) / 0.82;
    return {
      opacity: head ? k : 1 - k,
      transform: [
        { translateY: head ? 8 - 12 * k : -4 - 30 * k },
        { scale: head ? 0.7 + 0.38 * k : 1.08 - 0.08 * k },
      ],
    };
  });

  return <Animated.Text style={[styles.burst, { color: props.color }, style]}>+{props.points}</Animated.Text>;
}

/** Score number that pops when it increases, with a floating "+N". */
export function AnimatedScore(props: { value: number; style?: StyleProp<TextStyle>; burstColor?: string }) {
  const { value } = props;
  const previous = useRef(value);
  const pop = useSharedValue(1);
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const delta = value - previous.current;
    previous.current = value;
    if (delta <= 0) return;
    pop.value = withSequence(
      withTiming(1.18, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 270, easing: Easing.out(Easing.quad) })
    );
    setBursts((prev) => [...prev, { id: Date.now() + Math.random(), points: delta }]);
  }, [pop, value]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <View style={styles.scoreWrap}>
      <Animated.Text style={[props.style, popStyle]}>{value}</Animated.Text>
      <View pointerEvents="none" style={styles.burstLayer}>
        {bursts.map((b) => (
          <ScoreBurst
            key={b.id}
            points={b.points}
            color={props.burstColor ?? '#22C55E'}
            onDone={() => setBursts((prev) => prev.filter((x) => x.id !== b.id))}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  feedback: {
    fontFamily: 'Geist-Bold',
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 20,
  },
  scoreWrap: { alignItems: 'center', justifyContent: 'center' },
  burstLayer: { position: 'absolute', left: 0, right: 0, top: -6, alignItems: 'center' },
  burst: {
    position: 'absolute',
    fontFamily: 'Geist-Bold',
    fontWeight: '900',
    fontSize: 18,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
