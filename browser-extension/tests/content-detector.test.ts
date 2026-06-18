// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  scorePasswordField,
  scoreUsernameField,
  getAssociatedLabelText,
  detectLoginForms,
  detectBestLoginForm,
  collectAllInputs,
  walkElements,
  pairWithNearestUsername,
  isElementVisible,
  type DetectedField,
} from '../src/content/form-detector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInput(attrs: Record<string, string> = {}): HTMLInputElement {
  const input = document.createElement('input');
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'type') {
      input.type = value;
    } else if (key === 'id') {
      input.id = value;
    } else if (key === 'name') {
      input.name = value;
    } else if (key === 'placeholder') {
      input.placeholder = value;
    } else if (key === 'autocomplete') {
      input.autocomplete = value;
    } else {
      input.setAttribute(key, value);
    }
  }
  return input;
}

function createLabel(text: string, htmlFor?: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.textContent = text;
  if (htmlFor) {
    label.htmlFor = htmlFor;
  }
  return label;
}

function createFormWithFields(): HTMLFormElement {
  const form = document.createElement('form');
  form.innerHTML = `
    <label for="email-input">Email or Username</label>
    <input type="email" id="email-input" name="email" />
    <label for="pw-input">Password</label>
    <input type="password" id="pw-input" name="password" />
    <button type="submit">Sign In</button>
  `;
  return form;
}

// ---------------------------------------------------------------------------
// scorePasswordField
// ---------------------------------------------------------------------------

describe('scorePasswordField', () => {
  it('should score type=password with high confidence', () => {
    const input = createInput({ type: 'password' });
    document.body.appendChild(input);

    const result = scorePasswordField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.reasons).toContain('type=password');

    input.remove();
  });

  it('should score autocomplete=current-password highly', () => {
    const input = createInput({ type: 'text', autocomplete: 'current-password' });
    document.body.appendChild(input);

    const result = scorePasswordField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.25);
    expect(result.reasons.some((r) => r.includes('autocomplete'))).toBe(true);

    input.remove();
  });

  it('should score name containing "password"', () => {
    const input = createInput({ type: 'text', name: 'user_password' });
    document.body.appendChild(input);

    const result = scorePasswordField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.15);
    expect(result.reasons.some((r) => r.includes('attribute match'))).toBe(true);

    input.remove();
  });

  it('should score placeholder containing "password"', () => {
    const input = createInput({ type: 'text', placeholder: 'Enter your password' });
    document.body.appendChild(input);

    const result = scorePasswordField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.15);

    input.remove();
  });

  it('should score email type low for password detection', () => {
    const input = createInput({ type: 'email' });
    document.body.appendChild(input);

    const result = scorePasswordField(input);
    expect(result.confidence).toBe(0);

    input.remove();
  });

  it('should score with label text match', () => {
    const form = document.createElement('form');
    const label = createLabel('Password', 'pw-labeled');
    const input = createInput({ type: 'text', id: 'pw-labeled' });
    form.appendChild(label);
    form.appendChild(input);
    document.body.appendChild(form);

    const result = scorePasswordField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.2);
    expect(result.reasons.some((r) => r.includes('label match'))).toBe(true);

    form.remove();
  });

  it('should combine multiple signals for highest confidence', () => {
    const form = document.createElement('form');
    const label = createLabel('Your Password', 'pw-combo');
    const input = createInput({
      type: 'password',
      id: 'pw-combo',
      name: 'login_password',
      autocomplete: 'current-password',
    });
    form.appendChild(label);
    form.appendChild(input);
    document.body.appendChild(form);

    const result = scorePasswordField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);

    form.remove();
  });
});

// ---------------------------------------------------------------------------
// scoreUsernameField
// ---------------------------------------------------------------------------

