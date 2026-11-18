import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClusterModel } from './validation.ts';
import { baseModel } from './model.test.ts';

test('a minimal model is valid', () => {
  const result = validateClusterModel(baseModel());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('rejects a missing anchor', () => {
  const model = baseModel();
  // @ts-expect-error deliberately invalid
  model.geoReference = {};
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'geoReference.anchor');
});

test('rejects an out-of-range latitude', () => {
  const model = baseModel();
  model.geoReference.anchor.latitude = 120;
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === 'geoReference.anchor.latitude'));
});

test('rejects a storey that points at an unknown building', () => {
  const model = baseModel({
    storeys: [{ id: 's1', buildingId: 'missing', name: 'L0', elevation: 0, height: 3 }],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === 'storeys[0].buildingId'));
});

test('rejects a building that lists an unknown storey', () => {
  const model = baseModel({
    buildings: [{ id: 'b1', name: 'House', storeyIds: ['nope'] }],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === 'buildings[0].storeyIds'));
});

test('warns about a room without a storey', () => {
  const model = baseModel({
    zones: [
      {
        id: 'z1',
        name: 'Living',
        kind: 'room',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].path, 'zones[0].storeyId');
});

test('rejects a zone with fewer than three points', () => {
  const model = baseModel({
    zones: [{ id: 'z1', name: 'Bad', kind: 'bed', points: [{ x: 0, y: 0 }] }],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === 'zones[0].points'));
});

test('rejects an alignment whose stations do not increase', () => {
  const model = baseModel({
    alignments: [
      {
        id: 'a1',
        name: 'Road',
        horizontal: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        vertical: [
          { station: 10, elevation: 0 },
          { station: 5, elevation: 1 },
        ],
      },
    ],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === 'alignments[0].vertical'));
});
