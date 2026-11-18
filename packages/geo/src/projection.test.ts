import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEpsgProjector,
  geodeticToProjected,
  projectedToGeodetic,
  registerProjection,
} from './projection.ts';

const BERLIN = { latitude: 52.520008, longitude: 13.404954, height: 34 };

test('EPSG:25833 projects Berlin to a plausible UTM 33N easting/northing', () => {
  const { easting, northing } = geodeticToProjected(BERLIN, 25833);
  // UTM 33N eastings near Berlin are ~391 km, northings ~5.82 M.
  assert.ok(easting > 380_000 && easting < 400_000, `easting was ${easting}`);
  assert.ok(northing > 5_800_000 && northing < 5_850_000, `northing was ${northing}`);
});

test('EPSG:25833 round-trips a point', () => {
  const { easting, northing } = geodeticToProjected(BERLIN, 25833);
  const back = projectedToGeodetic(easting, northing, 25833, BERLIN.height);
  assert.ok(Math.abs(back.latitude - BERLIN.latitude) < 1e-9);
  assert.ok(Math.abs(back.longitude - BERLIN.longitude) < 1e-9);
  assert.equal(back.height, BERLIN.height);
});

test('the projector is cached per EPSG code', () => {
  assert.equal(createEpsgProjector(25833), createEpsgProjector(25833));
});

test('an unknown EPSG code throws instead of guessing', () => {
  assert.throws(() => createEpsgProjector(999999), /Unknown projection/);
});

test('an invalid EPSG code throws', () => {
  assert.throws(() => createEpsgProjector(0), /Invalid EPSG code/);
  assert.throws(() => createEpsgProjector(1.5), /Invalid EPSG code/);
});

test('a custom local grid can be registered and used', () => {
  registerProjection(
    'SITE_GRID',
    '+proj=tmerc +lat_0=52.52 +lon_0=13.4 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs',
  );
  const projector = createEpsgProjector('SITE_GRID');
  const [easting, northing] = projector.forward(BERLIN);
  // The grid origin is ~0.4 km from Berlin, so the point is a few hundred metres out.
  assert.ok(Math.abs(easting) < 1000, `easting was ${easting}`);
  assert.ok(Math.abs(northing) < 1000, `northing was ${northing}`);
  const [lon, lat] = projector.inverse(easting, northing);
  assert.ok(Math.abs(lat - BERLIN.latitude) < 1e-9);
  assert.ok(Math.abs(lon - BERLIN.longitude) < 1e-9);
});
