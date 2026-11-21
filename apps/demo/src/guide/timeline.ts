import {
  COST_IMPASSABLE,
  FLOW_DIR_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
  INTEGRATED_COST_UNREACHABLE,
  PathResult,
} from '@leptoquark1/openage-pfadfinder/shared';
import { type FieldTrace, type GuideModel, buildModel, type SectorView } from './model.js';
import { replayField } from './observe.js';
import type { LineKey } from './program.js';
import { type Cell, COLS, COST_MUD, ROWS, type Scenario, SECTOR_SIZE, SECTORS_X, SECTORS_Y } from './scenarios.js';

export type ChapterId =
  | 'memory'
  | 'sectors'
  | 'portals'
  | 'areas'
  | 'graph'
  | 'request'
  | 'search'
  | 'target'
  | 'transit'
  | 'route'
  | 'crowd';

export interface Chapter {
  readonly id: ChapterId;
  readonly title: string;
  readonly part: 'Build the grid' | 'Find the path';
}

export const CHAPTERS: readonly Chapter[] = [
  { id: 'memory', title: 'Cost map', part: 'Build the grid' },
  { id: 'sectors', title: 'Sectors', part: 'Build the grid' },
  { id: 'portals', title: 'Portals', part: 'Build the grid' },
  { id: 'areas', title: 'Areas & exits', part: 'Build the grid' },
  { id: 'graph', title: 'Portal graph', part: 'Build the grid' },
  { id: 'request', title: 'Path request', part: 'Find the path' },
  { id: 'search', title: 'Portal A*', part: 'Find the path' },
  { id: 'target', title: 'Target field', part: 'Find the path' },
  { id: 'transit', title: 'Portal fields', part: 'Find the path' },
  { id: 'route', title: 'Route', part: 'Find the path' },
  { id: 'crowd', title: 'Crowd', part: 'Find the path' },
];

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

type DraftStep = Omit<GuideStep, 'side'>;

export interface Timeline {
  readonly model: GuideModel;
  readonly steps: readonly GuideStep[];
  /** The chapters of this run with their first step. */
  readonly chapters: readonly (Chapter & { readonly first: number })[];
}

const FULL: Box = { x: -0.7, y: -0.7, w: COLS + 1.4, h: ROWS + 1.4 };
/** Centered on the memory tape, which lies above the map until it folds down. */
const MEMORY: Box = { x: -0.7, y: -12.5, w: COLS + 1.4, h: ROWS + 1.4 };

const focus = (sector: SectorView): Box => ({
  x: sector.ne - 1.3,
  y: sector.se - 1.3,
  w: SECTOR_SIZE + 2.6,
  h: SECTOR_SIZE + 2.6,
});

const sectorBox = (sector: SectorView): Box => ({ x: sector.ne, y: sector.se, w: SECTOR_SIZE, h: SECTOR_SIZE });
const cellBox = (cell: Cell): Box => ({ x: cell.ne, y: cell.se, w: 1, h: 1 });
const pointBox = (x: number, y: number): Box => ({ x: x - 1, y: y - 1, w: 2, h: 2 });
/** The two rows or columns of cells that face each other across a sector border. */
const borderBox = (sector: SectorView, northSouth: boolean): Box =>
  northSouth
    ? { x: sector.ne, y: sector.se + SECTOR_SIZE - 1, w: SECTOR_SIZE, h: 2 }
    : { x: sector.ne + SECTOR_SIZE - 1, y: sector.se, w: 2, h: SECTOR_SIZE };

const PAINT: StepInteraction = {
  tools: ['wall', 'mud', 'erase'],
  inspect: true,
  hint: 'Paint the map, or hover a cell to read its byte.',
};
const GRAPH_HOVER: StepInteraction = { tools: [], inspect: false, hint: 'Hover a portal to see its edge costs.' };
const PINS: StepInteraction = {
  tools: ['start', 'target'],
  inspect: false,
  hint: 'Drag a pin to ask for another route.',
};
const BYTES: StepInteraction = { tools: [], inspect: true, hint: 'Hover a cell to read its real bytes.' };
const UNBLOCK: StepInteraction = {
  tools: ['erase', 'start', 'target'],
  inspect: false,
  hint: 'Erase a wall or move a pin to open a way.',
};
const SANDBOX: StepInteraction = {
  tools: ['start', 'target', 'wall', 'mud', 'erase'],
  inspect: true,
  hint: 'Change the map. The route and the crowd follow.',
};

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

