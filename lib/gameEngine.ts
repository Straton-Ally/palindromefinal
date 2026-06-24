/**
 * Shared game engine for Palindrome - used by both native and web.
 * All board init, move validation, and scoring logic lives here.
 */

export const GRID_SIZE = 11;
export const NUM_COLORS = 5;
export const DEFAULT_BLOCK_COUNTS = [16, 16, 16, 16, 16] as const;
export const MIN_PALINDROME_LENGTH = 3;
const BULLDOG_BONUS = 10;

/** Center row/col for the PALINDROME word cross */
const CENTER = Math.floor(GRID_SIZE / 2);
const WORD = 'PALINDROME®';
const HALF_WORD = Math.floor(WORD.length / 2);

/** Number of initial pre-placed blocks */
const INITIAL_BLOCK_COUNT = 3;

export type Grid = (number | null)[][];

export interface GameState {
  grid: Grid;
  blockCounts: number[];
  score: number;
  bulldogPositions: { row: number; col: number }[];
  moveCount: number;
}

export interface ScoredTile {
  color: number;
  r: number;
  c: number;
}

export interface ScoringResult {
  score: number;
  /** For UI feedback: segment length that scored (e.g. 3 = GOOD, 4 = GREAT, ...) */
  segmentLength?: number;
  segment?: ScoredTile[];
  kind?: 'row' | 'col' | 'rightAngle';
  hasBulldog?: boolean;
}

export interface HintMove {
  row: number;
  col: number;
  colorIndex: number;
}

export type ScoringEvent = ScoringResult & {
  score: number;
  segmentLength: number;
  segment: ScoredTile[];
};

import { createSeededRandom } from './seededRandom';

function getBlockedPositionsForBulldogs(): Set<string> {
  const blocked = new Set<string>();
  for (let i = 0; i < WORD.length; i++) {
    blocked.add(`${CENTER},${CENTER - HALF_WORD + i}`);
    blocked.add(`${CENTER - HALF_WORD + i},${CENTER}`);
  }
  return blocked;
}

function shuffleColors(rng: () => number): number[] {
  const availableColors = Array.from({ length: NUM_COLORS }, (_, i) => i);
  for (let i = availableColors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [availableColors[i], availableColors[j]] = [availableColors[j], availableColors[i]];
  }
  return availableColors;
}

function createBulldogPositions(
  rng: () => number,
  blocked = getBlockedPositionsForBulldogs()
): { row: number; col: number }[] {
  const totalBulldogs = 5;
  const bulldogPositions: { row: number; col: number }[] = [];

  while (bulldogPositions.length < totalBulldogs) {
    const row = Math.floor(rng() * GRID_SIZE);
    const col = Math.floor(rng() * GRID_SIZE);
    const key = `${row},${col}`;
    if (
      !blocked.has(key) &&
      !bulldogPositions.some((p) => p.row === row && p.col === col)
    ) {
      bulldogPositions.push({ row, col });
    }
  }

  return bulldogPositions;
}

function createGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
}

/**
 * Create the unseeded single-player opener used by the main web game.
 */
export function createSinglePlayerInitialState(rng: () => number = Math.random): GameState {
  const bulldogPositions = createBulldogPositions(rng);
  const grid = createGrid();
  const initialPositions = [
    { row: 5, col: 3 },
    { row: 5, col: 4 },
    { row: 5, col: 5 },
  ];
  const initialColors = shuffleColors(rng).slice(0, INITIAL_BLOCK_COUNT);

  initialPositions.forEach((pos, idx) => {
    grid[pos.row][pos.col] = initialColors[idx];
  });

  const blockCounts = [...DEFAULT_BLOCK_COUNTS] as number[];
  initialColors.forEach((colorIdx) => {
    blockCounts[colorIdx] = Math.max(0, blockCounts[colorIdx] - 1);
  });

  return {
    grid,
    blockCounts,
    score: 0,
    bulldogPositions,
    moveCount: 0,
  };
}

/**
 * Create initial game state from a seed (deterministic for multiplayer).
 */
