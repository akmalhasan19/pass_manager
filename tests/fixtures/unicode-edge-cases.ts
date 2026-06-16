/**
 * Unicode edge-case fixtures used by Sub-Task 5.4.
 *
 * These values exercise complex Unicode scenarios: multi-code-point emoji
 * sequences, right-to-left scripts, and combining characters. They are
 * designed to be short enough for field-level tests while still stressing
 * grapheme cluster, normalization, and rendering code paths.
 */

export interface UnicodeEdgeCase {
  /** Stable identifier for the test case. */
  id: string;
  /** Human-readable description of the Unicode scenario. */
  name: string;
  /** The raw Unicode value to exercise. */
  value: string;
}

/**
 * A curated set of Unicode extremes.
 *
 * - `family-emoji`: 👨‍👩‍👧‍👦 is a single grapheme cluster built from 7 code
 *   points joined by ZWJ (zero-width joiner).
 * - `arabic-rtl` / `hebrew-rtl`: Right-to-left scripts.
 * - `combining-accent`: The character sequence e + combining acute.
 * - `precomposed-accent`: The single precomposed é character.
 * - `mixed-emoji-text`: A mix of LTR text, emoji, and CJK characters.
 * - `zwj-sequences`: Additional ZWJ emoji sequences (rainbow flag, astronaut).
 * - `rtl-mark`: RTL text wrapped with explicit RTL marks.
 */
export const unicodeEdgeCases: readonly UnicodeEdgeCase[] = [
  {
    id: 'family-emoji',
    name: 'family emoji sequence (7 code points, 1 grapheme)',
    value: '👨‍👩‍👧‍👦',
  },
  {
    id: 'arabic-rtl',
    name: 'Arabic RTL text',
    value: 'مرحبا بالعالم',
  },
  {
    id: 'hebrew-rtl',
    name: 'Hebrew RTL text',
    value: 'שלום עולם',
  },
  {
    id: 'combining-accent',
    name: 'combining characters (e + combining acute)',
    value: 'Cafe\u0301',
  },
  {
    id: 'precomposed-accent',
    name: 'precomposed accented character',
    value: 'Café',
  },
  {
    id: 'mixed-emoji-text',
    name: 'mixed LTR text, emoji, and CJK',
    value: 'Hello 👋 世界 🌍',
  },
  {
    id: 'zwj-sequences',
    name: 'additional ZWJ emoji sequences',
    value: '🏳️‍🌈 👨‍🚀 🏴‍☠️',
  },
  {
    id: 'rtl-mark',
    name: 'RTL mark wrapped text',
    value: '\u200Fעברית\u200F',
  },
];
