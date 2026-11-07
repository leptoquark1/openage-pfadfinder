import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

/** Pixel centre of a cell. */
function px(cell: number): number {
  return cell * CELL_SIZE + CELL_SIZE / 2;
}

/** Run planning ticks without moving anything (dt = 0). */
function plan(world: World, fromTick: number, ticks: number): number {
  for (let i = 0; i < ticks; i++) {
    world.step(0, (fromTick + i) * 100);
  }
  return fromTick + ticks;
}

function traceEndsAtTarget(world: World, mobIndex: number): boolean {
  const mob = world.getMobs()[mobIndex]!;
  const target = world.getTarget()!;
  const last = mob.trace[mob.trace.length - 1];
  return !mob.blocked && last !== undefined && last.ne === target.ne && last.se === target.se;
}

describe('flow fields stay current', () => {
  it('re-routes untouched sectors when a target move and a cell change share a tick', () => {
    const world = new World();
    world.resize(32, 32);
    world.setTargetAt(px(28), px(28));
    world.addMob(px(2), px(2));
    let tick = plan(world, 1, 3);
    expect(traceEndsAtTarget(world, 0)).toBe(true);

    // A wall far from both the mob and the new target, then a target move —
    // both land in the same planning tick.
    world.paintWall(px(28), px(4));
    expect(world.setTargetAt(px(4), px(28))).toBe(true);
    tick = plan(world, tick, 1);

    expect(traceEndsAtTarget(world, 0)).toBe(true);
  });

  it('traces a freshly spawned mob on the next tick while the round-robin cursor is mid-cycle', () => {
    const world = new World();
    world.resize(40, 40);
    world.setTargetAt(px(30), px(20));
    // One mob per cell: addMob rejects occupied cells.
    for (let i = 0; i < 40; i++) {
      world.addMob(px(2 + (i % 10)), px(2 + Math.floor(i / 10)));
    }
    expect(world.getMobs().length).toBe(40);
    // 40 mobs at 12 traces per tick: after 5 ticks the cursor is mid-cycle.
    let tick = plan(world, 1, 5);

    world.addMob(px(10), px(10));
    const late = world.getMobs()[world.getMobs().length - 1]!;
    tick = plan(world, tick, 1);

    expect(late.traceVersion).toBeGreaterThanOrEqual(0);
    expect(late.trace.length).toBeGreaterThan(0);
  });

  it('does not route through a pocket of the target sector that cannot reach the target', () => {
    // 3 x 2 sectors. In sector (1,0) — cells ne 8..15, se 0..7 — a wall at
    // ne 12 and along se 7 east of it cuts off a pocket (ne 13..15) that only
    // opens towards sector (2,0). The target sits west of the wall.
    const world = new World();
    world.resize(24, 16);
    for (let se = 0; se < 8; se++) {
      world.paintWall(px(12), px(se));
    }
    for (let ne = 13; ne < 16; ne++) {
      world.paintWall(px(ne), px(7));
    }
    expect(world.setTargetAt(px(9), px(3))).toBe(true);
    world.addMob(px(20), px(3));
    plan(world, 1, 3);

    const mob = world.getMobs()[0]!;
    expect(mob.trace.some(c => c.ne >= 13 && c.ne <= 15 && c.se <= 6)).toBe(false);
    expect(traceEndsAtTarget(world, 0)).toBe(true);
  });

  it('pulls the target back inside, onto a free cell, when the world shrinks', () => {
    const world = new World();
    world.resize(64, 64);
    // Wall on the cell the target would be clamped onto.
    world.paintWall(px(15), px(15));
    expect(world.setTargetAt(px(60), px(60))).toBe(true);
    world.addMob(px(2), px(2));
    plan(world, 1, 2);

    world.resize(16, 16);
    const target = world.getTarget()!;
    expect(target.ne).toBeLessThan(16);
    expect(target.se).toBeLessThan(16);
    expect(target.ne === 15 && target.se === 15).toBe(false);

    plan(world, 3, 3);
    expect(traceEndsAtTarget(world, 0)).toBe(true);
  });
});
