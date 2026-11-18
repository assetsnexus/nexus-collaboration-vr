import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  enuToProjected,
  geodeticToLocalEnu,
  localEnuToGeodetic,
  localEnuToGeodeticProjected,
  projectedToEnu,
  type ClusterGeoReferenceLike,
} from './geo-reference.ts';

const BERLIN = { latitude: 52.520008, longitude: 13.404954, elevation: 34 };

const withMapConversion: ClusterGeoReferenceLike = {
  anchor: BERLIN,
  projectedCrs: 25833,
  mapConversion: {
    eastings: 391_000,
    northings: 5_820_000,
    orthogonalHeight: 34,
    xAxisAbscissa: 1,
    xAxisOrdinate: 0,
    scale: 1,
  },
};

function close(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);
}

test('the local origin sits at the map conversion origin', () => {
  const p = enuToProjected({ east: 0, north: 0, up: 0 }, withMapConversion);
  assert.equal(p.easting, 391_000);
  assert.equal(p.northing, 5_820_000);
  assert.equal(p.height, 34);
});

test('east/north add directly when the rotation is zero', () => {
  const p = enuToProjected({ east: 10, north: 20, up: 1.5 }, withMapConversion);
  assert.equal(p.easting, 391_010);
  assert.equal(p.northing, 5_820_020);
  assert.equal(p.height, 35.5);
});

test('the local grid rotates by the map conversion axes', () => {
  const rotated: ClusterGeoReferenceLike = {
    ...withMapConversion,
    mapConversion: {
      ...withMapConversion.mapConversion!,
      // 90°: local east maps to projected north.
      xAxisAbscissa: 0,
      xAxisOrdinate: 1,
    },
  };
  const p = enuToProjected({ east: 10, north: 0, up: 0 }, rotated);
  close(p.easting, 391_000, 1e-6, 'easting');
  close(p.northing, 5_820_010, 1e-6, 'northing');
});

test('enuToProjected round-trips through projectedToEnu', () => {
  const enu = { east: -12.5, north: 42.25, up: 3 };
  const p = enuToProjected(enu, withMapConversion);
  const back = projectedToEnu(p.easting, p.northing, p.height, withMapConversion);
  close(back.east, enu.east, 1e-9, 'east');
  close(back.north, enu.north, 1e-9, 'north');
  close(back.up, enu.up, 1e-9, 'up');
});

test('the anchor is projected when there is no map conversion', () => {
  const ref: ClusterGeoReferenceLike = { anchor: BERLIN, projectedCrs: 25833 };
  const p = enuToProjected({ east: 0, north: 0, up: 0 }, ref);
  assert.ok(p.easting > 380_000 && p.easting < 400_000, `easting was ${p.easting}`);
  assert.ok(p.northing > 5_800_000 && p.northing < 5_850_000, `northing was ${p.northing}`);
  assert.equal(p.height, 34);
});

test('a reference with neither map conversion nor CRS throws', () => {
  assert.throws(
    () => enuToProjected({ east: 0, north: 0, up: 0 }, { anchor: BERLIN }),
    /neither mapConversion nor projectedCrs/,
  );
});

test('the anchor is the local origin', () => {
  const enu = geodeticToLocalEnu(
    { latitude: BERLIN.latitude, longitude: BERLIN.longitude, height: BERLIN.elevation },
    withMapConversion,
  );
  assert.ok(Math.abs(enu.east) < 1e-9);
  assert.ok(Math.abs(enu.north) < 1e-9);
  assert.ok(Math.abs(enu.up) < 1e-9);
});

test('geodetic ↔ local ENU round-trips through ECEF', () => {
  const target = { latitude: 52.5205, longitude: 13.4105, height: 40 };
  const enu = geodeticToLocalEnu(target, withMapConversion);
  const back = localEnuToGeodetic(enu, withMapConversion);
  assert.ok(Math.abs(back.latitude - target.latitude) < 1e-9);
  assert.ok(Math.abs(back.longitude - target.longitude) < 1e-9);
  assert.ok(Math.abs(back.height - target.height) < 1e-6);
});

test('local ENU round-trips through the projected CRS', () => {
  // A map conversion whose origin is the anchor's real projected position, so
  // the projected path and the ECEF path describe the same frame.
  const consistent: ClusterGeoReferenceLike = {
    anchor: BERLIN,
    projectedCrs: 25833,
    mapConversion: {
      eastings: 391_776.1580224526,
      northings: 5_820_073.117822807,
      orthogonalHeight: 34,
      xAxisAbscissa: 1,
      xAxisOrdinate: 0,
      scale: 1,
    },
  };
  const enu = { east: 25, north: -40, up: 2 };
  const geo = localEnuToGeodeticProjected(enu, consistent);
  const back = geodeticToLocalEnu(geo, consistent);
  // The projected path is flat-earth within the CRS, so it differs from the
  // ECEF path by the grid convergence (~1.1° at Berlin in UTM 33N) and the UTM
  // scale factor. Over ~47 m that is under 1.5 m; the point of the test is that
  // the two paths agree to within the projection's own distortion.
  assert.ok(Math.abs(back.east - enu.east) < 1.5, `east was ${back.east}`);
  assert.ok(Math.abs(back.north - enu.north) < 1.5, `north was ${back.north}`);
});

test('projecting without a CRS throws', () => {
  assert.throws(
    () => localEnuToGeodeticProjected({ east: 0, north: 0, up: 0 }, { anchor: BERLIN }),
    /no projectedCrs/,
  );
});
