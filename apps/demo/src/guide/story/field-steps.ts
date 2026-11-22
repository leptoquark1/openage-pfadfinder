import { PathResult } from '@leptoquark1/openage-pfadfinder/shared';
import type { FieldTrace, GuideModel } from '../model/types.js';
import { SECTOR_SIZE } from '../scenarios.js';
import { FULL } from './scene.js';
import { BYTES, cellText, focus, plural, pulses, SANDBOX, type Story } from './writer.js';

/** The flow fields of a found route, the walk along them and the crowd. */
export function addFieldSteps(story: Story, model: GuideModel): void {
  const { sectors, fields } = model;
  const { start } = model.scenario;

  // --- Fields -----------------------------------------------------------
  if (model.route) {
    const sectorOf = (field: FieldTrace) => sectors[field.sector]!;
    const setAt = (values: readonly number[], index: number, value: number) =>
      values.map((v, i) => (i === index ? value : v));
    const size = SECTOR_SIZE * SECTOR_SIZE;

    const targetField = fields[0]!;
    const targetSector = sectorOf(targetField);
    const stack = ['pathfinder.getFlowRoute()', 'integrator.getTargetShared()'];
    story.add(
      {
        chapter: 'target',
        title: 'Zooming into the target sector',
        body: 'The last sector gets the best treatment: a full integration towards the exact target cell. A new `IntegrationField` starts with every cell at `65535`, meaning “not reached”.',
        line: 'getRoute',
        stack,
        call: 'new IntegrationField(6)',
        returns: 'IntegrationField',
        duration: 2600,
        interaction: BYTES,
      },
      { camera: focus(targetSector), graph: 0.18 },
    );

    const losStops = pulses(0, targetField.losWrites, 6);
    losStops.forEach((stop, i) => {
      story.add(
        {
          chapter: 'target',
          title: `Line-of-sight wave ${i + 1}/${losStops.length}`,
          body:
            i === 0
              ? 'A wave spreads from the target. Cells it reaches on open ground **see** the target directly and are marked `LOS`.'
              : 'When the wave hits a wall or expensive ground, Bresenham lines from the obstacle’s corners cast a **shadow**. Shadow cells are marked `WAVEFRONT_BLOCKED`.',
          line: 'getRoute',
          stack: [...stack, 'integrateLos()'],
          call: 'field.integrateLos(costField, target)',
          returns: `${stop} of ${targetField.losWrites} writes`,
          duration: 1100,
          interaction: BYTES,
        },
        { fieldWrites: setAt(story.scene.fieldWrites, 0, stop) },
      );
    });

    const costStops = pulses(targetField.losWrites, targetField.writes.length, 4);
    costStops.forEach((stop, i) => {
      story.add(
        {
          chapter: 'target',
          title: `Cost wave ${i + 1}/${costStops.length}`,
          body: 'From the shadow’s edge, costs spread to the 4 neighbors and add up the terrain. A cell is revisited whenever a cheaper value arrives, so it ends with its true distance around obstacles.',
          line: 'getRoute',
          stack: [...stack, 'integrateCostFromWavefront()'],
          call: 'field.integrateCostFromWavefront(costField, blocked)',
          returns: `${stop} of ${targetField.writes.length} writes`,
          duration: 1100,
          interaction: BYTES,
        },
        { fieldWrites: setAt(story.scene.fieldWrites, 0, stop) },
      );
    });

    story.add(
      {
        chapter: 'target',
        title: 'From costs to directions',
        body: 'Each cell now looks at its 8 neighbors and points to the cheapest one. Diagonals only count if both adjacent cells are reachable, so units never cut a corner. One byte stores direction and flags.',
        line: 'getRoute',
        stack: [...stack, 'flowField.build()'],
        call: 'flowField.build(integrationField)',
        returns: 'FlowField',
        duration: 2800,
        interaction: BYTES,
      },
      { fieldFlow: setAt(story.scene.fieldFlow, 0, size) },
    );

    // --- Portal fields ----------------------------------------------------
    fields.forEach((field, index) => {
      if (field.kind !== 'portal') {
        return;
      }
      const sector = sectorOf(field);
      const stackPortal = ['pathfinder.getFlowRoute()', 'integrator.getPortalShared()'];
      story.add(
        {
          chapter: 'transit',
          title: `Sector ${field.sector}: heading for P${field.portal}`,
          body:
            index === 1
              ? `Working **back to front**. All cells of the portal towards sector ${field.nextSector} start at cost \`0\`. This field does not depend on the final target, so every route through this portal can share it from the cache.`
              : `All cells of P${field.portal} start at cost \`0\`, then the cost wave fills the sector. No line of sight here, and no costs carried over from the next sector.`,
          line: 'getRoute',
          stack: [...stackPortal, 'integrateCostPortal()'],
          call: `field.integrateCostPortal(costField, ${field.nextSector}, portal${field.portal})`,
          returns: `${field.writes.length} writes`,
          duration: index === 1 ? 2800 : 1500,
          interaction: BYTES,
        },
        { camera: focus(sector), fieldWrites: setAt(story.scene.fieldWrites, index, field.writes.length) },
      );
      story.add(
        {
          chapter: 'transit',
          title: `Sector ${field.sector}: flow towards S${field.nextSector}`,
          body: `The portal’s cells get a fixed direction **out** of the sector, into sector ${field.nextSector}. That hand-over is the only link between two fields of a route.`,
          line: 'getRoute',
          stack: [...stackPortal, 'flowField.buildPortal()'],
          call: `flowField.buildPortal(field, next, ${field.nextSector}, portal${field.portal})`,
          returns: 'FlowField',
          duration: 1300,
          interaction: BYTES,
        },
        { fieldFlow: setAt(story.scene.fieldFlow, index, size) },
      );
    });

    // --- Route ------------------------------------------------------------
    story.add(
      {
        chapter: 'route',
        title: 'The finished FlowRoute',
        body: `${plural(model.routeSectors.length, 'sector')} with one flow field each: ${model.routeSectors.map(id => `S${id}`).join(' → ')}. Together they answer “where next?” for **any** cell on the route.`,
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()'],
        call: 'route.getSectorIds()',
        returns: `[${model.routeSectors.join(', ')}]`,
        duration: 2800,
        interaction: BYTES,
      },
      { camera: FULL, route: 1, graph: 0, chain: 0 },
    );
    if (model.path.result === PathResult.FOUND) {
      story.add(
        {
          chapter: 'route',
          title: 'Walking the fields',
          body: `\`walk()\` follows the arrows cell by cell and keeps a waypoint at every change of direction. Once a cell sees the target over a clear line, it goes straight there. Result: ${plural(model.waypoints.length, 'waypoint')}.`,
          line: 'walk',
          stack: ['route.walk()'],
          call: `route.walk(${cellText(start)})`,
          returns: `Path { FOUND, ${plural(model.waypoints.length, 'waypoint')} }`,
          duration: 4200,
          interaction: BYTES,
        },
        { walk: 1 },
      );
    }

    // --- Crowd ------------------------------------------------------------
    story.add(
      {
        chapter: 'crowd',
        title: 'One route, a whole crowd',
        body: `This is why flow fields exist. ${plural(model.units.length, 'unit')} start from different cells and each asks \`route.next()\`, a simple lookup. There is **no extra search per unit**.`,
        line: 'next',
        stack: ['route.next()'],
        call: 'route.next(unit.ne, unit.se)',
        returns: 'TileDelta | null',
        duration: 7000,
        interaction: SANDBOX,
      },
      { crowd: 1 },
    );
  }
}