export function createInitialState(seed: string): GameState {
  const rng = createSeededRandom(seed);
  const blocked = getBlockedPositionsForBulldogs();
  const bulldogPositions = createBulldogPositions(rng, blocked);

  // Pick 2-3 colors for the starting horizontal palindrome setup.
  // Scoring palindromes must be odd-length and use at least two colors.
  const useThreeColors = rng() < 0.5;
  const availableColors = shuffleColors(rng);
  
  const initialColors: number[] = [];
  if (useThreeColors) {
    // 3 different colors
    initialColors.push(availableColors[0], availableColors[1], availableColors[2]);
  } else {
    // 2 colors: first color repeated, second different
    // Pattern: A, B, A (to make it a palindrome-able setup)
    initialColors.push(availableColors[0], availableColors[1], availableColors[0]);
  }

  const initialPositions = [
    { row: 5, col: 3 },
    { row: 5, col: 4 },
    { row: 5, col: 5 },
  ];

  const grid = createGrid();
  initialPositions.forEach((pos, idx) => {
    grid[pos.row][pos.col] = initialColors[idx];
  });

  const blockCounts = [...DEFAULT_BLOCK_COUNTS] as number[];
  initialColors.forEach((colorIdx) => {
    blockCounts[colorIdx] = Math.max(0, blockCounts[colorIdx] - 1);
  });

  return {
    grid,
    blockCounts,
    score: 0,
    bulldogPositions,
    moveCount: 0,
  };
}

/**
 * Check every row, column, and right-angle palindrome created through (row, col).
 */
