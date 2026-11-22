import {
  CostField,
  Grid,
  Pathfinder,
  PathResult,
  type Portal,
  type PortalId,
  Sector,
} from '@leptoquark1/openage-pfadfinder';
import { observeAStar } from '../observe.js';
import { type Scenario, SECTOR_SIZE, SECTORS_X, SECTORS_Y } from '../scenarios.js';
import { spawnUnits } from './crowd.js';
import { buildFields } from './fields.js';
import { floodRanks, graphEdges, portalsReachableFrom, portalView, scanEdges, sliceSector } from './grid-views.js';
import type { GuideModel, PortalView, SearchTrace, SectorView } from './types.js';

/**
 * Build the real grid and run the real pathfinder for a scenario, recording
 * everything the guide needs to replay it.
 */
export function buildModel(scenario: Scenario): GuideModel {
  const { costs, start, target } = scenario;

  const grid = new Grid(0, { width: SECTORS_X, height: SECTORS_Y }, SECTOR_SIZE);
  for (let y = 0, id = 0; y < SECTORS_Y; y++) {
    for (let x = 0; x < SECTORS_X; x++, id++) {
      const field = new CostField(SECTOR_SIZE);
      field.setCosts(sliceSector(costs, x, y));
      grid.addSector(new Sector(id, { x, y }, field));
    }
  }
  grid.initPortals();
  grid.initPortalNodes();

  const sectors: SectorView[] = grid.getSectors().map(sector => {
    const { x, y } = sector.getPosition();
    const areas = sector.getAreas();
    const flood = floodRanks(areas);
    return {
      id: sector.getId(),
      x,
      y,
      ne: x * SECTOR_SIZE,
      se: y * SECTOR_SIZE,
      areas,
      areaCount: flood.count,
      floodRank: flood.ranks,
      floodMax: flood.max,
      portalIds: sector.getPortals().map(p => p.getId()),
    };
  });

  const portals = new Map<PortalId, PortalView>();
  for (const sector of grid.getSectors()) {
    for (const portal of sector.getPortals()) {
      if (!portals.has(portal.getId())) {
        portals.set(portal.getId(), portalView(grid, portal));
      }
    }
  }

  const pathfinder = new Pathfinder();
  pathfinder.addGrid(grid);
  const request = { gridId: 0, start, target };
  const route = pathfinder.getFlowRoute(request);
  const path = pathfinder.getPath(request);

  const startSector = grid.getSectorAt(start.ne, start.se)!;
  const targetSector = grid.getSectorAt(target.ne, target.se)!;
  const startLocal = grid.globalToLocal(start.ne, start.se);
  const targetLocal = grid.globalToLocal(target.ne, target.se);
  const startCell = { ne: startLocal.localNe, se: startLocal.localSe };
  const targetCell = { ne: targetLocal.localNe, se: targetLocal.localSe };
  const sameArea =
    startSector === targetSector &&
    startSector.getAreas()[startCell.ne + startCell.se * SECTOR_SIZE] ===
      startSector.getAreas()[targetCell.ne + targetCell.se * SECTOR_SIZE];

  const startPortals = sameArea ? [] : portalsReachableFrom(startSector, startCell);
  const targetPortals = sameArea ? [] : portalsReachableFrom(targetSector, targetCell);

  let search: SearchTrace | null = null;
  let chain: Portal[] = [];
  if (!sameArea && startPortals.length > 0 && targetPortals.length > 0) {
    const observed = observeAStar(grid, startPortals, targetPortals, target, startSector.getId(), start);
    chain = observed.result.portals;
    search = {
      events: observed.events,
      found: observed.result.found,
      partial: observed.result.partial,
      chain: chain.map(p => p.getId()),
    };
  }

  const fields = route ? buildFields(grid, scenario, route, chain) : [];

  return {
    scenario,
    grid,
    sectors,
    portals,
    edges: scanEdges(grid, costs),
    graphEdges: graphEdges(grid),
    startSector: startSector.getId(),
    targetSector: targetSector.getId(),
    sameArea,
    startPortals: startPortals.map(p => p.getId()),
    targetPortals: targetPortals.map(p => p.getId()),
    search,
    route,
    routeSectors: route?.getSectorIds() ?? [],
    fields,
    path,
    waypoints: path.result === PathResult.FOUND ? path.waypoints : [],
    units: route ? spawnUnits(scenario, route, grid) : [],
  };
}
