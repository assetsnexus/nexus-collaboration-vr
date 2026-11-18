/**
 * Materials, placed models and product quantities.
 *
 * Pure functions over the cluster model. Nothing here touches a renderer, a
 * network or a database: the portal, the reference app and a partner app all
 * compute the same quantities from the same model.
 *
 * The long-term shape this is built for:
 *
 * - a placed asset points at a marketplace **product** and renders that
 *   product's model, unless the placement **overrides** the model;
 * - a surface (floor, wall) carries a **material** (paint, tile), which is
 *   itself bought as a product;
 * - the quantity of each product is derived from geometry, not typed in.
 *
 * IFC mapping (so a round-trip stays pro-software compatible):
 *
 * | Model | IFC |
 * | --- | --- |
 * | `ClusterMaterial` | `IfcMaterial` + `IfcSurfaceStyle` (`IfcColourRgb`, `IfcImageTexture`) |
 * | `ClusterSurface` | `IfcRelAssociatesMaterial` on the owning element |
 * | `ClusterAsset.modelRef` | `IfcShapeRepresentation` / an external model reference |
 * | `ClusterAsset.productRef` | `IfcClassificationReference` (product catalogue) |
 */
import type {
  ClusterAsset,
  ClusterMaterial,
  ClusterModel,
  ClusterSurface,
  MaterialUnit,
  ModelRef,
  Polygon,
} from './model.ts';

/** Shoelace area of a polygon in m². Absolute, so winding order does not matter. */
export function polygonArea(points: Polygon): number {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Area of a surface in m².
 *
 * An explicit `areaM2` wins (an imported model knows its own area); otherwise
 * the polygon is measured. A surface with neither is 0, never `NaN`.
 */
export function surfaceArea(surface: Pick<ClusterSurface, 'areaM2' | 'points'>): number {
  if (typeof surface.areaM2 === 'number' && Number.isFinite(surface.areaM2)) {
    return Math.max(0, surface.areaM2);
  }
  return surface.points ? polygonArea(surface.points) : 0;
}

/**
 * The model to render for a placement.
 *
 * The placement's own `modelRef` wins, so a user can swap a chair without
 * editing the product. Falls back to the product's model, then `null`.
 */
export function resolvePlacedModel(
  asset: Pick<ClusterAsset, 'modelRef'>,
  product?: { modelRef?: ModelRef } | null,
): ModelRef | null {
  return asset.modelRef ?? product?.modelRef ?? null;
}

/**
 * The material for one slot of a placement.
 *
 * A slot is the product's own material name (`fabric`, `frame`) or a surface id.
 * The placement override wins, then the product default.
 */
export function resolveSlotMaterial(
  asset: Pick<ClusterAsset, 'materialOverrides'>,
  slot: string,
  productDefault?: string | null,
): string | null {
  const override = asset.materialOverrides?.[slot];
  return override ?? productDefault ?? null;
}

/** One product's derived quantity. */
export type ProductQuantity = {
  productId: string;
  /** Placed instances (assets), summed by their `quantity`. */
  count: number;
  /** Measured area in m², when the product is applied to surfaces. */
  areaM2?: number;
  /** Measured length in m, for a linear product. */
  lengthM?: number;
  /** Purchase units needed, including the material's waste factor. */
  units: number;
  /** The unit `units` is expressed in. */
  unit: MaterialUnit;
};

type Accumulator = {
  productId: string;
  count: number;
  areaM2: number;
  lengthM: number;
  units: number;
  unit: MaterialUnit;
  hasArea: boolean;
  hasLength: boolean;
};

function accumulatorFor(map: Map<string, Accumulator>, productId: string, unit: MaterialUnit): Accumulator {
  const existing = map.get(productId);
  if (existing) return existing;
  const next: Accumulator = {
    productId,
    count: 0,
    areaM2: 0,
    lengthM: 0,
    units: 0,
    unit,
    hasArea: false,
    hasLength: false,
  };
  map.set(productId, next);
  return next;
}

/**
 * Derives the quantity of every product the cluster needs.
 *
 * - A placed asset with `productRef` contributes its `quantity` (default 1) as
 *   `piece`.
 * - A surface whose material has a `productRef` and `coverage` contributes the
 *   measured area or length divided by `perUnit`, plus the waste factor.
 *
 * The result is stable and sorted by product id, so two runs over the same model
 * produce the same list — a shopping list a user can trust.
 */
export function computeProductQuantities(model: ClusterModel): ProductQuantity[] {
  const materials = new Map<string, ClusterMaterial>(
    (model.materials ?? []).map((material) => [material.id, material]),
  );
  const zones = new Map((model.zones ?? []).map((zone) => [zone.id, zone]));
  const buildings = new Map((model.buildings ?? []).map((building) => [building.id, building]));
  const byProduct = new Map<string, Accumulator>();

  for (const asset of model.assets ?? []) {
    const productId = asset.productRef?.trim();
    if (!productId) continue;
    const acc = accumulatorFor(byProduct, productId, 'piece');
    acc.count += Number.isFinite(asset.quantity) && (asset.quantity as number) > 0
      ? (asset.quantity as number)
      : 1;
    acc.units += Number.isFinite(asset.quantity) && (asset.quantity as number) > 0
      ? (asset.quantity as number)
      : 1;
  }

  for (const surface of model.surfaces ?? []) {
    const material = surface.materialId ? materials.get(surface.materialId) : undefined;
    const productId = material?.productRef?.trim();
    const coverage = material?.coverage;
    if (!productId || !coverage || !(coverage.perUnit > 0)) continue;

    const acc = accumulatorFor(byProduct, productId, coverage.unit);
    const waste = 1 + Math.max(0, coverage.wasteFactor ?? 0);

    if (coverage.unit === 'm') {
      const length = Math.max(0, surface.lengthM ?? 0);
      acc.lengthM += length;
      acc.hasLength = true;
      acc.units += (length / coverage.perUnit) * waste;
    } else {
      // A surface without its own geometry inherits the owner's: a room floor is
      // the room polygon, a building floor is the building footprint.
      const ownerPoints =
        surface.ownerKind === 'zone'
          ? zones.get(surface.ownerId)?.points
          : buildings.get(surface.ownerId)?.footprint;
      const area = surfaceArea({
        areaM2: surface.areaM2,
        points: surface.points ?? ownerPoints,
      });
      acc.areaM2 += area;
      acc.hasArea = true;
      acc.units += (area / coverage.perUnit) * waste;
    }
  }

  return [...byProduct.values()]
    .map((acc) => ({
      productId: acc.productId,
      count: acc.count,
      ...(acc.hasArea ? { areaM2: round(acc.areaM2) } : {}),
      ...(acc.hasLength ? { lengthM: round(acc.lengthM) } : {}),
      units: Math.ceil(acc.units),
      unit: acc.unit,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
