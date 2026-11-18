import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW,
  buildSceneCommands,
  drawScene,
  pickAssetAt,
  projectPoint,
  type DrawCommand,
} from './scene.ts';
import type { ClusterModel } from '@nexus/cluster-editor-core';

function model(): ClusterModel {
  return {
    id: 'cluster-1',
    name: 'Test site',
    geoReference: { anchor: { latitude: 52.52, longitude: 13.405, elevation: 0 } },
    buildings: [],
    storeys: [{ id: 's1', buildingId: 'b1', name: 'Ground', elevation: 0, height: 2.8 }],
    zones: [
      {
        id: 'z1',
        name: 'Bed',
        kind: 'bed',
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
          { x: 0, y: 3 },
        ],
        color: '#cfe3cf',
      },
    ],
    networks: [
      {
        id: 'n1',
        name: 'Water',
        system: 'water',
        segments: [{ id: 'seg1', points: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] }],
        nodes: [],
      },
    ],
    assets: [
      { id: 'a1', name: 'Pump', position: { x: 1, y: 1, z: 0 } },
      { id: 'a2', name: 'Tank', position: { x: 3, y: 2, z: 0 } },
    ],
    alignments: [],
    materials: [],
    surfaces: [],
  };
}

test('projectPoint is a top-down plan at pitch 0', () => {
  const view = { ...DEFAULT_VIEW, scale: 10, offsetX: 100, offsetY: 100, yawDeg: 0, pitchDeg: 0 };
  const p = projectPoint({ x: 2, y: 3, z: 5 }, view);
  assert.equal(p.x, 120);
  // Height is ignored in a plan view.
  assert.equal(p.y, 130);
});

test('projectPoint lifts height at pitch 90', () => {
  const view = { ...DEFAULT_VIEW, scale: 10, offsetX: 0, offsetY: 0, yawDeg: 0, pitchDeg: 90 };
  const p = projectPoint({ x: 0, y: 0, z: 2 }, view);
  assert.equal(p.x, 0);
  assert.equal(p.y, -20);
});

test('projectPoint rotates with yaw', () => {
  const view = { ...DEFAULT_VIEW, scale: 1, offsetX: 0, offsetY: 0, yawDeg: 90, pitchDeg: 0 };
  const p = projectPoint({ x: 1, y: 0, z: 0 }, view);
  assert.ok(Math.abs(p.x) < 1e-9);
  assert.ok(Math.abs(p.y - 1) < 1e-9);
});

test('buildSceneCommands emits a polygon per zone, a line per segment and a marker per asset', () => {
  const commands = buildSceneCommands(model(), DEFAULT_VIEW);
  const kinds = commands.map((entry) => entry.kind);
  assert.equal(kinds.filter((kind) => kind === 'polygon').length, 1);
  assert.equal(kinds.filter((kind) => kind === 'line').length, 1);
  assert.equal(kinds.filter((kind) => kind === 'marker').length, 2);
});

test('a zone polygon keeps its colour', () => {
  const commands = buildSceneCommands(model(), DEFAULT_VIEW);
  const polygon = commands.find((entry) => entry.kind === 'polygon') as Extract<DrawCommand, { kind: 'polygon' }>;
  assert.equal(polygon.fill, '#cfe3cf');
  assert.equal(polygon.points.length, 4);
});

test('markers come after polygons so they are never hidden', () => {
  const commands = buildSceneCommands(model(), DEFAULT_VIEW);
  const lastPolygon = commands.map((entry) => entry.kind).lastIndexOf('polygon');
  const firstMarker = commands.map((entry) => entry.kind).indexOf('marker');
  assert.ok(firstMarker > lastPolygon);
});

test('pickAssetAt finds the nearest asset within the radius', () => {
  const view = DEFAULT_VIEW;
  const target = projectPoint({ x: 1, y: 1, z: 0 }, view);
  assert.equal(pickAssetAt(model(), view, target), 'a1');
  assert.equal(pickAssetAt(model(), view, { x: target.x + 200, y: target.y }), null);
});

test('drawScene executes the commands on a recording context', () => {
  const calls: string[] = [];
  const ctx = {
    clearRect: () => calls.push('clear'),
    beginPath: () => calls.push('begin'),
    moveTo: () => calls.push('move'),
    lineTo: () => calls.push('line'),
    closePath: () => calls.push('close'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    arc: () => calls.push('arc'),
    fillText: () => calls.push('text'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
  };
  drawScene(ctx, buildSceneCommands(model(), DEFAULT_VIEW), 640, 480);
  assert.equal(calls[0], 'clear');
  assert.ok(calls.includes('fill'));
  assert.ok(calls.includes('arc'));
  assert.ok(calls.includes('text'));
});
