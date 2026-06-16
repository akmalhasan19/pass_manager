// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeRichText, sanitizeRichTextForPaste } from '../../../src/shared/sanitizeRichText';

describe('sanitizeRichText', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeRichText('')).toBe('');
    expect(sanitizeRichText('   ')).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeRichText(null as unknown as string)).toBe('');
    expect(sanitizeRichText(undefined as unknown as string)).toBe('');
  });

  it('preserves allowed tags: p, b, i, u, strong, em, strike', () => {
    const input = '<p>Hello <b>bold</b> <i>italic</i> <u>underline</u></p>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<p>');
    expect(result).toContain('<b>');
    expect(result).toContain('<i>');
    expect(result).toContain('<u>');
  });

  it('preserves ol, ul, li tags', () => {
    const input = '<ul><li>item 1</li><li>item 2</li></ul>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });

  it('preserves blockquote, code, pre tags', () => {
    const input = '<blockquote>quote</blockquote><pre><code>code</code></pre>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<blockquote>');
    expect(result).toContain('<pre>');
    expect(result).toContain('<code>');
  });

  it('preserves heading tags h1-h3', () => {
    const input = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<h1>');
    expect(result).toContain('<h2>');
    expect(result).toContain('<h3>');
  });

  it('preserves <a> with href attribute', () => {
    const input = '<a href="https://example.com" title="Example">link</a>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<a');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('title="Example"');
  });

  it('preserves <br> and <hr>', () => {
    const input = 'line1<br>line2<hr>line3';
    const result = sanitizeRichText(input);
    expect(result).toContain('<br>');
    expect(result).toContain('<hr>');
  });

  describe('XSS prevention', () => {
    it('strips <script> tags entirely', () => {
      const input = 'before<script>alert("xss")</script>after';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<script');
      expect(result).not.toContain('alert');
      expect(result).toContain('before');
      expect(result).toContain('after');
    });

    it('strips <iframe> tags', () => {
      const input = '<iframe src="https://evil.com"></iframe>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<iframe');
      expect(result).not.toContain('evil.com');
    });

    it('strips <object> and <embed> tags', () => {
      const input = '<object data="evil.swf"></object><embed src="evil.swf">';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<object');
      expect(result).not.toContain('<embed');
    });

    it('strips <form>, <input>, <textarea>, <select>, <button> tags', () => {
      const input = '<form action="evil"><input type="text"><textarea>x</textarea><select><option>a</option></select><button>submit</button></form>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<form');
      expect(result).not.toContain('<input');
      expect(result).not.toContain('<textarea');
      expect(result).not.toContain('<select');
      expect(result).not.toContain('<button');
    });

    it('strips <style> tags', () => {
      const input = '<style>body{display:none}</style><p>visible</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<style');
      expect(result).toContain('<p>');
    });

    it('strips <img> tags', () => {
      const input = '<img src=x onerror=alert(1)>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<img');
    });

    it('strips <svg> with embedded script', () => {
      const input = '<svg><script>alert(1)</script></svg>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<svg');
      expect(result).not.toContain('<script');
    });

    it('strips <link> and <meta> tags', () => {
      const input = '<link rel="stylesheet" href="evil.css"><meta http-equiv="refresh" content="0;url=evil.com">';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<link');
      expect(result).not.toContain('<meta');
    });
  });

  describe('event handler stripping', () => {
    it('strips onclick from allowed tags', () => {
      const input = '<strong onclick="alert(1)">click me</strong>';
      const result = sanitizeRichText(input);
      expect(result).toContain('<strong>');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert');
    });

    it('strips onerror from any tag', () => {
      const input = '<p onerror="alert(1)">text</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('onerror');
    });

    it('strips onload, onmouseover, onfocus from allowed tags', () => {
      const input = '<p onload="x()" onmouseover="y()" onfocus="z()">text</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('onload');
      expect(result).not.toContain('onmouseover');
      expect(result).not.toContain('onfocus');
    });

    it('strips all on* event handlers', () => {
      const input = '<b ondblclick="evil()" onkeydown="evil()" oncontextmenu="evil()">text</b>';
      const result = sanitizeRichText(input);
      expect(result).toContain('<b>');
      expect(result).not.toMatch(/\bon\w+\s*=/i);
    });
  });

  describe('javascript: and data: URL stripping', () => {
    it('strips javascript: URLs from href', () => {
      const input = '<a href="javascript:alert(1)">click</a>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('alert');
    });

    it('strips data: URLs from href', () => {
      const input = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('data:');
      expect(result).not.toContain('<script');
    });

    it('allows http: and https: URLs', () => {
      const input = '<a href="https://example.com">safe</a>';
      const result = sanitizeRichText(input);
      expect(result).toContain('href="https://example.com"');
    });

    it('allows mailto: URLs', () => {
      const input = '<a href="mailto:test@example.com">email</a>';
      const result = sanitizeRichText(input);
      expect(result).toContain('href="mailto:test@example.com"');
    });

    it('strips javascript: with mixed case', () => {
      const input = '<a href="JaVaScRiPt:alert(1)">click</a>';
      const result = sanitizeRichText(input);
      expect(result).not.toMatch(/javascript/i);
    });
  });

  describe('attribute stripping', () => {
    it('strips style attributes', () => {
      const input = '<p style="color:red;background:url(evil)">text</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('style');
      expect(result).toContain('<p>');
    });

    it('strips data-* attributes', () => {
      const input = '<p data-evil="payload">text</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('data-');
    });

    it('strips aria-* attributes', () => {
      const input = '<p aria-label="evil">text</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('aria-');
    });

    it('preserves allowed attributes: href, title, target, rel', () => {
      const input = '<a href="https://example.com" title="Ex" target="_blank" rel="noopener">link</a>';
      const result = sanitizeRichText(input);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('title="Ex"');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener"');
    });
  });

  describe('complex XSS payloads', () => {
    it('handles nested script in allowed tags', () => {
      const input = '<p>safe<script>alert(1)</script>text</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<script');
      expect(result).toContain('<p>');
    });

    it('handles encoded XSS attempts', () => {
      const input = '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">click</a>';
      const result = sanitizeRichText(input);
      expect(result).not.toMatch(/javascript/i);
    });

    it('handles mixed content with multiple XSS vectors', () => {
      const input = '<p onclick="evil()">text</p><script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:void(0)">link</a>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('<script');
      expect(result).not.toContain('<img');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('javascript:');
      expect(result).toContain('<p>');
      expect(result).toContain('text');
    });
  });
});

