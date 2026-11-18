import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destination, geodesic, geodesicDistance, initialBearing } from './geodesic.ts';

const BERLIN = { latitude: 52.520008, longitude: 13.404954, height: 0 };
const HAMBURG = { latitude: 53.551086, longitude: 9.993682, height: 0 };

test('Berlin → Hamburg is about 255 km', () => {
  const d = geodesicDistance(BERLIN, HAMBURG);
  assert.ok(d > 253_000 && d < 257_000, `distance was ${d}`);
});

test('the bearing points north-west', () => {
  const bearing = initialBearing(BERLIN, HAMBURG);
  assert.ok(bearing > 280 && bearing < 300, `bearing was ${bearing}`);
});

test('distance is symmetric', () => {
  const a = geodesicDistance(BERLIN, HAMBURG);
  const b = geodesicDistance(HAMBURG, BERLIN);
  assert.ok(Math.abs(a - b) < 1e-6);
});

test('coincident points are zero', () => {
  const result = geodesic(BERLIN, BERLIN);
  assert.equal(result.distance, 0);
});

test('destination inverts the distance', () => {
  const target = destination(BERLIN, 90, 1000);
  const d = geodesicDistance(BERLIN, target);
  assert.ok(Math.abs(d - 1000) < 1e-3, `distance was ${d}`);
  // Due east keeps the latitude almost constant.
  assert.ok(Math.abs(target.latitude - BERLIN.latitude) < 1e-6);
});

test('destination round-trips a bearing', () => {
  const target = destination(BERLIN, 45, 5000);
  const bearing = initialBearing(BERLIN, target);
  assert.ok(Math.abs(bearing - 45) < 1e-6, `bearing was ${bearing}`);
});

test('a near-antipodal pair falls back instead of returning a wrong number', () => {
  // Vincenty does not converge for nearly antipodal points.
  const a = { latitude: 0, longitude: 0, height: 0 };
  const b = { latitude: 0.5, longitude: 179.7, height: 0 };
  const d = geodesicDistance(a, b);
  // Half the circumference, minus a little.
  assert.ok(d > 19_000_000 && d < 20_100_000, `distance was ${d}`);
});
