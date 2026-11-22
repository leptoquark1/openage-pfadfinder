import type { GuideModel } from '../model/types.js';
import { SECTOR_SIZE } from '../scenarios.js';
import { cellBox, cellText, PINS, plural, pointBox, portalList, type Story, UNBLOCK } from './writer.js';

/** The path request and the portal search it starts. */
export function addSearchSteps(story: Story, model: GuideModel): void {
  const { portals, search } = model;
  const { start, target } = model.scenario;

  // --- Request ----------------------------------------------------------
  const startInfo = model.grid.globalToLocal(start.ne, start.se);
  story.add(
    {
      chapter: 'request',
      title: 'A unit wants to move',
      body: `The grid is ready and never has to be rebuilt for a new request. Now we ask for a route from ${cellText(start)} to ${cellText(target)}.`,
      line: 'getRoute',
      stack: ['pathfinder.getFlowRoute()', 'planRoute()'],
      call: `pathfinder.getFlowRoute({ gridId: 0, start: ${cellText(start)}, target: ${cellText(target)} })`,
      returns: '…',
      duration: 2800,
      interaction: PINS,
    },
    { pins: 1 },
  );
  story.add(
    {
      chapter: 'request',
      title: 'From global to local',
      body: `Global ${cellText(start)} lies in sector ${model.startSector} at local \`(${startInfo.localNe}, ${startInfo.localSe})\`, which is cell index \`${startInfo.localNe + startInfo.localSe * SECTOR_SIZE}\`. The target lies in sector ${model.targetSector}.`,
      line: 'getRoute',
      stack: ['pathfinder.getFlowRoute()', 'planRoute()', 'grid.globalToLocal()'],
      call: `grid.globalToLocal(${start.ne}, ${start.se})`,
      returns: `{ sectorX: ${startInfo.sectorX}, sectorY: ${startInfo.sectorY}, localNe: ${startInfo.localNe}, localSe: ${startInfo.localSe} }`,
      duration: 3400,
      focus: cellBox(start),
      interaction: PINS,
    },
    { coords: 1 },
  );
  if (model.sameArea) {
    story.add(
      {
        chapter: 'request',
        title: 'Shortcut: same area',
        body: 'Start and target share a sector and an area. No portal search is needed, one flow field is enough.',
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()', 'planRoute()', 'getPathSingleSector()'],
        call: 'sector.getAreas()[startIdx] === sector.getAreas()[targetIdx]',
        returns: 'true',
        duration: 2800,
        focus: cellBox(start),
        interaction: PINS,
      },
      { coords: 0 },
    );
  } else {
    story.add(
      {
        chapter: 'request',
        title: 'Which gates are in reach?',
        body: `Only portals in the same area as the start or target are valid ends of the route. Start: ${portalList(model.startPortals)}. Target: ${portalList(model.targetPortals)}.`,
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()', 'getPathMultiSector()', 'portalsReachableFrom()'],
        call: 'portalsReachableFrom(sector, localNe, localSe)',
        returns: `start [${portalList(model.startPortals)}] · target [${portalList(model.targetPortals)}]`,
        duration: 3200,
        focus: cellBox(start),
        interaction: PINS,
      },
      { coords: 0, reach: 1 },
    );
  }

  // --- Portal A* --------------------------------------------------------
  if (search) {
    const stack = ['pathfinder.getFlowRoute()', 'getPathMultiSector()', 'portalAStar()'];
    const { events } = search;
    let at = 0;
    while (at < events.length && events[at]!.kind === 'seed') {
      at++;
    }
    story.add(
      {
        chapter: 'search',
        title: 'Seeding the open set',
        body: 'Each reachable start portal enters the open set with `g`, the walk from the start, and `h`, the straight-line distance to the target. The search always continues with the lowest `f = g + h`.',
        line: 'getRoute',
        stack,
        call: 'openSet.push(node, g + h)',
        returns: `${plural(at, 'node')} in the open set`,
        duration: 2800,
        event: at - 1,
        focus: cellBox(start),
      },
      { astar: at, reach: 0.35 },
    );

    let pops = 0;
    while (at < events.length) {
      const pop = events[at]!;
      let end = at + 1;
      while (end < events.length && events[end]!.kind === 'relax') {
        end++;
      }
      const relaxed = events.slice(at + 1, end);
      const added = relaxed.flatMap(e => (e.kind === 'relax' && e.outcome === 'added' ? [e.portal] : []));
      const improved = relaxed.flatMap(e => (e.kind === 'relax' && e.outcome === 'improved' ? [e.portal] : []));
      const skipped = relaxed.length - added.length - improved.length;
      const state = pop.states.find(s => s.id === pop.portal);
      const isGoal = search.found && end === events.length && pop.portal === search.chain[search.chain.length - 1];
      pops++;
      story.add(
        {
          chapter: 'search',
          title: isGoal ? `P${pop.portal} is a target portal` : `Expand P${pop.portal}`,
          body: isGoal
            ? `It has the lowest \`f\` (${state?.f ?? 0}) in the open set and touches the target’s area. The search stops after ${plural(pops, 'expansion')}.`
            : `Lowest \`f\` is ${state?.f ?? 0} (g ${state?.g ?? 0} + h ${state?.h ?? 0}). Exits: ${added.length ? `added ${portalList(added)}` : 'nothing new'}${improved.length ? `, improved ${portalList(improved)}` : ''}${skipped ? `, skipped ${skipped}` : ''}.`,
          line: 'getRoute',
          stack,
          call: 'openSet.pop()',
          returns: `P${pop.portal} · f = ${state?.f ?? 0}`,
          duration: isGoal ? 1800 : 1250,
          event: end - 1,
          focus: pointBox(portals.get(pop.portal)!.x, portals.get(pop.portal)!.y),
        },
        { astar: end },
      );
      at = end;
    }

    if (search.found) {
      story.add(
        {
          chapter: 'search',
          title: 'Backtracking the chain',
          body: `Following each node’s \`prev\` gives the portal chain: ${search.chain.map(id => `P${id}`).join(' → ')}. A* now knows **which sectors** to cross, but not yet how to move inside them.`,
          line: 'getRoute',
          stack,
          call: 'backtrace(node)',
          returns: `[${portalList(search.chain)}]`,
          duration: 3000,
          event: events.length - 1,
        },
        { chain: 1, reach: 0 },
      );
    } else {
      story.add(
        {
          chapter: 'search',
          title: 'No route exists',
          body: `The open set ran empty without reaching a target portal. \`portalAStar()\` reports${search.partial ? ' a partial chain to the closest node' : ' no chain'}, and \`Pathfinder\` answers with \`null\` because a partial route cannot be walked to the target.`,
          line: 'getRoute',
          stack,
          call: 'pathfinder.getFlowRoute(request)',
          returns: 'null · PathResult.NOT_FOUND',
          duration: 4000,
          interaction: UNBLOCK,
          event: events.length - 1,
        },
        { chain: search.partial ? 1 : 0, reach: 0 },
      );
    }
  } else if (!model.sameArea) {
    story.add(
      {
        chapter: 'search',
        title: 'No route exists',
        body: 'Start or target has no portal in its area, so there is nothing to search. `Pathfinder` answers with `null`.',
        line: 'getRoute',
        stack: ['pathfinder.getFlowRoute()', 'getPathMultiSector()'],
        call: 'pathfinder.getFlowRoute(request)',
        returns: 'null · PathResult.NOT_FOUND',
        duration: 3200,
        interaction: UNBLOCK,
      },
      { reach: 0 },
    );
  }
}
