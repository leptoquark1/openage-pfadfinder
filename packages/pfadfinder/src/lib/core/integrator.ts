import type { SectorId, TileDelta } from '../../shared/types.js';
import type { Portal } from '../graph/portal.js';
import { FieldCache, makeCacheKey } from '../pathfinding/field-cache.js';
import type { CostField } from './cost-field.js';
import { FlowField } from './flow-field.js';
import { IntegrationField } from './integration-field.js';

export interface IntegrationFlowPair {
  readonly integrationField: IntegrationField
  readonly flowField: FlowField
}

/**
 * Orchestrates flow-field computation.
 * Integrates cost fields and builds flow fields, with caching
 * for reuse across multiple path requests.
 *
 * Copy-on-read: on cache hit, the cached fields are cloned before
 * any re-integration (LOS re-run, flag transfer) so the cache stays
 * pristine for future lookups.
 *
 * Dirty tracking: cached entries store the cost-field version. If the
 * cost field has been modified since caching, the entry is evicted
 * and recomputed.
 */
export class Integrator {
  private readonly cache: FieldCache;

  constructor() {
    this.cache = new FieldCache();
  }

  /** Portal fields kept for reuse (one per portal and entered sector). */
  getCachedFieldCount(): number {
    return this.cache.size;
  }

  /**
   * Integrate cost field for a target cell within a sector.
   */
  integrate(costField: CostField, target: TileDelta, withLos = true): IntegrationField {
    const integrationField = new IntegrationField(costField.getSize());

    if (withLos) {
      const wavefrontBlocked = integrationField.integrateLos(costField, target);
      integrationField.integrateCostFromWavefront(costField, wavefrontBlocked);
    }
    else {
      integrationField.integrateCost(costField, target);
    }

    return integrationField;
  }

  /**
   * Integrate cost field from a portal boundary.
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

    if (withLos) {
      const wavefrontBlocked = integrationField.integrateLosPortal(
        costField,
        other,
        otherSectorId,
        portal,
        target,
      );
      integrationField.integrateCostFromWavefront(costField, wavefrontBlocked);
    }
    else {
      integrationField.integrateCostPortal(costField, otherSectorId, portal);
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
   * Uses copy-on-read: cached fields are cloned before any mutation.
   * Uses dirty tracking: stale entries are evicted and recomputed.
   */
  getPortal(
    costField: CostField,
    other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
    target: TileDelta,
    withLos = true,
  ): IntegrationFlowPair {
    const key = makeCacheKey(portal.getId(), otherSectorId);

    if (this.cache.isCached(key)) {
      const cachedVersion = this.cache.getCostFieldVersion(key)!;

      // Dirty check — evict if cost field has been modified
      if (costField.isDirty(cachedVersion)) {
        this.cache.evict(key);
      }
      else {
        // Copy-on-read: clone the cached fields before mutating
        const cached = this.cache.get(key)!;
        const integrationCopy = cached.integrationField.clone();
        const flowCopy = cached.flowField.clone();

        integrationCopy.resetDynamicFlags();
        flowCopy.resetDynamicFlags();

        if (withLos) {
          integrationCopy.integrateLosPortal(costField, other, otherSectorId, portal, target);
          flowCopy.transferDynamicFlags(integrationCopy);
        }

        return { integrationField: integrationCopy, flowField: flowCopy };
      }
    }

    const integrationField = this.integratePortal(
      costField,
      other,
      otherSectorId,
      portal,
      target,
      withLos,
    );
    const flowField = this.buildPortal(integrationField, other, otherSectorId, portal, withLos);

    // Cache the result (clone first, then clear dynamic flags on the clone)
    const cachedIntegration = integrationField.clone();
    const cachedFlow = flowField.clone();
    cachedIntegration.resetDynamicFlags();
    cachedFlow.resetDynamicFlags();
    this.cache.add(key, {
      integrationField: cachedIntegration,
      flowField: cachedFlow,
      costFieldVersion: costField.getVersion(),
    });

    return { integrationField, flowField };
  }
}
