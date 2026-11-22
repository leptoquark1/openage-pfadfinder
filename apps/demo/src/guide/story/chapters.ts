export type ChapterId =
  | 'memory'
  | 'sectors'
  | 'portals'
  | 'areas'
  | 'graph'
  | 'request'
  | 'search'
  | 'target'
  | 'transit'
  | 'route'
  | 'crowd';

export interface Chapter {
  readonly id: ChapterId;
  readonly title: string;
  readonly part: 'Build the grid' | 'Find the path';
}

export const CHAPTERS: readonly Chapter[] = [
  { id: 'memory', title: 'Cost map', part: 'Build the grid' },
  { id: 'sectors', title: 'Sectors', part: 'Build the grid' },
  { id: 'portals', title: 'Portals', part: 'Build the grid' },
  { id: 'areas', title: 'Areas & exits', part: 'Build the grid' },
  { id: 'graph', title: 'Portal graph', part: 'Build the grid' },
  { id: 'request', title: 'Path request', part: 'Find the path' },
  { id: 'search', title: 'Portal A*', part: 'Find the path' },
  { id: 'target', title: 'Target field', part: 'Find the path' },
  { id: 'transit', title: 'Portal fields', part: 'Find the path' },
  { id: 'route', title: 'Route', part: 'Find the path' },
  { id: 'crowd', title: 'Crowd', part: 'Find the path' },
];