export function checkAllPalindromes(
  grid: Grid,
  row: number,
  col: number,
  bulldogPositions: { row: number; col: number }[],
  minLength: number = MIN_PALINDROME_LENGTH
): ScoringResult[] {
  const isOdd = (n: number) => n % 2 === 1;
  const isInside = (r: number, c: number) => r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE;
  const hasMultipleColors = (segment: ScoredTile[]) => new Set(segment.map((tile) => tile.color)).size > 1;

  const checkLine = (lineIsRow: boolean): { length: number; segment: ScoredTile[] }[] => {
    const line: ScoredTile[] = [];
    if (lineIsRow) {
      for (let c = 0; c < GRID_SIZE; c++) {
        line.push({ color: grid[row][c] ?? -1, r: row, c });
      }
    } else {
      for (let r = 0; r < GRID_SIZE; r++) {
        line.push({ color: grid[r][col] ?? -1, r, c: col });
      }
    }

    const targetIndex = lineIsRow ? col : row;
    let start = targetIndex;
    let end = targetIndex;

    while (start > 0 && line[start - 1].color !== -1) start--;
    while (end < GRID_SIZE - 1 && line[end + 1].color !== -1) end++;

    const segment = line.slice(start, end + 1);
    if (segment.length < minLength) return [];

    const targetPosInSegment = targetIndex - start;
    const matches: { length: number; segment: ScoredTile[] }[] = [];

    for (let s = 0; s <= targetPosInSegment; s++) {
      for (let e = targetPosInSegment; e < segment.length; e++) {
        const len = e - s + 1;
        if (len < minLength || !isOdd(len)) continue;
        const sub = segment.slice(s, e + 1);
        const colors = sub.map(c => c.color);
        const isPal = colors.join(',') === [...colors].reverse().join(',');
        if (isPal && hasMultipleColors(sub)) {
          matches.push({ length: len, segment: sub });
        }
      }
    }

    return matches;
  };

  const checkRightAngle = (): { length: number; segment: ScoredTile[] }[] => {
    const pairs = [
      { a: { dr: -1, dc: 0 }, b: { dr: 0, dc: -1 } },
      { a: { dr: -1, dc: 0 }, b: { dr: 0, dc: 1 } },
      { a: { dr: 1, dc: 0 }, b: { dr: 0, dc: -1 } },
      { a: { dr: 1, dc: 0 }, b: { dr: 0, dc: 1 } },
    ] as const;

    const matches: { length: number; segment: ScoredTile[] }[] = [];

    const tryCorner = (cornerRow: number, cornerCol: number) => {
      const cornerColor = grid[cornerRow][cornerCol];
      if (cornerColor == null) return;

      for (const pair of pairs) {
        const armA: ScoredTile[] = [];
        const armB: ScoredTile[] = [];

        for (let dist = 1; dist < GRID_SIZE; dist++) {
          const r = cornerRow + pair.a.dr * dist;
          const c = cornerCol + pair.a.dc * dist;
          if (!isInside(r, c) || grid[r][c] == null) break;
          armA.push({ color: grid[r][c] as number, r, c });
        }

        for (let dist = 1; dist < GRID_SIZE; dist++) {
          const r = cornerRow + pair.b.dr * dist;
          const c = cornerCol + pair.b.dc * dist;
          if (!isInside(r, c) || grid[r][c] == null) break;
          armB.push({ color: grid[r][c] as number, r, c });
        }

        for (let lenA = 1; lenA <= armA.length; lenA++) {
          for (let lenB = 1; lenB <= armB.length; lenB++) {
            const length = lenA + 1 + lenB;
            if (length < minLength || !isOdd(length)) continue;

            let includesPlaced = cornerRow === row && cornerCol === col;
            if (!includesPlaced) {
              includesPlaced =
                armA.slice(0, lenA).some((tile) => tile.r === row && tile.c === col) ||
                armB.slice(0, lenB).some((tile) => tile.r === row && tile.c === col);
            }
            if (!includesPlaced) continue;

            const tiles: ScoredTile[] = [];
            for (let i = lenA - 1; i >= 0; i--) {
              tiles.push(armA[i]);
            }
            tiles.push({ color: cornerColor, r: cornerRow, c: cornerCol });
            for (let i = 0; i < lenB; i++) {
              tiles.push(armB[i]);
            }
            const colors = tiles.map((tile) => tile.color);
            const isPal = colors.join(',') === [...colors].reverse().join(',');
            if (!isPal) continue;
            if (!hasMultipleColors(tiles)) continue;
            matches.push({ length, segment: tiles });
          }
        }
      }
    };

    for (let cornerCol = 0; cornerCol < GRID_SIZE; cornerCol++) {
      tryCorner(row, cornerCol);
    }
    for (let cornerRow = 0; cornerRow < GRID_SIZE; cornerRow++) {
      if (cornerRow === row) continue;
      tryCorner(cornerRow, col);
    }

    return matches;
  };

  const scoreFor = (length: number, segment: ScoredTile[]) => {
    if (length < minLength) return { score: 0, hasBulldog: false };
    if (!isOdd(length) || !hasMultipleColors(segment)) return { score: 0, hasBulldog: false };
    const hasBulldog = segment.some((b) =>
      bulldogPositions.some((bp) => bp.row === b.r && bp.col === b.c)
    );
    return { score: length + (hasBulldog ? BULLDOG_BONUS : 0), hasBulldog };
  };

  const candidates = [
    ...checkLine(true).map((result) => ({ kind: 'row' as const, length: result.length, segment: result.segment })),
    ...checkLine(false).map((result) => ({ kind: 'col' as const, length: result.length, segment: result.segment })),
    ...checkRightAngle().map((result) => ({ kind: 'rightAngle' as const, length: result.length, segment: result.segment })),
  ]
    .map((candidate) => {
      const score = scoreFor(candidate.length, candidate.segment);
      return { ...candidate, score: score.score, hasBulldog: score.hasBulldog };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => (b.length !== a.length ? b.length - a.length : b.score - a.score));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.segment.map((tile) => `${tile.r},${tile.c}`).join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((candidate) => ({
    score: candidate.score,
    segmentLength: candidate.length,
    segment: candidate.segment,
    kind: candidate.kind,
    hasBulldog: candidate.hasBulldog,
  }));
}

/**
 * Check row, column, and right-angle palindromes through (row, col). Pure function.
 * Returns the strongest single result for callers that still expect one score event.
 */
export function checkPalindromes(
  grid: Grid,
  row: number,
  col: number,
  bulldogPositions: { row: number; col: number }[],
  minLength: number = MIN_PALINDROME_LENGTH
): ScoringResult {
  const best = checkAllPalindromes(grid, row, col, bulldogPositions, minLength)[0];
  if (!best) return { score: 0 };

  return best;
}

/**
 * Collect every newly-created scoring event from one or more placement anchors.
 * This is the multi-score gameplay used by the single-player web game.
 */
export function getNewScoringEvents(
  anchors: { row: number; col: number }[],
  currentGrid: Grid,
  bulldogPositions: { row: number; col: number }[],
  minLength: number = MIN_PALINDROME_LENGTH,
  previousGrid?: Grid
): ScoringEvent[] {
  const anchorKeys = new Set(anchors.map(({ row, col }) => `${row},${col}`));

  const orderSegmentFromAnchor = (event: ScoringEvent): ScoringEvent => {
    const anchorIndex = event.segment.findIndex((tile) => anchorKeys.has(`${tile.r},${tile.c}`));
    if (anchorIndex < 0) return event;

    const ordered: ScoredTile[] = [];
    const seen = new Set<string>();
    for (let distance = 0; distance < event.segment.length; distance++) {
      const left = anchorIndex - distance;
      const right = anchorIndex + distance;

      if (left >= 0) {
        const tile = event.segment[left];
        const key = `${tile.r},${tile.c}`;
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(tile);
        }
      }

      if (right < event.segment.length) {
        const tile = event.segment[right];
        const key = `${tile.r},${tile.c}`;
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(tile);
        }
      }
    }

    return { ...event, segment: ordered };
  };

  const collectEvents = (scanGrid: Grid) => {
    const eventsByKey = new Map<string, ScoringEvent>();
    const scanAnchors = previousGrid
      ? scanGrid.flatMap((rowArr, r) =>
          rowArr.flatMap((cell, c) => (cell == null ? [] : [{ row: r, col: c }]))
        )
      : anchors;

    scanAnchors.forEach(({ row, col }) => {
      checkAllPalindromes(scanGrid, row, col, bulldogPositions, minLength).forEach((result) => {
        if (!result.segment || !result.segmentLength || result.score <= 0) return;
        const key = `${result.kind}:${result.segment.map((t) => `${t.r},${t.c}`).join('|')}`;
        if (!eventsByKey.has(key)) {
          eventsByKey.set(key, {
            ...result,
            score: result.score,
            segment: result.segment,
            segmentLength: result.segmentLength,
          });
        }
      });
    });

    return eventsByKey;
  };

  const eventsByKey = collectEvents(currentGrid);
  if (previousGrid) {
    const previousEventsByKey = collectEvents(previousGrid);
    previousEventsByKey.forEach((_event, key) => {
      eventsByKey.delete(key);
    });
  }

  return [...eventsByKey.values()]
    .sort((a, b) => {
      if (b.segmentLength !== a.segmentLength) return b.segmentLength - a.segmentLength;
      return b.score - a.score;
    })
    .map(orderSegmentFromAnchor);
}

