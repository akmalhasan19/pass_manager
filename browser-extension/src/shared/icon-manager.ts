/**
 * Icon & Badge Manager for SecurePass Manager Browser Extension.
 *
 * Manages the extension icon colour (locked = red, unlocked = green),
 * toolbar badge (matching-item count), and a subtle pulse animation
 * that fires after a successful autofill.
 *
 * All icons are generated at runtime via OffscreenCanvas so there is
 * no need to ship multiple PNG bundles.
 *
 * @module shared/icon-manager
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VaultState = 'locked' | 'unlocked' | 'connecting';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Icon sizes required by Chrome. */
const ICON_SIZES: readonly number[] = [16, 48, 128] as const;

/** Colours per vault state (normalised to sRGB 0-255). */
const PALETTE: Record<VaultState, { bg: string; fg: string; badge: string }> = {
  connecting: { bg: '#f59e0b', fg: '#ffffff', badge: '#f59e0b' },
  locked:     { bg: '#ef4444', fg: '#ffffff', badge: '#ef4444' },
  unlocked:   { bg: '#10b981', fg: '#ffffff', badge: '#10b981' },
};

/** Duration of the autofill-success pulse animation (ms). */
const PULSE_DURATION_MS = 1200;

/** How many frames the pulse animation has. */
const PULSE_FRAMES = 6;

/** Idle pulse interval while the animation is active (ms). */
const PULSE_INTERVAL_MS = PULSE_DURATION_MS / PULSE_FRAMES;

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/**
 * Draw a rounded-rectangle shield icon on a canvas context.
 *
 * The shield shape is drawn centred inside the given `size` with a small
 * internal padding so the icon looks crisp at every resolution.
 */
function drawShieldIcon(
  ctx: OffscreenCanvasRenderingContext2D,
  size: number,
  bg: string,
  fg: string,
  alpha = 1,
): void {
  const pad = Math.round(size * 0.15);
  const w = size - pad * 2;
  const h = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = alpha;

  // Shield body — a rounded rect with a slight point at the bottom
  ctx.beginPath();
  const topLeft = { x: cx - w / 2, y: cy - h / 2 };
  const radius = Math.round(size * 0.18);

  // Top-left corner
  ctx.moveTo(topLeft.x + radius, topLeft.y);
  // Top edge
  ctx.lineTo(topLeft.x + w - radius, topLeft.y);
  // Top-right corner
  ctx.quadraticCurveTo(topLeft.x + w, topLeft.y, topLeft.x + w, topLeft.y + radius);
  // Right edge down to bottom point
  ctx.lineTo(topLeft.x + w, topLeft.y + h - radius * 1.2);
  // Bottom-right curve into point
  ctx.quadraticCurveTo(topLeft.x + w, topLeft.y + h, cx, topLeft.y + h);
  // Bottom-left curve out of point
  ctx.quadraticCurveTo(topLeft.x, topLeft.y + h, topLeft.x, topLeft.y + h - radius * 1.2);
  // Left edge up
  ctx.lineTo(topLeft.x, topLeft.y + radius);
  // Top-left corner
  ctx.quadraticCurveTo(topLeft.x, topLeft.y, topLeft.x + radius, topLeft.y);
  ctx.closePath();

  ctx.fillStyle = bg;
  ctx.fill();

  // Lock icon inside the shield (a circle + rectangle)
  const lockCx = cx;
  const lockCy = cy - size * 0.02;
  const lockRadius = size * 0.14;
  const lockBodyH = size * 0.16;
  const lockBodyW = lockRadius * 2;

  // Lock shackle (arc)
  ctx.beginPath();
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(2, Math.round(size * 0.06));
  ctx.lineCap = 'round';
  ctx.arc(lockCx, lockCy - lockBodyH * 0.25, lockRadius, Math.PI, 0);
  ctx.stroke();

  // Lock body (rounded rect)
  const bodyX = lockCx - lockBodyW / 2;
  const bodyY = lockCy - lockBodyH * 0.15;
  const bodyR = Math.round(size * 0.05);
  ctx.beginPath();
  ctx.moveTo(bodyX + bodyR, bodyY);
  ctx.lineTo(bodyX + lockBodyW - bodyR, bodyY);
  ctx.quadraticCurveTo(bodyX + lockBodyW, bodyY, bodyX + lockBodyW, bodyY + bodyR);
  ctx.lineTo(bodyX + lockBodyW, bodyY + lockBodyH);
  ctx.lineTo(bodyX, bodyY + lockBodyH);
  ctx.lineTo(bodyX, bodyY + bodyR);
  ctx.quadraticCurveTo(bodyX, bodyY, bodyX + bodyR, bodyY);
  ctx.closePath();
  ctx.fillStyle = fg;
  ctx.fill();

  ctx.globalAlpha = 1;
}

