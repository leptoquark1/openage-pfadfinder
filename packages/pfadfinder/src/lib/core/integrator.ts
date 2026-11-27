import { xyToIndex } from '../../shared/coordinates.js';
import type { CacheKey, SectorId, TileDelta } from '../../shared/types.js';
import type { Portal } from '../graph/portal.js';
import { type CacheEntry, FieldCache } from '../pathfinding/field-cache.js';
import type { CostField } from './cost-field.js';
import { FlowField } from './flow-field.js';
import { IntegrationField } from './integration-field.js';

export interface IntegrationFlowPair {
  readonly integrationField: IntegrationField;
  readonly flowField: FlowField;
}

/**
 * Bounds for the fields an `Integrator` keeps over all its cost fields. Each
 * is a count of integration + flow field pairs; beyond it, the least
 * recently used pair is dropped. Without a bound (or with `Infinity`), only
 * the bounds per cost field apply, as before.
 */
export interface IntegratorOptions {
  /** Portal fields kept at most (`getCachedFieldCount()`). */
  readonly maxPortalFields?: number;
  /** Target fields kept at most (`getCachedTargetFieldCount()`), on top of `FieldCache.MAX_TARGETS` per cost field. */
  readonly maxTargetFields?: number;
}

/**
 * The entries of several caches in order of use, least recent first. Beyond
 * `limit` entries the oldest is handed to `drop` and forgotten.
 */
class FieldLru<K> {
  private readonly order = new Map<CacheEntry, { readonly cache: FieldCache; readonly key: K }>();
  private readonly limit: number;
  private readonly drop: (cache: FieldCache, key: K) => void;

  constructor(limit: number, drop: (cache: FieldCache, key: K) => void) {
    this.limit = limit;
    this.drop = drop;
  }

  /** Mark an entry as just used. */
  touch(entry: CacheEntry): void {
    const at = this.order.get(entry);
    if (at) {
      this.order.delete(entry);
      this.order.set(entry, at);
    }
  }

  /** Track a new entry of `cache` under `key`, dropping the oldest beyond the limit. */
  add(entry: CacheEntry, cache: FieldCache, key: K): void {
    this.order.set(entry, { cache, key });
    while (this.order.size > this.limit) {
      const [oldest, at] = this.order.entries().next().value!;
      this.order.delete(oldest);
      this.drop(at.cache, at.key);
    }
  }

  /** Stop tracking an entry its cache dropped by itself. */
  forget(entry: CacheEntry): void {
    this.order.delete(entry);
  }
}

/** The LRU for a bound from the options, `undefined` when unbounded. */
function lruFor<K>(
  limit: number | undefined,
  name: string,
  drop: (cache: FieldCache, key: K) => void,
): FieldLru<K> | undefined {
  if (limit === undefined || limit === Number.POSITIVE_INFINITY) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError(`${name} must be a non-negative integer or Infinity, got ${limit}`);
  }
  return new FieldLru(limit, drop);
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
 * pristine for future lookups. `getPortalShared()` and `getTargetShared()`
 * skip the copies for callers that only read.
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
 *
 * Bounds (`IntegratorOptions`): the caches of all cost fields together keep
 * at most `maxPortalFields` portal fields and `maxTargetFields` target
 * fields, the least recently used dropped first. A dropped field is computed
 * again on its next use, and comes out the same, since it depends only on
 * the cost field and the portal range or target cell. A bound holds the
 * fields it tracks strongly: the fields of a grid that is no longer used are
 * released once newer fields push them out.
 */
export class Integrator {
  private caches = new WeakMap<CostField, FieldCache>();
  /** Weak handles of the caches above, only for counting entries. */
  private cacheRefs = new Set<WeakRef<FieldCache>>();
  private readonly portalLru: FieldLru<CacheKey> | undefined;
  private readonly targetLru: FieldLru<number> | undefined;

  constructor(options: IntegratorOptions = {}) {
    this.portalLru = lruFor<CacheKey>(options.maxPortalFields, 'maxPortalFields', (cache, key) => cache.evict(key));
    this.targetLru = lruFor<number>(options.maxTargetFields, 'maxTargetFields', (cache, cell) =>
      cache.evictTarget(cell),
    );
  }

  /** Portal fields kept for reuse (one per portal range and entered sector). */
  getCachedFieldCount(): number {
    return this.countCached(cache => cache.size);
  }

  /** Target fields kept for reuse (one per target cell, `FieldCache.MAX_TARGETS` per cost field at most). */
  getCachedTargetFieldCount(): number {
    return this.countCached(cache => cache.targetCount);
  }

  private countCached(count: (cache: FieldCache) => number): number {
    let total = 0;
    for (const ref of this.cacheRefs) {
      const cache = ref.deref();
      if (cache) {
        total += count(cache);
      } else {
        this.cacheRefs.delete(ref);
      }
    }
    return total;
  }

  /** The cache of a cost field, cleared when the field changed since last use. */
  private cacheFor(costField: CostField): FieldCache {
    let cache = this.caches.get(costField);
    if (!cache) {
      cache = new FieldCache();
      this.caches.set(costField, cache);
      this.cacheRefs.add(new WeakRef(cache));
    } else if (costField.isDirty(cache.version)) {
      // the bounds must not count fields that are gone
      if (this.portalLru) {
        for (const [, entry] of cache.portalEntries()) {
          this.portalLru.forget(entry);
        }
      }
      if (this.targetLru) {
        for (const [, entry] of cache.targetEntries()) {
          this.targetLru.forget(entry);
        }
      }
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
   * Integration + flow field (with line of sight) towards a cell of this cost
   * field, kept for the most recent targets (`FieldCache.MAX_TARGETS` per
   * cost field), so units heading for the same cell share one field.
   *
   * Read-only, like `getPortalShared()`: the fields are shared with the cache
   * and with every other caller.
   */
  getTargetShared(costField: CostField, target: TileDelta): IntegrationFlowPair {
    const cache = this.cacheFor(costField);
    const cell = xyToIndex(target.ne, target.se, costField.getSize());

    let entry = cache.getTarget(cell);
    if (entry) {
      this.targetLru?.touch(entry);
    } else {
      const integrationField = this.integrate(costField, target, true);
      entry = {
        integrationField,
        flowField: this.build(integrationField),
        costFieldVersion: costField.getVersion(),
      };
      const dropped = cache.addTarget(cell, entry);
      if (dropped) {
        this.targetLru?.forget(dropped);
      }
      this.targetLru?.add(entry, cache, cell);
    }
    return entry;
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
    const key = portal.getExitRangeKey(otherSectorId);

    let entry = cache.get(key);
    if (entry) {
      this.portalLru?.touch(entry);
    } else {
      const integrationField = this.integratePortal(costField, other, otherSectorId, portal, target, false);
      entry = {
        integrationField,
        flowField: this.buildPortal(integrationField, other, otherSectorId, portal, false),
        costFieldVersion: costField.getVersion(),
      };
      cache.add(key, entry);
      this.portalLru?.add(entry, cache, key);
    }
    return entry;
  }
}
