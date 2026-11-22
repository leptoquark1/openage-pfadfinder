import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder';
import type { GuideModel } from '../model/types.js';
import { COLS, COST_MUD, ROWS, SECTOR_SIZE, SECTORS_X, SECTORS_Y } from '../scenarios.js';
import { FULL } from './scene.js';
import { borderBox, GRAPH_HOVER, PAINT, plural, portalList, sectorBox, type Story } from './writer.js';

/** From the flat cost map to the finished portal graph. */
export function addBuildSteps(story: Story, model: GuideModel): void {
  const { sectors, edges, portals, graphEdges } = model;
  const { start, costs } = model.scenario;

  // --- Cost map ---------------------------------------------------------
  let walls = 0;
  let mud = 0;
  for (const cost of costs) {
    if (cost === COST_IMPASSABLE) {
      walls++;
    } else if (cost > 1) {
      mud++;
    }
  }
  story.add(
    {
      chapter: 'memory',
      title: 'A map is just bytes',
      body: `The whole map starts as one flat \`Uint8Array\` with ${COLS * ROWS} entries, one byte of movement cost per cell. There is no 2D structure yet.`,
      line: 'alloc',
      call: `new Uint8Array(${COLS} * ${ROWS})`,
      returns: `Uint8Array(${COLS * ROWS})`,
      duration: 3200,
    },
    {},
  );
  story.add(
    {
      chapter: 'memory',
      title: 'Folding it into rows',
      body: `Every ${COLS} bytes form a row. A cell's index is \`ne + se × ${COLS}\`, so \`ne\` walks east and \`se\` walks south. This row-major layout is used on every level of the library.`,
      line: 'paint',
      call: 'costs[ne + se * 24]',
      returns: `(${start.ne}, ${start.se}) → index ${start.ne + start.se * COLS}`,
      duration: 3600,
    },
    { fold: 1, camera: FULL },
  );
  story.add(
    {
      chapter: 'memory',
      title: 'What a byte means',
      body: `\`1\` is normal ground, up to \`254\` is passable but expensive, and \`255\` blocks movement. This map has ${plural(walls, 'wall')} and ${mud} mud cells (cost ${COST_MUD}).`,
      line: 'paint',
      call: 'costs[idx] = COST_IMPASSABLE',
      returns: `${walls} × 255 · ${mud} × ${COST_MUD} · ${COLS * ROWS - walls - mud} × 1`,
      duration: 2800,
      interaction: PAINT,
    },
    {},
  );

  // --- Sectors ----------------------------------------------------------
  story.add(
    {
      chapter: 'sectors',
      title: 'Cutting the map into sectors',
      body: `A \`Grid\` divides the map into ${SECTORS_X} × ${SECTORS_Y} square sectors of ${SECTOR_SIZE} × ${SECTOR_SIZE} cells. Later, each search only has to think about sectors, not about all ${COLS * ROWS} cells.`,
      line: 'grid',
      call: `new Grid(0, { width: ${SECTORS_X}, height: ${SECTORS_Y} }, ${SECTOR_SIZE})`,
      returns: 'Grid',
      duration: 2800,
    },
    { frames: 1 },
  );
  for (const sector of sectors) {
    story.add(
      {
        chapter: 'sectors',
        title: `Sector ${sector.id} at (${sector.x}, ${sector.y})`,
        body: `It copies cells \`ne ${sector.ne}–${sector.ne + SECTOR_SIZE - 1}\`, \`se ${sector.se}–${sector.se + SECTOR_SIZE - 1}\` into its own \`CostField\`. From here on it uses local coordinates, 0 to ${SECTOR_SIZE - 1}. Ids must be row-major: \`id = x + y × ${SECTORS_X}\`.`,
        line: 'addSector',
        call: `grid.addSector(new Sector(${sector.id}, { x: ${sector.x}, y: ${sector.y} }, field))`,
        returns: 'void',
        duration: 620,
        focus: sectorBox(sector),
      },
      { slices: sector.id + 1, slicing: sector.id },
    );
  }

  // --- Portals ----------------------------------------------------------
  story.add(
    {
      chapter: 'portals',
      title: 'Looking for gates',
      body: 'Sectors are still isolated. `initPortals()` walks every shared border. Wherever cells on **both** sides are passable, consecutive cells form one portal.',
      line: 'initPortals',
      stack: ['grid.initPortals()'],
      call: 'grid.initPortals()',
      returns: `${portals.size} portals`,
      duration: 2600,
    },
    {},
  );
  edges.forEach((edge, i) => {
    const direction = edge.northSouth ? 'NORTH_SOUTH' : 'EAST_WEST';
    const blocked = edge.pairs.filter(pair => !pair.open).length;
    story.add(
      {
        chapter: 'portals',
        title: `Border S${edge.a} ${edge.northSouth ? '↓' : '→'} S${edge.b}`,
        body:
          edge.portalIds.length === 0
            ? 'Every pair of cells along this border is blocked, so these sectors have no direct connection.'
            : `${SECTOR_SIZE - blocked} of ${SECTOR_SIZE} cell pairs are open. They form ${plural(edge.portalIds.length, 'portal')}: ${portalList(edge.portalIds)}.`,
        line: 'initPortals',
        stack: ['grid.initPortals()', 'sector.findPortals()'],
        call: `sector${edge.a}.findPortals(sector${edge.b}, PortalDirection.${direction}, allocateId)`,
        returns: `[${portalList(edge.portalIds)}]`,
        duration: 900,
        focus: borderBox(sectors[edge.a]!, edge.northSouth),
      },
      { edges: i + 1, scanning: i },
    );
  });

  // --- Areas ------------------------------------------------------------
  story.add(
    {
      chapter: 'areas',
      title: 'Which gates can reach each other?',
      body: 'Two portals of a sector are only connected if you can walk between them. A flood fill labels the connected **areas** of each sector. `initPortals()` does this right after handling a sector’s borders.',
      line: 'initPortals',
      stack: ['grid.initPortals()', 'sector.connectExits()'],
      call: 'sector.connectExits()',
      returns: 'void',
      duration: 2600,
    },
    {},
  );
  for (const sector of sectors) {
    story.add(
      {
        chapter: 'areas',
        title: `Sector ${sector.id}: ${plural(sector.areaCount, 'area')}`,
        body:
          sector.areaCount > 1
            ? `Walls split this sector. Portals only become exits of each other inside the same area, which is what keeps routes from walking through walls.`
            : `All passable cells are connected, so its ${plural(sector.portalIds.length, 'portal')} (${portalList(sector.portalIds)}) can all reach each other.`,
        line: 'initPortals',
        stack: ['grid.initPortals()', 'sector.connectExits()', 'sector.getAreas()'],
        call: `sector${sector.id}.getAreas()`,
        returns: `${plural(sector.areaCount, 'area')}`,
        duration: 760,
        focus: sectorBox(sector),
      },
      { areas: sector.id + 1, labelling: sector.id },
    );
  }

  // --- Portal graph -----------------------------------------------------
  story.add(
    {
      chapter: 'graph',
      title: 'The map becomes a graph',
      body: `Each portal becomes a \`PortalNode\`. Each edge stores the distance between two portal centers, as \`round(distance × 10)\`. ${COLS * ROWS} cells are now ${portals.size} nodes and ${graphEdges.length} edges.`,
      line: 'initNodes',
      stack: ['grid.initPortalNodes()', 'node.initExits()'],
      call: 'grid.initPortalNodes()',
      returns: `Map(${portals.size}) of PortalNode`,
      duration: 3400,
      interaction: GRAPH_HOVER,
    },
    { graph: 1 },
  );
}
