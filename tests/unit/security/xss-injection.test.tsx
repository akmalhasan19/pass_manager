// @vitest-environment jsdom
/**
 * Sub-Task 5.2: XSS Injection Tests
 *
 * Verifies that the common XSS payloads defined in
 * `tests/fixtures/xss-payloads.ts` are neutralised by the sanitisation
 * layer and cannot execute when rendered in the UI.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { commonXssPayloads, type XssPayload } from '../../fixtures/xss-payloads';
import { sanitizeForField, escapeHtml } from '../../../src/shared/sanitize';
import { sanitizeRichText } from '../../../src/shared/sanitizeRichText';
import { renderRichText } from '../../../src/renderer/utils/richText';

/** Fields that must never contain executable HTML after sanitisation. */
const PLAIN_TEXT_FIELDS = ['itemTitle', 'folderName', 'username', 'url', 'tagName'] as const;

type PlainTextField = (typeof PLAIN_TEXT_FIELDS)[number];

/**
 * Patterns that indicate executable markup in a plain-text context.
 * A raw `javascript:` string is NOT included here because, outside of an
 * HTML attribute, it is only text and cannot execute.
 */
const PLAIN_TEXT_DANGERS = [
  /<script\b/i,
  /<\/script>/i,
  /<iframe\b/i,
  /<img\b[^>]*>/i,
  /<[a-z][a-z0-9-]*[^>]*\son\w+\s*=/i,
  /<svg\b/i,
  /<object\b/i,
  /<embed\b/i,
  /<form\b/i,
  /<input\b/i,
  /<textarea\b/i,
];

/**
 * Patterns that indicate executable markup in a rich-text context. This set
 * additionally catches dangerous URI schemes when they appear inside an
 * attribute value.
 */
const RICH_TEXT_DANGERS = [
  ...PLAIN_TEXT_DANGERS,
  /href\s*=\s*["']?\s*(?:javascript|data):/i,
  /src\s*=\s*["']?\s*(?:javascript|data):/i,
  /style\s*=\s*["'][^"']*expression\s*\(/i,
];

function assertNoExecutableMarkup(
  result: string,
  label: string,
  patterns: RegExp[],
): void {
  for (const pattern of patterns) {
    expect(result, `${label}: must not match ${pattern.source}`).not.toMatch(pattern);
  }
  expect(result, `${label}: must not contain null bytes`).not.toContain('\u0000');
}

function getAllAttributes(root: Element): Array<{ element: Element; name: string; value: string }> {
  const attributes: Array<{ element: Element; name: string; value: string }> = [];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(element.attributes)) {
      attributes.push({ element, name: attr.name, value: attr.value });
    }
  }
  return attributes;
}

describe('XSS payload fixtures', () => {
  it('contains the four payloads required by Sub-Task 5.2', () => {
    const ids = commonXssPayloads.map((payload) => payload.id);
    expect(ids).toContain('script-tag');
    expect(ids).toContain('img-onerror');
    expect(ids).toContain('javascript-url');
    expect(ids).toContain('iframe');
  });
});

describe('Plain-text sanitisation does not leave executable markup', () => {
  const testCases: Array<{ field: PlainTextField; payload: XssPayload }> = [];
  for (const field of PLAIN_TEXT_FIELDS) {
    for (const payload of commonXssPayloads) {
      testCases.push({ field, payload });
    }
  }

  for (const { field, payload } of testCases) {
    it(`${field} neutralises <${payload.name}>`, () => {
      const result = sanitizeForField(field, payload.raw);
      assertNoExecutableMarkup(result, `${field} / ${payload.id}`, PLAIN_TEXT_DANGERS);
    });
  }
});

describe('Rich-text sanitisation does not leave executable markup', () => {
  for (const payload of commonXssPayloads) {
    it(`sanitizeRichText neutralises <${payload.name}>`, () => {
      const result = sanitizeRichText(payload.raw);
      assertNoExecutableMarkup(result, `sanitizeRichText / ${payload.id}`, RICH_TEXT_DANGERS);
    });
  }
});

describe('UI rendering does not execute scripts', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('plain-text fields render without script elements or event handlers', () => {
    const PlainTextXss: React.FC = () => (
      <div data-testid="xss-plain">
        {PLAIN_TEXT_FIELDS.map((field) =>
          commonXssPayloads.map((payload) => (
            <div key={`${field}-${payload.id}`} data-field={field} data-payload={payload.id}>
              {sanitizeForField(field, payload.raw)}
            </div>
          )),
        )}
      </div>
    );

    const { container } = render(<PlainTextXss />);
    const root = container.querySelector('[data-testid="xss-plain"]')!;

    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('svg')).toBeNull();

    for (const { name, value } of getAllAttributes(root)) {
      expect(name, `attribute ${name}="${value}" must not be an event handler`).not.toMatch(
        /^on/i,
      );
    }

    expect(window.alert).not.toHaveBeenCalled();
  });

  it('rich-text output renders without script elements or event handlers', () => {
    const RichTextXss: React.FC = () => (
      <div data-testid="xss-rich">
        {commonXssPayloads.map((payload) => (
          <div key={payload.id} data-payload={payload.id}>
            {renderRichText(sanitizeRichText(payload.raw))}
          </div>
        ))}
      </div>
    );

    const { container } = render(<RichTextXss />);
    const root = container.querySelector('[data-testid="xss-rich"]')!;

    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('svg')).toBeNull();

    for (const { name, value } of getAllAttributes(root)) {
      expect(name, `attribute ${name}="${value}" must not be an event handler`).not.toMatch(
        /^on/i,
      );
    }

    expect(window.alert).not.toHaveBeenCalled();
  });

  it('escapeHtml prevents attribute-breakout payloads from forming executable markup', () => {
    for (const payload of commonXssPayloads) {
      const escaped = escapeHtml(payload.raw);
      // After escaping, no unescaped HTML special character can form a tag
      expect(escaped).not.toMatch(/<script\b/i);
      expect(escaped).not.toMatch(/<iframe\b/i);
      expect(escaped).not.toMatch(/<img\b/i);
      expect(escaped).not.toMatch(/\son\w+\s*=/i);
    }
  });
});
