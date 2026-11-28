import { describe, expect, it, vi } from 'vitest';
import { CrowdScene, GROUP_RANGES } from '../src/world/scene.js';
import { CELL_SIZE } from '../src/world/world.js';

const px = (cell: number) => cell * CELL_SIZE + CELL_SIZE / 2;

/** A scene the size of a 40 × 24 cell view. */
function scene(): CrowdScene {
  const s = new CrowdScene();
  s.resize(40, 24);
  s.step(0, 0); // first planning tick: grid and crowd
  return s;
}

/** Advance in 16 ms frames until `done()` or `frames`; returns the frames run. */
function run(s: CrowdScene, frames: number, done: () => boolean = () => false, from = 1000): number {
  for (let i = 0; i < frames; i++) {
    if (done()) {
      return i;
    }
    s.step(16, from + i * 16);
  }
  return frames;
}

describe('CrowdScene', () => {
  it('starts with the crossing: four groups of 30 ± 20 % from corner to opposite corner', () => {
    const s = scene();
    const groups = s.getGroups();
    expect(groups).toHaveLength(4);
    for (const g of groups) {
      expect(g.count).toBeGreaterThanOrEqual(24);
      expect(g.count).toBeLessThanOrEqual(36);
      expect(g.total).toBe(g.count);
    }
    const [nw, ne, se, sw] = groups;
    expect(nw!.start).toEqual({ ne: 2, se: 2 });
    expect(nw!.goal).toEqual(se!.start);
    expect(ne!.goal).toEqual(sw!.start);
    expect(se!.goal).toEqual(nw!.start);
    expect(ne!.start).toEqual({ ne: 37, se: 2 });
    expect(sw!.start).toEqual({ ne: 2, se: 21 });
    expect(s.getPhase()).toBe('setup');
    expect(s.statusText()).toBe(''); // nothing to say before the start
  });

  it('waits in the setup, runs after start, and ends once all groups arrived', { timeout: 60_000 }, () => {
    const s = scene();
    const mobs = s.getMobs();
    const before = mobs.map(m => ({ x: m.x, y: m.y }));
    run(s, 60);
    expect(mobs.map(m => ({ x: m.x, y: m.y }))).toEqual(before); // setup: nobody moves

    s.setSpeed(4);
    s.start();
    expect(s.getPhase()).toBe('running');
    run(s, 6000, () => s.getPhase() === 'ended');
    expect(s.getPhase()).toBe('ended');
    expect(s.getEndReason()).toBe('arrived');
    expect(s.statusText()).toContain('All groups arrived');
    for (const g of s.getGroups()) {
      expect(g.arrived).toBe(g.total);
      expect(g.finishedAt).not.toBeNull();
    }
    // they stay at their goals (no respawn): every mob near its group's goal corner
    const goals = new Map(s.getGroups().map(g => [g.id, g.goal]));
    for (const mob of mobs) {
      const goal = goals.get(mob.group)!;
      expect(Math.hypot(mob.x - px(goal.ne), mob.y - px(goal.se))).toBeLessThan(6 * CELL_SIZE);
    }
    // over: time stands still
    const t = s.getSimTime();
    run(s, 30, undefined, 200_000);
    expect(s.getSimTime()).toBe(t);
  });

  it('ends as stuck when the goals cannot be reached', () => {
    const s = scene();
    // wall the north-west quarter off: its group has no way out, the others no way in
    for (let k = 0; k < 12; k++) {
      s.paintWall(px(12), px(k));
      s.paintWall(px(k), px(12));
    }
    s.paintWall(px(12), px(12));
    run(s, 10);
    s.setSpeed(4);
    s.start();
    run(s, 6000, () => s.getPhase() === 'ended');
    expect(s.getPhase()).toBe('ended');
    expect(s.getEndReason()).toBe('stuck');
    expect(s.statusText()).toContain('stuck');
  });

  it('pauses, resumes, runs faster at a higher speed and restarts from the start', () => {
    const distance = (speed: number) => {
      const s = scene();
      s.setSpeed(speed);
      s.start();
      const mob = s.getMobs()[0]!;
      const x0 = mob.x;
      const y0 = mob.y;
      run(s, 60);
      return { s, mob, moved: Math.hypot(mob.x - x0, mob.y - y0), x0, y0 };
    };
    const slow = distance(1);
    const fast = distance(2);
    expect(fast.moved).toBeGreaterThan(slow.moved * 1.5);
    expect(fast.s.getSimTime()).toBeCloseTo(slow.s.getSimTime() * 2, 1);

    const { s, mob, x0, y0 } = slow;
    s.pause();
    expect(s.getPhase()).toBe('paused');
    const at = { x: mob.x, y: mob.y };
    const t = s.getSimTime();
    run(s, 30, undefined, 5000);
    expect({ x: mob.x, y: mob.y }).toEqual(at);
    expect(s.getSimTime()).toBe(t);
    expect(s.statusText()).toContain('Paused');
    s.resume();
    run(s, 10, undefined, 6000);
    expect(s.getSimTime()).toBeGreaterThan(t);

    s.restart();
    expect(s.getPhase()).toBe('running');
    expect(s.getSimTime()).toBe(0);
    const first = s.getMobs()[0]!;
    expect(Math.hypot(first.x - x0, first.y - y0)).toBeLessThan(1);
    expect(s.getSpeed()).toBe(1);
  });

  it('holds a group back for its delay', () => {
    const s = scene();
    const [first, second] = s.getGroups();
    s.updateGroup(second!.id, { delay: 2 });
    s.start();
    run(s, 30); // 0.5 s
    const groups = s.getGroups();
    expect(groups.find(g => g.id === first!.id)!.released).toBe(true);
    expect(groups.find(g => g.id === second!.id)!.released).toBe(false);
    const waiting = s.getMobs().filter(m => m.group === second!.id);
    // waiting: they only shuffle apart to their personal space, they do not walk off
    expect(waiting.every(m => Math.hypot(m.x - m.spawnX, m.y - m.spawnY) < CELL_SIZE / 2)).toBe(true);
    run(s, 120, undefined, 3000); // past 2 s
    expect(s.getGroups().find(g => g.id === second!.id)!.released).toBe(true);
  });

  it('edits groups: size, start and goal by tool, added and removed groups, no single mobs', () => {
    const s = scene();
    const id = s.getGroups()[0]!.id;
    s.selectGroup(id);
    s.updateGroup(id, { count: 10 });
    expect(s.getGroups()[0]!.total).toBe(10);
    s.updateGroup(id, { count: 999, speed: -1 }); // clamped
    expect(s.getGroups()[0]!.count).toBe(GROUP_RANGES.count.max);
    expect(s.getGroups()[0]!.speed).toBe(GROUP_RANGES.speed.min);
    s.updateGroup(id, { count: 8 });

    expect(s.setStartAt(px(10), px(10))).toBe(true);
    expect(s.getGroups()[0]!.start).toEqual({ ne: 10, se: 10 });
    expect(s.setTargetAt(px(20), px(12))).toBe(true);
    expect(s.getGroups()[0]!.goal).toEqual({ ne: 20, se: 12 });
    s.paintWall(px(5), px(5));
    expect(s.setTargetAt(px(5), px(5))).toBe(false);
    // mobs come from the groups only: no single mobs placed or removed
    expect(s.canPlaceMob(px(15), px(15))).toBe(false);
    s.addMob(px(15), px(15));
    expect(s.getGroups()[0]!.total).toBe(8);
    const mob = s.getMobs()[0]!;
    expect(s.mobAt(mob.x, mob.y)).toBeNull();
    s.removeMob(mob.x, mob.y);
    expect(s.getMobs()).toContain(mob);

    const added = s.addGroup();
    expect(s.getGroups()).toHaveLength(5);
    expect(s.getSelectedGroup()).toBe(added);
    expect(s.colorOf(added)).toMatch(/^#/);
    s.removeGroup(added);
    expect(s.getGroups()).toHaveLength(4);
    expect(s.getMobs().some(m => m.group === added)).toBe(false);
  });

  it('reports changes that wait for a restart, and applies them with it', () => {
    const s = scene();
    const [a, b] = s.getGroups();
    s.updateGroup(a!.id, { count: 10 });
    expect(s.hasPendingChanges()).toBe(false); // before the start: placed at once
    s.start();
    run(s, 10);
    s.updateGroup(a!.id, { name: 'Renamed', goal: { ne: 20, se: 2 } });
    expect(s.hasPendingChanges()).toBe(false); // name and goal apply at once
    s.updateGroup(a!.id, { count: 12 });
    expect(s.hasPendingChanges()).toBe(true);
    s.updateGroup(a!.id, { count: 10 });
    expect(s.hasPendingChanges()).toBe(false); // back to what was placed
    s.updateGroup(b!.id, { delay: 3 });
    expect(s.hasPendingChanges()).toBe(true);
    s.restart();
    expect(s.hasPendingChanges()).toBe(false);
    expect(s.getGroups().find(g => g.id === a!.id)!.total).toBe(10);

    s.addGroup(); // no mobs until the restart
    expect(s.hasPendingChanges()).toBe(true);
    s.removeGroup(s.getSelectedGroup()); // gone at once
    expect(s.hasPendingChanges()).toBe(false);
  });

  it('changes a goal during the run at once', () => {
    const s = scene();
    const g = s.getGroups()[0]!;
    s.start();
    run(s, 20);
    s.updateGroup(g.id, { goal: { ne: 20, se: 2 } });
    run(s, 30, undefined, 3000);
    const mob = s.getMobs().find(m => m.group === g.id)!;
    expect(mob.trace.at(-1)).toEqual({ ne: 20, se: 2 });
  });

  it('sends groups under way to their goal again when a smaller view moves it', () => {
    const s = scene();
    s.start();
    run(s, 20);
    const before = new Map(s.getGroups().map(g => [g.id, g.goal]));
    const resent = new Set<number>();
    const send = vi
      .spyOn(s as unknown as { sendToTarget(mob: { group: number }): void }, 'sendToTarget')
      .mockImplementation(mob => {
        resent.add(mob.group);
      });
    s.resize(30, 18); // the east and south corners move inside
    send.mockRestore();
    const moved = s.getGroups().filter(g => {
      const prev = before.get(g.id)!;
      return prev.ne !== g.goal.ne || prev.se !== g.goal.se;
    });
    expect(moved.length).toBeGreaterThan(0);
    for (const g of moved) {
      expect(resent.has(g.id)).toBe(true);
    }
  });

  it('cannot start without mobs and resets to the crossing', () => {
    const s = scene();
    for (const g of s.getGroups()) {
      s.removeGroup(g.id);
    }
    expect(s.statusText()).toContain('Add a group');
    s.start();
    expect(s.getPhase()).toBe('setup');
    s.reset();
    expect(s.getGroups()).toHaveLength(4);
  });
});
