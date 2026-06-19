/**
 * DOM Isolation Utilities for SecurePass Manager Browser Extension.
 *
 * Provides helpers to create Shadow DOM containers for injected UI elements,
 * ensuring isolation from the host page's CSS, JavaScript, and DOM mutations.
 *
 * All injected overlays, prompt bars, and toasts should use Shadow DOM to
 * prevent:
 * - CSS style leakage from the host page
 * - Style override by malicious page stylesheets
 * - Accidental DOM manipulation by page scripts
 *
 * @module shared/dom-isolation
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix for all injected container IDs. */
const CONTAINER_PREFIX = 'securepass-isolated-';

/** Base styles that apply to all Shadow DOM roots to prevent leakage. */
const RESET_STYLES = `
  :host {
    all: initial !important;
    display: block !important;
    contain: content !important;
    isolation: isolate !important;
    position: fixed !important;
    z-index: 2147483647 !important;
  }
  :host * {
    all: revert !important;
    box-sizing: border-box !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
  }
`;

// ---------------------------------------------------------------------------
// Shadow Root Management
// ---------------------------------------------------------------------------

/**
 * Create or retrieve a Shadow DOM container for injected UI.
 *
 * The container is a `<div>` element appended to `document.body` with
 * an attached Shadow Root. All overlay/prompt UI should be rendered inside
 * `shadowRoot` to maintain CSS and DOM isolation from the host page.
 *
 * @param id - Unique identifier for this container (e.g., 'overlay', 'prompt', 'toast').
 * @param attachMode - Shadow DOM mode ('open' or 'closed'). Defaults to 'closed'.
 * @returns The ShadowRoot for rendering isolated UI.
 */
export function getOrCreateIsolatedContainer(
  id: string,
  attachMode: ShadowRootMode = 'closed',
): ShadowRoot {
  const existing = document.getElementById(CONTAINER_PREFIX + id);
  if (existing && existing.shadowRoot) {
    return existing.shadowRoot;
  }

  // Remove any stale container
  const stale = document.getElementById(CONTAINER_PREFIX + id);
  if (stale) stale.remove();

  // Create a host element
  const host = document.createElement('div');
  host.id = CONTAINER_PREFIX + id;
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';

  // Attach shadow root
  const shadowRoot = host.attachShadow({ mode: attachMode });

  // Inject reset styles
  const resetStyle = document.createElement('style');
  resetStyle.textContent = RESET_STYLES;
  shadowRoot.appendChild(resetStyle);

  document.body.appendChild(host);
  return shadowRoot;
}

/**
 * Remove an isolated container by its ID.
 *
 * @param id - The unique identifier for the container.
 */
export function removeIsolatedContainer(id: string): void {
  const container = document.getElementById(CONTAINER_PREFIX + id);
  if (container) {
    container.remove();
  }
}

/**
 * Check if a Shadow DOM container currently exists.
 *
 * @param id - The unique identifier for the container.
 * @returns True if the container exists with an attached shadow root.
 */
export function hasIsolatedContainer(id: string): boolean {
  const container = document.getElementById(CONTAINER_PREFIX + id);
  return !!container && !!container.shadowRoot;
}

// ---------------------------------------------------------------------------
// Style Injection
// ---------------------------------------------------------------------------

/**
 * Inject CSS styles into an isolated container's ShadowRoot.
 *
 * Styles are scoped to the ShadowRoot and will not leak to or from
 * the host page. Uses `!important` selectors internally to prevent
 * style override by the host page's CSS.
 *
 * @param shadowRoot - The target ShadowRoot.
 * @param css - CSS string to inject.
 * @returns The injected <style> element.
 */
export function injectShadowStyles(
  shadowRoot: ShadowRoot,
  css: string,
): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.appendChild(style);
  return style;
}

// ---------------------------------------------------------------------------
// Safe Element Creation
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe use in innerHTML or template literals.
 * Uses textContent assignment on a temporary element to encode HTML entities.
 *
 * This is the canonical escape function for all injected UI.
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Create a sanitized DOM element with text content.
 *
 * Safer alternative to innerHTML for dynamically created content.
 * Prevents XSS by never parsing HTML from user-controlled strings.
 *
 * @param tag - HTML tag name.
 * @param text - Text content (will be set via textContent, not innerHTML).
 * @param attributes - Optional key-value map of attributes.
 * @returns The created HTMLElement.
 */
export function createSafeElement(
  tag: string,
  text?: string,
  attributes?: Record<string, string>,
): HTMLElement {
  const el = document.createElement(tag);
  if (text !== undefined) {
    el.textContent = text;
  }
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}