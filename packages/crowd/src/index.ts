// Public API — openage-pfadfinder-crowd

// --- Simulation ---
export type { CrowdOptions } from './simulation.js';
export { CrowdSimulation } from './simulation.js';
export type { AgentId, AgentParams } from './types.js';
export { AgentState } from './types.js';

// --- Extension points and the context they see ---
export type {
  AgentView,
  CrowdContext,
  DensityFieldView,
  NavigationView,
  NeighborList,
  NeighborQuery,
} from './context.js';
export type { GuidanceProvider } from './guidance/types.js';
export { GuidanceStatus, Invalidation } from './guidance/types.js';
export type { PreferredVelocityModifier, SteeringForce } from './steering/types.js';
export type { CongestionCommit, CongestionModel, CostChange } from './congestion/types.js';

// --- Built-in strategies ---
export type { FlowRouteGuidanceOptions } from './guidance/flow-route.js';
export { FlowRouteGuidance } from './guidance/flow-route.js';
export type { PowerLawOptions } from './steering/power-law.js';
export { PowerLawAvoidance } from './steering/power-law.js';
export type { SeparationOptions } from './steering/separation.js';
export { Separation } from './steering/separation.js';
export type { SideRuleOptions } from './steering/side-rule.js';
export { SideRule } from './steering/side-rule.js';
export type { OverlapResolverOptions } from './collision/overlap.js';
export { OverlapResolver } from './collision/overlap.js';
export type { DensityCostOptions } from './congestion/density-cost.js';
export { DensityCostModel } from './congestion/density-cost.js';
export { DensityField } from './congestion/density-field.js';

// --- Helpers ---
export { moveWithWalls, pushOut, resolveWalls } from './collision/walls.js';
export { GridNavigation } from './navigation.js';
export { timeToCollision } from './steering/ttc.js';
export type { Vec2 } from './vec2.js';
export {
  add,
  addScaled,
  clampLength,
  copy,
  cross,
  distanceSq,
  dot,
  length,
  lengthSq,
  normalize,
  perpRight,
  scale,
  set,
  sub,
  VEC2_EPSILON_SQ,
  vec2,
} from './vec2.js';
