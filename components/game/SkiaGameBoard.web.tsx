/**
 * Web stub for the Skia board.
 *
 * Expo Router bundles the native screen files (gamelayout.tsx, turngame.tsx) into the
 * web build too, even though web renders the *.web.tsx screens. This stub keeps
 * @shopify/react-native-skia out of the web bundle entirely. It is never rendered on web.
 */
import type { ColorBlindMode } from '@/context/SettingsContext';
import type { SkiaGameBoardProps } from './SkiaGameBoard';

export type { BoardVariant, SkiaGameBoardProps } from './SkiaGameBoard';

export const COLOR_BLIND_TOKENS: Record<ColorBlindMode, readonly string[]> = {
  symbols: ['●', '▲', '■', '◆', '★'],
  emojis: ['🍓', '🥑', '🫐', '🖤', '🍋'],
  cards: ['♥', '♣', '♦', '♠', '★'],
  letters: ['A', 'B', 'C', 'D', 'E'],
} as const;

export function SkiaGameBoard(_props: SkiaGameBoardProps) {
  return null;
}
