import {
  COST_IMPASSABLE,
  COST_MIN,
  INTEGRATE_LOS_MASK,
  Integrator,
  Pathfinder,
  PathResult,
  portalAStar,
} from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { layoutGuide, makeView } from '../src/guide/layout.js';
import { buildModel } from '../src/guide/model/model.js';
import { replayField } from '../src/guide/observe.js';
import { Player } from '../src/guide/player.js';
import { LINE_OF, PROGRAM, tokenize } from '../src/guide/program.js';
import {
  type Cell,
  COLS,
  COST_MUD,
  ROWS,
  SCENARIOS,
  type Scenario,
  SECTOR_SIZE,
  withCost,
  withPin,
} from '../src/guide/scenarios.js';
import { buildTimeline } from '../src/guide/story/timeline.js';
import { mixScene } from '../src/guide/story/scene.js';

/** Deterministic random maps, so a failure can be reproduced. */
function randomScenario(seed: number): Scenario {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const costs = new Uint8Array(COLS * ROWS).fill(COST_MIN);
  for (let i = 0; i < costs.length; i++) {
    const roll = random();
    costs[i] = roll < 0.22 ? COST_IMPASSABLE : roll < 0.32 ? COST_MUD : COST_MIN;
  }
  const free = (): Cell => {
    while (true) {
      const cell = { ne: Math.floor(random() * COLS), se: Math.floor(random() * ROWS) };
      if (costs[cell.ne + cell.se * COLS] !== COST_IMPASSABLE) {
        return cell;
      }
    }
  };
  const start = free();
  let target = free();
  while (target.ne === start.ne && target.se === start.se) {
    target = free();
  }
  return { id: `random-${seed}`, name: 'Random', hint: '', watch: 'search', costs, start, target };
}

const scenarios: readonly Scenario[] = [...SCENARIOS, ...Array.from({ length: 40 }, (_, i) => randomScenario(i + 1))];

describe('guide: recorded data matches the real library', () => {
  it.each(scenarios.map(s => [s.id, s] as const))('%s', (_id, scenario) => {
    const model = buildModel(scenario);
    const request = { gridId: 0, start: scenario.start, target: scenario.target };

    // Waypoints are the library's own result.
    const pathfinder = new Pathfinder();
    pathfinder.addGrid(model.grid);
    expect(pathfinder.getPath(request).result).toBe(model.path.result);

    // The observed search returns what an unobserved search returns.
    if (model.search) {
      const byId = (id: number) => model.grid.getPortalMap().get(id)!.portal;
      const real = portalAStar(
        model.grid,
        model.startPortals.map(byId),
        model.targetPortals.map(byId),
        model.grid.getPortalMap(),
        scenario.target,
        model.startSector,
        scenario.start,
      );
      expect(model.search.chain).toEqual(real.portals.map(p => p.getId()));
      expect(model.search.found).toBe(real.found);
      for (const node of model.grid.getPortalMap().values()) {
        expect(node.search).toBeUndefined();
      }
    }

    // Replaying the recorded writes gives the fields the integrator computes.
    const integrator = new Integrator();
    const steps = model.route?.getSteps() ?? [];
    for (const field of model.fields) {
      const replayed = replayField(field.writes, field.writes.length, SECTOR_SIZE);
      const sector = model.grid.getSector(field.sector)!;
      if (field.kind === 'target') {
        const local = model.grid.globalToLocal(scenario.target.ne, scenario.target.se);
        const real = integrator.get(sector.getCostField(), { ne: local.localNe, se: local.localSe });
        expect([...replayed.costs]).toEqual([...real.integrationField.getCosts()]);
        expect([...replayed.flags]).toEqual([...real.integrationField.getFlagsArray()]);
        expect([...field.flow]).toEqual([...real.flowField.getCells()]);
      } else {
        const portal = model.grid.getPortalMap().get(field.portal!)!.portal;
        const next = model.grid.getSector(field.nextSector!)!;
        const real = integrator.getPortalShared(
          sector.getCostField(),
          integrator.get(next.getCostField(), { ne: 0, se: 0 }).integrationField,
          next.getId(),
          portal,
          { ne: 0, se: 0 },
        );
        expect([...replayed.costs]).toEqual([...real.integrationField.getCosts()]);
        expect([...replayed.flags]).toEqual([...real.integrationField.getFlagsArray()]);
        expect([...field.flow]).toEqual([...real.flowField.getCells()]);
      }
    }
    expect(model.fields.length).toBe(steps.length);

    // Border scans find exactly the portals the grid created, in id order.
    const scanned = model.edges.flatMap(edge => edge.portalIds);
    expect(scanned).toEqual([...model.portals.keys()].sort((a, b) => a - b));
    for (const edge of model.edges) {
      const runs = edge.pairs.filter((pair, i) => pair.open && !edge.pairs[i - 1]?.open).length;
      expect(edge.portalIds.length).toBe(runs);
    }

    // Every unit of the crowd arrives on passable cells.
    for (const unit of model.units) {
      expect(unit.cells.at(-1)).toEqual(scenario.target);
      for (const cell of unit.cells) {
        expect(scenario.costs[cell.ne + cell.se * COLS]).not.toBe(COST_IMPASSABLE);
      }
    }
  });
});

