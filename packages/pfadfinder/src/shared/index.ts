// --- Shared: flags, constants, coordinates, types (src/shared) ---
export { clearFlag, hasFlag, setFlag, toggleFlag } from './bit-ops.js';
export {
  COST_IMPASSABLE,
  COST_INIT,
  COST_MAX,
  COST_MIN,
  FLOW_DIR_MASK,
  FLOW_FLAGS_MASK,
  FLOW_INIT,
  FLOW_LOS_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
  INTEGRATE_FOUND_MASK,
  INTEGRATE_LOS_MASK,
  INTEGRATE_TARGET_MASK,
  INTEGRATE_WAVEFRONT_BLOCKED_MASK,
  INTEGRATED_COST_START,
  INTEGRATED_COST_UNREACHABLE,
} from './constants.js';
export {
  indexToX,
  indexToY,
  makeTileDelta,
  tileDistance,
  tileEuclidean,
  tileToIndex,
  xyToIndex,
} from './coordinates.js';
export { buildGrid, nearestReachable, reachableFrom } from './cost-map/cost-map.js';
export type {
  CacheKey,
  GridId,
  Path,
  PathRequest,
  PortalId,
  SectorId,
  Size2s,
  Tile3,
  TileDelta,
  Vector2s,
  Waypoint,
} from './types.js';
export { FlowDir, PathResult, PortalDirection } from './types.js';
