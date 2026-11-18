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

test('rejects a surface that references an unknown material', () => {
  const model = baseModel({
    surfaces: [{ id: 's1', ownerId: 'b1', ownerKind: 'building', kind: 'floor', materialId: 'nope' }],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'surfaces[0].materialId'));
});

test('rejects a surface that references an unknown owner', () => {
  const model = baseModel({
    surfaces: [{ id: 's1', ownerId: 'missing', ownerKind: 'zone', kind: 'floor' }],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'surfaces[0].ownerId'));
});

test('accepts a surface owned by a known zone', () => {
  const model = baseModel({
    zones: [
      {
        id: 'room-1',
        name: 'Room',
        kind: 'room',
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      },
    ],
    surfaces: [{ id: 's1', ownerId: 'room-1', ownerKind: 'zone', kind: 'floor' }],
  });
  assert.equal(validateClusterModel(model).ok, true);
});

test('rejects a material with a non-hex colour', () => {
  const model = baseModel({ materials: [{ id: 'm1', name: 'Paint', kind: 'paint', color: 'red' }] });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'materials[0].color'));
});

test('rejects a material coverage that cannot divide', () => {
  const model = baseModel({
    materials: [
      { id: 'm1', name: 'Paint', kind: 'paint', coverage: { unit: 'm2', perUnit: 0 } },
    ],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'materials[0].coverage.perUnit'));
});

test('rejects an unknown model format on a placed asset', () => {
  const model = baseModel({
    assets: [
      {
        id: 'a1',
        name: 'Chair',
        position: { x: 0, y: 0, z: 0 },
        // @ts-expect-error deliberately invalid
        modelRef: { format: 'obj' },
      },
    ],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'assets[0].modelRef.format'));
});

test('rejects a material override that references an unknown material', () => {
  const model = baseModel({
    assets: [
      {
        id: 'a1',
        name: 'Chair',
        position: { x: 0, y: 0, z: 0 },
        materialOverrides: { fabric: 'nope' },
      },
    ],
  });
  const result = validateClusterModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'assets[0].materialOverrides.fabric'));
});
