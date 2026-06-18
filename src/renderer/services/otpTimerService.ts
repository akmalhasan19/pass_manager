/**
 * otpTimerService.ts
 *
 * Global OTP timer aggregator service.
 *
 * PROBLEM: If the user has many items with OTP configured, each OtpWidget
 * instance creates its own `setInterval(fn, 1000)`. With N items, that's
 * N independent intervals — each firing an IPC call every second.
 *
 * SOLUTION:
 * - A single global `setInterval` fires once per second.
 * - All OtpWidget instances subscribe to this shared tick via callbacks.
 * - The global interval is ONLY active when at least one subscriber exists.
 * - Each widget manages its own remaining-seconds countdown locally.
 * - The circular SVG countdown uses `requestAnimationFrame` for smooth
 *   animation without blocking the main thread.
 *
 * PERFORMANCE:
 * - IPC calls are reduced from once-per-second-per-widget to
 *   once-per-period-per-widget (e.g., every 30 seconds).
 * - Only 1 global `setInterval` regardless of how many OTP widgets exist.
 *
 * USAGE:
 * ```ts
 * import { otpTimerService } from '../../services/otpTimerService';
 *
 * useEffect(() => {
 *   const unsubscribe = otpTimerService.subscribe(onTick);
 *   return () => unsubscribe();
 * }, []);
 * ```
 */

type TickCallback = (elapsedSeconds: number) => void;

interface Subscription {
  id: string;
  callback: TickCallback;
}

const TICK_INTERVAL_MS = 1000;

class OtpTimerService {
  private subscriptions: Map<string, TickCallback> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickCount: number = 0;
  private lastFrameTime: number = 0;

  /**
   * Subscribe to the global OTP tick.
   * The callback receives the number of elapsed seconds since the service
   * started ticking (useful for deriving remaining time locally).
   *
   * @returns An unsubscribe function. Must be called on component unmount.
   */
  subscribe(callback: TickCallback): () => void {
    const id = crypto.randomUUID();
    this.subscriptions.set(id, callback);

    // Start the global interval if this is the first subscriber
    if (this.subscriptions.size === 1) {
      this.start();
    }

    return () => {
      this.subscriptions.delete(id);

      // Stop the global interval if no subscribers remain
      if (this.subscriptions.size === 0) {
        this.stop();
      }
    };
  }

  /**
   * Returns the number of active subscribers.
   */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  private start(): void {
    this.tickCount = 0;
    this.lastFrameTime = performance.now();

    this.intervalId = setInterval(() => {
      this.tickCount++;
      this.broadcast();
    }, TICK_INTERVAL_MS);
  }

  private stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.tickCount = 0;
  }

  private broadcast(): void {
    for (const callback of this.subscriptions.values()) {
      try {
        callback(this.tickCount);
      } catch {
        // Silently ignore individual callback errors
        // to prevent one bad subscriber from crashing all others.
      }
    }
  }

  /**
   * Reset the service. Clears all subscriptions and stops the timer.
   * Called during vault switch / lock to prevent stale subscriptions.
   */
  reset(): void {
    this.stop();
    this.subscriptions.clear();
  }
}

/**
 * Singleton instance of the OTP timer service.
 * Use this instance throughout the application.
 */
export const otpTimerService = new OtpTimerService();