const cellText = (cell: Cell) => `(${cell.ne}, ${cell.se})`;
const portalList = (ids: readonly number[]) => (ids.length ? ids.map(id => `P${id}`).join(', ') : 'none');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Evenly spaced stops from `from` (excluded) to `to` (included). */
function pulses(from: number, to: number, count: number): number[] {
  const span = to - from;
  if (span <= 0) {
    return [];
  }
  const n = Math.min(count, span);
  return Array.from({ length: n }, (_, i) => from + Math.round((span * (i + 1)) / n));
}

export function buildTimeline(scenario: Scenario): Timeline {
  const model = buildModel(scenario);
  const { sectors, edges, portals, graphEdges, search, fields } = model;
  const { start, target, costs } = scenario;
  const steps: DraftStep[] = [];

  let scene: Scene = {
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
    fieldWrites: fields.map(() => 0),
    fieldFlow: fields.map(() => 0),
    route: 0,
    walk: 0,
    crowd: 0,
  };

  const add = (
    step: Omit<DraftStep, 'scene' | 'event' | 'stack' | 'focus' | 'interaction'> & {
      readonly stack?: readonly string[];
      readonly event?: number;
      readonly focus?: Box;
      readonly interaction?: StepInteraction;
    },
    patch: Partial<Scene>,
  ) => {
    scene = { ...scene, slicing: -1, scanning: -1, labelling: -1, ...patch };
    steps.push({ stack: [], event: -1, focus: scene.camera, interaction: null, ...step, scene });
  };

  // --- Cost map ---------------------------------------------------------
  let walls = 0;
  let mud = 0;
  for (const cost of costs) {
    if (cost === COST_IMPASSABLE) {
      walls++;
    } else if (cost > 1) {
      mud++;
    }
  }
  add(
    {
      chapter: 'memory',
      title: 'A map is just bytes',
      body: `The whole map starts as one flat \`Uint8Array\` with ${COLS * ROWS} entries, one byte of movement cost per cell. There is no 2D structure yet.`,
      line: 'alloc',
      call: `new Uint8Array(${COLS} * ${ROWS})`,
      returns: `Uint8Array(${COLS * ROWS})`,
      duration: 3200,
    },
    {},
  );
  add(
    {
      chapter: 'memory',
      title: 'Folding it into rows',
      body: `Every ${COLS} bytes form a row. A cell's index is \`ne + se × ${COLS}\`, so \`ne\` walks east and \`se\` walks south. This row-major layout is used on every level of the library.`,
      line: 'paint',
      call: 'costs[ne + se * 24]',
      returns: `(${start.ne}, ${start.se}) → index ${start.ne + start.se * COLS}`,
      duration: 3600,
    },
    { fold: 1, camera: FULL },
  );
  add(
    {
      chapter: 'memory',
      title: 'What a byte means',
      body: `\`1\` is normal ground, up to \`254\` is passable but expensive, and \`255\` blocks movement. This map has ${plural(walls, 'wall')} and ${mud} mud cells (cost ${COST_MUD}).`,
      line: 'paint',
      call: 'costs[idx] = COST_IMPASSABLE',
      returns: `${walls} × 255 · ${mud} × ${COST_MUD} · ${COLS * ROWS - walls - mud} × 1`,
      duration: 2800,
      interaction: PAINT,
    },
    {},
  );

  // --- Sectors ----------------------------------------------------------
  add(
    {
      chapter: 'sectors',
      title: 'Cutting the map into sectors',
      body: `A \`Grid\` divides the map into ${SECTORS_X} × ${SECTORS_Y} square sectors of ${SECTOR_SIZE} × ${SECTOR_SIZE} cells. Later, each search only has to think about sectors, not about all ${COLS * ROWS} cells.`,
      line: 'grid',
      call: `new Grid(0, { width: ${SECTORS_X}, height: ${SECTORS_Y} }, ${SECTOR_SIZE})`,
      returns: 'Grid',
      duration: 2800,
    },
    { frames: 1 },
  );
  for (const sector of sectors) {
    add(
      {
        chapter: 'sectors',
        title: `Sector ${sector.id} at (${sector.x}, ${sector.y})`,
        body: `It copies cells \`ne ${sector.ne}–${sector.ne + SECTOR_SIZE - 1}\`, \`se ${sector.se}–${sector.se + SECTOR_SIZE - 1}\` into its own \`CostField\`. From here on it uses local coordinates, 0 to ${SECTOR_SIZE - 1}. Ids must be row-major: \`id = x + y × ${SECTORS_X}\`.`,
        line: 'addSector',
        call: `grid.addSector(new Sector(${sector.id}, { x: ${sector.x}, y: ${sector.y} }, field))`,
        returns: 'void',
        duration: 620,
        focus: sectorBox(sector),
      },
      { slices: sector.id + 1, slicing: sector.id },
    );
  }

  // --- Portals ----------------------------------------------------------
  add(
    {
      chapter: 'portals',
      title: 'Looking for gates',
      body: 'Sectors are still isolated. `initPortals()` walks every shared border. Wherever cells on **both** sides are passable, consecutive cells form one portal.',
      line: 'initPortals',
      stack: ['grid.initPortals()'],
      call: 'grid.initPortals()',
      returns: `${portals.size} portals`,
      duration: 2600,
    },
    {},
  );
  edges.forEach((edge, i) => {
    const direction = edge.northSouth ? 'NORTH_SOUTH' : 'EAST_WEST';
    const blocked = edge.pairs.filter(pair => !pair.open).length;
    add(
      {
        chapter: 'portals',
        title: `Border S${edge.a} ${edge.northSouth ? '↓' : '→'} S${edge.b}`,
        body:
          edge.portalIds.length === 0
            ? 'Every pair of cells along this border is blocked, so these sectors have no direct connection.'
            : `${SECTOR_SIZE - blocked} of ${SECTOR_SIZE} cell pairs are open. They form ${plural(edge.portalIds.length, 'portal')}: ${portalList(edge.portalIds)}.`,
        line: 'initPortals',
        stack: ['grid.initPortals()', 'sector.findPortals()'],
        call: `sector${edge.a}.findPortals(sector${edge.b}, PortalDirection.${direction}, allocateId)`,
        returns: `[${portalList(edge.portalIds)}]`,
        duration: 900,
        focus: borderBox(sectors[edge.a]!, edge.northSouth),
      },
      { edges: i + 1, scanning: i },
    );
  });

  // --- Areas ------------------------------------------------------------
  add(
    {
      chapter: 'areas',
      title: 'Which gates can reach each other?',
      body: 'Two portals of a sector are only connected if you can walk between them. A flood fill labels the connected **areas** of each sector. `initPortals()` does this right after handling a sector’s borders.',
      line: 'initPortals',
      stack: ['grid.initPortals()', 'sector.connectExits()'],
      call: 'sector.connectExits()',
      returns: 'void',
      duration: 2600,
    },
    {},
  );
  for (const sector of sectors) {
    add(
      {
        chapter: 'areas',
        title: `Sector ${sector.id}: ${plural(sector.areaCount, 'area')}`,
        body:
          sector.areaCount > 1
            ? `Walls split this sector. Portals only become exits of each other inside the same area, which is what keeps routes from walking through walls.`
            : `All passable cells are connected, so its ${plural(sector.portalIds.length, 'portal')} (${portalList(sector.portalIds)}) can all reach each other.`,
        line: 'initPortals',
        stack: ['grid.initPortals()', 'sector.connectExits()', 'sector.getAreas()'],
        call: `sector${sector.id}.getAreas()`,
        returns: `${plural(sector.areaCount, 'area')}`,
        duration: 760,
        focus: sectorBox(sector),
      },
      { areas: sector.id + 1, labelling: sector.id },
    );
  }

  // --- Portal graph -----------------------------------------------------
  add(
    {
      chapter: 'graph',
      title: 'The map becomes a graph',
      body: `Each portal becomes a \`PortalNode\`. Each edge stores the distance between two portal centers, as \`round(distance × 10)\`. ${COLS * ROWS} cells are now ${portals.size} nodes and ${graphEdges.length} edges.`,
      line: 'initNodes',
      stack: ['grid.initPortalNodes()', 'node.initExits()'],
      call: 'grid.initPortalNodes()',
      returns: `Map(${portals.size}) of PortalNode`,
      duration: 3400,
      interaction: GRAPH_HOVER,
    },
    { graph: 1 },
  );

  // --- Request ----------------------------------------------------------
  const startInfo = model.grid.globalToLocal(start.ne, start.se);
  add(
    {
      chapter: 'request',
      title: 'A unit wants to move',
      body: `The grid is ready and never has to be rebuilt for a new request. Now we ask for a route from ${cellText(start)} to ${cellText(target)}.`,
      line: 'getRoute',
      stack: ['pathfinder.getFlowRoute()', 'planRoute()'],
      call: `pathfinder.getFlowRoute({ gridId: 0, start: ${cellText(start)}, target: ${cellText(target)} })`,
      returns: '…',
      duration: 2800,
      interaction: PINS,
    },
    { pins: 1 },
  );
  add(
    {
      chapter: 'request',
      title: 'From global to local',
      body: `Global ${cellText(start)} lies in sector ${model.startSector} at local \`(${startInfo.localNe}, ${startInfo.localSe})\`, which is cell index \`${startInfo.localNe + startInfo.localSe * SECTOR_SIZE}\`. The target lies in sector ${model.targetSector}.`,
      line: 'getRoute',
      stack: ['pathfinder.getFlowRoute()', 'planRoute()', 'grid.globalToLocal()'],
      call: `grid.globalToLocal(${start.ne}, ${start.se})`,
      returns: `{ sectorX: ${startInfo.sectorX}, sectorY: ${startInfo.sectorY}, localNe: ${startInfo.localNe}, localSe: ${startInfo.localSe} }`,
      duration: 3400,
      focus: cellBox(start),
      interaction: PINS,
    },
    { coords: 1 },
  );
  if (model.sameArea) {
    add(
      {
        chapter: 'request',
        title: 'Shortcut: same area',
        body: 'Start and target share a sector and an area. No portal search is needed, one flow field is enough.',
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()', 'planRoute()', 'getPathSingleSector()'],
        call: 'sector.getAreas()[startIdx] === sector.getAreas()[targetIdx]',
        returns: 'true',
        duration: 2800,
        focus: cellBox(start),
        interaction: PINS,
      },
      { coords: 0 },
    );
  } else {
    add(
      {
        chapter: 'request',
        title: 'Which gates are in reach?',
        body: `Only portals in the same area as the start or target are valid ends of the route. Start: ${portalList(model.startPortals)}. Target: ${portalList(model.targetPortals)}.`,
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()', 'getPathMultiSector()', 'portalsReachableFrom()'],
        call: 'portalsReachableFrom(sector, localNe, localSe)',
        returns: `start [${portalList(model.startPortals)}] · target [${portalList(model.targetPortals)}]`,
        duration: 3200,
        focus: cellBox(start),
        interaction: PINS,
      },
      { coords: 0, reach: 1 },
    );
  }

  // --- Portal A* --------------------------------------------------------
  if (search) {
    const stack = ['pathfinder.getFlowRoute()', 'getPathMultiSector()', 'portalAStar()'];
    const { events } = search;
    let at = 0;
    while (at < events.length && events[at]!.kind === 'seed') {
      at++;
    }
    add(
      {
        chapter: 'search',
        title: 'Seeding the open set',
        body: 'Each reachable start portal enters the open set with `g`, the walk from the start, and `h`, the straight-line distance to the target. The search always continues with the lowest `f = g + h`.',
        line: 'getRoute',
        stack,
        call: 'openSet.push(node, g + h)',
        returns: `${plural(at, 'node')} in the open set`,
        duration: 2800,
        event: at - 1,
        focus: cellBox(start),
      },
      { astar: at, reach: 0.35 },
    );

    let pops = 0;
    while (at < events.length) {
      const pop = events[at]!;
      let end = at + 1;
      while (end < events.length && events[end]!.kind === 'relax') {
        end++;
      }
      const relaxed = events.slice(at + 1, end);
      const added = relaxed.flatMap(e => (e.kind === 'relax' && e.outcome === 'added' ? [e.portal] : []));
      const improved = relaxed.flatMap(e => (e.kind === 'relax' && e.outcome === 'improved' ? [e.portal] : []));
      const skipped = relaxed.length - added.length - improved.length;
      const state = pop.states.find(s => s.id === pop.portal);
      const isGoal = search.found && end === events.length && pop.portal === search.chain[search.chain.length - 1];
      pops++;
      add(
        {
          chapter: 'search',
          title: isGoal ? `P${pop.portal} is a target portal` : `Expand P${pop.portal}`,
          body: isGoal
            ? `It has the lowest \`f\` (${state?.f ?? 0}) in the open set and touches the target’s area. The search stops after ${plural(pops, 'expansion')}.`
            : `Lowest \`f\` is ${state?.f ?? 0} (g ${state?.g ?? 0} + h ${state?.h ?? 0}). Exits: ${added.length ? `added ${portalList(added)}` : 'nothing new'}${improved.length ? `, improved ${portalList(improved)}` : ''}${skipped ? `, skipped ${skipped}` : ''}.`,
          line: 'getRoute',
          stack,
          call: 'openSet.pop()',
          returns: `P${pop.portal} · f = ${state?.f ?? 0}`,
          duration: isGoal ? 1800 : 1250,
          event: end - 1,
          focus: pointBox(portals.get(pop.portal)!.x, portals.get(pop.portal)!.y),
        },
        { astar: end },
      );
      at = end;
    }

    if (search.found) {
      add(
        {
          chapter: 'search',
          title: 'Backtracking the chain',
          body: `Following each node’s \`prev\` gives the portal chain: ${search.chain.map(id => `P${id}`).join(' → ')}. A* now knows **which sectors** to cross, but not yet how to move inside them.`,
          line: 'getRoute',
          stack,
          call: 'backtrace(node)',
          returns: `[${portalList(search.chain)}]`,
          duration: 3000,
          event: events.length - 1,
        },
        { chain: 1, reach: 0 },
      );
    } else {
      add(
        {
          chapter: 'search',
          title: 'No route exists',
          body: `The open set ran empty without reaching a target portal. \`portalAStar()\` reports${search.partial ? ' a partial chain to the closest node' : ' no chain'}, and \`Pathfinder\` answers with \`null\` because a partial route cannot be walked to the target.`,
          line: 'getRoute',
          stack,
          call: 'pathfinder.getFlowRoute(request)',
          returns: 'null · PathResult.NOT_FOUND',
          duration: 4000,
          interaction: UNBLOCK,
          event: events.length - 1,
        },
        { chain: search.partial ? 1 : 0, reach: 0 },
      );
    }
  } else if (!model.sameArea) {
    add(
      {
        chapter: 'search',
        title: 'No route exists',
        body: 'Start or target has no portal in its area, so there is nothing to search. `Pathfinder` answers with `null`.',
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()', 'getPathMultiSector()'],
        call: 'pathfinder.getFlowRoute(request)',
        returns: 'null · PathResult.NOT_FOUND',
        duration: 3200,
        interaction: UNBLOCK,
      },
      { reach: 0 },
    );
  }

  // --- Fields -----------------------------------------------------------
  if (model.route) {
    const sectorOf = (field: FieldTrace) => sectors[field.sector]!;
    const setAt = (values: readonly number[], index: number, value: number) =>
      values.map((v, i) => (i === index ? value : v));
    const size = SECTOR_SIZE * SECTOR_SIZE;

    const targetField = fields[0]!;
    const targetSector = sectorOf(targetField);
    const stack = ['pathfinder.getFlowRoute()', 'integrator.getTargetShared()'];
    add(
      {
        chapter: 'target',
        title: 'Zooming into the target sector',
        body: 'The last sector gets the best treatment: a full integration towards the exact target cell. A new `IntegrationField` starts with every cell at `65535`, meaning “not reached”.',
        line: 'getRoute',
        stack,
        call: 'new IntegrationField(6)',
        returns: 'IntegrationField',
        duration: 2600,
        interaction: BYTES,
      },
      { camera: focus(targetSector), graph: 0.18 },
    );

    const losStops = pulses(0, targetField.losWrites, 6);
    losStops.forEach((stop, i) => {
      add(
        {
          chapter: 'target',
          title: `Line-of-sight wave ${i + 1}/${losStops.length}`,
          body:
            i === 0
              ? 'A wave spreads from the target. Cells it reaches on open ground **see** the target directly and are marked `LOS`.'
              : 'When the wave hits a wall or expensive ground, Bresenham lines from the obstacle’s corners cast a **shadow**. Shadow cells are marked `WAVEFRONT_BLOCKED`.',
          line: 'getRoute',
          stack: [...stack, 'integrateLos()'],
          call: 'field.integrateLos(costField, target)',
          returns: `${stop} of ${targetField.losWrites} writes`,
          duration: 1100,
          interaction: BYTES,
        },
        { fieldWrites: setAt(scene.fieldWrites, 0, stop) },
      );
    });

    const costStops = pulses(targetField.losWrites, targetField.writes.length, 4);
    costStops.forEach((stop, i) => {
      add(
        {
          chapter: 'target',
          title: `Cost wave ${i + 1}/${costStops.length}`,
          body: 'From the shadow’s edge, costs spread to the 4 neighbors and add up the terrain. A cell is revisited whenever a cheaper value arrives, so it ends with its true distance around obstacles.',
          line: 'getRoute',
          stack: [...stack, 'integrateCostFromWavefront()'],
          call: 'field.integrateCostFromWavefront(costField, blocked)',
          returns: `${stop} of ${targetField.writes.length} writes`,
          duration: 1100,
          interaction: BYTES,
        },
        { fieldWrites: setAt(scene.fieldWrites, 0, stop) },
      );
    });

    add(
      {
        chapter: 'target',
        title: 'From costs to directions',
        body: 'Each cell now looks at its 8 neighbors and points to the cheapest one. Diagonals only count if both adjacent cells are reachable, so units never cut a corner. One byte stores direction and flags.',
        line: 'getRoute',
        stack: [...stack, 'flowField.build()'],
        call: 'flowField.build(integrationField)',
        returns: 'FlowField',
        duration: 2800,
        interaction: BYTES,
      },
      { fieldFlow: setAt(scene.fieldFlow, 0, size) },
    );

    // --- Portal fields ----------------------------------------------------
    fields.forEach((field, index) => {
      if (field.kind !== 'portal') {
        return;
      }
      const sector = sectorOf(field);
      const stackPortal = ['pathfinder.getFlowRoute()', 'integrator.getPortalShared()'];
      add(
        {
          chapter: 'transit',
          title: `Sector ${field.sector}: heading for P${field.portal}`,
          body:
            index === 1
              ? `Working **back to front**. All cells of the portal towards sector ${field.nextSector} start at cost \`0\`. This field does not depend on the final target, so every route through this portal can share it from the cache.`
              : `All cells of P${field.portal} start at cost \`0\`, then the cost wave fills the sector. No line of sight here, and no costs carried over from the next sector.`,
          line: 'getRoute',
          stack: [...stackPortal, 'integrateCostPortal()'],
          call: `field.integrateCostPortal(costField, ${field.nextSector}, portal${field.portal})`,
          returns: `${field.writes.length} writes`,
          duration: index === 1 ? 2800 : 1500,
          interaction: BYTES,
        },
        { camera: focus(sector), fieldWrites: setAt(scene.fieldWrites, index, field.writes.length) },
      );
      add(
        {
          chapter: 'transit',
          title: `Sector ${field.sector}: flow towards S${field.nextSector}`,
          body: `The portal’s cells get a fixed direction **out** of the sector, into sector ${field.nextSector}. That hand-over is the only link between two fields of a route.`,
          line: 'getRoute',
          stack: [...stackPortal, 'flowField.buildPortal()'],
          call: `flowField.buildPortal(field, next, ${field.nextSector}, portal${field.portal})`,
          returns: 'FlowField',
          duration: 1300,
          interaction: BYTES,
        },
        { fieldFlow: setAt(scene.fieldFlow, index, size) },
      );
    });

    // --- Route ------------------------------------------------------------
    add(
      {
        chapter: 'route',
        title: 'The finished FlowRoute',
        body: `${plural(model.routeSectors.length, 'sector')} with one flow field each: ${model.routeSectors.map(id => `S${id}`).join(' → ')}. Together they answer “where next?” for **any** cell on the route.`,
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()'],
        call: 'route.getSectorIds()',
        returns: `[${model.routeSectors.join(', ')}]`,
        duration: 2800,
        interaction: BYTES,
      },
      { camera: FULL, route: 1, graph: 0, chain: 0 },
    );
    if (model.path.result === PathResult.FOUND) {
      add(
        {
          chapter: 'route',
          title: 'Walking the fields',
          body: `\`walk()\` follows the arrows cell by cell and keeps a waypoint at every change of direction. Once a cell sees the target over a clear line, it goes straight there. Result: ${plural(model.waypoints.length, 'waypoint')}.`,
          line: 'walk',
          stack: ['route.walk()'],
          call: `route.walk(${cellText(start)})`,
          returns: `Path { FOUND, ${plural(model.waypoints.length, 'waypoint')} }`,
          duration: 4200,
          interaction: BYTES,
        },
        { walk: 1 },
      );
    }

    // --- Crowd ------------------------------------------------------------
    add(
      {
        chapter: 'crowd',
        title: 'One route, a whole crowd',
        body: `This is why flow fields exist. ${plural(model.units.length, 'unit')} start from different cells and each asks \`route.next()\`, a simple lookup. There is **no extra search per unit**.`,
        line: 'next',
        stack: ['route.next()'],
        call: 'route.next(unit.ne, unit.se)',
        returns: 'TileDelta | null',
        duration: 7000,
        interaction: SANDBOX,
      },
      { crowd: 1 },
    );
  }

  const chapters = CHAPTERS.flatMap(chapter => {
    const first = steps.findIndex(step => step.chapter === chapter.id);
    return first >= 0 ? [{ ...chapter, first }] : [];
  });
  return { model, steps: assignSides(steps), chapters };
}

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

