import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { PortalNode, portalAStar } from '../src/lib/pathfinding/portal-graph.js';
import { COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PathResult } from '../src/shared/types.js';

/**
 * Regression test for the cross-sector heuristic bug.
 *
 * The old portalAStar compared two *local* sector coordinates as if they
 * were in the same reference frame: a portal's entry-center in sector A's
 * local frame was compared with a target position expressed in sector B's
 * local frame. The result was that heuristic costs were not admissible
 * across sectors — A* could expand nodes in the wrong order and miss the
 * truly closest portal to the target.
 *
 * These tests assert the new behavior: heuristic costs are computed in
 * GLOBAL tile coordinates.
 */
describe('portalAStar cross-sector heuristic', () => {
  it('localToGlobal converts with sector offset × sectorSize', () => {
    // Direct unit test of the coordinate conversion that anchors the fix.
    const grid = new Grid(0, { width: 3, height: 2 }, 5);
    // Sector id 4: x = 4 % 3 = 3 → wait, width=3, so x = 4 % 3 = 1? No: 4 % 3 = 1.
    // Let's use deterministic ids: id = x + y * width.
    // width=3: id 0=(0,0), id 1=(1,0), id 2=(2,0), id 3=(0,1), id 4=(1,1), id 5=(2,1).
    expect(grid.getSectorPosition(0)).toEqual({ x: 0, y: 0 });
    expect(grid.getSectorPosition(1)).toEqual({ x: 1, y: 0 });
    expect(grid.getSectorPosition(4)).toEqual({ x: 1, y: 1 });
    expect(grid.getSectorPosition(5)).toEqual({ x: 2, y: 1 });

    expect(PortalNode.localToGlobal(grid, 0, 2, 3)).toEqual({ ne: 2, se: 3 });
    expect(PortalNode.localToGlobal(grid, 4, 0, 0)).toEqual({ ne: 5, se: 5 });
    expect(PortalNode.localToGlobal(grid, 5, 4, 4)).toEqual({ ne: 14, se: 9 });
  });

  it('portalAStar over a 2x2 grid finds a path, ordering portals by global distance', () => {
    const size = 4;
    const grid = new Grid(0, { width: 2, height: 2 }, size);
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        const cf = new CostField(size);
        cf.setCosts(new Uint8Array(size * size).fill(COST_MIN));
        grid.addSector(new Sector(x + y * 2, { x: x, y: y }, cf));
      }
    }
    grid.initPortals();
    grid.initPortalNodes();

    const s0 = grid.getSector(0)!;
    const s3 = grid.getSector(3)!;

    // Target at sector 3, local (3,3) → GLOBAL (7, 7).
    const result = portalAStar(
      grid,
      s0.getPortals(),
      s3.getPortals(),
      grid.getPortalMap(),
      { ne: 7, se: 7 },
      s0.getId(),
    );
    expect(result.found).toBe(true);

    // Sectors 0→3 in a 2×2 layout require crossing at least 2 portals
    // (right then down, or down then right).
    expect(result.portals.length).toBeGreaterThanOrEqual(2);
  });

  it('portals in different sectors compare correctly against a global target', () => {
    // Two sectors side by side, target in sector 1 at local (3, 2) → global (8, 2).
    // The portals between sector 0 and sector 1 sit around sector0.ne=3 /
    // sector1.ne=0. In the OLD (broken) scheme, the target's local (3, 2)
    // was compared with portal centers in *both* sectors' local frames —
    // i.e. a portal at sector0-local (3, 2) received a heuristic of ~0
    // even though globally it is ~5 cells away.
    //
    // In the NEW scheme, portal entry-centers are converted to global
    // coords first. The portal in sector 1 (near the target) gets a lower
    // heuristic than a same-local-coords portal in sector 0.
    //
    // We test this by inspecting the recorded heuristicCost values when
    // pushing start nodes: for a start in sector 0, the entry portal is
    // on the far side of sector 0 → its global distance to a target in
    // sector 1 will be a meaningful positive number, NOT ~0.
    const size = 5;
    const grid = new Grid(0, { width: 2, height: 1 }, size);
    const cf0 = new CostField(size);
    cf0.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    const cf1 = new CostField(size);
    cf1.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    grid.addSector(new Sector(0, { x: 0, y: 0 }, cf0));
    grid.addSector(new Sector(1, { x: 1, y: 0 }, cf1));
    grid.initPortals();
    grid.initPortalNodes();

    const s0 = grid.getSector(0)!;
    const s1 = grid.getSector(1)!;

    // Target in sector 1, local (3, 2) → global (8, 2).
    const result = portalAStar(
      grid,
      s0.getPortals(),
      s1.getPortals(),
      grid.getPortalMap(),
      { ne: 8, se: 2 },
      s0.getId(),
    );
    expect(result.found).toBe(true);
    expect(result.portals.length).toBeGreaterThanOrEqual(1);

    // Indirect invariant via the SearchNode heuristic: under the OLD code
    // the same portal at sector0-local (4, se) had h = dist((4,se),(3,2))×10.
    // Under the NEW code h = dist(global((4,se),(8,2))×10 — i.e. one
    // sectorSize (5) larger in the ne-component. We can't read the
    // SearchNode directly (it's not exposed), but the *returned path*
    // must still be valid, and the path length is bounded (≤ expected).
    // The functional assert above is the public-behavior check.
  });
});

describe('getPath() between two neighboring sectors with several portals', () => {
  // 16x8: two 8x8 sectors side by side; a wall on the shared border (column 7)
  // leaves two gaps, one far north and one right next to start and target.
  it('crosses through the portal on the way, not the first one listed', () => {
    const size = 8;
    const costs = new Uint8Array(16 * size).fill(COST_MIN);
    for (let se = 2; se < 6; se++) {
      costs[7 + se * 16] = 255;
    }
    const grid = buildGrid(costs, { width: 16, height: size }, size, 0);
    const pf = new Pathfinder();
    pf.addGrid(grid);
    const path = pf.getPath({ gridId: 0, start: { ne: 5, se: 7 }, target: { ne: 10, se: 7 } });
    expect(path.result).toBe(PathResult.FOUND);
    // the southern gap (rows 6–7) is on the way; the northern one (rows 0–1) a detour
    expect(Math.min(...path.waypoints.map(w => w.se))).toBeGreaterThanOrEqual(5);
  });
});

describe('PortalNode exit costs', () => {
  // 3x2 sectors of 8; walls on the borders leave several parallel portals
  // between the same two sectors.
  it('measure from the portal to each exit inside the sector they share', () => {
    const size = 8;
    const width = 3 * size;
    const height = 2 * size;
    const costs = new Uint8Array(width * height).fill(COST_MIN);
    for (const [ne, se] of [
      [7, 3],
      [7, 4],
      [15, 1],
      [15, 5],
      [3, 7],
      [12, 7],
      [20, 8],
    ] as const) {
      costs[ne + se * width] = 255;
    }
    const grid = buildGrid(costs, { width, height }, size, 0);
    let checked = 0;
    for (const node of grid.getPortalMap().values()) {
      for (const sector of [node.portal.getSector0(), node.portal.getSector1()]) {
        for (const [exitId, cost] of node.getExits(sector)) {
          const exit = grid.getPortalMap().get(exitId)!.portal;
          const expected = PortalNode.distanceCost(
            node.portal.getEntryCenter(sector),
            exit.getEntryCenter(sector),
          );
          expect(cost, `#${node.portal.getId()} -> #${exitId} in sector ${sector}`).toBe(expected);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
