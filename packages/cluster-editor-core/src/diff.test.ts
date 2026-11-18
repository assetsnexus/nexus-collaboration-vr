import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyClusterPatch, diffClusterModel, invertPatch, isPatchEmpty } from './diff.ts';
import { baseModel } from './model.test.ts';
import type { ClusterModel } from './model.ts';

function chair(id: string, x: number, name = 'Chair') {
  return { id, name, position: { x, y: 0, z: 0 } };
}

test('an unchanged model produces an empty patch', () => {
  const model = baseModel({ assets: [chair('a1', 0)] });
  const patch = diffClusterModel(model, model);
  assert.equal(isPatchEmpty(patch), true);
  assert.deepEqual(patch.changes, {});
});

test('an added asset is recorded with its value', () => {
  const before = baseModel({ assets: [chair('a1', 0)] });
  const after = baseModel({ assets: [chair('a1', 0), chair('a2', 5)] });
  const patch = diffClusterModel(before, after);
  assert.deepEqual(patch.changes.assets?.added, [{ id: 'a2', value: chair('a2', 5) }]);
  assert.deepEqual(patch.changes.assets?.removed, []);
  assert.deepEqual(patch.changes.assets?.updated, []);
});

test('a removed asset is recorded with its value', () => {
  const before = baseModel({ assets: [chair('a1', 0), chair('a2', 5)] });
  const after = baseModel({ assets: [chair('a1', 0)] });
  const patch = diffClusterModel(before, after);
  assert.deepEqual(patch.changes.assets?.removed, [{ id: 'a2', value: chair('a2', 5) }]);
});

test('an updated asset carries before and after', () => {
  const before = baseModel({ assets: [chair('a1', 0)] });
  const after = baseModel({ assets: [chair('a1', 9, 'Armchair')] });
  const patch = diffClusterModel(before, after);
  assert.deepEqual(patch.changes.assets?.updated, [
    { id: 'a1', before: chair('a1', 0), after: chair('a1', 9, 'Armchair') },
  ]);
});

test('applying a patch reproduces the after model', () => {
  const before = baseModel({ assets: [chair('a1', 0)] });
  const after = baseModel({ assets: [chair('a1', 9), chair('a2', 5)] });
  const patched = applyClusterPatch(before, diffClusterModel(before, after));
  assert.deepEqual(patched, after);
});

test('inverting a patch restores the before model', () => {
  const before = baseModel({ assets: [chair('a1', 0), chair('a2', 5)] });
  const after = baseModel({ assets: [chair('a1', 9), chair('a3', 7)] });
  const patch = diffClusterModel(before, after);
  const patched = applyClusterPatch(before, patch);
  const undone = applyClusterPatch(patched, invertPatch(patch));
  assert.deepEqual(undone, before);
});

test('apply does not mutate the input model', () => {
  const before = baseModel({ assets: [chair('a1', 0)] });
  const snapshot = JSON.parse(JSON.stringify(before));
  applyClusterPatch(before, diffClusterModel(before, baseModel({ assets: [] })));
  assert.deepEqual(before, snapshot);
});

test('a georeference change is a whole-object replacement', () => {
  const before = baseModel();
  const after = baseModel({
    geoReference: { anchor: { latitude: 48.1, longitude: 11.5, elevation: 520 } },
  });
  const patch = diffClusterModel(before, after);
  assert.deepEqual(patch.replaced?.geoReference?.after, after.geoReference);
  assert.deepEqual(applyClusterPatch(before, patch).geoReference, after.geoReference);
});

test('a terrain change is a whole-object replacement', () => {
  const before = baseModel();
  const after = baseModel({
    terrain: { origin: { x: 0, y: 0 }, cellSize: 1, current: [0, 0, 0, 0], columns: 2 },
  });
  const patch = diffClusterModel(before, after);
  assert.ok(patch.replaced?.terrain);
  assert.deepEqual(applyClusterPatch(before, patch).terrain, after.terrain);
});

test('an empty patch leaves the model untouched', () => {
  const model = baseModel({ assets: [chair('a1', 0)] });
  assert.deepEqual(applyClusterPatch(model, { changes: {} }), model);
});

test('a patch across several collections applies in one pass', () => {
  const before = baseModel();
  const after: ClusterModel = baseModel({
    buildings: [{ id: 'b1', name: 'House', storeyIds: [] }],
    materials: [{ id: 'm1', name: 'Paint', kind: 'paint' }],
    assets: [chair('a1', 0)],
  });
  const patched = applyClusterPatch(before, diffClusterModel(before, after));
  assert.deepEqual(patched, after);
});
