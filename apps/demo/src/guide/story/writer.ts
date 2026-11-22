import type { SectorView } from '../model/types.js';
import { type Cell, SECTOR_SIZE } from '../scenarios.js';
import type { Box, Scene } from './scene.js';
import type { DraftStep, StepInteraction } from './types.js';

type NewStep = Omit<DraftStep, 'scene' | 'event' | 'stack' | 'focus' | 'interaction'> & {
  readonly stack?: readonly string[];
  readonly event?: number;
  readonly focus?: Box;
  readonly interaction?: StepInteraction;
};

/** Collects the steps of a run; each step changes the scene the one before it left. */
export class Story {
  readonly steps: DraftStep[] = [];

  constructor(public scene: Scene) {}

  add(step: NewStep, patch: Partial<Scene>): void {
    this.scene = { ...this.scene, slicing: -1, scanning: -1, labelling: -1, ...patch };
    this.steps.push({ stack: [], event: -1, focus: this.scene.camera, interaction: null, ...step, scene: this.scene });
  }
}

export const focus = (sector: SectorView): Box => ({
  x: sector.ne - 1.3,
  y: sector.se - 1.3,
  w: SECTOR_SIZE + 2.6,
  h: SECTOR_SIZE + 2.6,
});

export const sectorBox = (sector: SectorView): Box => ({ x: sector.ne, y: sector.se, w: SECTOR_SIZE, h: SECTOR_SIZE });

export const cellBox = (cell: Cell): Box => ({ x: cell.ne, y: cell.se, w: 1, h: 1 });

export const pointBox = (x: number, y: number): Box => ({ x: x - 1, y: y - 1, w: 2, h: 2 });

/** The two rows or columns of cells that face each other across a sector border. */
export const borderBox = (sector: SectorView, northSouth: boolean): Box =>
  northSouth
    ? { x: sector.ne, y: sector.se + SECTOR_SIZE - 1, w: SECTOR_SIZE, h: 2 }
    : { x: sector.ne + SECTOR_SIZE - 1, y: sector.se, w: 2, h: SECTOR_SIZE };

export const PAINT: StepInteraction = {
  tools: ['wall', 'mud', 'erase'],
  inspect: true,
  hint: 'Paint the map, or hover a cell to read its byte.',
};

export const GRAPH_HOVER: StepInteraction = {
  tools: [],
  inspect: false,
  hint: 'Hover a portal to see its edge costs.',
};

export const PINS: StepInteraction = {
  tools: ['start', 'target'],
  inspect: false,
  hint: 'Drag a pin to ask for another route.',
};

export const BYTES: StepInteraction = { tools: [], inspect: true, hint: 'Hover a cell to read its real bytes.' };

export const UNBLOCK: StepInteraction = {
  tools: ['erase', 'start', 'target'],
  inspect: false,
  hint: 'Erase a wall or move a pin to open a way.',
};

export const SANDBOX: StepInteraction = {
  tools: ['start', 'target', 'wall', 'mud', 'erase'],
  inspect: true,
  hint: 'Change the map. The route and the crowd follow.',
};

export const cellText = (cell: Cell) => `(${cell.ne}, ${cell.se})`;

export const portalList = (ids: readonly number[]) => (ids.length ? ids.map(id => `P${id}`).join(', ') : 'none');

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Evenly spaced stops from `from` (excluded) to `to` (included). */
export function pulses(from: number, to: number, count: number): number[] {
  const span = to - from;
  if (span <= 0) {
    return [];
  }
  const n = Math.min(count, span);
  return Array.from({ length: n }, (_, i) => from + Math.round((span * (i + 1)) / n));
}