describe('scoreUsernameField', () => {
  it('should score type=email with high confidence', () => {
    const input = createInput({ type: 'email' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.reasons).toContain('type=email');

    input.remove();
  });

  it('should score type=tel with moderate confidence', () => {
    const input = createInput({ type: 'tel' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    expect(result.reasons).toContain('type=tel');

    input.remove();
  });

  it('should score type=text with low confidence', () => {
    const input = createInput({ type: 'text' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);

    input.remove();
  });

  it('should score type=checkbox as zero confidence', () => {
    const input = createInput({ type: 'checkbox', name: 'remember' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBe(0);

    input.remove();
  });

  it('should score type=submit as zero confidence', () => {
    const input = createInput({ type: 'submit' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBe(0);

    input.remove();
  });

  it('should score autocomplete=username highly', () => {
    const input = createInput({ type: 'text', autocomplete: 'username' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);

    input.remove();
  });

  it('should score name containing "email"', () => {
    const input = createInput({ type: 'text', name: 'login_email' });
    document.body.appendChild(input);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.15);

    input.remove();
  });

  it('should score with label text "Username"', () => {
    const form = document.createElement('form');
    const label = createLabel('Username', 'user-labeled');
    const input = createInput({ type: 'text', id: 'user-labeled' });
    form.appendChild(label);
    form.appendChild(input);
    document.body.appendChild(form);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.2);
    expect(result.reasons.some((r) => r.includes('label match'))).toBe(true);

    form.remove();
  });

  it('should combine signals for high confidence', () => {
    const form = document.createElement('form');
    const label = createLabel('Email Address', 'email-combo');
    const input = createInput({
      type: 'email',
      id: 'email-combo',
      name: 'user_email',
      autocomplete: 'email',
    });
    form.appendChild(label);
    form.appendChild(input);
    document.body.appendChild(form);

    const result = scoreUsernameField(input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);

    form.remove();
  });
});

// ---------------------------------------------------------------------------
// getAssociatedLabelText
// ---------------------------------------------------------------------------

describe('getAssociatedLabelText', () => {
  it('should find label via explicit for attribute', () => {
    const form = document.createElement('form');
    const label = createLabel('Email Address', 'email-explicit');
    const input = createInput({ type: 'email', id: 'email-explicit' });
    form.appendChild(label);
    form.appendChild(input);
    document.body.appendChild(form);

    const text = getAssociatedLabelText(input);
    expect(text).toBe('Email Address');

    form.remove();
  });

  it('should find label via implicit wrapping', () => {
    const form = document.createElement('form');
    const label = createLabel('Password');
    const input = createInput({ type: 'password' });
    label.appendChild(input);
    form.appendChild(label);
    document.body.appendChild(form);

    const text = getAssociatedLabelText(input);
    expect(text).toBe('Password');

    form.remove();
  });

  it('should find label via aria-labelledby', () => {
    const form = document.createElement('form');
    const labelEl = document.createElement('span');
    labelEl.id = 'aria-label-email';
    labelEl.textContent = 'Your Email';
    const input = createInput({ type: 'email' });
    input.setAttribute('aria-labelledby', 'aria-label-email');
    form.appendChild(labelEl);
    form.appendChild(input);
    document.body.appendChild(form);

    const text = getAssociatedLabelText(input);
    expect(text).toBe('Your Email');

    form.remove();
  });

  it('should return empty string when no label found', () => {
    // Use an input inside a form with no labels or preceding text
    const form = document.createElement('form');
    const input = createInput({ type: 'text' });
    form.appendChild(input);
    document.body.appendChild(form);

    const text = getAssociatedLabelText(input);
    expect(text).toBe('');

    form.remove();
  });

  it('should find nearest preceding sibling text', () => {
    const container = document.createElement('div');
    const preceding = document.createElement('span');
    preceding.textContent = 'Username:';
    const input = createInput({ type: 'text' });
    container.appendChild(preceding);
    container.appendChild(input);
    document.body.appendChild(container);

    const text = getAssociatedLabelText(input);
    expect(text).toBe('Username:');

    container.remove();
  });
});

// ---------------------------------------------------------------------------
// walkElements (shadow DOM traversal)
// ---------------------------------------------------------------------------

describe('walkElements', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should yield all elements in a flat DOM', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Hello</p><span>World</span>';
    document.body.appendChild(container);

    const elements = Array.from(walkElements(document.body));
    expect(elements.length).toBeGreaterThanOrEqual(3); // div, p, span
    expect(elements).toContain(container.querySelector('p')!);
    expect(elements).toContain(container.querySelector('span')!);

    container.remove();
  });

  it('should traverse into shadow DOM', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const innerInput = document.createElement('input');
    innerInput.type = 'password';
    shadowRoot.appendChild(innerInput);

    const elements = Array.from(walkElements(document.body));
    const found = elements.find(
      (el) => el instanceof HTMLInputElement && el.type === 'password',
    );
    expect(found).toBe(innerInput);

    host.remove();
  });

  it('should traverse nested shadow DOMs', () => {
    const outer = document.createElement('div');
    document.body.appendChild(outer);

    const outerShadow = outer.attachShadow({ mode: 'open' });
    const middle = document.createElement('div');
    outerShadow.appendChild(middle);

    const middleShadow = middle.attachShadow({ mode: 'open' });
    const innerInput = document.createElement('input');
    innerInput.type = 'password';
    middleShadow.appendChild(innerInput);

    const elements = Array.from(walkElements(document.body));
    const found = elements.find(
      (el) => el instanceof HTMLInputElement && el.type === 'password',
    );
    expect(found).toBe(innerInput);

    outer.remove();
  });

  it('should respect maxShadowDepth', () => {
    const outer = document.createElement('div');
    document.body.appendChild(outer);

    const outerShadow = outer.attachShadow({ mode: 'open' });
    const middle = document.createElement('div');
    outerShadow.appendChild(middle);

    const middleShadow = middle.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    middleShadow.appendChild(inner);

    const deepShadow = inner.attachShadow({ mode: 'open' });
    const deepInput = document.createElement('input');
    deepShadow.appendChild(deepInput);

    // depth=2 should find middle but not inner's shadow
    const elements = Array.from(walkElements(document.body, 2));
    const found = elements.find(
      (el) => el instanceof HTMLInputElement,
    );
    expect(found).toBeUndefined();

    outer.remove();
  });
});

// ---------------------------------------------------------------------------
// collectAllInputs
// ---------------------------------------------------------------------------

describe('collectAllInputs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should collect inputs from flat DOM', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input type="text" name="user" />
      <input type="password" name="pass" />
      <input type="email" name="email" />
    `;
    document.body.appendChild(form);

    const inputs = collectAllInputs(document.body);
    expect(inputs.length).toBe(3);

    form.remove();
  });

  it('should collect inputs from shadow DOM', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const pwInput = document.createElement('input');
    pwInput.type = 'password';
    shadow.appendChild(pwInput);

    const inputs = collectAllInputs(document.body);
    expect(inputs).toContain(pwInput);

    host.remove();
  });
});

// ---------------------------------------------------------------------------
// pairWithNearestUsername
// ---------------------------------------------------------------------------

describe('pairWithNearestUsername', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should pair password with closest username in same form', () => {
    const form = document.createElement('form');
    form.style.position = 'relative';
    form.innerHTML = `
      <input type="email" id="u1" style="position:absolute;top:0;left:0;" />
      <input type="password" id="p1" style="position:absolute;top:40px;left:0;" />
    `;
    document.body.appendChild(form);

    const pwInput = form.querySelector('#p1') as HTMLInputElement;
    const uInput = form.querySelector('#u1') as HTMLInputElement;

    const pwField: DetectedField = {
      element: pwInput,
      confidence: 0.9,
      reasons: ['type=password'],
    };

    const candidates: DetectedField[] = [
      { element: uInput, confidence: 0.7, reasons: ['type=email'] },
    ];

    const result = pairWithNearestUsername(pwField, candidates);
    expect(result).not.toBeNull();
    expect(result!.element).toBe(uInput);

    form.remove();
  });

  it('should return null if no candidates pass threshold', () => {
    const form = document.createElement('form');
    const pwInput = createInput({ type: 'password' });
    const uInput = createInput({ type: 'checkbox' });
    form.appendChild(pwInput);
    form.appendChild(uInput);
    document.body.appendChild(form);

    const pwField: DetectedField = {
      element: pwInput,
      confidence: 0.9,
      reasons: [],
    };

    const candidates: DetectedField[] = [
      { element: uInput, confidence: 0.1, reasons: [] },
    ];

    const result = pairWithNearestUsername(pwField, candidates, {
      maxShadowDepth: 10,
      minConfidence: 0.3,
      maxNearnessDistance: 20,
    });
    expect(result).toBeNull();

    form.remove();
  });
});

// ---------------------------------------------------------------------------
// detectLoginForms
// ---------------------------------------------------------------------------

describe('detectLoginForms', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should detect a standard login form', () => {
    document.body.appendChild(createFormWithFields());

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(1);
    expect(forms[0].passwordField).toBeDefined();
    expect(forms[0].usernameField).not.toBeNull();
    expect(forms[0].passwordField.element.type).toBe('password');
    expect(forms[0].usernameField!.element.type).toBe('email');

    document.body.innerHTML = '';
  });

  it('should detect multiple login forms on the same page', () => {
    const form1 = createFormWithFields();
    form1.id = 'login-form-1';
    const form2 = createFormWithFields();
    form2.id = 'login-form-2';

    document.body.appendChild(form1);
    document.body.appendChild(form2);

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(2);

    document.body.innerHTML = '';
  });

  it('should detect password-only form (no username)', () => {
    const form = document.createElement('form');
    const pwInput = createInput({ type: 'password', name: 'secret' });
    form.appendChild(pwInput);
    document.body.appendChild(form);

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(1);
    expect(forms[0].passwordField).toBeDefined();
    expect(forms[0].usernameField).toBeNull();

    form.remove();
  });

  it('should detect standalone password field outside a form', () => {
    const container = document.createElement('div');
    const pwInput = createInput({
      type: 'password',
      name: 'auth_password',
      autocomplete: 'current-password',
    });
    container.appendChild(pwInput);
    document.body.appendChild(container);

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(1);
    expect(forms[0].formElement).toBeNull(); // standalone

    container.remove();
  });

  it('should skip disabled inputs', () => {
    const form = document.createElement('form');
    const pwInput = createInput({ type: 'password' });
    pwInput.disabled = true;
    form.appendChild(pwInput);
    document.body.appendChild(form);

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(0);

    form.remove();
  });

  it('should detect forms inside shadow DOM', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <form>
        <label for="sd-email">Shadow Email</label>
        <input type="email" id="sd-email" />
        <label for="sd-pass">Shadow Password</label>
        <input type="password" id="sd-pass" />
      </form>
    `;

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(1);
    expect(forms[0].passwordField.element.type).toBe('password');

    host.remove();
  });

  it('should sort forms by overall confidence', () => {
    // Form 1: password with strong signals
    const form1 = document.createElement('form');
    form1.innerHTML = `
      <label for="strong-pw">Password</label>
      <input type="password" id="strong-pw" name="password" autocomplete="current-password" />
      <label for="strong-un">Email</label>
      <input type="email" id="strong-un" name="email" autocomplete="email" />
    `;
    document.body.appendChild(form1);

    // Form 2: password with weak signals
    const form2 = document.createElement('form');
    form2.innerHTML = `
      <input type="text" name="x" />
      <input type="password" name="y" />
    `;
    document.body.appendChild(form2);

    const forms = detectLoginForms(document.body);
    expect(forms.length).toBe(2);
    expect(forms[0].overallConfidence).toBeGreaterThanOrEqual(
      forms[1].overallConfidence,
    );

    document.body.innerHTML = '';
  });
});

