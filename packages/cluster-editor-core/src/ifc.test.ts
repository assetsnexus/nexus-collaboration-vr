import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromIfcModel, toIfcModel } from './ifc.ts';
import type { ClusterModel } from './model.ts';

function fullModel(): ClusterModel {
  return {
    id: 'cluster-1',
    name: 'Test site',
    geoReference: {
      anchor: { latitude: 52.52, longitude: 13.405, elevation: 34 },
      projectedCrs: 25833,
      mapConversion: {
        eastings: 391776.16,
        northings: 5820073.12,
        orthogonalHeight: 34,
        xAxisAbscissa: 1,
        xAxisOrdinate: 0,
        scale: 1,
      },
      gridRotationDeg: 0,
      heightModel: 'DHHN2016',
    },
    buildings: [
      {
        id: 'b1',
        name: 'House',
        footprint: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
        storeyIds: ['s1'],
      },
    ],
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
    networks: [
      {
        id: 'n1',
        name: 'Water',
        system: 'water',
        segments: [{ id: 'seg1', points: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }] }],
        nodes: [{ id: 'node1', position: { x: 0, y: 0, z: 0 } }],
      },
    ],
    assets: [
      {
        id: 'a1',
        name: 'Chair',
        position: { x: 1, y: 1, z: 0 },
        rotationDeg: 45,
        storeyId: 's1',
        productRef: 'chair-oak',
        modelRef: { modelId: 'chair-oak-v2', format: 'glb' },
        materialOverrides: { fabric: 'linen' },
        quantity: 4,
      },
    ],
    alignments: [
      {
        id: 'al1',
        name: 'Driveway',
        horizontal: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        vertical: [{ station: 0, elevation: 0 }, { station: 20, elevation: 0.5 }],
      },
    ],
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

test('toIfcModel tags every entity with its IFC kind', () => {
  const ifc = toIfcModel(fullModel());
  const kinds = ifc.entities.map((row) => row.kind);
  assert.deepEqual(kinds, [
    'IfcProject',
    'IfcSite',
    'IfcBuilding',
    'IfcBuildingStorey',
    'IfcSpace',
    'IfcMaterial',
    'IfcRelAssociatesMaterial',
    'IfcElement',
    'IfcAlignment',
    'IfcDistributionSystem',
  ]);
});

test('toIfcModel keeps the georeference on the project/site pair', () => {
  const ifc = toIfcModel(fullModel());
  const project = ifc.entities.find((row) => row.kind === 'IfcProject');
  const site = ifc.entities.find((row) => row.kind === 'IfcSite');
  assert.equal(project?.attributes.projectedCrs, 25833);
  assert.deepEqual(site?.attributes.anchor, { latitude: 52.52, longitude: 13.405, elevation: 34 });
  assert.equal(site?.attributes.heightModel, 'DHHN2016');
});

test('toIfcModel is deterministic', () => {
  const model = fullModel();
  assert.deepEqual(toIfcModel(model), toIfcModel(model));
});

test('a full model round-trips through IFC', () => {
  const model = fullModel();
  const back = fromIfcModel(toIfcModel(model));
  assert.deepEqual(back, model);
});

test('a minimal model round-trips through IFC', () => {
  const model: ClusterModel = {
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
  assert.deepEqual(fromIfcModel(toIfcModel(model)), model);
});

test('an unknown entity kind is ignored, not fatal', () => {
  const ifc = toIfcModel(fullModel());
  ifc.entities.push({
    // @ts-expect-error deliberately unknown
    kind: 'IfcFutureThing',
    ifcGlobalId: 'x',
    attributes: {},
  });
  const back = fromIfcModel(ifc);
  assert.equal(back.assets.length, 1);
  assert.equal(back.materials?.length, 1);
});

test('the product and model references survive the round-trip', () => {
  const back = fromIfcModel(toIfcModel(fullModel()));
  assert.equal(back.assets[0].productRef, 'chair-oak');
  assert.deepEqual(back.assets[0].modelRef, { modelId: 'chair-oak-v2', format: 'glb' });
  assert.deepEqual(back.assets[0].materialOverrides, { fabric: 'linen' });
  assert.equal(back.assets[0].quantity, 4);
});
