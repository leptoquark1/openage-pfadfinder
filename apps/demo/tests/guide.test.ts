import { Integrator, Pathfinder, portalAStar } from '@leptoquark1/openage-pfadfinder';
import { COST_IMPASSABLE, COST_MIN, PathResult } from '@leptoquark1/openage-pfadfinder/shared';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/guide/model.js';
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
import { buildTimeline, mixScene } from '../src/guide/timeline.js';

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
  return { id: `random-${seed}`, name: 'Random', hint: '', costs, start, target };
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

describe('guide: player', () => {
  const player = () => {
    const p = new Player();
    p.load([100, 100, 100, 100]);
    return p;
  };

  it('plays through the steps and stops at the end', () => {
    const p = player();
    p.play();
    expect(p.index).toBe(1);
    p.tick(50);
    expect(p.t).toBeCloseTo(0.5);
    p.tick(1000);
    expect(p.index).toBe(3);
    expect(p.t).toBe(1);
    expect(p.playing).toBe(false);
  });

  it('pauses mid-step and keeps the position', () => {
    const p = player();
    p.play();
    p.tick(30);
    p.pause();
    p.tick(500);
    expect(p.index).toBe(1);
    expect(p.t).toBeCloseTo(0.3);
  });

  it('steps forward one animation at a time', () => {
    const p = player();
    p.stepForward();
    expect([p.index, p.t]).toEqual([1, 0]);
    p.tick(1000);
    expect([p.index, p.t]).toEqual([1, 1]);
  });

  it('finishes a running animation before moving on', () => {
    const p = player();
    p.stepForward();
    p.tick(10);
    p.stepForward();
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

  it('restarts when played at the end', () => {
    const p = player();
    p.seek(3);
    p.play();
    expect([p.index, p.t, p.playing]).toEqual([0, 0, true]);
  });

  it('restarts on the first step, so it gets its full time on screen', () => {
    const p = player();
    p.seek(2);
    p.restart();
    expect([p.index, p.t, p.playing]).toEqual([0, 0, true]);
    p.tick(50);
    expect([p.index, p.t]).toEqual([0, 0.5]);
  });

  it('only notifies on discrete changes while playing', () => {
    const p = player();
    let notified = 0;
    p.subscribe(() => notified++);
    p.restart();
    notified = 0;
    p.tick(10);
    p.tick(10);
    expect(notified).toBe(0);
    p.tick(100);
    expect(notified).toBe(1);
  });

  it('applies the speed', () => {
    const p = player();
    p.setSpeed(4);
    p.play();
    p.tick(10);
    expect(p.t).toBeCloseTo(0.4);
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
