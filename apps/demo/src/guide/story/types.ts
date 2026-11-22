import type { GuideModel } from '../model/types.js';
import type { LineKey } from '../program.js';
import type { Chapter, ChapterId } from './chapters.js';
import type { Box, Scene } from './scene.js';

export type Tool = 'inspect' | 'start' | 'target' | 'wall' | 'mud' | 'erase';

/** What the reader can do on the map during a step. */
export interface StepInteraction {
  /** Canvas tools worth offering here; `inspect` is the implicit default. */
  readonly tools: readonly Tool[];
  /** Hovering a cell shows its bytes. */
  readonly inspect: boolean;
  readonly hint: string;
}

export interface GuideStep {
  readonly chapter: ChapterId;
  readonly title: string;
  /** Explanation; text in backticks renders as code. */
  readonly body: string;
  readonly line: LineKey;
  /** Where the library is while this step runs, outermost first. */
  readonly stack: readonly string[];
  readonly call: string;
  readonly returns: string;
  readonly duration: number;
  readonly scene: Scene;
  /** Index of the A* event whose state the open-set table shows; -1 for none. */
  readonly event: number;
  /** The part of the map this step is about, in cell coordinates. */
  readonly focus: Box;
  /** The side of the map its explanation floats on. */
  readonly side: 'left' | 'right';
  /** What the reader can do on the map; null when the step needs no interface. */
  readonly interaction: StepInteraction | null;
}

export type DraftStep = Omit<GuideStep, 'side'>;

export interface Timeline {
  readonly model: GuideModel;
  readonly steps: readonly GuideStep[];
  /** The chapters of this run with their first step. */
  readonly chapters: readonly (Chapter & { readonly first: number })[];
}
