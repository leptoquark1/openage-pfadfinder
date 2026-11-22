import { INTEGRATED_COST_UNREACHABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { flowDirection } from '../model/fields.js';
import type { GuideModel } from '../model/types.js';
import { replayField } from '../observe.js';
import { type Cell, COLS, SECTOR_SIZE } from '../scenarios.js';
import type { Scene } from './scene.js';

export interface CellInspection {
  readonly cell: Cell;
  readonly index: number;
  readonly sector: number;
  readonly local: Cell;
  readonly localIndex: number;
  readonly cost: number;
  /** Integrated cost, when a visible field has reached the cell. */
  readonly integrated: number | null;
  readonly integrationFlags: number | null;
  /** Flow byte, when the cell's direction is visible. */
  readonly flow: number | null;
  /** The direction units leave this cell in; null where they follow no arrow, as on the goal. */
  readonly direction: number | null;
}

/** Everything the current scene knows about one cell. */
export function inspectCell(model: GuideModel, scene: Scene, cell: Cell): CellInspection {
  const sector = model.grid.getSectorAt(cell.ne, cell.se)!;
  const local = { ne: cell.ne % SECTOR_SIZE, se: cell.se % SECTOR_SIZE };
  const localIndex = local.ne + local.se * SECTOR_SIZE;
  let integrated: number | null = null;
  let integrationFlags: number | null = null;
  let flow: number | null = null;
  let direction: number | null = null;

  for (let i = model.fields.length - 1; i >= 0; i--) {
    const field = model.fields[i]!;
    const writes = Math.floor(scene.fieldWrites[i] ?? 0);
    if (field.sector !== sector.getId() || writes <= 0) {
      continue;
    }
    const state = replayField(field.writes, writes, SECTOR_SIZE);
    if (state.costs[localIndex] === INTEGRATED_COST_UNREACHABLE) {
      continue;
    }
    integrated = state.costs[localIndex]!;
    integrationFlags = state.flags[localIndex]!;
    if ((scene.fieldFlow[i] ?? 0) > localIndex) {
      flow = field.flow[localIndex]!;
      direction = flowDirection(field, flow);
    }
    break;
  }

  return {
    cell,
    index: cell.ne + cell.se * COLS,
    sector: sector.getId(),
    local,
    localIndex,
    cost: model.scenario.costs[cell.ne + cell.se * COLS]!,
    integrated,
    integrationFlags,
    flow,
    direction,
  };
}