/**
 * Render the icon for a given state at all required sizes and return
 * an `ImageData`-like record keyed by size.
 */
function renderIconSet(
  state: VaultState,
  alpha?: number,
): { size: number; data: ImageData }[] {
  const { bg, fg } = PALETTE[state];
  const results: { size: number; data: ImageData }[] = [];

  for (const size of ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    drawShieldIcon(ctx, size, bg, fg, alpha);
    results.push({ size, data: ctx.getImageData(0, 0, size, size) });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let currentState: VaultState = 'connecting';
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let pulseFrame = 0;

/**
 * Set the extension icon to reflect the current vault state.
 *
 * @param state - 'locked' | 'unlocked' | 'connecting'
 */
export function setIconState(state: VaultState): void {
  if (state === currentState && !pulseTimer) return;
  currentState = state;

  // Cancel any running pulse animation
  if (pulseTimer) {
    clearTimeout(pulseTimer);
    pulseTimer = null;
  }

  const iconSet = renderIconSet(state);
  const imageData: Record<number, ImageData> = {};
  for (const { size, data } of iconSet) {
    imageData[size] = data;
  }

  // chrome.action.setIcon accepts an object keyed by size → ImageData
  chrome.action.setIcon({ imageData });
}

/**
 * Update the toolbar badge with the number of matching items for the
 * current tab. Pass `0` or a negative number to clear the badge.
 *
 * @param count - Number of matching credentials.
 */
export function setBadgeCount(count: number): void {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: PALETTE[currentState].badge });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Show a warning badge (!) to indicate suspicious activity detected.
 * Clears when setBadgeCount or clearWarningBadge is called.
 */
export function setWarningBadge(): void {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // Red
}

/**
 * Clear any warning badge that was set.
 */
export function clearWarningBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}

/**
 * Trigger the subtle autofill-success pulse animation.
 *
 * The icon briefly flashes to a lighter green shade and then returns
 * to its normal colour, giving the user visual feedback that the
 * autofill was dispatched.
 */
export function pulseAutofillSuccess(): void {
  if (pulseTimer) {
    clearTimeout(pulseTimer);
    pulseTimer = null;
  }

  pulseFrame = 0;

  const step = (): void => {
    pulseFrame++;

    // Alternate between normal icon and brightened icon
    const bright = pulseFrame % 2 === 0;
    const alpha = bright ? 0.6 : 1;

    const iconSet = renderIconSet('unlocked', alpha);
    const imageData: Record<number, ImageData> = {};
    for (const { size, data } of iconSet) {
      imageData[size] = data;
    }
    chrome.action.setIcon({ imageData });

    if (pulseFrame < PULSE_FRAMES) {
      pulseTimer = setTimeout(step, PULSE_INTERVAL_MS);
    } else {
      // Restore normal icon
      pulseTimer = null;
      setIconState(currentState);
    }
  };

  step();
}

/**
 * Convenience: update icon + badge together after a response from the
 * host that reveals the vault lock state and matching-item count.
 *
 * @param vaultLocked - Whether the vault is currently locked.
 * @param matchingCount - Number of matching items (0 when locked).
 */
export function updateFromHostResponse(
  vaultLocked: boolean,
  matchingCount: number,
): void {
  setIconState(vaultLocked ? 'locked' : 'unlocked');
  setBadgeCount(vaultLocked ? 0 : matchingCount);
}

/**
 * Reset the icon to the connecting state (amber).
 */
export function setConnecting(): void {
  setIconState('connecting');
  setBadgeCount(0);
}
