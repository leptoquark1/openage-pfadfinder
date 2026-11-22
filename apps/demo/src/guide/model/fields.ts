import type { FlowRoute, Grid, Portal } from '@leptoquark1/openage-pfadfinder';
import {
  FLOW_DIR_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
  INTEGRATED_COST_UNREACHABLE,
} from '@leptoquark1/openage-pfadfinder/shared';
import { observeField } from '../observe.js';
import { type Scenario, SECTOR_SIZE } from '../scenarios.js';
import type { FieldTrace } from './types.js';

type FlowStep = ReturnType<FlowRoute['getSteps']>[number];
type FieldStages = Parameters<typeof observeField>[2];

/** The direction units leave a cell in; null where they follow no arrow, as on the target field's goal. */
export function flowDirection(field: FieldTrace, byte: number): number | null {
  const atGoal = field.kind === 'target' && (byte & FLOW_TARGET_MASK) !== 0;
  return !atGoal && (byte & FLOW_PATHABLE_MASK) !== 0 ? byte & FLOW_DIR_MASK : null;
}

/** Records one step's field; `exit` is the portal it leads to, and null for the target field. */
function traceField(
  step: FlowStep,
  exit: { readonly portal: Portal; readonly nextSector: number } | null,
  stages: FieldStages,
): FieldTrace {
  const { writes, stageEnds } = observeField(step.sector.getCostField().getCosts(), SECTOR_SIZE, stages);
  return {
    kind: exit ? 'portal' : 'target',
    sector: step.sector.getId(),
    portal: exit?.portal.getId() ?? null,
    nextSector: exit?.nextSector ?? null,
    writes,
    losWrites: exit ? 0 : stageEnds[0]!,
    maxCost: writes.reduce((max, w) => (w.cost < INTEGRATED_COST_UNREACHABLE ? Math.max(max, w.cost) : max), 1),
    flow: step.flowField.getCells(),
  };
}

export function buildFields(grid: Grid, scenario: Scenario, route: FlowRoute, chain: readonly Portal[]): FieldTrace[] {
  const steps = route.getSteps();
  const { localNe, localSe } = grid.globalToLocal(scenario.target.ne, scenario.target.se);

  let blocked: number[] = [];
  const fields = [
    traceField(steps[steps.length - 1]!, null, [
      (costField, field) => {
        blocked = field.integrateLos(costField, { ne: localNe, se: localSe });
      },
      (costField, field) => field.integrateCostFromWavefront(costField, blocked),
    ]),
  ];

  for (let i = chain.length - 1; i >= 0; i--) {
    const portal = chain[i]!;
    const nextSector = steps[i + 1]!.sector.getId();
    fields.push(
      traceField(steps[i]!, { portal, nextSector }, [
        (costField, field) => field.integrateCostPortal(costField, nextSector, portal),
      ]),
    );
  }
  return fields;
}
