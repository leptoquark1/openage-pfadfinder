/**
 * Playback over a list of step durations. A position is a step index plus
 * the progress `t` of that step's animation; `t = 1` means the step is done.
 * Steps are pure data, so going back is just moving the position.
 */
export class Player {
  index = 0;
  t = 1;
  playing = false;
  speed = 1;

  private durations: readonly number[] = [];
  /** A single step forward animates up to this index and stops. */
  private stopAt: number | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getVersion = (): number => this.version;

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  get last(): number {
    return Math.max(0, this.durations.length - 1);
  }

  get atEnd(): boolean {
    return this.index >= this.last && this.t >= 1;
  }

  /** Replace the steps and stand on a finished step. */
  load(durations: readonly number[], index = 0): void {
    this.durations = durations;
    this.index = Math.min(index, this.last);
    this.t = 1;
    this.playing = false;
    this.stopAt = null;
    this.notify();
  }

  /** Advance the animation; call once per frame. */
  tick(dtMs: number): void {
    if (!this.playing && this.stopAt === null) {
      return;
    }
    const before = { index: this.index, playing: this.playing, stopAt: this.stopAt };
    let budget = dtMs * this.speed;

    while (budget > 0) {
      const duration = this.durations[this.index] ?? 1;
      const remaining = (1 - this.t) * duration;
      if (budget < remaining) {
        this.t += budget / duration;
        break;
      }
      budget -= remaining;
      this.t = 1;

      if (this.stopAt === this.index) {
        this.stopAt = null;
        break;
      }
      if (this.index >= this.last) {
        this.playing = false;
        this.stopAt = null;
        break;
      }
      this.index++;
      this.t = 0;
    }

    // The animation itself is read every frame; only discrete changes re-render the UI.
    if (this.index !== before.index || this.playing !== before.playing || this.stopAt !== before.stopAt) {
      this.notify();
    }
  }

  /** Play from the very beginning, including the first step. */
  restart(): void {
    this.index = 0;
    this.t = 0;
    this.playing = true;
    this.stopAt = null;
    this.notify();
  }

  play(): void {
    if (this.atEnd) {
      this.index = 0;
      this.t = 0;
    } else if (this.t >= 1) {
      this.index++;
      this.t = 0;
    }
    this.playing = true;
    this.stopAt = null;
    this.notify();
  }

  pause(): void {
    this.playing = false;
    this.stopAt = null;
    this.notify();
  }

  toggle(): void {
    if (this.playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Finish the running animation, or animate exactly one more step. */
  stepForward(): void {
    this.playing = false;
    if (this.t < 1) {
      this.t = 1;
      this.stopAt = null;
    } else if (this.index < this.last) {
      this.index++;
      this.t = 0;
      this.stopAt = this.index;
    }
    this.notify();
  }

  /** Undo the current step: back to the finished state of the one before. */
  stepBack(): void {
    this.playing = false;
    this.stopAt = null;
    this.index = Math.max(0, this.index - 1);
    this.t = 1;
    this.notify();
  }

  seek(index: number): void {
    this.playing = false;
    this.stopAt = null;
    this.index = Math.max(0, Math.min(index, this.last));
    this.t = 1;
    this.notify();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.notify();
  }
}
