// Public API — openage-pfadfinder

// --- Library: field pipeline (src/lib/core) ---
export { CostField } from './lib/core/cost-field.js';
export { FlowField } from './lib/core/flow-field.js';
export { IntegrationField } from './lib/core/integration-field.js';
export type { IntegrationFlowPair } from './lib/core/integrator.js';
export { Integrator } from './lib/core/integrator.js';

// --- Library: spatial graph (src/lib/graph) ---
export { Grid } from './lib/graph/grid.js';
export { Portal } from './lib/graph/portal.js';
export { Sector } from './lib/graph/sector.js';

// --- Library: internals kept public for compatibility (src/lib/internal) ---
export { BinaryHeap } from './lib/internal/binary-heap.js';
export { bresenhamLine } from './lib/internal/bresenham.js';

// --- Library: pathfinding (src/lib/pathfinding) ---
export type { CacheEntry } from './lib/pathfinding/field-cache.js';
export { FieldCache, makeCacheKey } from './lib/pathfinding/field-cache.js';
export type { FlowStep } from './lib/pathfinding/flow-route.js';
export { FlowRoute, isLineWalkable } from './lib/pathfinding/flow-route.js';
export {
  makePath,
  pathFound,
  pathNotFound,
  pathOutOfBounds,
} from './lib/pathfinding/path-result.js';
export { Pathfinder } from './lib/pathfinding/pathfinder.js';
export type { PortalStarResult } from './lib/pathfinding/portal-graph.js';
export { PortalNode, portalAStar } from './lib/pathfinding/portal-graph.js';
