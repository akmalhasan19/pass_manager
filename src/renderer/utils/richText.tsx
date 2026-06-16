/**
 * Safe rendering of small inline-HTML fragments (e.g. translation
 * strings that may include `<strong>` or `<em>`). Only a hard-coded
 * whitelist of inline formatting tags is preserved; everything else is
 * stripped. Text segments are emitted as plain React children, so the
 * framework automatically escapes `<`, `>`, `&`, `"`, and `'` — this
 * is the safe alternative to `dangerouslySetInnerHTML`.
 *
 * Use this helper whenever a translation string or any other value
 * might contain a small amount of inline markup that should be
 * rendered as React elements rather than as literal text.
 */

import React, { type ReactNode } from 'react';

const RICH_INLINE_TAGS = ['strong', 'em', 'b', 'i', 'u', 'code'] as const;
export type RichTag = (typeof RICH_INLINE_TAGS)[number];

type RichSegment =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; tag: RichTag; closing: boolean };

/**
 * Match the opening or closing tag of an allowed inline format
 * element, optionally with attributes (which are discarded). Examples
 * of matched inputs:
 *   - `<strong>`, `</strong>`
 *   - `<em class="x">`, `<code data-foo='bar'>`
 *   - `<STRONG>`, `</Em>`
 *
 * Disallowed tags (script, img, iframe, etc.) are not matched here;
 * they fall through to the `ANY_TAG_RE` strip pass below.
 */
const ALLOWED_TAG_RE = /<\/?(strong|em|b|i|u|code)(?:\s+[^<>]*)?>/gi;

/**
 * Match any HTML-like tag (used to strip disallowed markup). The
 * pattern allows for a tag name followed by anything except `<` or `>`
 * up to the closing `>`, which is sufficient for our translation
 * inputs.
 */
const ANY_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*[^<>]*>/g;

function isRichTag(name: string): name is RichTag {
  return (RICH_INLINE_TAGS as readonly string[]).includes(name.toLowerCase());
}

/**
 * Parse a string into text segments and allowed inline-tag segments.
 *
 * - Allowed tags (`<strong>`, `<em>`, `<b>`, `<i>`, `<u>`, `<code>`)
 *   with optional attributes become `{ kind: 'tag' }` segments. The
 *   attributes are intentionally discarded.
 * - Disallowed tags (including `<script>`, `<img>`, `<iframe>`, etc.)
 *   are completely stripped from the output.
 * - Everything else is a `{ kind: 'text' }` segment.
 */
export function parseRichText(value: string): RichSegment[] {
  if (!value) return [];
  const segments: RichSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  ALLOWED_TAG_RE.lastIndex = 0;
  while ((match = ALLOWED_TAG_RE.exec(value)) !== null) {
    const start = match.index;
    const fullMatch = match[0];
    const tagName = match[1];
    const closing = fullMatch.startsWith('</');
    if (start > cursor) {
      segments.push({ kind: 'text', value: stripDisallowedTags(value.slice(cursor, start)) });
    }
    if (tagName && isRichTag(tagName)) {
      segments.push({
        kind: 'tag',
        tag: tagName.toLowerCase() as RichTag,
        closing,
      });
    }
    cursor = start + fullMatch.length;
  }
  if (cursor < value.length) {
    segments.push({ kind: 'text', value: stripDisallowedTags(value.slice(cursor)) });
  }
  return segments;
}

function stripDisallowedTags(text: string): string {
  return text.replace(ANY_TAG_RE, '');
}

/**
 * Render a string that may contain a small whitelist of inline
 * formatting tags as React elements. Other HTML is silently stripped.
 * Text segments are emitted as plain React children, so React
 * automatically escapes `<`, `>`, `&`, `"`, and `'`.
 */
export function renderRichText(value: string): ReactNode {
  const segments = parseRichText(value);
  if (segments.length === 0) return null;

  const out: ReactNode[] = [];
  let buffer: string[] = [];
  const stack: RichTag[] = [];

  const flush = (key: string): void => {
    if (buffer.length === 0) return;
    const text = buffer.join('');
    buffer = [];
    if (text.length === 0) return;
    if (stack.length === 0) {
      out.push(<React.Fragment key={key}>{text}</React.Fragment>);
      return;
    }
    let wrapped: ReactNode = text;
    for (let i = stack.length - 1; i >= 0; i--) {
      const tag = stack[i];
      const Tag = tag as keyof JSX.IntrinsicElements;
      wrapped = <Tag key={`${key}-${i}`}>{wrapped}</Tag>;
    }
    out.push(<React.Fragment key={key}>{wrapped}</React.Fragment>);
  };

  segments.forEach((segment, index) => {
    if (segment.kind === 'text') {
      buffer.push(segment.value);
      return;
    }
    flush(`seg-${index}`);
    if (segment.closing) {
      const idx = stack.lastIndexOf(segment.tag);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    } else {
      stack.push(segment.tag);
    }
  });
  flush('seg-final');

  return out;
}
