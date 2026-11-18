/**
 * Earthworks: current vs must.
 *
 * The editor keeps two elevation grids. `current` is what the site is now;
 * `must` is what the plan wants. The diff is a real job (a shovel, an
 * excavator, a robot), so it is computed as an explicit, inspectable list of
 * cut/fill cells rather than applied silently.
 *
 * Terrain edits are undoable: each edit is a job with a before/after grid, and
 * "apply" is a separate confirmation because the default action is real work.
 */
import type { ClusterTerrain } from './model.ts';

export type EarthworkCell = {
  /** Row-major index into the grid. */
  index: number;
  /** Cell centre in cluster-local ENU metres. */
  x: number;
  y: number;
  current: number;
  must: number;
  /** `must - current`. Positive is fill, negative is cut. */
  delta: number;
};

export type EarthworkDiff = {
  cells: EarthworkCell[];
  /** Total volume to add, cubic metres. */
  fillM3: number;
  /** Total volume to remove, cubic metres. */
  cutM3: number;
  /** Largest absolute delta, metres. */
  maxDelta: number;
};

/** Cells whose delta is at or below this are treated as unchanged. */
export const EARTHWORK_EPSILON_M = 0.01;

/**
 * Computes the cut/fill diff between `current` and `must`.
 *
 * A terrain without `must` has no planned change, so the diff is empty rather
 * than "everything is zero" — the two states mean different things to the UI.
 */
export function diffTerrain(terrain: ClusterTerrain): EarthworkDiff {
  const { current, must, columns, cellSize, origin } = terrain;
  if (!must || must.length !== current.length || columns <= 0) {
    return { cells: [], fillM3: 0, cutM3: 0, maxDelta: 0 };
  }
  const cells: EarthworkCell[] = [];
  let fill = 0;
  let cut = 0;
  let maxDelta = 0;
  const cellArea = cellSize * cellSize;

  for (let index = 0; index < current.length; index += 1) {
    const delta = must[index] - current[index];
    if (Math.abs(delta) <= EARTHWORK_EPSILON_M) continue;
    const row = Math.floor(index / columns);
    const col = index % columns;
    cells.push({
      index,
      x: origin.x + (col + 0.5) * cellSize,
      y: origin.y + (row + 0.5) * cellSize,
      current: current[index],
      must: must[index],
      delta,
    });
    if (delta > 0) fill += delta * cellArea;
    else cut += -delta * cellArea;
    maxDelta = Math.max(maxDelta, Math.abs(delta));
  }

  return { cells, fillM3: fill, cutM3: cut, maxDelta };
}

/** A terrain edit that can be undone: the grid before and after. */
export type TerrainEdit = {
  id: string;
  label: string;
  at: string;
  before: number[];
  after: number[];
  /** True once the edit has been applied as a real job. */
  applied: boolean;
};

/** Applies an edit to a terrain, returning a new terrain (never mutates). */
export function applyTerrainEdit(terrain: ClusterTerrain, edit: TerrainEdit): ClusterTerrain {
  if (edit.after.length !== terrain.current.length) {
    throw new Error('terrain edit size does not match the grid');
  }
  return { ...terrain, current: [...edit.after] };
}

/** Reverts an edit, returning a new terrain (never mutates). */
export function revertTerrainEdit(terrain: ClusterTerrain, edit: TerrainEdit): ClusterTerrain {
  if (edit.before.length !== terrain.current.length) {
    throw new Error('terrain edit size does not match the grid');
  }
  return { ...terrain, current: [...edit.before] };
}

/** Creates an undoable edit from a single-cell change. */
export function editTerrainCell(
  terrain: ClusterTerrain,
  index: number,
  elevation: number,
  label: string,
  now = new Date(),
): TerrainEdit {
  if (index < 0 || index >= terrain.current.length) {
    throw new Error(`terrain cell ${index} is out of range`);
  }
  const after = [...terrain.current];
  after[index] = elevation;
  return {
    id: `terrain-edit-${now.getTime()}-${index}`,
    label,
    at: now.toISOString(),
    before: [...terrain.current],
    after,
    applied: false,
  };
}
