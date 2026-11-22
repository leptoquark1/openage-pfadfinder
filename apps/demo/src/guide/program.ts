export type LineKey =
  | 'alloc'
  | 'paint'
  | 'grid'
  | 'field'
  | 'addSector'
  | 'initPortals'
  | 'initNodes'
  | 'pathfinder'
  | 'addGrid'
  | 'getRoute'
  | 'walk'
  | 'next';

/** The program the guide walks through, with the lines its steps point at. */
const SOURCE: readonly (readonly [string, LineKey?])[] = [
  ['import { CostField, Grid, Pathfinder, Sector,'],
  ["         COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder';"],
  [''],
  ['// 1 · One flat cost array, row-major'],
  ['const costs = new Uint8Array(24 * 18).fill(COST_MIN);', 'alloc'],
  ['costs[ne + se * 24] = COST_IMPASSABLE;', 'paint'],
  [''],
  ['// 2 · Slice it into sectors (or just call buildGrid)'],
  ['const grid = new Grid(0, { width: 4, height: 3 }, 6);', 'grid'],
  ['for (let y = 0, id = 0; y < 3; y++) {'],
  ['  for (let x = 0; x < 4; x++, id++) {'],
  ['    const field = new CostField(6);'],
  ['    field.setCosts(sliceSector(costs, x, y));', 'field'],
  ['    grid.addSector(new Sector(id, { x, y }, field));', 'addSector'],
  ['  }'],
  ['}'],
  [''],
  ['// 3 · Connect the sectors'],
  ['grid.initPortals();', 'initPortals'],
  ['grid.initPortalNodes();', 'initNodes'],
  [''],
  ['// 4 · Ask for a route'],
  ['const pathfinder = new Pathfinder();', 'pathfinder'],
  ['pathfinder.addGrid(grid);', 'addGrid'],
  ['const route = pathfinder.getFlowRoute({ gridId: 0, start, target });', 'getRoute'],
  [''],
  ['// 5 · Follow it'],
  ['const path = route.walk(start);', 'walk'],
  ['const nextCell = route.next(unit.ne, unit.se);', 'next'],
];

export const PROGRAM: readonly string[] = SOURCE.map(([text]) => text);

export const LINE_OF = Object.fromEntries(
  SOURCE.flatMap(([, key], line) => (key ? [[key, line] as const] : [])),
) as Record<LineKey, number>;

export type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'type' | 'call';

export interface Token {
  readonly text: string;
  readonly kind: TokenKind;
}

const TOKEN =
  /(\/\/.*$)|('[^']*')|\b(import|from|const|let|new|for|return)\b|\b(\d+)\b|\b([A-Z][A-Za-z0-9_]*)\b|\b([a-z][A-Za-z0-9]*)(?=\()/g;

/** A small highlighter for the snippets shown in the guide. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (const match of line.matchAll(TOKEN)) {
    if (match.index > at) {
      tokens.push({ text: line.slice(at, match.index), kind: 'plain' });
    }
    const kind: TokenKind = match[1]
      ? 'comment'
      : match[2]
        ? 'string'
        : match[3]
          ? 'keyword'
          : match[4]
            ? 'number'
            : match[5]
              ? 'type'
              : 'call';
    tokens.push({ text: match[0], kind });
    at = match.index + match[0].length;
  }
  if (at < line.length) {
    tokens.push({ text: line.slice(at), kind: 'plain' });
  }
  return tokens;
}
