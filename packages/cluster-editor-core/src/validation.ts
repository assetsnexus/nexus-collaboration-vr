/**
 * Model validation.
 *
 * Pure and framework-free so the portal, the reference app and a partner app
 * all reject the same model for the same reason. Errors carry a path so the UI
 * can point at the offending entity instead of showing a generic failure.
 */
import type { ClusterModel } from './model.ts';

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MODEL_FORMATS = new Set(['glb', 'gltf', 'vrm', 'ifc', 'urdf', 'other']);

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
  const zoneIds = new Set(model.zones.map((zone) => zone.id));
  const materialIds = new Set((model.materials ?? []).map((material) => material.id));

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
    if (asset.modelRef?.format && !MODEL_FORMATS.has(asset.modelRef.format)) {
      errors.push({
        path: `assets[${index}].modelRef.format`,
        message: `unknown model format ${asset.modelRef.format}`,
      });
    }
    if (asset.quantity !== undefined && !(asset.quantity > 0)) {
      errors.push({ path: `assets[${index}].quantity`, message: 'must be greater than zero' });
    }
    for (const [slot, materialId] of Object.entries(asset.materialOverrides ?? {})) {
      if (!materialIds.has(materialId)) {
        errors.push({
          path: `assets[${index}].materialOverrides.${slot}`,
          message: `references unknown material ${materialId}`,
        });
      }
    }
  });

  model.materials?.forEach((material, index) => {
    if (!material.id) {
      errors.push({ path: `materials[${index}].id`, message: 'a material needs an id' });
    }
    if (material.color && !HEX_COLOR.test(material.color)) {
      errors.push({ path: `materials[${index}].color`, message: 'must be a hex colour' });
    }
    if (material.coverage && !(material.coverage.perUnit > 0)) {
      errors.push({
        path: `materials[${index}].coverage.perUnit`,
        message: 'must be greater than zero',
      });
    }
    if (material.coverage && material.coverage.wasteFactor !== undefined && material.coverage.wasteFactor < 0) {
      errors.push({
        path: `materials[${index}].coverage.wasteFactor`,
        message: 'must not be negative',
      });
    }
  });

  model.surfaces?.forEach((surface, index) => {
    const ownerExists =
      surface.ownerKind === 'zone' ? zoneIds.has(surface.ownerId) : buildingIds.has(surface.ownerId);
    if (!ownerExists) {
      errors.push({
        path: `surfaces[${index}].ownerId`,
        message: `references unknown ${surface.ownerKind} ${surface.ownerId}`,
      });
    }
    if (surface.materialId && !materialIds.has(surface.materialId)) {
      errors.push({
        path: `surfaces[${index}].materialId`,
        message: `references unknown material ${surface.materialId}`,
      });
    }
    if (surface.areaM2 !== undefined && surface.areaM2 < 0) {
      errors.push({ path: `surfaces[${index}].areaM2`, message: 'must not be negative' });
    }
    if (surface.lengthM !== undefined && surface.lengthM < 0) {
      errors.push({ path: `surfaces[${index}].lengthM`, message: 'must not be negative' });
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
