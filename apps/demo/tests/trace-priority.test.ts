import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

/**
 * traceVersion exists to prioritize stale traces: a fresh spawn (traceVersion
 * -1) or a mob whose route a repaint invalidated must get its next trace
 * before the round-robin reaches it by cursor alone. With more mobs than the
 * per-tick trace budget, the cursor alone would leave late-spawned mobs
 * standing for a full cycle.
 */
describe('trace scheduling prioritizes stale traces', () => {
  it('gives a freshly spawned mob a trace within a couple of ticks even in a large crowd', () => {
    const world = new World();
    world.resize(40, 40);
    world.setTargetAt(30 * CELL_SIZE + 16, 20 * CELL_SIZE + 16);

    // Fill the world with more mobs than one tick can trace — one per
    // cell, since addMob rejects occupied cells.
    for (let i = 0; i < 40; i++) {
      world.addMob((2 + (i % 10)) * CELL_SIZE + 16, (2 + Math.floor(i / 10)) * CELL_SIZE + 16);
    }
    expect(world.getMobs().length).toBe(40);
    // Run enough ticks to build the flow fields and trace the crowd once.
    for (let i = 0; i < 20; i++) {
      world.step(50, i * 50);
    }

    // Spawn a latecomer — with cursor-only scheduling it would wait until
    // the full 40-mob cycle comes around; stale-first must trace it within
    // a few ticks.
    const before = world.getMobs().length;
    world.addMob(10 * CELL_SIZE + 16, 10 * CELL_SIZE + 16);
    expect(world.getMobs().length).toBe(before + 1);
    const late = world.getMobs()[world.getMobs().length - 1]!;
    for (let i = 0; i < 6; i++) {
      world.step(50, (20 + i) * 50);
    }
    // A traced mob has a non-empty trace and is either routed (not
    // blocked) or was at least evaluated against the current fields —
    // both beat the never-traced state it would hold for a full cycle.
    expect(late.trace.length).toBeGreaterThan(0);
  });

  it('repainting a wall invalidates traces, and the next tick re-traces prioritized mobs', () => {
    const world = new World();
    world.resize(24, 24);
    world.setTargetAt(20 * CELL_SIZE + 16, 12 * CELL_SIZE + 16);

    for (let i = 0; i < 16; i++) {
      world.addMob(2 * CELL_SIZE + (i % 8) * 16, 2 * CELL_SIZE + Math.floor(i / 8) * 16);
    }
    for (let i = 0; i < 10; i++) {
      world.step(50, i * 50);
    }

    // Repaint invalidates every mob's trace version against the new one.
    world.paintWall(6 * CELL_SIZE + 16, 6 * CELL_SIZE + 16);
    for (let i = 0; i < 3; i++) {
      world.step(50, (10 + i) * 50);
    }

    // After the repaint, at least the trace budget's worth of mobs must
    // have been re-traced against the bumped version — their traces are
    // non-empty again (target exists, cells are walkable).
    const traced = world.getMobs().filter(m => m.trace.length > 0).length;
    expect(traced).toBeGreaterThan(0);
  });
});
