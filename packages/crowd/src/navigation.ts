import { COST_IMPASSABLE, type Grid, type Sector, type SectorId } from '@leptoquark1/openage-pfadfinder';
import type { NavigationView } from './context.js';

/**
 * `NavigationView` over a pathfinder grid. Reads the sectors' live cost
 * arrays directly, so cost changes (terrain or congestion) show up at once
 * and a lookup allocates nothing.
 */
export class GridNavigation implements NavigationView {
  readonly width: number;
  readonly height: number;
  readonly sectorSize: number;
  private readonly sectorsX: number;
  private readonly sectors: (Sector | undefined)[];
  private readonly costs: (Uint8Array | undefined)[];

  constructor(grid: Grid) {
    const size = grid.getSize();
    this.sectorSize = grid.getSectorSize();
    this.sectorsX = size.width;
    this.width = size.width * this.sectorSize;
    this.height = size.height * this.sectorSize;
    this.sectors = [];
    this.costs = [];
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const sector = grid.getSector(x, y);
        this.sectors.push(sector);
        this.costs.push(sector?.getCostField().getCosts());
      }
    }
  }

  isBlocked(ne: number, se: number): boolean {
    return this.cost(ne, se) === COST_IMPASSABLE;
  }

  cost(ne: number, se: number): number {
    if (ne < 0 || se < 0 || ne >= this.width || se >= this.height) {
      return COST_IMPASSABLE;
    }
    const s = this.sectorSize;
    const sx = Math.floor(ne / s);
    const sy = Math.floor(se / s);
    const costs = this.costs[sx + sy * this.sectorsX];
    return costs ? costs[ne - sx * s + (se - sy * s) * s]! : COST_IMPASSABLE;
  }

  sectorAt(ne: number, se: number): SectorId {
    return this.sectorObjectAt(ne, se)?.getId() ?? -1;
  }

  /** The sector holding a cell, undefined outside the map. */
  sectorObjectAt(ne: number, se: number): Sector | undefined {
    if (ne < 0 || se < 0 || ne >= this.width || se >= this.height) {
      return undefined;
    }
    const s = this.sectorSize;
    return this.sectors[Math.floor(ne / s) + Math.floor(se / s) * this.sectorsX];
  }

  /** All sectors, row by row. */
  allSectors(): readonly (Sector | undefined)[] {
    return this.sectors;
  }
}
