/**
 * A position in a list of step durations: a step index plus the progress `t`
 * of that step's animation, where `t = 1` means the step is done. Steps are
 * pure data, so going back is just moving the position. Nothing advances on
 * its own, only the reader moves from one step to the next.
 */
export class Player {
  index = 0;
  t = 1;

  private durations: readonly number[] = [];
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

  /** Replace the steps and stand on a finished step. */
  load(durations: readonly number[], index = 0): void {
    this.durations = durations;
    this.index = Math.min(index, this.last);
    this.t = 1;
    this.notify();
  }

  /** Advance the current step's animation; call once per frame. */
  tick(dtMs: number): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dtMs / (this.durations[this.index] ?? 1));
    }
  }

  /** Move to the next step and animate it. On the last step, finish its animation. */
  stepForward(): void {
    if (this.index < this.last) {
      this.index++;
      this.t = 0;
    } else {
      this.t = 1;
    }
    this.notify();
  }

  /** Undo the current step: back to the finished state of the one before. */
  stepBack(): void {
    this.index = Math.max(0, this.index - 1);
    this.t = 1;
    this.notify();
  }

  /** Jump to a step. Moving forward animates it, moving back shows it finished. */
  seek(index: number): void {
    const target = Math.max(0, Math.min(index, this.last));
    this.t = target > this.index ? 0 : 1;
    this.index = target;
    this.notify();
  }
}
