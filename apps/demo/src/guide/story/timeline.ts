import { buildModel } from '../model/model.js';
import { COLS, type Scenario } from '../scenarios.js';
import { addBuildSteps } from './build-steps.js';
import { CHAPTERS } from './chapters.js';
import { addFieldSteps } from './field-steps.js';
import { initialScene } from './scene.js';
import { addSearchSteps } from './search-steps.js';
import type { DraftStep, GuideStep, Timeline } from './types.js';
import { Story } from './writer.js';

/**
 * Puts each explanation on the side nearest to what it explains. The side only
 * changes with the chapter or the camera, so the map holds still while the
 * reader steps through one view.
 */
function assignSides(steps: readonly DraftStep[]): GuideStep[] {
  const placed: GuideStep[] = [];
  let side: GuideStep['side'] = 'right';
  let from = 0;
  while (from < steps.length) {
    const { chapter, scene } = steps[from]!;
    let to = from + 1;
    while (to < steps.length && steps[to]!.chapter === chapter && steps[to]!.scene.camera === scene.camera) {
      to++;
    }
    const run = steps.slice(from, to);
    const center = run.reduce((sum, step) => sum + step.focus.x + step.focus.w / 2, 0) / run.length / COLS;
    if (center < 0.4) {
      side = 'left';
    } else if (center > 0.6) {
      side = 'right';
    }
    for (const step of run) {
      placed.push({ ...step, side });
    }
    from = to;
  }
  return placed;
}

export function buildTimeline(scenario: Scenario): Timeline {
  const model = buildModel(scenario);
  const story = new Story(initialScene(model.fields.length));
  addBuildSteps(story, model);
  addSearchSteps(story, model);
  addFieldSteps(story, model);

  const chapters = CHAPTERS.flatMap(chapter => {
    const first = story.steps.findIndex(step => step.chapter === chapter.id);
    return first >= 0 ? [{ ...chapter, first }] : [];
  });
  return { model, steps: assignSides(story.steps), chapters };
}
