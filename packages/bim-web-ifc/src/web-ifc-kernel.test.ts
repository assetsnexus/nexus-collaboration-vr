import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebIfcKernel } from './web-ifc-kernel.ts';
import type { ClusterModel } from '@nexus/cluster-editor-core';

function model(): ClusterModel {
  return {
    id: 'cluster-1',
    name: 'Test site',
    geoReference: {
      anchor: { latitude: 52.52, longitude: 13.405, elevation: 34 },
      projectedCrs: 25833,
    },
    buildings: [{ id: 'b1', name: 'House', storeyIds: ['s1'] }],
    storeys: [{ id: 's1', buildingId: 'b1', name: 'Ground floor', elevation: 0, height: 2.8 }],
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
        storeyId: 's1',
        color: '#e8e2d6',
      },
    ],
    networks: [],
    assets: [
      {
        id: 'a1',
        name: 'Chair',
        position: { x: 1, y: 2, z: 0 },
        rotationDeg: 45,
        storeyId: 's1',
        productRef: 'chair-oak',
        modelRef: { modelId: 'chair-oak-v2', format: 'glb' },
        materialOverrides: { fabric: 'linen' },
        quantity: 4,
      },
    ],
    alignments: [],
    materials: [
      {
        id: 'paint-white',
        name: 'White paint',
        kind: 'paint',
        color: '#f5f5f0',
        productRef: 'paint-10l',
        coverage: { unit: 'm2', perUnit: 10, wasteFactor: 0.1 },
      },
    ],
    surfaces: [
      { id: 'surf-1', ownerId: 'room-1', ownerKind: 'zone', kind: 'floor', materialId: 'paint-white' },
    ],
  };
}

const kernel = createWebIfcKernel();

test('web-ifc exports a valid IFC4 file', async () => {
  const bytes = await kernel.exportIfc(model());
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^ISO-10303-21;/);
  assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\)/);
});

test('a cluster model round-trips through web-ifc', async () => {
  const original = model();
  const bytes = await kernel.exportIfc(original);
  const back = await kernel.importIfc(bytes);

  assert.equal(back.id, original.id);
  assert.equal(back.name, original.name);
  assert.deepEqual(back.geoReference, original.geoReference);

  assert.equal(back.buildings.length, 1);
  assert.equal(back.buildings[0].name, 'House');
  assert.deepEqual(back.buildings[0].storeyIds, ['s1']);

  assert.equal(back.storeys.length, 1);
  assert.equal(back.storeys[0].elevation, 0);
  assert.equal(back.storeys[0].height, 2.8);
  assert.equal(back.storeys[0].buildingId, 'b1');

  assert.equal(back.zones.length, 1);
  assert.equal(back.zones[0].name, 'Living room');
  assert.equal(back.zones[0].kind, 'room');
  assert.equal(back.zones[0].points.length, 4);

  assert.equal(back.materials?.length, 1);
  assert.equal(back.materials?.[0].kind, 'paint');
  assert.equal(back.materials?.[0].productRef, 'paint-10l');

  assert.equal(back.surfaces?.length, 1);
  assert.equal(back.surfaces?.[0].materialId, 'paint-white');

  assert.equal(back.assets.length, 1);
  assert.equal(back.assets[0].name, 'Chair');
  assert.deepEqual(back.assets[0].position, { x: 1, y: 2, z: 0 });
  assert.equal(back.assets[0].rotationDeg, 45);
  assert.equal(back.assets[0].productRef, 'chair-oak');
  assert.deepEqual(back.assets[0].modelRef, { modelId: 'chair-oak-v2', format: 'glb' });
  assert.deepEqual(back.assets[0].materialOverrides, { fabric: 'linen' });
  assert.equal(back.assets[0].quantity, 4);
});

test('an empty cluster round-trips', async () => {
  const empty: ClusterModel = {
    id: 'c2',
    name: 'Empty',
    geoReference: { anchor: { latitude: 0, longitude: 0, elevation: 0 } },
    buildings: [],
    storeys: [],
    zones: [],
    networks: [],
    assets: [],
    alignments: [],
    materials: [],
    surfaces: [],
  };
  const back = await kernel.importIfc(await kernel.exportIfc(empty));
  assert.equal(back.name, 'Empty');
  assert.deepEqual(back.geoReference, empty.geoReference);
  assert.equal(back.assets.length, 0);
});
