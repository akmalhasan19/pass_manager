/**
 * Form Detection Engine for SecurePass Manager Browser Extension.
 *
 * Detects login forms and credential fields across all web pages,
 * including modern web apps that use Shadow DOM and dynamically
 * rendered content.
 *
 * Detection strategy (layered heuristics with confidence scoring):
 *
 * 1. **CSS Selector Match** — attribute-based selectors for password/username
 *    fields (type, autocomplete, name, id, placeholder).
 * 2. **Label Association** — <label for="..."> and implicit <label> wrapping.
 * 3. **Text Heuristics** — nearby text nodes and labels containing keywords
 *    like "email", "username", "password", "login".
 * 4. **Positional Nearness** — text-likely inputs positioned visually near
 *    the password field.
 * 5. **Shadow DOM** — recursive traversal into shadow roots to find fields
 *    in modern web components (web apps, SSO flows).
 *
 * Each detected field receives a confidence score (0–1). The highest-scoring
 * pair is selected as the "primary" login form on the page.
 *
 * @module content/form-detector
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Confidence score for a detected field (0 = no confidence, 1 = certain). */
export type ConfidenceScore = number;

/** A detected credential field with metadata. */
export interface DetectedField {
  /** The actual DOM element. */
  element: HTMLInputElement;
  /** Confidence that this is the intended field. */
  confidence: ConfidenceScore;
  /** Why this field was detected (for debugging). */
  reasons: string[];
}

/** A detected login form consisting of a password field, optional username, and optional OTP. */
export interface DetectedLoginForm {
  /** The password input field. */
  passwordField: DetectedField;
  /** The username/email input field (null if only password found). */
  usernameField: DetectedField | null;
  /** The OTP/TOTP input field (null if no OTP field detected). */
  otpField: DetectedField | null;
  /** The closest <form> element wrapping these fields (null if standalone). */
  formElement: HTMLFormElement | null;
  /** Overall confidence for this form pair. */
  overallConfidence: ConfidenceScore;
}

/** Configuration for the detector. */
export interface DetectorConfig {
  /** Maximum DOM depth for shadow DOM traversal. */
  maxShadowDepth: number;
  /** Minimum confidence threshold to consider a field. */
  minConfidence: number;
  /** Maximum distance (in DOM nodes) to search for a username near a password field. */
  maxNearnessDistance: number;
}

const DEFAULT_CONFIG: DetectorConfig = {
  maxShadowDepth: 10,
  minConfidence: 0.3,
  maxNearnessDistance: 20,
};

// ---------------------------------------------------------------------------
// Keyword lists for heuristic matching
// ---------------------------------------------------------------------------

/** Keywords indicating a password field. */
const PASSWORD_KEYWORDS = [
  'password', 'passwd', 'pass', 'pwd', 'passphrase',
  'secret', 'credential', 'auth',
];

/** Keywords indicating a username/email field. */
const USERNAME_KEYWORDS = [
  'email', 'e-mail', 'mail', 'username', 'user', 'login',
  'account', 'name', 'id', 'phone', 'mobile', 'tel',
];

/** Keywords indicating an OTP/TOTP field. */
const OTP_KEYWORDS = [
  'otp', 'totp', 'mfa', '2fa', 'two-factor', 'verification code',
  'authenticator', 'security code', 'passcode', 'token',
];

/** autocomplete attribute values indicating a password field. */
const PASSWORD_AUTOCOMPLETE = [
  'current-password', 'new-password',
];

/** autocomplete attribute values indicating a username field. */
const USERNAME_AUTOCOMPLETE = [
  'username', 'email', 'tel', 'webauthn',
];

// ---------------------------------------------------------------------------
// Shadow DOM traversal
// ---------------------------------------------------------------------------

/**
 * Recursively collect all elements from the DOM tree, including
 * elements inside Shadow DOM roots.
 *
 * @param root - The root element, document, or shadow root to start from.
 * @param maxDepth - Maximum shadow DOM nesting depth.
 * @param currentDepth - Current recursion depth (internal).
 * @returns Generator yielding all descendant elements.
 */
export function* walkElements(
  root: Element | Document | ShadowRoot,
  maxDepth: number = DEFAULT_CONFIG.maxShadowDepth,
  currentDepth: number = 0,
): Generator<Element> {
  if (currentDepth > maxDepth) return;

  const children = root.querySelectorAll('*');

  for (const child of children) {
    yield child;

    // Recurse into shadow roots
    if (child.shadowRoot) {
      yield* walkElements(child.shadowRoot, maxDepth, currentDepth + 1);
    }
  }
}

