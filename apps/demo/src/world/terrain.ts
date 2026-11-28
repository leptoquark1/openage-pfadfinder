/** A ground type: walkable like free ground, but each cell costs more to cross. */
export interface Terrain {
  readonly id: TerrainId;
  readonly label: string;
  /** Cost of one cell, between `COST_MIN` and `COST_MAX`. */
  readonly cost: number;
}

export type TerrainId = 'sand' | 'forest' | 'mud' | 'swamp';

/** The terrains the playground can paint, from cheapest to most expensive. */
export const TERRAINS: readonly Terrain[] = [
  { id: 'sand', label: 'Sand', cost: 3 },
  { id: 'forest', label: 'Forest', cost: 5 },
  { id: 'mud', label: 'Mud', cost: 7 },
  { id: 'swamp', label: 'Swamp', cost: 12 },
];

/** The terrain with the given id. */
export function terrainById(id: TerrainId): Terrain {
  return TERRAINS.find(t => t.id === id)!;
}

/** The terrain with the given cell cost, or null for free ground. */
export function terrainByCost(cost: number): Terrain | null {
  return TERRAINS.find(t => t.cost === cost) ?? null;
}
