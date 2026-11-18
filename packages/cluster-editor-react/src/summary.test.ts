import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClusterSummary } from './ClusterSummary.ts';
import type { ClusterModel } from '@nexus/cluster-editor-core';

function model(): ClusterModel {
  return {
    id: 'cluster-1',
    name: 'Test site',
    geoReference: { anchor: { latitude: 52.52, longitude: 13.405, elevation: 0 } },
    buildings: [{ id: 'b1', name: 'House', storeyIds: [] }],
    storeys: [],
    zones: [],
    alignments: [],
    assets: [
      { id: 'a1', name: 'Chair', position: { x: 0, y: 0, z: 0 }, productRef: 'chair', quantity: 3 },
    ],
    materials: [{ id: 'm1', name: 'Paint', kind: 'paint' }],
    networks: [],
    surfaces: [],
  };
}

test('ClusterSummary renders the model name and counts', () => {
  const html = renderToStaticMarkup(createElement(ClusterSummary, { model: model() }));
  assert.match(html, /Test site/);
  assert.match(html, /Buildings: 1/);
  assert.match(html, /Assets: 1/);
  assert.match(html, /Materials: 1/);
});

test('ClusterSummary renders derived product quantities', () => {
  const html = renderToStaticMarkup(createElement(ClusterSummary, { model: model() }));
  assert.match(html, /chair/);
  assert.match(html, /3 piece/);
});

test('ClusterSummary omits the quantity table when there is nothing to buy', () => {
  const empty: ClusterModel = {
    ...model(),
    assets: [],
    materials: [],
  };
  const html = renderToStaticMarkup(createElement(ClusterSummary, { model: empty }));
  assert.doesNotMatch(html, /cluster-quantities/);
});
