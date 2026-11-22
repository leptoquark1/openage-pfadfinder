import type { FlowRoute, Grid, Portal } from '@leptoquark1/openage-pfadfinder';
import { INTEGRATED_COST_UNREACHABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { type FieldWrite, observeField } from '../observe.js';
import { type Scenario, SECTOR_SIZE } from '../scenarios.js';
import type { FieldTrace } from './types.js';

export function buildFields(grid: Grid, scenario: Scenario, route: FlowRoute, chain: readonly Portal[]): FieldTrace[] {
  const steps = route.getSteps();
  const fields: FieldTrace[] = [];
  const { localNe, localSe } = grid.globalToLocal(scenario.target.ne, scenario.target.se);
  const finite = (writes: readonly FieldWrite[]) =>
    writes.reduce((max, w) => (w.cost < INTEGRATED_COST_UNREACHABLE ? Math.max(max, w.cost) : max), 1);

  const last = steps[steps.length - 1]!;
  let blocked: number[] = [];
  const targetField = observeField(last.sector.getCostField().getCosts(), SECTOR_SIZE, [
    (costField, field) => {
      blocked = field.integrateLos(costField, { ne: localNe, se: localSe });
    },
    (costField, field) => field.integrateCostFromWavefront(costField, blocked),
  ]);
  fields.push({
    kind: 'target',
    sector: last.sector.getId(),
    portal: null,
    nextSector: null,
    writes: targetField.writes,
    losWrites: targetField.stageEnds[0]!,
    maxCost: finite(targetField.writes),
    flow: last.flowField.getCells(),
  });

  for (let i = chain.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    const portal = chain[i]!;
    const nextSector = steps[i + 1]!.sector.getId();
    const portalField = observeField(step.sector.getCostField().getCosts(), SECTOR_SIZE, [
      (costField, field) => field.integrateCostPortal(costField, nextSector, portal),
    ]);
    fields.push({
      kind: 'portal',
      sector: step.sector.getId(),
      portal: portal.getId(),
      nextSector,
      writes: portalField.writes,
      losWrites: 0,
      maxCost: finite(portalField.writes),
      flow: step.flowField.getCells(),
    });
  }
  return fields;
}
