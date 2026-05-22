/**
 * Token bucket per-server (default: 30/min, 200/hour).
 */

export interface RateLimitConfig {
  perMinute: number;
  perHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = { perMinute: 30, perHour: 200 };

export class TokenBucket {
  private minuteWindow = 0;
  private minuteCount = 0;
  private hourWindow = 0;
  private hourCount = 0;

  constructor(private config: RateLimitConfig = DEFAULT_RATE_LIMITS) {}

  /** Returns true if the call is allowed; false if rate limit hit. */
  tryConsume(now: number = Date.now()): boolean {
    const currentMinute = Math.floor(now / 60_000);
    const currentHour = Math.floor(now / 3_600_000);

    if (currentMinute !== this.minuteWindow) {
      this.minuteWindow = currentMinute;
      this.minuteCount = 0;
    }
    if (currentHour !== this.hourWindow) {
      this.hourWindow = currentHour;
      this.hourCount = 0;
    }

    if (this.minuteCount >= this.config.perMinute) return false;
    if (this.hourCount >= this.config.perHour) return false;

    this.minuteCount += 1;
    this.hourCount += 1;
    return true;
  }

  currentCounts(now: number = Date.now()): { minute: number; hour: number } {
    const currentMinute = Math.floor(now / 60_000);
    const currentHour = Math.floor(now / 3_600_000);
    return {
      minute: currentMinute === this.minuteWindow ? this.minuteCount : 0,
      hour: currentHour === this.hourWindow ? this.hourCount : 0,
    };
  }
}
