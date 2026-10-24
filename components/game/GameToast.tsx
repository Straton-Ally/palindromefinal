/**
 * Small non-blocking message for the game screens (native), e.g. why a counter can't go there.
 * Fades in/out with Reanimated and disappears on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

const VISIBLE_MS = 2200;

export function useGameToast() {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), text });
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, showToast };
}

export function GameToast(props: { toast: { id: number; text: string } | null; style?: StyleProp<ViewStyle> }) {
  const { toast } = props;
  if (!toast) return null;
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
      style={[styles.container, props.style]}
    >
      <Text style={styles.text}>{toast.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 10000,
    elevation: 20,
  },
  text: {
    overflow: 'hidden',
    textAlign: 'center',
    color: '#FFFFFF',
    fontFamily: 'Geist-Bold',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(17,17,17,0.9)',
  },
});
