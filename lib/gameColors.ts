/**
 * Default gradient colors for game blocks (red, green, blue, dark, yellow).
 * Used when user has not set custom colors.
 */
export type GameColorGradient = [string, string];

export const DEFAULT_GAME_GRADIENTS: readonly GameColorGradient[] = [
  ['#C40111', '#F01D2E'],
  ['#757F35', '#99984D'],
  ['#1177FE', '#48B7FF'],
  ['#111111', '#3C3C3C'],
  ['#E7CC01', '#E7E437'],
];

/** HSL to hex (h 0–360, s and l 0–1) */
export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Hex to HSL; returns h in 0–360, s and l in 0–1 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = hex.replace(/^#/, '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s, l };
}

/** Build a gradient from a single hue: [darker, lighter] */
export function gradientFromHue(hue: number, s = 0.7): GameColorGradient {
  return [
    hslToHex(hue, s, 0.35),
    hslToHex(hue, s, 0.55),
  ];
}

/** Build a gradient from hue and lightness (0–1). Lightness 0 = black, 1 = white. */
export function gradientFromHueAndLightness(hue: number, lightness: number, s = 0.7): GameColorGradient {
  const l1 = Math.max(0, Math.min(1, lightness - 0.12));
  const l2 = Math.max(0, Math.min(1, lightness + 0.12));
  return [
    hslToHex(hue, lightness <= 0.15 || lightness >= 0.85 ? 0 : s, l1),
    hslToHex(hue, lightness <= 0.15 || lightness >= 0.85 ? 0 : s, l2),
  ];
}

/** Normalize hex to #rrggbb (add # if missing, expand 3 to 6). */
export function normalizeHex(hex: string): string {
  let s = hex.replace(/^#/, '').trim();
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6 || !/^[0-9a-fA-F]+$/.test(s)) return '#000000';
  return '#' + s.toLowerCase();
}

/** Build a gradient from a single hex color: [slightly darker, slightly lighter]. */
export function gradientFromHex(hex: string): GameColorGradient {
  const normalized = normalizeHex(hex);
  const { h, s, l } = hexToHsl(normalized);
  const l1 = Math.max(0, l - 0.12);
  const l2 = Math.min(1, l + 0.12);
  return [
    hslToHex(h, s, l1),
    hslToHex(h, s, l2),
  ];
}

/**
 * Subtle light ring drawn around every counter in dark mode, so dark colours (e.g. the default
 * black) stay visible on the navy board without any one colour looking special.
 */
export const DARK_COUNTER_OUTLINE = 'rgba(255,255,255,0.55)';