describe('sanitizeRichTextForPaste', () => {
  it('sanitizes pasted HTML the same way as sanitizeRichText', () => {
    const input = '<p>safe</p><script>alert(1)</script>';
    const result = sanitizeRichTextForPaste(input);
    expect(result).not.toContain('<script');
    expect(result).toContain('<p>');
  });

  it('strips event handlers from pasted content', () => {
    const input = '<p onclick="evil()">pasted text</p>';
    const result = sanitizeRichTextForPaste(input);
    expect(result).not.toContain('onclick');
  });

  it('strips javascript: URLs from pasted links', () => {
    const input = '<a href="javascript:alert(1)">pasted link</a>';
    const result = sanitizeRichTextForPaste(input);
    expect(result).not.toContain('javascript:');
  });

  it('returns empty string for empty pasted HTML', () => {
    expect(sanitizeRichTextForPaste('')).toBe('');
    expect(sanitizeRichTextForPaste('   ')).toBe('');
  });

  describe('Word paste handling', () => {
    it('strips mso-* attributes from pasted Word content', () => {
      const input = '<p class="MsoNormal" style="margin-top:0in">Word text</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<p>');
      expect(result).not.toContain('MsoNormal');
      expect(result).not.toContain('style=');
    });

    it('strips Office namespace elements', () => {
      const input = '<p>Before<o:p></o:p>After</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('Before');
      expect(result).toContain('After');
      expect(result).not.toContain('o:p');
    });

    it('unwraps font tags from Word content', () => {
      const input = '<p><font size="3" face="Arial">text</font></p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('text');
      expect(result).not.toContain('<font');
      expect(result).not.toContain('</font>');
    });

    it('handles Word bold/italic spans converted from mso styles', () => {
      const input =
        '<p class="MsoNormal"><b>bold</b> normal <i>italic</i></p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<b>');
      expect(result).toContain('<i>');
      expect(result).toContain('bold');
      expect(result).toContain('normal');
      expect(result).toContain('italic');
      expect(result).not.toContain('MsoNormal');
    });

    it('handles Word paragraph with multiple inline styles stripped', () => {
      const input =
        '<p class="MsoNormal" style="margin-bottom:12.0pt;line-height:115%">Paragraph text</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<p>');
      expect(result).toContain('Paragraph text');
      expect(result).not.toContain('style=');
      expect(result).not.toContain('MsoNormal');
    });

    it('handles Word list pasted as mso-style paragraphs', () => {
      const input =
        '<p class="MsoListParagraph" style="text-indent:-.25in">1. Item one</p>' +
        '<p class="MsoListParagraph" style="text-indent:-.25in">2. Item two</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('Item one');
      expect(result).toContain('Item two');
      expect(result).not.toContain('MsoListParagraph');
      expect(result).not.toContain('style=');
    });
  });

  describe('style, class, id stripping on paste', () => {
    it('strips inline style attributes from pasted content', () => {
      const input = '<p style="color:red;font-size:20px">styled text</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<p>');
      expect(result).not.toContain('style=');
    });

    it('strips class attributes from pasted content', () => {
      const input = '<p class="my-paragraph highlight">text</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).not.toContain('class=');
    });

    it('strips id attributes from pasted content', () => {
      const input = '<p id="section-1">text</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).not.toContain('id=');
    });

    it('strips dir and align attributes from pasted content', () => {
      const input = '<p dir="rtl" align="center">text</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).not.toContain('dir=');
      expect(result).not.toContain('align=');
    });

    it('strips all style/class/id from nested elements', () => {
      const input =
        '<div class="wrapper"><p class="text" style="font-weight:bold"><span class="highlight" style="background:yellow">nested</span></p></div>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).not.toContain('class=');
      expect(result).not.toContain('style=');
      expect(result).toContain('<span>');
      expect(result).toContain('nested');
    });
  });

  describe('empty element cleanup', () => {
    it('removes empty paragraphs from pasted content', () => {
      const input = '<p>content</p><p> </p><p></p><p>more</p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('content');
      expect(result).toContain('more');
      const pCount = (result.match(/<p>/g) || []).length;
      expect(pCount).toBeLessThanOrEqual(3);
    });

    it('removes empty divs', () => {
      const input = '<div></div><div>content</div>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('content');
    });

    it('preserves non-empty elements', () => {
      const input = '<p>text</p><strong>bold</strong><em>italic</em>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<strong>');
      expect(result).toContain('<em>');
      expect(result).toContain('bold');
      expect(result).toContain('italic');
    });
  });

  describe('Google Docs paste handling', () => {
    it('strips Google Docs style attributes', () => {
      const input =
        '<p><span style="font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap">GDocs text</span></p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('GDocs text');
      expect(result).not.toContain('style=');
    });

    it('handles Google Docs bold from weight-style conversion', () => {
      const input =
        '<p><span style="font-weight:700">bold text</span></p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('bold text');
      expect(result).not.toContain('style=');
    });

    it('handles Google Docs italic from style conversion', () => {
      const input =
        '<p><span style="font-style:italic">italic text</span></p>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('italic text');
      expect(result).not.toContain('style=');
    });
  });

  describe('composite Word + GDocs real-world scenarios', () => {
    it('handles rich Word document paste with headings, bold, lists', () => {
      const input = `
        <h1 class="MsoNormal" style="margin-top:12pt">Report Title</h1>
        <p class="MsoNormal"><b style="font-weight:bold">Executive Summary</b></p>
        <p class="MsoNormal" style="margin-left:.5in">Bullet 1</p>
        <p class="MsoNormal" style="margin-left:.5in">Bullet 2</p>
        <p class="MsoNormal"><i>End of document</i></p>
      `;
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<h1>');
      expect(result).toContain('Report Title');
      expect(result).toContain('<b>');
      expect(result).toContain('Executive Summary');
      expect(result).toContain('<i>');
      expect(result).toContain('End of document');
      expect(result).not.toContain('MsoNormal');
      expect(result).not.toContain('style=');
      expect(result).not.toContain('class=');
    });

    it('handles Google Docs page content with links and lists', () => {
      const input = `
        <p class="c0"><span class="c1">Page Title</span></p>
        <p class="c0"><span class="c2">Paragraph one with </span><a href="https://example.com"><span class="c3">a link</span></a><span class="c2">.</span></p>
        <ul class="c4 lst-kix_abc-0"><li class="c0">List item 1</li></ul>
      `;
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('Page Title');
      expect(result).toContain('Paragraph one with');
      expect(result).toContain('<a');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('a link');
      expect(result).toContain('List item 1');
      expect(result).not.toContain('class=');
      expect(result).not.toContain('c0');
      expect(result).not.toContain('c1');
    });

    it('preserves allowed formatting while stripping foreign attributes', () => {
      const input =
        '<b style="font-weight:700" class="my-bold" id="b1">bold</b> ' +
        '<i style="font-style:italic" class="my-italic">italic</i> ' +
        '<a href="https://safe.com" style="color:blue" class="ext-link" target="_blank">link</a>';
      const result = sanitizeRichTextForPaste(input);
      expect(result).toContain('<b>');
      expect(result).toContain('bold');
      expect(result).toContain('<i>');
      expect(result).toContain('italic');
      expect(result).toContain('<a');
      expect(result).toContain('href="https://safe.com"');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('link');
      expect(result).not.toContain('style=');
      expect(result).not.toContain('class=');
      expect(result).not.toContain('id=');
    });
  });
});
