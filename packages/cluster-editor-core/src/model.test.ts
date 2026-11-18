import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClusterModel } from './model.ts';

export function baseModel(overrides: Partial<ClusterModel> = {}): ClusterModel {
  return {
    id: 'cluster-1',
    name: 'Test site',
    geoReference: {
      anchor: { latitude: 52.52, longitude: 13.405, elevation: 34 },
      projectedCrs: 25833,
    },
    buildings: [],
    storeys: [],
    zones: [],
    networks: [],
    assets: [],
    alignments: [],
    ...overrides,
  };
}

test('a minimal model has the expected shape', () => {
  const model = baseModel();
  assert.equal(model.id, 'cluster-1');
  assert.equal(model.geoReference.anchor.latitude, 52.52);
  assert.deepEqual(model.buildings, []);
});
