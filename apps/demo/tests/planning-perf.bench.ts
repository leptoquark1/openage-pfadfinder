import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

// This is a timing-sensitive regression test. It is named `.bench.ts` so it is
// excluded from the default `pnpm test` run (parallel workers and loaded CI
// machines make the absolute ms budgets flaky). Run it on demand with:
//   pnpm test:perf
describe('planning performance', () => {
  it('keeps the incremental planning tick far below the frame budget', () => {
    const cols = 256;
    const rows = 160;
    const world = new World();
    world.resize(cols, rows);
    world.setTargetAt((cols - 2) * CELL_SIZE, (rows - 2) * CELL_SIZE);
    for (let i = 0; i < 12; i++) {
      world.addMovingObstacle(((10 + i * 7) % cols) * CELL_SIZE + 16, ((10 + i * 5) % rows) * CELL_SIZE + 16);
    }

    // Warm-up: first build plus enough ticks that the perf window (120
    // planning-tick samples) only covers steady state afterwards.
    for (let i = 0; i < 600; i++) {
      world.step(16, i * 16);
    }

    const perf = world.getPerf();
    // Steady state: obstacles move every frame, planning ticks run at 10 Hz.
    for (let i = 600; i < 1200; i++) {
      world.step(16, i * 16);
    }

    const snapshot = perf.snapshot();
    const phases = new Map(snapshot.phases.map(([name, entry]) => [name, entry]));
    const grid = phases.get('Grid');
    const flow = phases.get('Flow');
    console.log('Grid avg/max:', grid?.avg.toFixed(3), '/', grid?.max.toFixed(3));
    console.log('Flow avg/max:', flow?.avg.toFixed(3), '/', flow?.max.toFixed(3));

    // Baseline (full rebuild per tick): Grid ~12.7 ms, Flow ~14 ms — over
    // the 16.7 ms frame budget together. Incremental must land well below;
    // Flow keeps the portal-route Dijkstra, so its budget is looser.
    expect(grid!.avg).toBeGreaterThan(0);
    expect(grid!.avg).toBeLessThan(4);
    expect(flow!.avg).toBeLessThan(10);
  }, 120000);
});
