import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProductQuantities,
  polygonArea,
  resolvePlacedModel,
  resolveSlotMaterial,
  surfaceArea,
} from './materials.ts';
import { baseModel } from './model.test.ts';

test('polygonArea measures a square', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];
  assert.equal(polygonArea(square), 12);
});

test('polygonArea is winding-order independent', () => {
  const cw = [
    { x: 0, y: 0 },
    { x: 0, y: 3 },
    { x: 4, y: 3 },
    { x: 4, y: 0 },
  ];
  assert.equal(polygonArea(cw), 12);
});

test('polygonArea is zero for a degenerate polygon', () => {
  assert.equal(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0);
  assert.equal(polygonArea([]), 0);
});

test('surfaceArea prefers an explicit area', () => {
  assert.equal(surfaceArea({ areaM2: 7.5 }), 7.5);
});

test('surfaceArea falls back to the polygon', () => {
  const area = surfaceArea({
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
  });
  assert.equal(area, 4);
});

test('surfaceArea is zero, never NaN, when there is nothing to measure', () => {
  assert.equal(surfaceArea({}), 0);
});

test('resolvePlacedModel lets the placement override the product model', () => {
  const resolved = resolvePlacedModel(
    { modelRef: { modelId: 'chair-b' } },
    { modelRef: { modelId: 'chair-a' } },
  );
  assert.deepEqual(resolved, { modelId: 'chair-b' });
});

test('resolvePlacedModel falls back to the product model', () => {
  assert.deepEqual(resolvePlacedModel({}, { modelRef: { modelId: 'chair-a' } }), {
    modelId: 'chair-a',
  });
});

test('resolvePlacedModel returns null when neither has a model', () => {
  assert.equal(resolvePlacedModel({}, null), null);
});

test('resolveSlotMaterial lets the placement override a product slot', () => {
  assert.equal(
    resolveSlotMaterial({ materialOverrides: { fabric: 'linen' } }, 'fabric', 'wool'),
    'linen',
  );
});

test('resolveSlotMaterial falls back to the product default', () => {
  assert.equal(resolveSlotMaterial({}, 'fabric', 'wool'), 'wool');
});

test('resolveSlotMaterial returns null when neither is set', () => {
  assert.equal(resolveSlotMaterial({}, 'fabric'), null);
});

test('computeProductQuantities counts placed assets by their quantity', () => {
  const model = baseModel({
    assets: [
      { id: 'a1', name: 'Chair', position: { x: 0, y: 0, z: 0 }, productRef: 'chair' },
      { id: 'a2', name: 'Chair', position: { x: 1, y: 0, z: 0 }, productRef: 'chair', quantity: 4 },
    ],
  });
  assert.deepEqual(computeProductQuantities(model), [
    { productId: 'chair', count: 5, units: 5, unit: 'piece' },
  ]);
});

test('computeProductQuantities turns a painted floor into litres of paint', () => {
  const model = baseModel({
    zones: [
      {
        id: 'room-1',
        name: 'Living room',
        kind: 'room',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 4 },
          { x: 0, y: 4 },
        ],
      },
    ],
    materials: [
      {
        id: 'paint-white',
        name: 'White paint',
        kind: 'paint',
        productRef: 'paint-10l',
        coverage: { unit: 'm2', perUnit: 10 },
      },
    ],
    surfaces: [
      { id: 's1', ownerId: 'room-1', ownerKind: 'zone', kind: 'floor', materialId: 'paint-white' },
    ],
  });
  // 20 m² / 10 m² per litre = 2 litres.
  assert.deepEqual(computeProductQuantities(model), [
    { productId: 'paint-10l', count: 0, areaM2: 20, units: 2, unit: 'm2' },
  ]);
});

test('computeProductQuantities applies the waste factor and rounds up', () => {
  const model = baseModel({
    materials: [
      {
        id: 'tile',
        name: 'Tile',
        kind: 'tile',
        productRef: 'tile-box',
        coverage: { unit: 'm2', perUnit: 1.44, wasteFactor: 0.1 },
      },
    ],
    surfaces: [
      { id: 's1', ownerId: 'b1', ownerKind: 'building', kind: 'floor', materialId: 'tile', areaM2: 10 },
    ],
  });
  // 10 / 1.44 * 1.1 = 7.64 -> 8 boxes.
  assert.equal(computeProductQuantities(model)[0].units, 8);
});

test('computeProductQuantities measures a linear product by length', () => {
  const model = baseModel({
    materials: [
      {
        id: 'skirting',
        name: 'Skirting',
        kind: 'wood',
        productRef: 'skirting-2m',
        coverage: { unit: 'm', perUnit: 2 },
      },
    ],
    surfaces: [
      { id: 's1', ownerId: 'b1', ownerKind: 'building', kind: 'wall', materialId: 'skirting', lengthM: 9 },
    ],
  });
  assert.deepEqual(computeProductQuantities(model), [
    { productId: 'skirting-2m', count: 0, lengthM: 9, units: 5, unit: 'm' },
  ]);
});

test('computeProductQuantities ignores a material without a product or coverage', () => {
  const model = baseModel({
    materials: [{ id: 'm1', name: 'Unpriced', kind: 'other' }],
    surfaces: [
      { id: 's1', ownerId: 'b1', ownerKind: 'building', kind: 'floor', materialId: 'm1', areaM2: 5 },
    ],
  });
  assert.deepEqual(computeProductQuantities(model), []);
});

test('computeProductQuantities is stable and sorted by product id', () => {
  const model = baseModel({
    assets: [
      { id: 'a1', name: 'B', position: { x: 0, y: 0, z: 0 }, productRef: 'zeta' },
      { id: 'a2', name: 'A', position: { x: 0, y: 0, z: 0 }, productRef: 'alpha' },
    ],
  });
  assert.deepEqual(
    computeProductQuantities(model).map((row) => row.productId),
    ['alpha', 'zeta'],
  );
});