// ---------------------------------------------------------------------------
// detectBestLoginForm
// ---------------------------------------------------------------------------

describe('detectBestLoginForm', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return the best form or null', () => {
    const noForms = detectBestLoginForm(document.body);
    expect(noForms).toBeNull();

    document.body.appendChild(createFormWithFields());
    const best = detectBestLoginForm(document.body);
    expect(best).not.toBeNull();
    expect(best!.passwordField.element.type).toBe('password');

    document.body.innerHTML = '';
  });
});

// ---------------------------------------------------------------------------
// isElementVisible
// ---------------------------------------------------------------------------

describe('isElementVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return true for visible elements', () => {
    const el = document.createElement('input');
    el.style.display = 'block';
    el.style.width = '100px';
    el.style.height = '20px';
    document.body.appendChild(el);

    // jsdom doesn't compute layout, so getBoundingClientRect returns zeros
    // We test the style-based checks
    expect(isElementVisible(el)).toBe(true);

    el.remove();
  });

  it('should return false for display:none', () => {
    const el = document.createElement('input');
    el.style.display = 'none';
    document.body.appendChild(el);

    expect(isElementVisible(el)).toBe(false);

    el.remove();
  });

  it('should return false for visibility:hidden', () => {
    const el = document.createElement('input');
    el.style.visibility = 'hidden';
    document.body.appendChild(el);

    expect(isElementVisible(el)).toBe(false);

    el.remove();
  });

  it('should return false for opacity:0', () => {
    const el = document.createElement('input');
    el.style.opacity = '0';
    document.body.appendChild(el);

    expect(isElementVisible(el)).toBe(false);

    el.remove();
  });
});
