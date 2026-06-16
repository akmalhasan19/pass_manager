// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderRichText, parseRichText, type RichTag } from '../../../src/renderer/utils/richText';

describe('parseRichText', () => {
  it('returns text segment for plain input', () => {
    const segments = parseRichText('hello world');
    expect(segments).toEqual([{ kind: 'text', value: 'hello world' }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseRichText('')).toEqual([]);
  });

  it('parses a strong tag', () => {
    const segments = parseRichText('hello <strong>world</strong>');
    expect(segments).toEqual([
      { kind: 'text', value: 'hello ' },
      { kind: 'tag', tag: 'strong', closing: false },
      { kind: 'text', value: 'world' },
      { kind: 'tag', tag: 'strong', closing: true },
    ]);
  });

  it('parses multiple inline tags', () => {
    const segments = parseRichText('<em>foo</em> and <code>bar</code>');
    expect(segments.length).toBe(7);
    expect(segments[0]).toEqual({ kind: 'tag', tag: 'em', closing: false });
    expect(segments[2]).toEqual({ kind: 'tag', tag: 'em', closing: true });
    expect(segments[4]).toEqual({ kind: 'tag', tag: 'code', closing: false });
    expect(segments[6]).toEqual({ kind: 'tag', tag: 'code', closing: true });
  });

  it('strips disallowed tags entirely', () => {
    const segments = parseRichText('safe<script>alert(1)</script>after');
    // The <script> tag is not in the whitelist, so it is removed completely.
    expect(segments).toEqual([{ kind: 'text', value: 'safealert(1)after' }]);
  });

  it('strips disallowed closing tags', () => {
    const segments = parseRichText('hello</script>after');
    expect(segments).toEqual([{ kind: 'text', value: 'helloafter' }]);
  });

  it('handles uppercase and mixed case tag names', () => {
    const segments = parseRichText('<STRONG>x</STRONG>');
    const tag = segments.find((s) => s.kind === 'tag');
    expect(tag).toEqual({ kind: 'tag', tag: 'strong', closing: false });
  });
});

describe('renderRichText', () => {
  it('renders plain text as-is', () => {
    render(<div data-testid="root">{renderRichText('hello world')}</div>);
    expect(screen.getByTestId('root').textContent).toBe('hello world');
  });

  it('renders strong tag as a <strong> element', () => {
    render(<div data-testid="root">{renderRichText('hello <strong>world</strong>!')}</div>);
    const root = screen.getByTestId('root');
    expect(root.textContent).toBe('hello world!');
    const strong = root.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('world');
  });

  it('renders em tag as an <em> element', () => {
    render(<div data-testid="root">{renderRichText('<em>emphasized</em>')}</div>);
    const root = screen.getByTestId('root');
    const em = root.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('emphasized');
  });

  it('renders code tag as a <code> element', () => {
    render(<div data-testid="root">{renderRichText('use <code>foo()</code> here')}</div>);
    const root = screen.getByTestId('root');
    const code = root.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('foo()');
  });

  it('strips script tags — no <script> element is rendered', () => {
    render(
      <div data-testid="root">{renderRichText('safe<script>alert("xss")</script>after')}</div>,
    );
    const root = screen.getByTestId('root');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toBe('safealert("xss")after');
  });

  it('strips img tags — no <img> element is rendered', () => {
    render(<div data-testid="root">{renderRichText('text<img src=x onerror=alert(1)>more')}</div>);
    const root = screen.getByTestId('root');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBe('textmore');
  });

  it('strips iframe tags — no <iframe> element is rendered', () => {
    render(
      <div data-testid="root">{renderRichText('text<iframe src="evil.com"></iframe>after')}</div>,
    );
    const root = screen.getByTestId('root');
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.textContent).toBe('textafter');
  });

  it('strips event handlers from attribute contexts', () => {
    render(
      <div data-testid="root">{renderRichText('<strong onclick="alert(1)">click</strong>')}</div>,
    );
    const root = screen.getByTestId('root');
    const strong = root.querySelector('strong');
    expect(strong).not.toBeNull();
    // The onclick attribute is dropped because the parser does not copy
    // attributes from the input — only the tag name and the text between.
    expect(strong?.getAttribute('onclick')).toBeNull();
    expect(strong?.textContent).toBe('click');
  });

  it('strips javascript: URLs', () => {
    render(
      <div data-testid="root">
        {renderRichText('before<a href="javascript:alert(1)">link</a>after')}
      </div>,
    );
    const root = screen.getByTestId('root');
    expect(root.querySelector('a')).toBeNull();
    // The "a" tag is not in the whitelist, so it's stripped
    expect(root.textContent).toBe('beforelinkafter');
  });

  it('handles nested allowed tags', () => {
    render(
      <div data-testid="root">{renderRichText('<strong><em>bold and italic</em></strong>')}</div>,
    );
    const root = screen.getByTestId('root');
    const strong = root.querySelector('strong');
    const em = root.querySelector('em');
    expect(strong).not.toBeNull();
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('bold and italic');
  });

  it('escapes user-supplied special characters in text segments', () => {
    render(
      <div data-testid="root">{renderRichText('5 < 10 & 10 > 5 "quoted" \'apostrophe\'')}</div>,
    );
    const root = screen.getByTestId('root');
    // React escapes the three special characters that affect HTML
    // structure (`<`, `>`, `&`) when rendering as text children.
    // Quotes are not escaped in text content (only in attribute values).
    expect(root.textContent).toBe('5 < 10 & 10 > 5 "quoted" \'apostrophe\'');
    expect(root.innerHTML).toContain('&lt;');
    expect(root.innerHTML).toContain('&amp;');
    expect(root.innerHTML).toContain('&gt;');
    // No raw <, >, or & survives in the rendered HTML
    expect(root.innerHTML).not.toMatch(/<(?![a-zA-Z!])/);
    expect(root.innerHTML).not.toMatch(/[^&]<\/[^a-zA-Z]/);
  });

  it('returns null for empty input', () => {
    const result = renderRichText('');
    expect(result).toBeNull();
  });

  it('preserves Unicode characters', () => {
    render(<div data-testid="root">{renderRichText('héllo 👋 世界 مرحبا')}</div>);
    expect(screen.getByTestId('root').textContent).toBe('héllo 👋 世界 مرحبا');
  });

  it('handles all whitelisted tags', () => {
    const tags: RichTag[] = ['strong', 'em', 'b', 'i', 'u', 'code'];
    for (const tag of tags) {
      const html = `<${tag}>x</${tag}>`;
      const { container } = render(<div>{renderRichText(html)}</div>);
      const element = container.querySelector(tag);
      expect(element).not.toBeNull();
      expect(element?.textContent).toBe('x');
    }
  });

  it('strips inline styles from tags', () => {
    render(<div data-testid="root">{renderRichText('<strong style="color: red">x</strong>')}</div>);
    const root = screen.getByTestId('root');
    const strong = root.querySelector('strong');
    expect(strong).not.toBeNull();
    // style attribute is dropped — only the tag name and inner text are kept
    expect(strong?.getAttribute('style')).toBeNull();
  });

  it('handles malformed tag sequences gracefully', () => {
    render(<div data-testid="root">{renderRichText('<strong>no closing')}</div>);
    const root = screen.getByTestId('root');
    const strong = root.querySelector('strong');
    expect(strong).not.toBeNull();
    // Even unclosed, the parser still emits a <strong> element
    expect(strong?.textContent).toBe('no closing');
  });
});