export interface CellInspection {
  readonly cell: Cell;
  readonly index: number;
  readonly sector: number;
  readonly local: Cell;
  readonly localIndex: number;
  readonly cost: number;
  /** Integrated cost, when a visible field has reached the cell. */
  readonly integrated: number | null;
  readonly integrationFlags: number | null;
  /** Flow byte, when the cell's direction is visible. */
  readonly flow: number | null;
  /** The direction units leave this cell in; null where they follow no arrow, as on the goal. */
  readonly direction: number | null;
}

/** Everything the current scene knows about one cell. */
export function inspectCell(model: GuideModel, scene: Scene, cell: Cell): CellInspection {
  const sector = model.grid.getSectorAt(cell.ne, cell.se)!;
  const local = { ne: cell.ne % SECTOR_SIZE, se: cell.se % SECTOR_SIZE };
  const localIndex = local.ne + local.se * SECTOR_SIZE;
  let integrated: number | null = null;
  let integrationFlags: number | null = null;
  let flow: number | null = null;
  let direction: number | null = null;

  for (let i = model.fields.length - 1; i >= 0; i--) {
    const field = model.fields[i]!;
    const writes = Math.floor(scene.fieldWrites[i] ?? 0);
    if (field.sector !== sector.getId() || writes <= 0) {
      continue;
    }
    const state = replayField(field.writes, writes, SECTOR_SIZE);
    if (state.costs[localIndex] === INTEGRATED_COST_UNREACHABLE) {
      continue;
    }
    integrated = state.costs[localIndex]!;
    integrationFlags = state.flags[localIndex]!;
    if ((scene.fieldFlow[i] ?? 0) > localIndex) {
      flow = field.flow[localIndex]!;
      const atGoal = field.kind === 'target' && (flow & FLOW_TARGET_MASK) !== 0;
      direction = !atGoal && (flow & FLOW_PATHABLE_MASK) !== 0 ? flow & FLOW_DIR_MASK : null;
    }
    break;
  }

  return {
    cell,
    index: cell.ne + cell.se * COLS,
    sector: sector.getId(),
    local,
    localIndex,
    cost: model.scenario.costs[cell.ne + cell.se * COLS]!,
    integrated,
    integrationFlags,
    flow,
    direction,
  };
}
