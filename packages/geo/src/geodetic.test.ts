import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ecefToEnu,
  ecefToGeodetic,
  enuToEcef,
  enuToGeodetic,
  geodeticToEcef,
  geodeticToEnu,
} from './geodetic.ts';
import { MARS, MOON, WGS84, resolveEllipsoid } from './ellipsoid.ts';

const BERLIN = { latitude: 52.520008, longitude: 13.404954, height: 34 };

test('geodeticToEcef matches the WGS84 reference for a known point', () => {
  // Equator / prime meridian at sea level is (a, 0, 0).
  const p = geodeticToEcef({ latitude: 0, longitude: 0, height: 0 });
  assert.ok(Math.abs(p.x - WGS84.a) < 1e-6);
  assert.ok(Math.abs(p.y) < 1e-6);
  assert.ok(Math.abs(p.z) < 1e-6);

  // North pole at sea level is (0, 0, b).
  const pole = geodeticToEcef({ latitude: 90, longitude: 0, height: 0 });
  assert.ok(Math.abs(pole.x) < 1e-6);
  assert.ok(Math.abs(pole.z - WGS84.b) < 1e-6);
});

test('ecefToGeodetic round-trips a mid-latitude point', () => {
  const back = ecefToGeodetic(geodeticToEcef(BERLIN));
  assert.ok(Math.abs(back.latitude - BERLIN.latitude) < 1e-9);
  assert.ok(Math.abs(back.longitude - BERLIN.longitude) < 1e-9);
  assert.ok(Math.abs(back.height - BERLIN.height) < 1e-6);
});

test('ecefToGeodetic handles the polar axis without stalling', () => {
  const pole = ecefToGeodetic({ x: 0, y: 0, z: WGS84.b + 100 });
  assert.equal(pole.latitude, 90);
  assert.ok(Math.abs(pole.height - 100) < 1e-6);

  const south = ecefToGeodetic({ x: 0, y: 0, z: -(WGS84.b + 50) });
  assert.equal(south.latitude, -90);
  assert.ok(Math.abs(south.height - 50) < 1e-6);
});

test('ENU round-trips through ECEF', () => {
  const enu = { east: 120, north: -45, up: 3.5 };
  const ecef = enuToEcef(enu, BERLIN);
  const back = ecefToEnu(ecef, BERLIN);
  assert.ok(Math.abs(back.east - enu.east) < 1e-6);
  assert.ok(Math.abs(back.north - enu.north) < 1e-6);
  assert.ok(Math.abs(back.up - enu.up) < 1e-6);
});

test('geodeticToEnu puts the origin at zero', () => {
  const enu = geodeticToEnu(BERLIN, BERLIN);
  assert.ok(Math.abs(enu.east) < 1e-9);
  assert.ok(Math.abs(enu.north) < 1e-9);
  assert.ok(Math.abs(enu.up) < 1e-9);
});

test('geodeticToEnu and enuToGeodetic are inverse', () => {
  const target = { latitude: 52.5205, longitude: 13.4105, height: 40 };
  const enu = geodeticToEnu(target, BERLIN);
  const back = enuToGeodetic(enu, BERLIN);
  assert.ok(Math.abs(back.latitude - target.latitude) < 1e-9);
  assert.ok(Math.abs(back.longitude - target.longitude) < 1e-9);
  assert.ok(Math.abs(back.height - target.height) < 1e-6);
});

test('a 100 m east offset is ~100 m east in ENU', () => {
  const enu = geodeticToEnu({ latitude: BERLIN.latitude, longitude: BERLIN.longitude + 0.0014, height: BERLIN.height }, BERLIN);
  assert.ok(enu.east > 90 && enu.east < 100);
  assert.ok(Math.abs(enu.north) < 1);
});

test('the same math works on another body', () => {
  const moon = resolveEllipsoid('MOON');
  const p = geodeticToEcef({ latitude: 0, longitude: 0, height: 0 }, moon);
  assert.ok(Math.abs(p.x - MOON.a) < 1e-6);
  const back = ecefToGeodetic(p, moon);
  assert.ok(Math.abs(back.latitude) < 1e-9);

  const mars = resolveEllipsoid(MARS);
  const mp = geodeticToEcef({ latitude: 10, longitude: 20, height: 0 }, mars);
  const mback = ecefToGeodetic(mp, mars);
  assert.ok(Math.abs(mback.latitude - 10) < 1e-9);
  assert.ok(Math.abs(mback.longitude - 20) < 1e-9);
});

test('resolveEllipsoid defaults to WGS84', () => {
  assert.equal(resolveEllipsoid(undefined).name, 'WGS84');
  assert.equal(resolveEllipsoid('nope').name, 'WGS84');
  assert.equal(resolveEllipsoid('grs80').name, 'GRS80');
});
