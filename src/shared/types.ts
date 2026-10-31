export type GridId = number;
export type SectorId = number;
export type PortalId = number;

export enum PathResult {
  FOUND = 0,
  NOT_FOUND = 1,
  OUT_OF_BOUNDS = 2,
}

export enum FlowDir {
  NORTH = 0x00,
  NORTH_EAST = 0x01,
  EAST = 0x02,
  SOUTH_EAST = 0x03,
  SOUTH = 0x04,
  SOUTH_WEST = 0x05,
  WEST = 0x06,
  NORTH_WEST = 0x07,
}

export enum PortalDirection {
  NORTH_SOUTH = 0,
  EAST_WEST = 1,
}

export interface TileDelta {
  readonly ne: number
  readonly se: number
}

export interface Tile3 {
  readonly ne: number
  readonly se: number
  readonly up: number
}

export interface PathRequest {
  readonly gridId: GridId
  readonly start: TileDelta
  readonly target: TileDelta
}

export interface Waypoint {
  readonly ne: number
  readonly se: number
}

export interface Path {
  readonly result: PathResult
  readonly waypoints: Waypoint[]
}

/** Width/height pair for grid and sector dimensions. */
export interface Size2s {
  readonly width: number
  readonly height: number
}

/** x/y pair for grid positions (e.g. a sector's position in the grid). */
export interface Vector2s {
  readonly x: number
  readonly y: number
}

export type CacheKey = string;