describe('guide: scenarios', () => {
  const outcome = (id: string) => buildModel(SCENARIOS.find(s => s.id === id)!);

  it('finds a route on every map except the sealed one', () => {
    for (const scenario of SCENARIOS) {
      const expected = scenario.id === 'sealed' ? PathResult.NOT_FOUND : PathResult.FOUND;
      expect(buildModel(scenario).path.result, scenario.id).toBe(expected);
    }
  });

  it('leaves and re-enters the split sector', () => {
    const ids = outcome('split').routeSectors;
    expect(ids[0]).toBe(ids.at(-1));
    expect(ids.length).toBeGreaterThan(2);
  });

  it('does not change a cell under a pin, and keeps pins off walls', () => {
    const base = SCENARIOS[0]!;
    expect(withCost(base, base.start, COST_IMPASSABLE)).toBe(base);
    const wall = { ne: 6, se: 1 };
    expect(base.costs[wall.ne + wall.se * COLS]).toBe(COST_IMPASSABLE);
    expect(withPin(base, 'target', wall)).toBe(base);
    expect(withPin(base, 'target', base.start)).toBe(base);
  });
});

describe('guide: map explanations', () => {
  const scenarioOf = (id: string) => SCENARIOS.find(s => s.id === id)!;

  it('points every map at a chapter it reaches', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.hint).not.toBe('');
      expect(buildTimeline(scenario).chapters.map(c => c.id)).toContain(scenario.watch);
    }
  });

  it('swamp: the route wades through mud although a dry way exists', () => {
    const scenario = scenarioOf('swamp');
    const model = buildModel(scenario);
    expect(model.waypoints.some(w => scenario.costs[w.ne + w.se * COLS] === COST_MUD)).toBe(true);

    const seen = new Set([scenario.start.ne + scenario.start.se * COLS]);
    const open: Cell[] = [scenario.start];
    while (open.length > 0) {
      const { ne, se } = open.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = { ne: ne + dx, se: se + dy };
        const at = next.ne + next.se * COLS;
        if (
          next.ne >= 0 &&
          next.se >= 0 &&
          next.ne < COLS &&
          next.se < ROWS &&
          !seen.has(at) &&
          scenario.costs[at] === COST_MIN
        ) {
          seen.add(at);
          open.push(next);
        }
      }
    }
    expect(seen.has(scenario.target.ne + scenario.target.se * COLS)).toBe(true);
  });

  it('labyrinth: most sectors split into areas and the route doubles back', () => {
    const model = buildModel(scenarioOf('maze'));
    expect(model.sectors.filter(s => s.areaCount > 1).length).toBeGreaterThan(model.sectors.length / 2);
    expect(new Set(model.routeSectors).size).toBeLessThan(model.routeSectors.length);
    expect(model.portals.size).toBeGreaterThan(buildModel(scenarioOf('open')).portals.size);
  });

  it('open field: line of sight alone fills the target sector', () => {
    const field = buildModel(scenarioOf('open')).fields[0]!;
    expect(field.losWrites).toBe(field.writes.length);
    const { flags } = replayField(field.writes, field.writes.length, SECTOR_SIZE);
    expect([...flags].every(flag => (flag & INTEGRATE_LOS_MASK) !== 0)).toBe(true);
  });
});

