import { useSettings } from '@/context/SettingsContext';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

type SoundKey = 'pickup' | 'drop' | 'error' | 'success';

type WebTone = {
  type: OscillatorType;
  frequency: number;
  durationMs: number;
  attackMs: number;
  gain: number;
};

const WEB_TONES: Record<SoundKey, WebTone> = {
  pickup: { type: 'sine', frequency: 880, durationMs: 60, attackMs: 6, gain: 0.12 },
  drop: { type: 'sine', frequency: 420, durationMs: 90, attackMs: 6, gain: 0.12 },
  error: { type: 'square', frequency: 180, durationMs: 140, attackMs: 6, gain: 0.08 },
  success: { type: 'triangle', frequency: 660, durationMs: 140, attackMs: 8, gain: 0.1 },
};

// Bundled with the app (generated from WEB_TONES by scripts/generate-sounds.py), so native
// sounds match the web game, work offline and have no first-play network delay.
const NATIVE_SOUND_SOURCES: Record<SoundKey, number> = {
  pickup: require('../assets/sounds/pickup.wav'),
  drop: require('../assets/sounds/drop.wav'),
  error: require('../assets/sounds/error.wav'),
  success: require('../assets/sounds/success.wav'),
};

export function useSound() {
  const { soundEnabled } = useSettings();

  const webAudioContextRef = useRef<AudioContext | null>(null);
  const nativeSoundsRef = useRef<Partial<Record<SoundKey, any>> | null>(null);
  const nativeLoadPromiseRef = useRef<Promise<void> | null>(null);

  const getWebAudioContext = useCallback(() => {
    if (Platform.OS !== 'web') return null;
    if (webAudioContextRef.current) return webAudioContextRef.current;

    const AudioContextCtor: typeof AudioContext | undefined =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();
    webAudioContextRef.current = ctx;
    return ctx;
  }, []);

  const playWebTone = useCallback((key: SoundKey) => {
    const ctx = getWebAudioContext();
    if (!ctx) return;

    const tone = WEB_TONES[key];
    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, now);

    const attackSeconds = tone.attackMs / 1000;
    const durationSeconds = tone.durationMs / 1000;

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(tone.gain, now + attackSeconds);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attackSeconds + durationSeconds);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    ctx.resume().catch(() => {});

    oscillator.start(now);
    oscillator.stop(now + attackSeconds + durationSeconds + 0.02);
  }, [getWebAudioContext]);

  const ensureNativeSounds = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (nativeSoundsRef.current) return;
    if (nativeLoadPromiseRef.current) return nativeLoadPromiseRef.current;

    nativeLoadPromiseRef.current = (async () => {
      const { createAudioPlayer, setAudioModeAsync } = await import('expo-audio');
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      });

      const entries = (Object.keys(NATIVE_SOUND_SOURCES) as SoundKey[]).map(async (key) => {
        try {
          const player = createAudioPlayer(NATIVE_SOUND_SOURCES[key]);
          return [key, player] as const;
        } catch {
          return null;
        }
      });

      const loaded = await Promise.all(entries);
      const sounds = loaded.filter((v): v is readonly [SoundKey, any] => v !== null);
      nativeSoundsRef.current = sounds.reduce((acc, [key, sound]) => {
        acc[key] = sound;
        return acc;
      }, {} as Record<SoundKey, any>);
    })();

    return nativeLoadPromiseRef.current;
  }, []);

  const playNativeSound = useCallback(async (key: SoundKey) => {
    try {
      await ensureNativeSounds();
      const sound = nativeSoundsRef.current?.[key];
      if (!sound) return;
      sound.seekTo(0);
      sound.play();
    } catch {
      return;
    }
  }, [ensureNativeSounds]);

  const play = useCallback(
    (key: SoundKey) => {
      if (!soundEnabled) return;
      if (Platform.OS === 'web') {
        playWebTone(key);
        return;
      }
      // seekTo/play are synchronous native calls (~5-30 ms on the JS thread). Run them on the
      // next macrotask so a state update made in the same handler (placing a block, showing the
      // score) renders first instead of waiting behind the audio call.
      setTimeout(() => {
        void playNativeSound(key);
      }, 0);
    },
    [playNativeSound, playWebTone, soundEnabled],
  );

  useEffect(() => {
    return () => {
      if (webAudioContextRef.current) {
        webAudioContextRef.current.close().catch(() => {});
        webAudioContextRef.current = null;
      }
      const sounds = nativeSoundsRef.current;
      if (sounds) {
        (Object.keys(sounds) as SoundKey[]).forEach((k) => {
          try {
            sounds[k].remove();
          } catch {
            // ignore
          }
        });
        nativeSoundsRef.current = null;
      }
      nativeLoadPromiseRef.current = null;
    };
  }, []);

  const playPickupSound = useCallback(() => play('pickup'), [play]);
  const playDropSound = useCallback(() => play('drop'), [play]);
  const playErrorSound = useCallback(() => play('error'), [play]);
  const playSuccessSound = useCallback(() => play('success'), [play]);

  return { playPickupSound, playDropSound, playErrorSound, playSuccessSound };
}
