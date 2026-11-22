import { COLS, ROWS } from '../scenarios.js';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * What the canvas shows after a step. Every number is a progress value, so
 * an animation is the interpolation between two consecutive scenes.
 */
export interface Scene {
  readonly camera: Box;
  /** The memory strip folding into rows, 0..1. */
  readonly fold: number;
  /** Sector frames visible, 0..1. */
  readonly frames: number;
  /** Sectors sliced so far; the fraction animates the current one. */
  readonly slices: number;
  /** The sector this step cuts out; -1 when it is about none. */
  readonly slicing: number;
  /** Borders scanned so far. */
  readonly edges: number;
  /** The border this step scans; -1 when it is about none. */
  readonly scanning: number;
  /** Sectors with labelled areas so far. */
  readonly areas: number;
  /** The sector whose areas this step labels; -1 when it is about none. */
  readonly labelling: number;
  /** Portal graph visible, 0..1. */
  readonly graph: number;
  readonly pins: number;
  readonly coords: number;
  /** Reachable start and target portals highlighted, 0..1. */
  readonly reach: number;
  /** A* events applied so far. */
  readonly astar: number;
  /** Final portal chain highlighted, 0..1. */
  readonly chain: number;
  /** Per field: writes replayed so far. */
  readonly fieldWrites: readonly number[];
  /** Per field: cells whose direction is visible so far. */
  readonly fieldFlow: readonly number[];
  /** Route sectors highlighted, 0..1. */
  readonly route: number;
  readonly walk: number;
  readonly crowd: number;
}

export const FULL: Box = { x: -0.7, y: -0.7, w: COLS + 1.4, h: ROWS + 1.4 };

/** Centered on the memory tape, which lies above the map until it folds down. */
const MEMORY: Box = { x: -0.7, y: -12.5, w: COLS + 1.4, h: ROWS + 1.4 };

/** The scene before the first step. */
export function initialScene(fieldCount: number): Scene {
  const none = () => Array.from({ length: fieldCount }, () => 0);
  return {
    camera: MEMORY,
    fold: 0,
    frames: 0,
    slices: 0,
    slicing: -1,
    edges: 0,
    scanning: -1,
    areas: 0,
    labelling: -1,
    graph: 0,
    pins: 0,
    coords: 0,
    reach: 0,
    astar: 0,
    chain: 0,
    fieldWrites: none(),
    fieldFlow: none(),
    route: 0,
    walk: 0,
    crowd: 0,
  };
}

/** The scene part way through a step. */
export function mixScene(from: Scene, to: Scene, t: number): Scene {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    camera: to.camera,
    fold: mix(from.fold, to.fold),
    frames: mix(from.frames, to.frames),
    slices: mix(from.slices, to.slices),
    slicing: to.slicing,
    edges: mix(from.edges, to.edges),
    scanning: to.scanning,
    areas: mix(from.areas, to.areas),
    labelling: to.labelling,
    graph: mix(from.graph, to.graph),
    pins: mix(from.pins, to.pins),
    coords: mix(from.coords, to.coords),
    reach: mix(from.reach, to.reach),
    astar: mix(from.astar, to.astar),
    chain: mix(from.chain, to.chain),
    fieldWrites: to.fieldWrites.map((v, i) => mix(from.fieldWrites[i] ?? 0, v)),
    fieldFlow: to.fieldFlow.map((v, i) => mix(from.fieldFlow[i] ?? 0, v)),
    route: mix(from.route, to.route),
    walk: mix(from.walk, to.walk),
    crowd: mix(from.crowd, to.crowd),
  };
}