describe('guide: timeline', () => {
  it.each(scenarios.map(s => [s.id, s] as const))('%s has a complete, reversible story', (_id, scenario) => {
    const { steps, chapters, model } = buildTimeline(scenario);
    expect(steps.length).toBeGreaterThan(0);
    expect(chapters[0]!.first).toBe(0);
    for (const step of steps) {
      expect(step.duration).toBeGreaterThan(0);
      expect(step.title).not.toBe('');
      expect(LINE_OF[step.line]).toBeGreaterThanOrEqual(0);
    }

    const last = steps.at(-1)!.scene;
    expect(last.slices).toBe(model.sectors.length);
    expect(last.edges).toBe(model.edges.length);
    if (model.search) {
      expect(last.astar).toBe(model.search.events.length);
    }
    model.fields.forEach((field, i) => {
      expect(last.fieldWrites[i]).toBe(field.writes.length);
    });

    // A scene halfway lies between its neighbours and ends exactly on them.
    const from = steps[0]!.scene;
    const to = last;
    expect(mixScene(from, to, 0).slices).toBe(from.slices);
    expect(mixScene(from, to, 1).slices).toBe(to.slices);
    expect(mixScene(from, to, 0.5).slices).toBe((from.slices + to.slices) / 2);
  });

  it('skips the search when start and target share an area', () => {
    const base = SCENARIOS.find(s => s.id === 'open')!;
    const near = withPin(base, 'target', { ne: base.start.ne + 1, se: base.start.se });
    const { chapters, model } = buildTimeline(near);
    expect(model.sameArea).toBe(true);
    expect(chapters.map(c => c.id)).not.toContain('search');
    expect(chapters.map(c => c.id)).toContain('target');
  });

  it('ends at the search when no route exists', () => {
    const { steps, model } = buildTimeline(SCENARIOS.find(s => s.id === 'sealed')!);
    expect(model.route).toBeNull();
    expect(steps.at(-1)!.chapter).toBe('search');
  });
});

describe('guide: floating layout', () => {
  const sizes = [
    [1920, 1080],
    [1600, 950],
    [1280, 720],
    [1024, 768],
  ] as const;

  it.each(scenarios.map(s => [s.id, s] as const))('%s keeps the card on screen and off the map', (_id, scenario) => {
    const { steps } = buildTimeline(scenario);
    for (const [width, height] of sizes) {
      for (const step of steps) {
        const { card, insets } = layoutGuide(width, height, step.side, step.focus, step.scene.camera, 320);
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(width);
        expect(card.y).toBeGreaterThanOrEqual(0);
        expect(card.y + Math.min(320, card.maxHeight)).toBeLessThanOrEqual(height);

        const view = makeView(width, height, step.scene.camera, insets);
        const mapLeft = view.ox + step.scene.camera.x * view.s;
        const mapRight = mapLeft + step.scene.camera.w * view.s;
        expect(card.x >= mapRight - 0.01 || card.x + card.width <= mapLeft + 0.01).toBe(true);
      }
    }
  });

  it('stacks the card below the map on a narrow screen', () => {
    const step = buildTimeline(SCENARIOS[0]!).steps[0]!;
    const { card, insets } = layoutGuide(390, 844, step.side, step.focus, step.scene.camera, 300);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    expect(card.y).toBeGreaterThanOrEqual(844 - insets.bottom);
  });

  it('keeps the side while the camera holds still within a chapter', () => {
    for (const scenario of scenarios) {
      const { steps } = buildTimeline(scenario);
      steps.forEach((step, i) => {
        const before = steps[i - 1];
        if (before?.chapter === step.chapter && before.scene.camera === step.scene.camera) {
          expect(step.side).toBe(before.side);
        }
      });
    }
  });
});