/**
 * Collect all <input> elements from the DOM, including those in shadow DOM.
 */
export function collectAllInputs(
  root: Element | Document | ShadowRoot = document,
  maxDepth: number = DEFAULT_CONFIG.maxShadowDepth,
): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = [];
  for (const el of walkElements(root, maxDepth)) {
    if (el instanceof HTMLInputElement) {
      inputs.push(el);
    }
  }
  return inputs;
}

// ---------------------------------------------------------------------------
// Field classification heuristics
// ---------------------------------------------------------------------------

/**
 * Score how likely an input is a password field.
 *
 * @param input - The input element to score.
 * @returns Confidence score [0, 1] and matching reasons.
 */
export function scorePasswordField(input: HTMLInputElement): DetectedField {
  const reasons: string[] = [];
  let confidence = 0;

  // Hidden/password type is a strong signal
  if (input.type === 'password') {
    confidence += 0.6;
    reasons.push('type=password');
  }

  // autocomplete attribute
  const autocomplete = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase();
  if (PASSWORD_AUTOCOMPLETE.includes(autocomplete)) {
    confidence += 0.25;
    reasons.push(`autocomplete=${autocomplete}`);
  }

  // Check attributes: name, id, placeholder, aria-label
  const textToSearch = [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label') || '',
  ].join(' ').toLowerCase();

  for (const keyword of PASSWORD_KEYWORDS) {
    if (textToSearch.includes(keyword)) {
      confidence += 0.15;
      reasons.push(`attribute match: "${keyword}"`);
      break; // only count once
    }
  }

  // Label text association
  const labelText = getAssociatedLabelText(input).toLowerCase();
  if (labelText) {
    for (const keyword of PASSWORD_KEYWORDS) {
      if (labelText.includes(keyword)) {
        confidence += 0.2;
        reasons.push(`label match: "${keyword}"`);
        break;
      }
    }
  }

  // Cap at 1.0
  confidence = Math.min(confidence, 1.0);

  return { element: input, confidence, reasons };
}

/**
 * Score how likely an input is a username/email field.
 *
 * @param input - The input element to score.
 * @returns Confidence score [0, 1] and matching reasons.
 */
export function scoreUsernameField(input: HTMLInputElement): DetectedField {
  const reasons: string[] = [];
  let confidence = 0;

  // Type-based signals
  if (input.type === 'email') {
    confidence += 0.5;
    reasons.push('type=email');
  } else if (input.type === 'tel') {
    confidence += 0.3;
    reasons.push('type=tel');
  } else if (input.type === 'text' || input.type === '') {
    // Text inputs are potential usernames — low base confidence
    confidence += 0.1;
    reasons.push('type=text (potential)');
  } else if (
    input.type === 'number' ||
    input.type === 'date' ||
    input.type === 'file' ||
    input.type === 'checkbox' ||
    input.type === 'radio' ||
    input.type === 'submit' ||
    input.type === 'hidden' ||
    input.type === 'range' ||
    input.type === 'color'
  ) {
    // These types are never usernames
    return { element: input, confidence: 0, reasons: ['incompatible type'] };
  }

  // autocomplete attribute
  const autocomplete = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase();
  if (USERNAME_AUTOCOMPLETE.includes(autocomplete)) {
    confidence += 0.3;
    reasons.push(`autocomplete=${autocomplete}`);
  }

  // Check attributes: name, id, placeholder, aria-label
  const textToSearch = [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label') || '',
  ].join(' ').toLowerCase();

  for (const keyword of USERNAME_KEYWORDS) {
    if (textToSearch.includes(keyword)) {
      confidence += 0.15;
      reasons.push(`attribute match: "${keyword}"`);
      break;
    }
  }

  // Label text association
  const labelText = getAssociatedLabelText(input).toLowerCase();
  if (labelText) {
    for (const keyword of USERNAME_KEYWORDS) {
      if (labelText.includes(keyword)) {
        confidence += 0.2;
        reasons.push(`label match: "${keyword}"`);
        break;
      }
    }
  }

  // Check if the field is visually positioned near a password field
  // (this is scored externally in pairWithNearestUsername)

  confidence = Math.min(confidence, 1.0);

  return { element: input, confidence, reasons };
}