describe('renderRichText — XSS payload integration', () => {
  const payloads = [
    { name: 'script tag', input: 'safe<script>alert(1)</script>after' },
    { name: 'img onerror', input: 'safe<img src=x onerror=alert(1)>after' },
    { name: 'iframe', input: 'safe<iframe src="evil.com"></iframe>after' },
    { name: 'object embed', input: 'safe<object data="evil.swf"></object>after' },
    { name: 'svg with script', input: 'safe<svg><script>alert(1)</script></svg>after' },
    { name: 'style tag', input: 'safe<style>body{color:red}</style>after' },
    { name: 'link tag', input: 'safe<link rel="stylesheet" href="evil.css">after' },
    {
      name: 'meta refresh',
      input: 'safe<meta http-equiv="refresh" content="0;url=evil.com">after',
    },
    {
      name: 'data URL',
      input: 'safe<a href="data:text/html,<script>alert(1)</script>">x</a>after',
    },
  ];

  for (const payload of payloads) {
    it(`strips <${payload.name}> payload`, () => {
      const { container } = render(<div data-testid="root">{renderRichText(payload.input)}</div>);
      const root = container.querySelector('[data-testid="root"]')!;
      // No script element is present
      expect(root.querySelector('script')).toBeNull();
      // No img/iframe/object/style/link/meta element
      expect(root.querySelector('img, iframe, object, style, link, meta')).toBeNull();
      // No on* event attributes
      const allElements = root.querySelectorAll('*');
      for (const el of Array.from(allElements)) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name).not.toMatch(/^on/i);
        }
      }
    });
  }
});
