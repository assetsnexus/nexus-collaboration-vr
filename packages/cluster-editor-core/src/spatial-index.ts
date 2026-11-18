/**
 * Indexes for large scenes.
 *
 * A cluster can hold thousands of assets. The editor must not scan the whole
 * array to answer "what is near this point" or "which material is this", so the
 * model gets an optional index built once and reused.
 *
 * The index is plain data: no renderer, no observers, no mutation of the model.
 * Rebuild it after a structural edit; a move that keeps the same cell needs no
 * rebuild, which is why `cellOf` is exported.
 */
import type { ClusterAsset, ClusterMaterial, ClusterModel, ClusterZone, Vec3 } from './model.ts';

export type SpatialGrid<T> = {
  /** Cell edge length in metres. */
  cellSize: number;
  /** Key is `${ix}:${iy}`; value is the items whose origin falls in that cell. */
  cells: Map<string, T[]>;
};

export type ClusterIndex = {
  assets: ReadonlyMap<string, ClusterAsset>;
  zones: ReadonlyMap<string, ClusterZone>;
  materials: ReadonlyMap<string, ClusterMaterial>;
  /** Assets bucketed in the XY plane for proximity queries. */
  assetGrid: SpatialGrid<ClusterAsset>;
};

/** Default cell size: a 10 m grid keeps a typical site to a few cells per asset. */
export const DEFAULT_CELL_SIZE_M = 10;

export function cellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function addToGrid<T extends { position: Vec3 }>(grid: SpatialGrid<T>, item: T): void {
  const key = cellKey(item.position.x, item.position.y, grid.cellSize);
  const bucket = grid.cells.get(key);
  if (bucket) bucket.push(item);
  else grid.cells.set(key, [item]);
}

/**
 * Builds the index once per structural edit.
 *
 * `cellSizeM` is a tuning knob: too small and a query touches many cells, too
 * large and every cell holds the whole site. 10 m is a good default for a
 * building or a garden.
 */
export function buildClusterIndex(
  model: ClusterModel,
  opts?: { cellSizeM?: number },
): ClusterIndex {
  const cellSize = opts?.cellSizeM && opts.cellSizeM > 0 ? opts.cellSizeM : DEFAULT_CELL_SIZE_M;
  const assets = new Map<string, ClusterAsset>();
  const zones = new Map<string, ClusterZone>();
  const materials = new Map<string, ClusterMaterial>();
  const assetGrid: SpatialGrid<ClusterAsset> = { cellSize, cells: new Map() };

  for (const asset of model.assets ?? []) {
    assets.set(asset.id, asset);
    addToGrid(assetGrid, asset);
  }
  for (const zone of model.zones ?? []) zones.set(zone.id, zone);
  for (const material of model.materials ?? []) materials.set(material.id, material);

  return { assets, zones, materials, assetGrid };
}

/**
 * Assets within `radiusM` of `point`, in the XY plane.
 *
 * The Z axis is ignored on purpose: a sensor on the ground floor should find a
 * camera on the first floor of the same column, and a 3D radius would hide it.
 * Callers that need a height filter apply it to the result.
 */
export function queryNearby(index: ClusterIndex, point: Vec3, radiusM: number): ClusterAsset[] {
  if (!(radiusM > 0)) return [];
  const { cellSize, cells } = index.assetGrid;
  const minX = Math.floor((point.x - radiusM) / cellSize);
  const maxX = Math.floor((point.x + radiusM) / cellSize);
  const minY = Math.floor((point.y - radiusM) / cellSize);
  const maxY = Math.floor((point.y + radiusM) / cellSize);
  const radiusSq = radiusM * radiusM;
  const out: ClusterAsset[] = [];

  for (let ix = minX; ix <= maxX; ix += 1) {
    for (let iy = minY; iy <= maxY; iy += 1) {
      const bucket = cells.get(`${ix}:${iy}`);
      if (!bucket) continue;
      for (const asset of bucket) {
        const dx = asset.position.x - point.x;
        const dy = asset.position.y - point.y;
        if (dx * dx + dy * dy <= radiusSq) out.push(asset);
      }
    }
  }
  return out;
}

/** The cell an asset currently belongs to, for a cheap "did it move cells?" check. */
export function assetCell(asset: Pick<ClusterAsset, 'position'>, cellSize: number): string {
  return cellKey(asset.position.x, asset.position.y, cellSize);
}
