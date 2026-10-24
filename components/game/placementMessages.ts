/**
 * Short explanations shown when a counter can't be placed, so a rejected move never
 * looks like the counter "disappeared for no reason". Shared by native and web screens.
 */
export const PLACEMENT_MESSAGES = {
  firstMove: 'First move: your 2 counters must make a palindrome of 5 or more.',
  noPalindrome: "That move doesn't make a palindrome.",
  occupied: 'That square is already taken.',
  noCounters: 'No counters left in that colour.',
  pickSquareFirst: 'Choose a square first, then a colour.',
  notYourTurn: "Wait for your turn.",
} as const;
