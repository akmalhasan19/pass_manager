/**
 * Common XSS payloads used by Sub-Task 5.2.
 *
 * These fixtures are intentionally raw and malicious. Every consumer is
 * expected to run them through the appropriate sanitisation layer before
 * storing or rendering them.
 */

export interface XssPayload {
  /** Stable identifier used for test names and snapshots. */
  id: string;
  /** Human-readable label for the vector. */
  name: string;
  /** Raw, unsanitised XSS payload. */
  raw: string;
}

/**
 * A curated set of real-world XSS vectors. The first four payloads are the
 * ones explicitly listed in PLANNING-FORM-VALIDATION.md for Sub-Task 5.2.
 */
export const commonXssPayloads: readonly XssPayload[] = [
  {
    id: 'script-tag',
    name: 'script tag',
    raw: "<script>alert('xss')</script>",
  },
  {
    id: 'img-onerror',
    name: 'img onerror',
    raw: "<img src=x onerror=alert('xss')>",
  },
  {
    id: 'javascript-url',
    name: 'javascript: URL',
    raw: "javascript:alert('xss')",
  },
  {
    id: 'iframe',
    name: 'iframe',
    raw: '<iframe src="evil.com"></iframe>',
  },
  {
    id: 'svg-script',
    name: 'svg with embedded script',
    raw: '<svg><script>alert(1)</script></svg>',
  },
  {
    id: 'data-url',
    name: 'data: URL',
    raw: 'data:text/html,<script>alert(1)</script>',
  },
  {
    id: 'anchor-javascript-url',
    name: 'anchor with javascript: URL',
    raw: '<a href="javascript:alert(1)">click me</a>',
  },
  {
    id: 'event-handler-attribute',
    name: 'inline event handler',
    raw: '<div onclick="alert(1)">click</div>',
  },
  {
    id: 'encoded-javascript-url',
    name: 'encoded javascript: URL',
    raw: '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">link</a>',
  },
  {
    id: 'object-embed',
    name: 'object/embed tag',
    raw: '<object data="evil.swf"></object><embed src="evil.swf">',
  },
];
