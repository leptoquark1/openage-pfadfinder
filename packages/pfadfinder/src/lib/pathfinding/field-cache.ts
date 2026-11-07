import type { CacheKey } from '../../shared/types.js';
import type { FlowField } from '../core/flow-field.js';
import type { IntegrationField } from '../core/integration-field.js';

export interface CacheEntry {
  readonly integrationField: IntegrationField
  readonly flowField: FlowField
  costFieldVersion: number
}

/**
 * Cache for already computed integration and flow fields.
 * Keyed by a `CacheKey`; `makeCacheKey` builds portal-id + sector-id keys,
 * `Integrator` keys by the portal's cell range instead.
 * Cached fields have dynamic flags cleared (LOS, wavefront) —
 * these must be recomputed when a field is reused.
 *
 * The cache itself does no validation. Keys are only unique within one
 * cost field, so use one cache per cost field (as `Integrator` does) and
 * check `costFieldVersion` or `version` against the field before reuse.
 */
export class FieldCache {
  private cache: Map<CacheKey, CacheEntry> = new Map();
  /** Cost field version the cache contents belong to (set by the owner). */
  version = 0;

  add(key: CacheKey, entry: CacheEntry): void {
    this.cache.set(key, entry);
  }

  evict(key: CacheKey): boolean {
    return this.cache.delete(key);
  }

  isCached(key: CacheKey): boolean {
    return this.cache.has(key);
  }

  get(key: CacheKey): CacheEntry | undefined {
    return this.cache.get(key);
  }

  getIntegrationField(key: CacheKey): IntegrationField | undefined {
    return this.cache.get(key)?.integrationField;
  }

  getFlowField(key: CacheKey): FlowField | undefined {
    return this.cache.get(key)?.flowField;
  }

  getCostFieldVersion(key: CacheKey): number | undefined {
    return this.cache.get(key)?.costFieldVersion;
  }

  setCostFieldVersion(key: CacheKey, version: number): void {
    const entry = this.cache.get(key);
    if (entry) {
      entry.costFieldVersion = version;
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export function makeCacheKey(portalId: number, sectorId: number): CacheKey {
  return `${portalId}:${sectorId}`;
}
