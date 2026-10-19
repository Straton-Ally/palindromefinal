"""
Generate the native app's sound effects as small WAV files.

They reproduce the Web Audio tones the web game plays (hooks/use-sound.ts, WEB_TONES):
same oscillator type, frequency, attack and duration, with the same envelope
(0.0001 -> gain linearly over the attack, then exponentially back to 0.0001).
Levels keep the web's relative gains, scaled up 4x because the web values are
mixed into a browser page while these play as standalone phone sounds.

Run from the project root:  python scripts/generate-sounds.py
"""
import math
import os
import struct
import wave

SAMPLE_RATE = 44100
LEVEL_SCALE = 4.0
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds')

# Mirrors WEB_TONES in hooks/use-sound.ts
TONES = {
    'pickup': {'type': 'sine', 'frequency': 880, 'duration_ms': 60, 'attack_ms': 6, 'gain': 0.12},
    'drop': {'type': 'sine', 'frequency': 420, 'duration_ms': 90, 'attack_ms': 6, 'gain': 0.12},
    'error': {'type': 'square', 'frequency': 180, 'duration_ms': 140, 'attack_ms': 6, 'gain': 0.08},
    'success': {'type': 'triangle', 'frequency': 660, 'duration_ms': 140, 'attack_ms': 8, 'gain': 0.1},
}


def oscillator(kind, phase):
    """phase in cycles (0..1 repeating)"""
    p = phase % 1.0
    if kind == 'sine':
        return math.sin(2 * math.pi * p)
    if kind == 'square':
        return 1.0 if p < 0.5 else -1.0
    if kind == 'triangle':
        return 4 * p - 1 if p < 0.5 else 3 - 4 * p
    raise ValueError(kind)


def envelope(t, attack, duration, gain):
    floor = 0.0001
    if t <= attack:
        return floor + (gain - floor) * (t / attack)
    # exponentialRampToValueAtTime(0.0001, attack + duration)
    k = min(1.0, (t - attack) / duration)
    return gain * (floor / gain) ** k


def render(spec):
    attack = spec['attack_ms'] / 1000
    duration = spec['duration_ms'] / 1000
    total = attack + duration + 0.02  # oscillator.stop(now + attack + duration + 0.02)
    n = int(total * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        value = oscillator(spec['type'], spec['frequency'] * t) * envelope(t, attack, duration, spec['gain']) * LEVEL_SCALE
        samples.append(max(-1.0, min(1.0, value)))
    return samples


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, spec in TONES.items():
        path = os.path.join(OUT_DIR, f'{name}.wav')
        with wave.open(path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(b''.join(struct.pack('<h', int(s * 32767)) for s in render(spec)))
        print(f'{path}: {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    main()
