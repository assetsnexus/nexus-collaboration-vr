import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClusterTerrain } from './model.ts';
import {
  EARTHWORK_EPSILON_M,
  applyTerrainEdit,
  diffTerrain,
  editTerrainCell,
  revertTerrainEdit,
} from './earthworks.ts';

function terrain(overrides: Partial<ClusterTerrain> = {}): ClusterTerrain {
  return {
    origin: { x: 0, y: 0 },
    cellSize: 1,
    columns: 2,
    current: [0, 0, 0, 0],
    ...overrides,
  };
}

test('a terrain without a target has no diff', () => {
  const diff = diffTerrain(terrain());
  assert.deepEqual(diff.cells, []);
  assert.equal(diff.fillM3, 0);
  assert.equal(diff.cutM3, 0);
});

test('computes fill and cut volumes per cell', () => {
  const diff = diffTerrain(terrain({ must: [1, -0.5, 0, 0] }));
  assert.equal(diff.cells.length, 2);
  assert.equal(diff.fillM3, 1);
  assert.equal(diff.cutM3, 0.5);
  assert.equal(diff.maxDelta, 1);
});

test('ignores deltas at or below the epsilon', () => {
  const diff = diffTerrain(terrain({ must: [EARTHWORK_EPSILON_M, 0, 0, 0] }));
  assert.equal(diff.cells.length, 0);
});

test('cell centres use the grid origin and cell size', () => {
  const diff = diffTerrain(
    terrain({ origin: { x: 10, y: 20 }, cellSize: 2, columns: 2, current: [0, 0, 0, 0], must: [0, 0, 0, 1] }),
  );
  assert.equal(diff.cells.length, 1);
  // index 3 → row 1, col 1 → x = 10 + 1.5*2, y = 20 + 1.5*2
  assert.deepEqual({ x: diff.cells[0].x, y: diff.cells[0].y }, { x: 13, y: 23 });
});

test('rejects a target grid of the wrong size', () => {
  const diff = diffTerrain(terrain({ must: [1, 2] }));
  assert.deepEqual(diff.cells, []);
});

test('an edit is undoable and never mutates the input', () => {
  const before = terrain();
  const edit = editTerrainCell(before, 1, 2.5, 'raise bed');
  assert.deepEqual(before.current, [0, 0, 0, 0]);
  const applied = applyTerrainEdit(before, edit);
  assert.deepEqual(applied.current, [0, 2.5, 0, 0]);
  const reverted = revertTerrainEdit(applied, edit);
  assert.deepEqual(reverted.current, [0, 0, 0, 0]);
});

test('an out-of-range cell throws', () => {
  assert.throws(() => editTerrainCell(terrain(), 9, 1, 'nope'));
});

test('an edit with a mismatched grid throws', () => {
  const edit = editTerrainCell(terrain(), 0, 1, 'x');
  assert.throws(() => applyTerrainEdit(terrain({ current: [0, 0] }), edit));
});
