import { type ChapterId, CHAPTERS } from './chapters.js';
import type { Timeline } from './types.js';

/** Where the reader is in the story, in terms that survive a change of the map. */
export interface ReaderPlace {
  readonly chapter: ChapterId;
  /** Steps since the start of the chapter. */
  readonly offset: number;
  /** On the chapter's last step, whichever step that is on another map. */
  readonly atEnd: boolean;
}

export function readerPlace(timeline: Timeline, index: number): ReaderPlace {
  const at = Math.min(index, timeline.steps.length - 1);
  const { chapter } = timeline.steps[at]!;
  const first = timeline.steps.findIndex(step => step.chapter === chapter);
  return { chapter, offset: at - first, atEnd: timeline.steps[at + 1]?.chapter !== chapter };
}

/** The step for a place: the same one if its chapter exists, else the end of the nearest earlier chapter. */
export function stepForPlace(timeline: Timeline, place: ReaderPlace): number {
  for (let i = CHAPTERS.findIndex(c => c.id === place.chapter); i >= 0; i--) {
    const { id } = CHAPTERS[i]!;
    const last = timeline.steps.findLastIndex(step => step.chapter === id);
    if (last >= 0) {
      const first = timeline.steps.findIndex(step => step.chapter === id);
      return id === place.chapter && !place.atEnd ? Math.min(first + place.offset, last) : last;
    }
  }
  return 0;
}