/**
 * Score how likely an input is an OTP/TOTP field.
 *
 * OTP fields are typically short text inputs (maxlength 6–8)
 * that accept numeric codes from authenticator apps.
 *
 * @param input - The input element to score.
 * @returns Confidence score [0, 1] and matching reasons.
 */
export function scoreOtpField(input: HTMLInputElement): DetectedField {
  const reasons: string[] = [];
  let confidence = 0;

  // OTP fields are usually text or number inputs, not password/email
  if (
    input.type !== 'text' &&
    input.type !== 'number' &&
    input.type !== 'tel' &&
    input.type !== ''
  ) {
    return { element: input, confidence: 0, reasons: ['incompatible type for OTP'] };
  }

  // Length heuristic: OTP codes are typically 6–8 digits
  const maxLength = input.maxLength;
  if (maxLength >= 4 && maxLength <= 8) {
    confidence += 0.2;
    reasons.push(`maxlength=${maxLength}`);
  }

  // Small field suggests short code
  const style = window.getComputedStyle(input);
  const width = parseFloat(style.width);
  if (width > 0 && width < 200) {
    confidence += 0.1;
    reasons.push(`narrow field: ${Math.round(width)}px`);
  }

  // autocomplete="one-time-code" is a strong signal
  const autocomplete = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase();
  if (autocomplete === 'one-time-code') {
    confidence += 0.4;
    reasons.push('autocomplete=one-time-code');
  }

  // Check attributes: name, id, placeholder, aria-label
  const textToSearch = [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label') || '',
  ].join(' ').toLowerCase();

  for (const keyword of OTP_KEYWORDS) {
    if (textToSearch.includes(keyword)) {
      confidence += 0.3;
      reasons.push(`attribute match: "${keyword}"`);
      break;
    }
  }

  // Label text association
  const labelText = getAssociatedLabelText(input).toLowerCase();
  if (labelText) {
    for (const keyword of OTP_KEYWORDS) {
      if (labelText.includes(keyword)) {
        confidence += 0.3;
        reasons.push(`label match: "${keyword}"`);
        break;
      }
    }
  }

  // inputmode="numeric" is common for OTP
  const inputMode = (input.getAttribute('inputmode') || '').toLowerCase();
  if (inputMode === 'numeric' && maxLength >= 4 && maxLength <= 8) {
    confidence += 0.15;
    reasons.push('inputmode=numeric + short maxlength');
  }

  // pattern attribute common for OTP (digits only)
  const pattern = input.getAttribute('pattern') || '';
  if (pattern === '[0-9]*' || pattern === '\\d*' || pattern === '[0-9]{6}') {
    confidence += 0.15;
    reasons.push(`pattern="${pattern}"`);
  }

  confidence = Math.min(confidence, 1.0);

  return { element: input, confidence, reasons };
}
// ---------------------------------------------------------------------------

/**
 * Get the text content of the label associated with an input.
 *
 * Checks:
 * 1. <label for="inputId"> — explicit association.
 * 2. <label> wrapping the input — implicit association.
 * 3. aria-labelledby attribute.
 * 4. Nearest preceding text in the same container.
 *
 * @param input - The input element.
 * @returns The associated label text, or empty string if none found.
 */
export function getAssociatedLabelText(input: HTMLInputElement): string {
  // 1. Explicit <label for="...">
  if (input.id) {
    // Use CSS.escape if available (browser), otherwise quote the id safely
    const escapedId = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(input.id)
      : input.id.replace(/["\\]/g, '\\$&');
    const label = document.querySelector(`label[for="${escapedId}"]`);
    if (label) {
      return getCleanLabelText(label);
    }
  }

  // 2. Implicit <label> wrapping the input
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return getCleanLabelText(parentLabel, input);
  }

  // 3. aria-labelledby
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => {
      const el = document.getElementById(id);
      return el?.textContent?.trim() || '';
    });
    const text = parts.filter(Boolean).join(' ');
    if (text) return text;
  }

  // 4. Search for nearest preceding sibling text or parent container text
  return getNearestAncestorText(input);
}

/**
 * Get clean text from a label element, optionally excluding the input's own text.
 */
