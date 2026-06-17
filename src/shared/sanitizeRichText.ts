import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'i',
  'u',
  'strong',
  'em',
  'strike',
  's',
  'ol',
  'ul',
  'li',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'hr',
  'div',
  'span',
];

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel'];

const SAFE_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:_-]|$))/i;

const BLOCK_TAGS = new Set([
  'p', 'div', 'ol', 'ul', 'li', 'blockquote', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
]);

const EMPTY_TAG_REGEX = /^[\s\u00A0]*$/;

export const MAX_RICH_TEXT_LENGTH = 100_000;

const EXTENSION_ELEMENT_SELECTORS = [
  'grammarly-extension',
  'grammarly-desktop-integration',
  'grammarly-popups',
  'grammarly-toolbar',
  'languagetool-extension',
  'languagetool-inline-marker',
  '[data-gr-id]',
  '[data-gr-cs-loaded]',
  '[data-new-gr-cs-loaded]',
  '[data-lt-tmp-id]',
  '[data-lt-active]',
];

const EXTENSION_ATTR_PATTERNS = [
  /^data-gr-/i,
  /^data-lt-/i,
  /^gramm$/i,
  /^data-new-gr-/i,
  /^data-gramm$/i,
];

function normalizeMalformedHTML(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

function stripExtensionArtifacts(doc: Document): void {
  for (const selector of EXTENSION_ELEMENT_SELECTORS) {
    try {
      doc.querySelectorAll(selector).forEach((el) => el.remove());
    } catch {
      // selector may be invalid in some contexts — ignore
    }
  }

  const allElements = doc.querySelectorAll('*');
  for (const el of Array.from(allElements)) {
    const attrsToRemove: string[] = [];
    for (const attr of Array.from(el.attributes)) {
      for (const pattern of EXTENSION_ATTR_PATTERNS) {
        if (pattern.test(attr.name)) {
          attrsToRemove.push(attr.name);
          break;
        }
      }
    }
    for (const attr of attrsToRemove) {
      el.removeAttribute(attr);
    }
  }
}

export function sanitizeRichText(html: string): string {
  if (!html || html.trim() === '') {
    return '';
  }

  if (html.length > MAX_RICH_TEXT_LENGTH) {
    html = html.slice(0, MAX_RICH_TEXT_LENGTH);
  }

  const normalized = normalizeMalformedHTML(html);

  const clean = DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'img', 'svg', 'math', 'link', 'meta'],
  });

  if (!clean || clean.trim() === '') {
    return '';
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, 'text/html');
  stripExtensionArtifacts(doc);

  return doc.body.innerHTML;
}

function stripWordMarkup(doc: Document): void {
  doc.querySelectorAll('o\\:p').forEach((el) => el.remove());

  doc.querySelectorAll('[style]').forEach((el) => {
    el.removeAttribute('style');
  });

  doc.querySelectorAll('[class]').forEach((el) => {
    const cls = el.getAttribute('class') || '';
    if (cls.startsWith('Mso') || cls.startsWith('c') || cls.startsWith('g')) {
      el.removeAttribute('class');
    }
  });

  doc.querySelectorAll('font').forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    }
  });

  cleanupEmptyElements(doc.body);
}

function stripInlineStyles(doc: Document): void {
  doc.querySelectorAll('[style]').forEach((el) => {
    el.removeAttribute('style');
  });
  doc.querySelectorAll('[class]').forEach((el) => {
    el.removeAttribute('class');
  });
  doc.querySelectorAll('[id]').forEach((el) => {
    el.removeAttribute('id');
  });
  doc.querySelectorAll('[dir]').forEach((el) => {
    el.removeAttribute('dir');
  });
  doc.querySelectorAll('[align]').forEach((el) => {
    el.removeAttribute('align');
  });
}

function cleanupEmptyElements(root: Element): void {
  const toRemove: Element[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    if (tagName !== 'br' && tagName !== 'hr' && tagName !== 'img') {
      if (EMPTY_TAG_REGEX.test(el.textContent || '') && BLOCK_TAGS.has(tagName)) {
        toRemove.push(el);
      }
    }
    node = walker.nextNode();
  }

  for (const el of toRemove) {
    const next = el.nextSibling;
    if (next instanceof Node) {
      const parent = el.parentNode;
      if (parent) {
        parent.insertBefore(document.createElement('br'), el);
      }
    }
    el.remove();
  }
}

export function sanitizeRichTextForPaste(html: string): string {
  if (!html || html.trim() === '') {
    return '';
  }

  if (html.length > MAX_RICH_TEXT_LENGTH) {
    html = html.slice(0, MAX_RICH_TEXT_LENGTH);
  }

  const normalized = normalizeMalformedHTML(html);

  const clean = DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'img', 'svg', 'math', 'link', 'meta', 'font'],
  });

  if (!clean || clean.trim() === '') {
    return '';
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, 'text/html');

  stripExtensionArtifacts(doc);
  stripWordMarkup(doc);
  stripInlineStyles(doc);

  return doc.body.innerHTML;
}