export function scoreNewPalindromes(
  anchors: { row: number; col: number }[],
  currentGrid: Grid,
  bulldogPositions: { row: number; col: number }[],
  minLength: number = MIN_PALINDROME_LENGTH,
  previousGrid?: Grid
): { score: number; events: ScoringEvent[] } {
  const events = getNewScoringEvents(anchors, currentGrid, bulldogPositions, minLength, previousGrid);
  return {
    score: events.reduce((total, event) => total + event.score, 0),
    events,
  };
}

/**
 * Apply a move: validate, update grid and inventory, compute score delta.
 * Returns { success, newState, scoreDelta }.
 */
export function applyMove(
  state: GameState,
  row: number,
  col: number,
  colorIndex: number,
  minLength: number = MIN_PALINDROME_LENGTH
): {
  success: boolean;
  newState?: GameState;
  scoreDelta?: number;
} {
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
    return { success: false };
  }
  if (state.grid[row][col] !== null) {
    return { success: false };
  }
  if (
    colorIndex < 0 ||
    colorIndex >= NUM_COLORS ||
    state.blockCounts[colorIndex] <= 0
  ) {
    return { success: false };
  }

  const newGrid = state.grid.map((r) => [...r]);
  newGrid[row][col] = colorIndex;

  const result = scoreNewPalindromes(
    [{ row, col }],
    newGrid,
    state.bulldogPositions,
    minLength,
    state.grid
  );

  const newBlockCounts = [...state.blockCounts];
  newBlockCounts[colorIndex] = Math.max(0, newBlockCounts[colorIndex] - 1);

  const newState: GameState = {
    grid: newGrid,
    blockCounts: newBlockCounts,
    score: state.score + result.score,
    bulldogPositions: state.bulldogPositions,
    moveCount: state.moveCount + 1,
  };

  return {
    success: true,
    newState,
    scoreDelta: result.score,
  };
}

/**
 * Find first cell + color that would score (for hints).
 */
export function findScoringMove(
  state: GameState,
  minLength: number = MIN_PALINDROME_LENGTH
): HintMove | null {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (state.grid[r][c] !== null) continue;
      for (let colorIdx = 0; colorIdx < NUM_COLORS; colorIdx++) {
        if (state.blockCounts[colorIdx] <= 0) continue;
        const tempGrid = state.grid.map((rowArr) => [...rowArr]);
        tempGrid[r][c] = colorIdx;
        const result = scoreNewPalindromes(
          [{ row: r, col: c }],
          tempGrid,
          state.bulldogPositions,
          minLength,
          state.grid
        );
        if (result.score > 0) {
          return { row: r, col: c, colorIndex: colorIdx };
        }
      }
    }
  }
  return null;
}

/**
 * Whether the player has any blocks left (game can continue with time limit).
 */
export function hasBlocksLeft(state: GameState): boolean {
  return state.blockCounts.some((c) => c > 0);
}

/**
 * Whether there is at least one empty cell (for "board full" check).
 */
export function hasEmptyCell(state: GameState): boolean {
  return state.grid.some((row) => row.some((cell) => cell === null));
}

/**
 * Check if a move would be valid (cell empty, color in stock).
 */
export function canPlace(
  state: GameState,
  row: number,
  col: number,
  colorIndex: number
): boolean {
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return false;
  if (state.grid[row][col] !== null) return false;
  if (
    colorIndex < 0 ||
    colorIndex >= NUM_COLORS ||
    state.blockCounts[colorIndex] <= 0
  )
    return false;
  return true;
}