describe('guide: contextual interface', () => {
  const stepsOf = (id: string) => buildTimeline(SCENARIOS.find(s => s.id === id)!).steps;

  it('offers no tools while the map is being built', () => {
    const steps = stepsOf('fortress');
    for (const chapter of ['sectors', 'portals', 'areas', 'search'] as const) {
      for (const step of steps.filter(s => s.chapter === chapter)) {
        expect(step.interaction?.tools ?? []).toEqual([]);
      }
    }
    expect(steps[0]!.interaction).toBeNull();
  });

  it('offers the tools a chapter needs', () => {
    const steps = stepsOf('fortress');
    expect(steps.find(s => s.chapter === 'request')!.interaction!.tools).toEqual(['start', 'target']);
    expect(steps.at(-1)!.interaction!.tools).toContain('wall');
  });

  it('offers a way out when no route exists', () => {
    const last = stepsOf('sealed').at(-1)!;
    expect(last.title).toBe('No route exists');
    expect(last.interaction!.tools).toContain('erase');
  });
});

describe('guide: player', () => {
  const player = () => {
    const p = new Player();
    p.load([100, 100, 100, 100]);
    return p;
  };

  it('never advances on its own', () => {
    const p = player();
    p.tick(100_000);
    expect([p.index, p.t]).toEqual([0, 1]);
    p.stepForward();
    p.tick(100_000);
    expect([p.index, p.t]).toEqual([1, 1]);
  });

  it('animates the step it moved to', () => {
    const p = player();
    p.stepForward();
    expect([p.index, p.t]).toEqual([1, 0]);
    p.tick(50);
    expect(p.t).toBeCloseTo(0.5);
  });

  it('moves on at once while a step is still animating', () => {
    const p = player();
    p.stepForward();
    p.tick(10);
    p.stepForward();
    expect([p.index, p.t]).toEqual([2, 0]);
  });

  it('finishes the last step instead of running past it', () => {
    const p = player();
    p.seek(3);
    expect([p.index, p.t]).toEqual([3, 0]);
    p.stepForward();
    expect([p.index, p.t]).toEqual([3, 1]);
  });

  it('animates a jump forward and shows a jump back finished', () => {
    const p = player();
    p.seek(2);
    expect([p.index, p.t]).toEqual([2, 0]);
    p.seek(1);
    expect([p.index, p.t]).toEqual([1, 1]);
  });

  it('undoes a step, also in the middle of its animation', () => {
    const p = player();
    p.seek(2);
    p.stepBack();
    expect([p.index, p.t]).toEqual([1, 1]);
    p.stepForward();
    p.tick(50);
    p.stepBack();
    expect([p.index, p.t]).toEqual([1, 1]);
    p.seek(0);
    p.stepBack();
    expect([p.index, p.t]).toEqual([0, 1]);
  });

  it('notifies when the position changes, not on animation frames', () => {
    const p = player();
    let notified = 0;
    p.subscribe(() => notified++);
    p.stepForward();
    expect(notified).toBe(1);
    p.tick(10);
    p.tick(1000);
    expect(notified).toBe(1);
  });
});

describe('guide: program listing', () => {
  it('points every key at a line of code', () => {
    for (const line of Object.values(LINE_OF)) {
      expect(PROGRAM[line]!.trim()).not.toBe('');
    }
  });

  it('tokenizes without losing text', () => {
    for (const line of PROGRAM) {
      expect(
        tokenize(line)
          .map(t => t.text)
          .join(''),
      ).toBe(line);
    }
  });
});
