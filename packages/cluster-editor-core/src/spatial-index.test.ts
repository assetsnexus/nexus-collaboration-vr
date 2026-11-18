import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetCell, buildClusterIndex, cellKey, queryNearby } from './spatial-index.ts';
import { baseModel } from './model.test.ts';

function asset(id: string, x: number, y: number, z = 0) {
  return { id, name: id, position: { x, y, z } };
}

test('cellKey buckets by floor division', () => {
  assert.equal(cellKey(0, 0, 10), '0:0');
  assert.equal(cellKey(9.9, 9.9, 10), '0:0');
  assert.equal(cellKey(10, 0, 10), '1:0');
  assert.equal(cellKey(-0.1, -0.1, 10), '-1:-1');
});

test('buildClusterIndex maps ids and buckets assets', () => {
  const model = baseModel({
    assets: [asset('a1', 1, 1), asset('a2', 25, 25)],
    zones: [{ id: 'z1', name: 'Bed', kind: 'bed', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
    materials: [{ id: 'm1', name: 'Paint', kind: 'paint' }],
  });
  const index = buildClusterIndex(model);
  assert.equal(index.assets.get('a1')?.id, 'a1');
  assert.equal(index.zones.get('z1')?.id, 'z1');
  assert.equal(index.materials.get('m1')?.id, 'm1');
  assert.equal(index.assetGrid.cells.get('0:0')?.length, 1);
  assert.equal(index.assetGrid.cells.get('2:2')?.length, 1);
});

test('queryNearby finds assets inside the radius only', () => {
  const model = baseModel({
    assets: [asset('near', 1, 0), asset('edge', 5, 0), asset('far', 50, 0)],
  });
  const index = buildClusterIndex(model);
  const found = queryNearby(index, { x: 0, y: 0, z: 0 }, 6).map((entry) => entry.id);
  assert.deepEqual(found.sort(), ['edge', 'near']);
});

test('queryNearby ignores height so a sensor finds the camera above it', () => {
  const model = baseModel({ assets: [asset('camera', 0, 0, 12)] });
  const index = buildClusterIndex(model);
  assert.deepEqual(
    queryNearby(index, { x: 0, y: 0, z: 0 }, 2).map((entry) => entry.id),
    ['camera'],
  );
});

test('queryNearby spans multiple cells', () => {
  const model = baseModel({ assets: [asset('a', 0, 0), asset('b', 25, 0)] });
  const index = buildClusterIndex(model, { cellSizeM: 10 });
  assert.deepEqual(
    queryNearby(index, { x: 12, y: 0, z: 0 }, 15).map((entry) => entry.id).sort(),
    ['a', 'b'],
  );
});

test('queryNearby returns nothing for a non-positive radius', () => {
  const index = buildClusterIndex(baseModel({ assets: [asset('a', 0, 0)] }));
  assert.deepEqual(queryNearby(index, { x: 0, y: 0, z: 0 }, 0), []);
});

test('assetCell reports the bucket an asset belongs to', () => {
  assert.equal(assetCell({ position: { x: 12, y: 3, z: 0 } }, 10), '1:0');
});
