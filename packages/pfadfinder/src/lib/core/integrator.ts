import type { SectorId, TileDelta } from '../../shared/types.js';
import type { Portal } from '../graph/portal.js';
import type { CacheKey } from '../../shared/types.js';
import { FieldCache } from '../pathfinding/field-cache.js';
import type { CostField } from './cost-field.js';
import { FlowField } from './flow-field.js';
import { IntegrationField } from './integration-field.js';

export interface IntegrationFlowPair {
  readonly integrationField: IntegrationField;
  readonly flowField: FlowField;
}

/**
 * Orchestrates flow-field computation.
 * Integrates cost fields and builds flow fields, with caching
 * for reuse across multiple path requests.
 *
 * Portal fields are cached without line of sight: the costs from a portal
 * depend only on the cost field and the portal's cells, while line of sight
 * also depends on the target and the field behind the portal. A request
 * with LOS gets the marks added to its own copy.
 *
 * Copy-on-read: `getPortal()` clones the cached fields before it hands
 * them out (and before the LOS pass or flag transfer), so the cache stays
 * pristine for future lookups. `getPortalShared()` skips the copies for
 * callers that only read.
 *
 * Cache scope: every cost field gets its own cache, held weakly, so fields
 * of different grids never share entries and the cache of a replaced grid
 * is released with it. Within a cost field, entries are keyed by the portal's
 * cell range rather than its id: the cached field depends only on that range
 * and the cost field, so ids cannot collide and a portal that vanishes and
 * reappears with the same range reuses its entry.
 *
 * Dirty tracking: once a cost field has been modified, its whole cache is
 * stale and gets cleared; this also drops entries of portals that vanished
 * with the change.
 */
export class Integrator {
  private caches = new WeakMap<CostField, FieldCache>();
  /** Weak handles of the caches above, only for counting entries. */
  private cacheRefs = new Set<WeakRef<FieldCache>>();

  /** Portal fields kept for reuse (one per portal range and entered sector). */
  getCachedFieldCount(): number {
    let count = 0;
    for (const ref of this.cacheRefs) {
      const cache = ref.deref();
      if (cache) {
        count += cache.size;
      } else {
        this.cacheRefs.delete(ref);
      }
    }
    return count;
  }

  /** The cache of a cost field, cleared when the field changed since last use. */
  private cacheFor(costField: CostField): FieldCache {
    let cache = this.caches.get(costField);
    if (!cache) {
      cache = new FieldCache();
      this.caches.set(costField, cache);
      this.cacheRefs.add(new WeakRef(cache));
    } else if (costField.isDirty(cache.version)) {
      cache.clear();
    }
    cache.version = costField.getVersion();
    return cache;
  }

  /**
   * Integrate cost field for a target cell within a sector.
   */
  integrate(costField: CostField, target: TileDelta, withLos = true): IntegrationField {
    const integrationField = new IntegrationField(costField.getSize());

    if (withLos) {
      const wavefrontBlocked = integrationField.integrateLos(costField, target);
      integrationField.integrateCostFromWavefront(costField, wavefrontBlocked);
    } else {
      integrationField.integrateCost(costField, target);
    }

    return integrationField;
  }

  /**
   * Integrate cost field from a portal boundary.
   *
   * The costs always come from the whole portal. `withLos` adds the
   * line-of-sight marks on top: the LOS pass alone only starts from portal
   * cells that see the target and would leave every other cell without a
   * cost.
   */
  integratePortal(
    costField: CostField,
    other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
    target: TileDelta,
    withLos = true,
  ): IntegrationField {
    const integrationField = new IntegrationField(costField.getSize());

    integrationField.integrateCostPortal(costField, otherSectorId, portal);
    if (withLos) {
      integrationField.integrateLosPortal(costField, other, otherSectorId, portal, target);
    }

    return integrationField;
  }

  /**
   * Build flow field from an integration field.
   */
  build(integrationField: IntegrationField): FlowField {
    const flowField = new FlowField(integrationField.getSize());
    flowField.build(integrationField);
    return flowField;
  }

  /**
   * Build flow field from a portal-connected integration field.
   */
  buildPortal(
    integrationField: IntegrationField,
    other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
    _withLos = true,
  ): FlowField {
    const flowField = new FlowField(integrationField.getSize());
    flowField.buildPortal(integrationField, other, otherSectorId, portal);
    return flowField;
  }

  /**
   * Get integration + flow field for a target (no caching).
   */
  get(costField: CostField, target: TileDelta, withLos = true): IntegrationFlowPair {
    const integrationField = this.integrate(costField, target, withLos);
    const flowField = this.build(integrationField);
    return { integrationField, flowField };
  }

  /**
   * Get integration + flow field for a portal entry, with cache lookup.
   * The cached fields hold no line of sight, so one entry serves requests
   * with and without it, whatever their target.
   * Uses copy-on-read: cached fields are cloned before they are handed out.
   * Uses dirty tracking: the cache of a modified cost field is cleared.
   */
  getPortal(
    costField: CostField,
    other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
    target: TileDelta,
    withLos = true,
  ): IntegrationFlowPair {
    const cached = this.getPortalShared(costField, other, otherSectorId, portal, target);

    // Copy-on-read: the caller's fields, free to take the LOS marks
    const integrationField = cached.integrationField.clone();
    const flowField = cached.flowField.clone();

    if (withLos) {
      integrationField.integrateLosPortal(costField, other, otherSectorId, portal, target);
      flowField.transferDynamicFlags(integrationField);
    }

    return { integrationField, flowField };
  }

  /**
   * The cached integration + flow field for a portal entry themselves:
   * `getPortal()` without line of sight and without its copies.
   *
   * Read-only. The fields are shared with the cache and with every other
   * caller, so anything written to them shows up in later requests. For
   * callers that only read them, as `Pathfinder` does for its routes.
   */
  getPortalShared(
    costField: CostField,
    other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
    target: TileDelta,
  ): IntegrationFlowPair {
    const cache = this.cacheFor(costField);
    const key = portalRangeKey(portal, otherSectorId);

    let entry = cache.get(key);
    if (!entry) {
      const integrationField = this.integratePortal(costField, other, otherSectorId, portal, target, false);
      entry = {
        integrationField,
        flowField: this.buildPortal(integrationField, other, otherSectorId, portal, false),
        costFieldVersion: costField.getVersion(),
      };
      cache.add(key, entry);
    }
    return entry;
  }
}

/**
 * Cache key of a portal entered from `otherSectorId`: the entered sector's
 * cells of the portal. Together with the cost field (the cache scope) this
 * is everything a cached portal field depends on.
 */
function portalRangeKey(portal: Portal, otherSectorId: SectorId): CacheKey {
  const start = portal.getExitStart(otherSectorId);
  const end = portal.getExitEnd(otherSectorId);
  return `${otherSectorId}:${start.ne},${start.se}:${end.ne},${end.se}`;
}
