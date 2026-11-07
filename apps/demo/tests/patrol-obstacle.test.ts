import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

describe('patrol obstacle', () => {
  it('pendles between both endpoints and turns around at each', () => {
    const world = new World();
    world.resize(24, 16);

    const ax = 2 * CELL_SIZE + 16;
    const ay = 2 * CELL_SIZE + 16;
    const bx = 14 * CELL_SIZE + 16;
    const by = 8 * CELL_SIZE + 16;

    expect(world.addPatrolObstacle(ax, ay)).toBe(false); // first click only anchors
    expect(world.getPatrolAnchor()).toEqual({ x: ax, y: ay });
    expect(world.addPatrolObstacle(bx, by)).toBe(true); // second click spawns
    expect(world.getPatrolAnchor()).toBeNull();

    const obstacle = world.getObstacles()[0]!;
    const route = obstacle.patrol!;
    expect(route).toEqual({ ax, ay, bx, by });

    // Far enough past the round trip that the obstacle must have turned.
    // 50 ms frames at OBSTACLE_SPEED move it ~2 px, the route is ~430 px.
    const oneWayMs = (Math.hypot(bx - ax, by - ay) / obstacle.speed) * 1000;
    let sawAtB = false;
    let sawAtA = false;
    for (let i = 0; i < 1000 && !(sawAtB && sawAtA); i++) {
      world.step(50, i * 50);
      if (Math.hypot(obstacle.x - bx, obstacle.y - by) < 2) {
        sawAtB = true;
      }
      if (Math.hypot(obstacle.x - ax, obstacle.y - ay) < 2) {
        sawAtA = true;
      }
    }
    expect(oneWayMs).toBeGreaterThan(0);
    expect(sawAtB).toBe(true);
    expect(sawAtA).toBe(true);
  });

  it('blocks placement on the cells it covers while patrolling', () => {
    const world = new World();
    world.resize(24, 16);

    const ax = 2 * CELL_SIZE + 16;
    const ay = 2 * CELL_SIZE + 16;
    const bx = 14 * CELL_SIZE + 16;
    const by = 2 * CELL_SIZE + 16;
    world.addPatrolObstacle(ax, ay);
    world.addPatrolObstacle(bx, by);

    // Sitting on endpoint A: its covered cells reject placements (the
    // predicate behind the green/red placement preview).
    expect(world.canPlaceWall(ax, ay)).toBe(false);
    // Away from the obstacle the same check passes.
    expect(world.canPlaceWall(12 * CELL_SIZE + 16, 12 * CELL_SIZE + 16)).toBe(true);

    // Once it has patrolled far from A, the cells there are free again.
    let leftAnchor = false;
    for (let i = 0; i < 120 && !leftAnchor; i++) {
      world.step(50, i * 50);
      if (world.canPlaceWall(ax, ay)) {
        leftAnchor = true;
      }
    }
    expect(leftAnchor).toBe(true);
  });

  it('rejects endpoints on another obstacle and cancels the anchor on demand', () => {
    const world = new World();
    world.resize(24, 16);

    const ax = 4 * CELL_SIZE + 16;
    const ay = 4 * CELL_SIZE + 16;
    world.addMovingObstacle(ax, ay);

    // Same spot as the existing obstacle: rejected, and the anchor survives.
    expect(world.canPlacePatrolObstacle(ax, ay)).toBe(false);
    world.addPatrolObstacle(ax, ay);
    expect(world.getPatrolAnchor()).toBeNull();

    // A valid spot anchors, cancel clears it again.
    const bx = 10 * CELL_SIZE + 16;
    const by = 10 * CELL_SIZE + 16;
    world.addPatrolObstacle(bx, by);
    expect(world.getPatrolAnchor()).toEqual({ x: bx, y: by });
    world.cancelPatrolAnchor();
    expect(world.getPatrolAnchor()).toBeNull();
    expect(world.getObstacles().length).toBe(1);
  });

  it('clamps its route into the world on resize', () => {
    const world = new World();
    world.resize(64, 64);

    const ax = 50 * CELL_SIZE + 16;
    const ay = 50 * CELL_SIZE + 16;
    const bx = 60 * CELL_SIZE + 16;
    const by = 60 * CELL_SIZE + 16;
    world.addPatrolObstacle(ax, ay);
    world.addPatrolObstacle(bx, by);

    world.resize(16, 16);
    const worldW = world.getCols() * CELL_SIZE;
    const worldH = world.getRows() * CELL_SIZE;
    const route = world.getObstacles()[0]!.patrol!;
    expect(route.bx).toBeLessThanOrEqual(worldW);
    expect(route.by).toBeLessThanOrEqual(worldH);

    // The clamped route must still run without leaving the world.
    for (let i = 0; i < 200; i++) {
      world.step(50, i * 50);
      const o = world.getObstacles()[0]!;
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThanOrEqual(worldW);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThanOrEqual(worldH);
    }
  });
});
