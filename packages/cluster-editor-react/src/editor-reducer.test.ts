import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HISTORY,
  clusterEditorReducer,
  initialEditorState,
} from './editor-reducer.ts';
import type { ClusterAsset, ClusterModel } from '@nexus/cluster-editor-core';

function model(): ClusterModel {
  return {
    id: 'cluster-1',
    name: 'Test site',
    geoReference: { anchor: { latitude: 52.52, longitude: 13.405, elevation: 0 } },
    buildings: [],
    storeys: [],
    zones: [],
    alignments: [],
    assets: [],
    materials: [],
    networks: [],
    surfaces: [],
  };
}

function chair(id: string, x = 0): ClusterAsset {
  return { id, name: 'Chair', position: { x, y: 0, z: 0 } };
}

test('addAsset adds the asset and records one history step', () => {
  const state = clusterEditorReducer(initialEditorState(model()), {
    type: 'addAsset',
    asset: chair('a1'),
  });
  assert.equal(state.model.assets.length, 1);
  assert.equal(state.past.length, 1);
  assert.equal(state.future.length, 0);
});

test('updateAsset merges the changes', () => {
  let state = clusterEditorReducer(initialEditorState(model()), { type: 'addAsset', asset: chair('a1') });
  state = clusterEditorReducer(state, { type: 'updateAsset', id: 'a1', changes: { name: 'Armchair' } });
  assert.equal(state.model.assets[0].name, 'Armchair');
  assert.deepEqual(state.model.assets[0].position, { x: 0, y: 0, z: 0 });
});

test('updateAsset on an unknown id is a no-op', () => {
  const initial = initialEditorState(model());
  const state = clusterEditorReducer(initial, { type: 'updateAsset', id: 'nope', changes: { name: 'X' } });
  assert.equal(state, initial);
});

test('removeAsset removes it', () => {
  let state = clusterEditorReducer(initialEditorState(model()), { type: 'addAsset', asset: chair('a1') });
  state = clusterEditorReducer(state, { type: 'removeAsset', id: 'a1' });
  assert.equal(state.model.assets.length, 0);
});

test('undo restores the previous model', () => {
  const initial = initialEditorState(model());
  let state = clusterEditorReducer(initial, { type: 'addAsset', asset: chair('a1') });
  state = clusterEditorReducer(state, { type: 'undo' });
  assert.deepEqual(state.model, initial.model);
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 1);
});

test('redo re-applies the undone change', () => {
  const initial = initialEditorState(model());
  let state = clusterEditorReducer(initial, { type: 'addAsset', asset: chair('a1') });
  state = clusterEditorReducer(state, { type: 'undo' });
  state = clusterEditorReducer(state, { type: 'redo' });
  assert.equal(state.model.assets.length, 1);
  assert.equal(state.past.length, 1);
  assert.equal(state.future.length, 0);
});

test('undo walks back several steps', () => {
  const initial = initialEditorState(model());
  let state = clusterEditorReducer(initial, { type: 'addAsset', asset: chair('a1') });
  state = clusterEditorReducer(state, { type: 'addAsset', asset: chair('a2') });
  state = clusterEditorReducer(state, { type: 'addAsset', asset: chair('a3') });
  state = clusterEditorReducer(state, { type: 'undo' });
  state = clusterEditorReducer(state, { type: 'undo' });
  assert.deepEqual(state.model.assets.map((entry) => entry.id), ['a1']);
});

test('a new edit clears the redo stack', () => {
  let state = clusterEditorReducer(initialEditorState(model()), { type: 'addAsset', asset: chair('a1') });
  state = clusterEditorReducer(state, { type: 'undo' });
  state = clusterEditorReducer(state, { type: 'addAsset', asset: chair('a2') });
  assert.equal(state.future.length, 0);
  assert.deepEqual(state.model.assets.map((entry) => entry.id), ['a2']);
});

test('a no-op action does not add history', () => {
  const initial = initialEditorState(model());
  const state = clusterEditorReducer(initial, { type: 'removeAsset', id: 'missing' });
  assert.equal(state, initial);
});

test('history is capped', () => {
  let state = initialEditorState(model());
  for (let i = 0; i < MAX_HISTORY + 5; i += 1) {
    state = clusterEditorReducer(state, { type: 'addAsset', asset: chair(`a${i}`) });
  }
  assert.equal(state.past.length, MAX_HISTORY);
});

test('paintSurface adds a surface', () => {
  const state = clusterEditorReducer(initialEditorState(model()), {
    type: 'paintSurface',
    surface: { id: 's1', ownerId: 'b1', ownerKind: 'building', kind: 'floor', materialId: 'm1' },
  });
  assert.equal(state.model.surfaces?.length, 1);
});

test('addMaterial adds a material', () => {
  const state = clusterEditorReducer(initialEditorState(model()), {
    type: 'addMaterial',
    material: { id: 'm1', name: 'Paint', kind: 'paint' },
  });
  assert.equal(state.model.materials?.length, 1);
});

test('replace swaps the whole model and is undoable', () => {
  const initial = initialEditorState(model());
  const next = { ...model(), name: 'Renamed' };
  let state = clusterEditorReducer(initial, { type: 'replace', model: next });
  assert.equal(state.model.name, 'Renamed');
  state = clusterEditorReducer(state, { type: 'undo' });
  assert.equal(state.model.name, 'Test site');
});
