/**
 * Frame clock for battle playback. Every timed step (a tween or a wait) is driven from the page's animation frame,
 * so playback pauses with the page and can be hurried (text) or finished at once (leaving the battle).
 */
export class Clock {
  constructor() {
    this.now = 0;
    this.jobs = new Set();
    this.instant = false;
  }

  /** Called once per animation frame with the frame time in milliseconds. */
  tick(now) {
    this.now = now;
    for (const job of [...this.jobs]) job(now);
  }

  /** Run update(progress 0..1) every frame for `duration` milliseconds. */
  tween(duration, update = () => {}) {
    if (this.instant || duration <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let start = null;
      const job = now => {
        if (start === null) start = now;
        const progress = this.instant ? 1 : Math.min(1, (now - start) / duration);
        update(progress);
        if (progress >= 1) {
          this.jobs.delete(job);
          resolve();
        }
      };
      this.jobs.add(job);
    });
  }

  /** Wait `duration` milliseconds; `skip()` (A or B) ends a skippable wait early. */
  wait(duration, skippable = false) {
    if (this.instant) return Promise.resolve();
    return new Promise(resolve => {
      let start = null;
      const job = now => {
        if (start === null) start = now;
        if (this.instant || now - start >= duration || (skippable && this.skipped)) {
          this.jobs.delete(job);
          if (skippable) this.skipped = false;
          resolve();
        }
      };
      this.jobs.add(job);
    });
  }

  skip() { this.skipped = true; }

  /** Finish everything that is running and everything started from now on immediately. */
  finish() {
    this.instant = true;
    this.tick(this.now);
  }
}

export const ease = {
  linear: t => t,
  out: t => 1 - (1 - t) * (1 - t),
  in: t => t * t,
  inOut: t => (t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
};

export function lerp(from, to, t) {
  return from + (to - from) * t;
}