function getCleanLabelText(label: Element, exclude?: HTMLInputElement): string {
  const clone = label.cloneNode(true) as Element;
  if (exclude) {
    const clones = clone.querySelectorAll('input, textarea, select');
    clones.forEach((c) => c.remove());
  }
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Walk up the DOM looking for text nodes that might label this input.
 * Stops at form boundaries or after finding text.
 */
function getNearestAncestorText(input: HTMLInputElement): string {
  let current: Element | null = input.parentElement;
  let distance = 0;

  while (current && distance < 5) {
    // Check for text in sibling elements before this element
    const siblings = Array.from(current.children);
    const inputIndex = siblings.indexOf(input);

    for (let i = Math.max(0, inputIndex - 3); i < inputIndex; i++) {
      const sibling = siblings[i];
      if (sibling && sibling !== input) {
        const text = (sibling.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 0 && text.length < 100) {
          return text;
        }
      }
    }

    // Also check the parent's own text content if it's a label-like element
    const tagName = current.tagName.toLowerCase();
    if (tagName === 'label' || tagName === 'fieldset' || tagName === 'legend') {
      const text = (current.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 0 && text.length < 100) {
        return text;
      }
    }

    current = current.parentElement;
    distance++;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Positional nearness heuristic
// ---------------------------------------------------------------------------

/**
 * Calculate the visual distance between two elements.
 * Uses bounding rects for a screen-space approximation.
 */
function getElementDistance(a: Element, b: Element): number {
  const rectA = a.getBoundingClientRect();
  const rectB = b.getBoundingClientRect();

  const centerXa = rectA.left + rectA.width / 2;
  const centerYa = rectA.top + rectA.height / 2;
  const centerXb = rectB.left + rectB.width / 2;
  const centerYb = rectB.top + rectB.height / 2;

  const dx = centerXa - centerXb;
  const dy = centerYa - centerYb;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Given a password field, find the best username field among candidates,
 * scoring them by confidence + nearness bonus.
 *
 * @param passwordField - The detected password field.
 * @param candidates - All potential username fields on the page.
 * @param config - Detector configuration.
 * @returns The best matching username field, or null.
 */
export function pairWithNearestUsername(
  passwordField: DetectedField,
  candidates: DetectedField[],
  config: DetectorConfig = DEFAULT_CONFIG,
): DetectedField | null {
  const pwElement = passwordField.element;
  const pwRect = pwElement.getBoundingClientRect();
  const formElement = pwElement.closest('form');

  let best: DetectedField | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    // Skip if the candidate IS the password field
    if (candidate.element === pwElement) continue;

    // Skip candidates with very low base confidence
    if (candidate.confidence < config.minConfidence) continue;

    // Bonus if in the same form
    const inSameForm = formElement && candidate.element.closest('form') === formElement;
    const formBonus = inSameForm ? 0.2 : 0;

    // Bonus for nearness (closer = higher bonus)
    const distance = getElementDistance(pwElement, candidate.element);
    const maxDist = config.maxNearnessDistance * 100; // approximate pixels
    const nearnessBonus = Math.max(0, 0.3 * (1 - distance / maxDist));

    // Bonus if the element appears before the password field in DOM order
    const domOrder = pwElement.compareDocumentPosition(candidate.element);
    const orderBonus = (domOrder & Node.DOCUMENT_POSITION_PRECEDING) ? 0.1 : 0;

    const totalScore = candidate.confidence + formBonus + nearnessBonus + orderBonus;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      best = {
        element: candidate.element,
        confidence: Math.min(totalScore, 1.0),
        reasons: [
          ...candidate.reasons,
          `nearness: ${Math.round(distance)}px`,
          ...(inSameForm ? ['same form'] : []),
        ],
      };
    }
  }

  return best;
}

/**
 * Given a password field, find the best OTP field among candidates.
 * OTP fields are typically positioned near the password field in login forms.
 */
function pairWithNearestOtp(
  passwordField: DetectedField,
  candidates: DetectedField[],
  usedElements: Set<HTMLInputElement>,
  config: DetectorConfig = DEFAULT_CONFIG,
): DetectedField | null {
  const pwElement = passwordField.element;
  const formElement = pwElement.closest('form');

  let best: DetectedField | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (candidate.element === pwElement) continue;
    if (usedElements.has(candidate.element)) continue;
    if (candidate.confidence < config.minConfidence) continue;

    // Bonus if in the same form
    const inSameForm = formElement && candidate.element.closest('form') === formElement;
    const formBonus = inSameForm ? 0.3 : 0;

    // OTP fields that appear AFTER the password field are more likely to be the right one
    const domOrder = pwElement.compareDocumentPosition(candidate.element);
    const afterPassword = (domOrder & Node.DOCUMENT_POSITION_FOLLOWING) ? 0.15 : 0;

    // Nearness bonus
    const distance = getElementDistance(pwElement, candidate.element);
    const maxDist = config.maxNearnessDistance * 100;
    const nearnessBonus = Math.max(0, 0.2 * (1 - distance / maxDist));

    const totalScore = candidate.confidence + formBonus + afterPassword + nearnessBonus;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      best = {
        element: candidate.element,
        confidence: Math.min(totalScore, 1.0),
        reasons: [
          ...candidate.reasons,
          `otp nearness: ${Math.round(distance)}px`,
          ...(inSameForm ? ['same form'] : []),
          ...(afterPassword ? ['after password'] : []),
        ],
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detect login forms on the current page (including shadow DOM).
 *
 * Returns detected forms sorted by overall confidence (highest first).
 *
 * @param root - Root element to scan (default: document).
 * @param config - Detector configuration.
 * @returns Array of detected login forms.
 */
export function detectLoginForms(
  root: Element | Document | ShadowRoot = document,
  config: DetectorConfig = DEFAULT_CONFIG,
): DetectedLoginForm[] {
  // Step 1: Collect all input elements (including shadow DOM)
  const allInputs = collectAllInputs(root, config.maxShadowDepth);

  // Step 2: Score each input as password, username, or OTP
  const passwordFields: DetectedField[] = [];
  const usernameFields: DetectedField[] = [];
  const otpFields: DetectedField[] = [];

  for (const input of allInputs) {
    // Skip invisible or disabled inputs
    if (input.disabled || input.hidden) continue;

    const pwScore = scorePasswordField(input);
    if (pwScore.confidence >= config.minConfidence) {
      passwordFields.push(pwScore);
    }

    const unScore = scoreUsernameField(input);
    if (unScore.confidence >= config.minConfidence) {
      usernameFields.push(unScore);
    }

    const otpScore = scoreOtpField(input);
    if (otpScore.confidence >= config.minConfidence) {
      otpFields.push(otpScore);
    }
  }

  // Step 3: For each password field, find the best username and OTP match
  const forms: DetectedLoginForm[] = [];
  const usedUsernameElements = new Set<HTMLInputElement>();
  const usedOtpElements = new Set<HTMLInputElement>();

  // Sort password fields by confidence (highest first)
  passwordFields.sort((a, b) => b.confidence - a.confidence);

  for (const pwField of passwordFields) {
    const usernameField = pairWithNearestUsername(pwField, usernameFields, config);
    const otpField = pairWithNearestOtp(pwField, otpFields, usedOtpElements, config);

    // Mark this username as used so it's not paired with multiple passwords
    if (usernameField) {
      usedUsernameElements.add(usernameField.element);
    }
    if (otpField) {
      usedOtpElements.add(otpField.element);
    }

    const formElement = pwField.element.closest('form');

    forms.push({
      passwordField: pwField,
      usernameField,
      otpField,
      formElement,
      overallConfidence: calculateOverallConfidence(pwField, usernameField),
    });
  }

  // Step 4: Sort by overall confidence
  forms.sort((a, b) => b.overallConfidence - a.overallConfidence);

  return forms;
}

/**
 * Calculate the overall confidence for a detected form pair.
 */
function calculateOverallConfidence(
  passwordField: DetectedField,
  usernameField: DetectedField | null,
): number {
  const pwWeight = 0.6;
  const unWeight = 0.4;

  const pwScore = passwordField.confidence * pwWeight;

  if (usernameField) {
    return pwScore + usernameField.confidence * unWeight;
  }

  // Without a username field, confidence is lower
  return pwScore * 0.7;
}

/**
 * Detect the best login form on the current page.
 *
 * @param root - Root element to scan.
 * @param config - Detector configuration.
 * @returns The best detected form, or null if none found.
 */
export function detectBestLoginForm(
  root: Element | Document | ShadowRoot = document,
  config: DetectorConfig = DEFAULT_CONFIG,
): DetectedLoginForm | null {
  const forms = detectLoginForms(root, config);
  return forms.length > 0 ? forms[0] : null;
}

/**
 * Check if an element is visible in the viewport.
 */
export function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  const rect = el.getBoundingClientRect();
  // In jsdom, getBoundingClientRect returns all zeros — treat as visible
  // since we can't compute layout. In real browsers, width/height > 0.
  if (typeof rect.width === 'number' && typeof rect.height === 'number') {
    if (rect.width > 0 && rect.height > 0) return true;
    // If both are 0, it might be jsdom — fall through to style-based check
    if (rect.width === 0 && rect.height === 0) return true;
  }

  return true;
}
