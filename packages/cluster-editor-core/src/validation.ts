/**
 * Model validation.
 *
 * Pure and framework-free so the portal, the reference app and a partner app
 * all reject the same model for the same reason. Errors carry a path so the UI
 * can point at the offending entity instead of showing a generic failure.
 */
import type { ClusterModel } from './model.ts';

export type ValidationIssue = {
  /** Dotted path, e.g. `storeys[2].elevation`. */
  path: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function validateClusterModel(model: ClusterModel): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!model.geoReference?.anchor) {
    errors.push({ path: 'geoReference.anchor', message: 'a cluster needs a WGS84 anchor' });
  } else {
    const { latitude, longitude } = model.geoReference.anchor;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      errors.push({ path: 'geoReference.anchor.latitude', message: 'must be between -90 and 90' });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      errors.push({ path: 'geoReference.anchor.longitude', message: 'must be between -180 and 180' });
    }
  }

  const buildingIds = new Set(model.buildings.map((building) => building.id));
  const storeyIds = new Set(model.storeys.map((storey) => storey.id));

  model.buildings.forEach((building, index) => {
    for (const storeyId of building.storeyIds) {
      if (!storeyIds.has(storeyId)) {
        errors.push({
          path: `buildings[${index}].storeyIds`,
          message: `references unknown storey ${storeyId}`,
        });
      }
    }
  });

  model.storeys.forEach((storey, index) => {
    if (!buildingIds.has(storey.buildingId)) {
      errors.push({
        path: `storeys[${index}].buildingId`,
        message: `references unknown building ${storey.buildingId}`,
      });
    }
    if (!Number.isFinite(storey.elevation)) {
      errors.push({ path: `storeys[${index}].elevation`, message: 'must be a number' });
    }
    if (!(storey.height > 0)) {
      errors.push({ path: `storeys[${index}].height`, message: 'must be greater than zero' });
    }
  });

  model.zones.forEach((zone, index) => {
    if (zone.points.length < 3) {
      errors.push({ path: `zones[${index}].points`, message: 'a zone needs at least three points' });
    }
    if (zone.kind === 'room' && !zone.storeyId) {
      warnings.push({
        path: `zones[${index}].storeyId`,
        message: 'a room without a storey will not map to IfcSpace',
      });
    }
    if (zone.storeyId && !storeyIds.has(zone.storeyId)) {
      errors.push({
        path: `zones[${index}].storeyId`,
        message: `references unknown storey ${zone.storeyId}`,
      });
    }
  });

  model.networks.forEach((network, index) => {
    network.segments.forEach((segment, segmentIndex) => {
      if (segment.points.length < 2) {
        errors.push({
          path: `networks[${index}].segments[${segmentIndex}].points`,
          message: 'a segment needs at least two points',
        });
      }
    });
  });

  model.assets.forEach((asset, index) => {
    if (asset.storeyId && !storeyIds.has(asset.storeyId)) {
      errors.push({
        path: `assets[${index}].storeyId`,
        message: `references unknown storey ${asset.storeyId}`,
      });
    }
  });

  model.alignments.forEach((alignment, index) => {
    if (alignment.horizontal.length < 2) {
      errors.push({
        path: `alignments[${index}].horizontal`,
        message: 'an alignment needs at least two horizontal points',
      });
    }
    const stations = alignment.vertical.map((point) => point.station);
    for (let i = 1; i < stations.length; i += 1) {
      if (stations[i] <= stations[i - 1]) {
        errors.push({
          path: `alignments[${index}].vertical`,
          message: 'stations must increase',
        });
        break;
      }
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}
