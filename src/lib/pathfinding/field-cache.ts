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
 * Keyed by portal-id + sector-id combination.
 * Cached fields have dynamic flags cleared (LOS, wavefront) —
 * these must be recomputed when a field is reused.
 *
 * Dirty tracking: each entry stores the cost-field version at cache time.
 * If the cost field has been modified since, the entry is evicted.
 */
export class FieldCache {
  private cache: Map<CacheKey, CacheEntry> = new Map();

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
