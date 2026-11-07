import { type Path, PathResult, type Waypoint } from '../../shared/types.js';

export function makePath(result: PathResult, waypoints: Waypoint[] = []): Path {
  return { result, waypoints };
}

export function pathFound(waypoints: Waypoint[]): Path {
  return { result: PathResult.FOUND, waypoints };
}

export function pathNotFound(): Path {
  return { result: PathResult.NOT_FOUND, waypoints: [] };
}

export function pathOutOfBounds(): Path {
  return { result: PathResult.OUT_OF_BOUNDS, waypoints: [] };
}
