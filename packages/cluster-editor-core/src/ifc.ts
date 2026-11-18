/**
 * IFC-shaped export/import seam.
 *
 * The cluster model is already IFC-shaped, so import and export are a mapping
 * rather than a translation layer. This module is that mapping, kept **pure**:
 * it produces an IFC entity graph, not a STEP file. A browser adapter
 * (`web-ifc`) or a future region-side `anx-bim` sidecar turns the graph into
 * bytes; the mapping itself never depends on WASM, a DOM or a network.
 *
 * Design rules:
 *
 * - `attributes` are the IFC attributes (named after the IFC attribute).
 * - `properties` are the rest, shaped like an `IfcPropertySet`.
 * - `ifcGlobalId` is the model id, so a round-trip preserves identity.
 * - Containment (`IfcRelContainedInSpatialStructure`) is derived from
 *   `storeyId`/`buildingId`, never stored twice.
 *
 * Not mapped yet (documented, not silently dropped): terrain (a TIN is not an
 * IFC entity) and the live-position trace (telemetry, not geometry).
 */
import type {
  ClusterAlignment,
  ClusterAsset,
  ClusterBuilding,
  ClusterGeoReference,
  ClusterMaterial,
  ClusterModel,
  ClusterNetwork,
  ClusterStorey,
  ClusterSurface,
  ClusterZone,
} from './model.ts';

export type IfcEntityKind =
  | 'IfcProject'
  | 'IfcSite'
  | 'IfcBuilding'
  | 'IfcBuildingStorey'
  | 'IfcSpace'
  | 'IfcElement'
  | 'IfcMaterial'
  | 'IfcRelAssociatesMaterial'
  | 'IfcAlignment'
  | 'IfcDistributionSystem';

export type IfcEntity = {
  kind: IfcEntityKind;
  /** IFC GlobalId. The cluster id, so a round-trip is stable. */
  ifcGlobalId: string;
  name?: string;
  /** IFC attributes, keyed by the IFC attribute name. */
  attributes: Record<string, unknown>;
  /** Everything else, shaped like an `IfcPropertySet`. */
  properties?: Record<string, unknown>;
};

export type ClusterIfcModel = {
  /** `IfcProjectedCRS` + `IfcMapConversion`. */
  geoReference: ClusterGeoReference;
  entities: IfcEntity[];
};

function entity(
  kind: IfcEntityKind,
  ifcGlobalId: string,
  name: string | undefined,
  attributes: Record<string, unknown>,
  properties?: Record<string, unknown>,
): IfcEntity {
  return {
    kind,
    ifcGlobalId,
    ...(name ? { name } : {}),
    attributes,
    ...(properties && Object.keys(properties).length ? { properties } : {}),
  };
}

/** Drops `undefined` values so the graph stays small and stable. */
function compact(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}

/**
 * Cluster model → IFC entity graph.
 *
 * The order is stable (project, site, buildings, storeys, spaces, materials,
 * material associations, elements, alignments, systems), so two exports of the
 * same model are identical.
 */
export function toIfcModel(model: ClusterModel): ClusterIfcModel {
  const entities: IfcEntity[] = [];

  entities.push(
    entity('IfcProject', model.id, model.name, compact({
      // The georeference lives on the project/site pair in IFC.
      projectedCrs: model.geoReference.projectedCrs,
      mapConversion: model.geoReference.mapConversion,
    })),
  );
  entities.push(
    entity('IfcSite', `${model.id}:site`, undefined, compact({
      anchor: model.geoReference.anchor,
      gridRotationDeg: model.geoReference.gridRotationDeg,
      heightModel: model.geoReference.heightModel,
    })),
  );

  for (const building of model.buildings) {
    entities.push(
      entity('IfcBuilding', building.id, building.name, {}, compact({
        footprint: building.footprint,
        storeyIds: building.storeyIds,
        ifcGlobalId: building.ifcGlobalId,
      })),
    );
  }

  for (const storey of model.storeys) {
    entities.push(
      entity('IfcBuildingStorey', storey.id, storey.name, compact({
        elevation: storey.elevation,
        height: storey.height,
      }), compact({
        buildingId: storey.buildingId,
        ifcGlobalId: storey.ifcGlobalId,
      })),
    );
  }

  for (const zone of model.zones) {
    entities.push(
      entity('IfcSpace', zone.id, zone.name, compact({ predefinedType: zone.kind }), compact({
        points: zone.points,
        storeyId: zone.storeyId,
        color: zone.color,
        label: zone.label,
        configuration: zone.configuration,
      })),
    );
  }

  for (const material of model.materials ?? []) {
    entities.push(
      entity('IfcMaterial', material.id, material.name, compact({
        kind: material.kind,
        color: material.color,
        textureUrl: material.textureUrl,
      }), compact({
        productRef: material.productRef,
        coverage: material.coverage,
        ifcGlobalId: material.ifcGlobalId,
      })),
    );
  }

  for (const surface of model.surfaces ?? []) {
    entities.push(
      entity('IfcRelAssociatesMaterial', surface.id, undefined, compact({
        surfaceKind: surface.kind,
        materialId: surface.materialId,
      }), compact({
        ownerId: surface.ownerId,
        ownerKind: surface.ownerKind,
        areaM2: surface.areaM2,
        lengthM: surface.lengthM,
        points: surface.points,
        ifcGlobalId: surface.ifcGlobalId,
      })),
    );
  }

  for (const asset of model.assets) {
    entities.push(
      entity('IfcElement', asset.id, asset.name, compact({
        position: asset.position,
        rotationDeg: asset.rotationDeg,
        scale: asset.scale,
      }), compact({
        storeyId: asset.storeyId,
        blueprintRef: asset.blueprintRef,
        productRef: asset.productRef,
        modelRef: asset.modelRef,
        materialOverrides: asset.materialOverrides,
        quantity: asset.quantity,
        configuration: asset.configuration,
        ifcGlobalId: asset.ifcGlobalId,
      })),
    );
  }

  for (const alignment of model.alignments) {
    entities.push(
      entity('IfcAlignment', alignment.id, alignment.name, compact({
        horizontal: alignment.horizontal,
        vertical: alignment.vertical,
      })),
    );
  }

  for (const network of model.networks) {
    entities.push(
      entity('IfcDistributionSystem', network.id, network.name, compact({
        system: network.system,
        systemPredefinedType: network.systemPredefinedType,
      }), compact({
        segments: network.segments,
        nodes: network.nodes,
      })),
    );
  }

  return { geoReference: model.geoReference, entities };
}

function ofKind(entities: IfcEntity[], kind: IfcEntityKind): IfcEntity[] {
  return entities.filter((row) => row.kind === kind);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * IFC entity graph → cluster model.
 *
 * The inverse of {@link toIfcModel}. Unknown entity kinds are ignored rather
 * than throwing, so a graph produced by a newer exporter still imports the
 * parts this version understands.
 */
export function fromIfcModel(ifc: ClusterIfcModel): ClusterModel {
  const project = ofKind(ifc.entities, 'IfcProject')[0];
  const site = ofKind(ifc.entities, 'IfcSite')[0];

  const geoReference: ClusterGeoReference = {
    ...ifc.geoReference,
    ...(ifc.geoReference.projectedCrs === undefined && project?.attributes.projectedCrs !== undefined
      ? { projectedCrs: project.attributes.projectedCrs as number }
      : {}),
    ...(ifc.geoReference.mapConversion === undefined && project?.attributes.mapConversion
      ? { mapConversion: project.attributes.mapConversion as ClusterGeoReference['mapConversion'] }
      : {}),
    ...(ifc.geoReference.gridRotationDeg === undefined && site?.attributes.gridRotationDeg !== undefined
      ? { gridRotationDeg: site.attributes.gridRotationDeg as number }
      : {}),
    ...(ifc.geoReference.heightModel === undefined && site?.attributes.heightModel !== undefined
      ? { heightModel: site.attributes.heightModel as string }
      : {}),
  };

  const buildings: ClusterBuilding[] = ofKind(ifc.entities, 'IfcBuilding').map((row) => ({
    id: row.ifcGlobalId,
    name: row.name ?? row.ifcGlobalId,
    ...(row.properties?.footprint ? { footprint: row.properties.footprint as ClusterBuilding['footprint'] } : {}),
    storeyIds: Array.isArray(row.properties?.storeyIds) ? (row.properties.storeyIds as string[]) : [],
    ...(str(row.properties?.ifcGlobalId) ? { ifcGlobalId: str(row.properties?.ifcGlobalId) } : {}),
  }));

  const storeys: ClusterStorey[] = ofKind(ifc.entities, 'IfcBuildingStorey').map((row) => ({
    id: row.ifcGlobalId,
    buildingId: str(row.properties?.buildingId) ?? '',
    name: row.name ?? row.ifcGlobalId,
    elevation: Number(row.attributes.elevation ?? 0),
    height: Number(row.attributes.height ?? 0),
    ...(str(row.properties?.ifcGlobalId) ? { ifcGlobalId: str(row.properties?.ifcGlobalId) } : {}),
  }));

  const zones: ClusterZone[] = ofKind(ifc.entities, 'IfcSpace').map((row) => ({
    id: row.ifcGlobalId,
    name: row.name ?? row.ifcGlobalId,
    kind: (str(row.attributes.predefinedType) ?? 'other') as ClusterZone['kind'],
    points: Array.isArray(row.properties?.points) ? (row.properties.points as ClusterZone['points']) : [],
    ...(str(row.properties?.storeyId) ? { storeyId: str(row.properties?.storeyId) } : {}),
    ...(str(row.properties?.color) ? { color: str(row.properties?.color) } : {}),
    ...(str(row.properties?.label) ? { label: str(row.properties?.label) } : {}),
    ...(row.properties?.configuration ? { configuration: row.properties.configuration as Record<string, unknown> } : {}),
  }));

  const materials: ClusterMaterial[] = ofKind(ifc.entities, 'IfcMaterial').map((row) => ({
    id: row.ifcGlobalId,
    name: row.name ?? row.ifcGlobalId,
    kind: (str(row.attributes.kind) ?? 'other') as ClusterMaterial['kind'],
    ...(str(row.attributes.color) ? { color: str(row.attributes.color) } : {}),
    ...(str(row.attributes.textureUrl) ? { textureUrl: str(row.attributes.textureUrl) } : {}),
    ...(str(row.properties?.productRef) ? { productRef: str(row.properties?.productRef) } : {}),
    ...(row.properties?.coverage ? { coverage: row.properties.coverage as ClusterMaterial['coverage'] } : {}),
    ...(str(row.properties?.ifcGlobalId) ? { ifcGlobalId: str(row.properties?.ifcGlobalId) } : {}),
  }));

  const surfaces: ClusterSurface[] = ofKind(ifc.entities, 'IfcRelAssociatesMaterial').map((row) => ({
    id: row.ifcGlobalId,
    ownerId: str(row.properties?.ownerId) ?? '',
    ownerKind: (str(row.properties?.ownerKind) ?? 'zone') as ClusterSurface['ownerKind'],
    kind: (str(row.attributes.surfaceKind) ?? 'other') as ClusterSurface['kind'],
    ...(str(row.attributes.materialId) ? { materialId: str(row.attributes.materialId) } : {}),
    ...(row.properties?.areaM2 !== undefined ? { areaM2: Number(row.properties.areaM2) } : {}),
    ...(row.properties?.lengthM !== undefined ? { lengthM: Number(row.properties.lengthM) } : {}),
    ...(row.properties?.points ? { points: row.properties.points as ClusterSurface['points'] } : {}),
    ...(str(row.properties?.ifcGlobalId) ? { ifcGlobalId: str(row.properties?.ifcGlobalId) } : {}),
  }));

  const assets: ClusterAsset[] = ofKind(ifc.entities, 'IfcElement').map((row) => ({
    id: row.ifcGlobalId,
    name: row.name ?? row.ifcGlobalId,
    position: (row.attributes.position as ClusterAsset['position']) ?? { x: 0, y: 0, z: 0 },
    ...(row.attributes.rotationDeg !== undefined ? { rotationDeg: Number(row.attributes.rotationDeg) } : {}),
    ...(row.attributes.scale ? { scale: row.attributes.scale as ClusterAsset['scale'] } : {}),
    ...(str(row.properties?.storeyId) ? { storeyId: str(row.properties?.storeyId) } : {}),
    ...(str(row.properties?.blueprintRef) ? { blueprintRef: str(row.properties?.blueprintRef) } : {}),
    ...(str(row.properties?.productRef) ? { productRef: str(row.properties?.productRef) } : {}),
    ...(row.properties?.modelRef ? { modelRef: row.properties.modelRef as ClusterAsset['modelRef'] } : {}),
    ...(row.properties?.materialOverrides
      ? { materialOverrides: row.properties.materialOverrides as Record<string, string> }
      : {}),
    ...(row.properties?.quantity !== undefined ? { quantity: Number(row.properties.quantity) } : {}),
    ...(row.properties?.configuration
      ? { configuration: row.properties.configuration as Record<string, unknown> }
      : {}),
    ...(str(row.properties?.ifcGlobalId) ? { ifcGlobalId: str(row.properties?.ifcGlobalId) } : {}),
  }));

  const alignments: ClusterAlignment[] = ofKind(ifc.entities, 'IfcAlignment').map((row) => ({
    id: row.ifcGlobalId,
    name: row.name ?? row.ifcGlobalId,
    horizontal: Array.isArray(row.attributes.horizontal) ? (row.attributes.horizontal as ClusterAlignment['horizontal']) : [],
    vertical: Array.isArray(row.attributes.vertical) ? (row.attributes.vertical as ClusterAlignment['vertical']) : [],
  }));

  const networks: ClusterNetwork[] = ofKind(ifc.entities, 'IfcDistributionSystem').map((row) => ({
    id: row.ifcGlobalId,
    name: row.name ?? row.ifcGlobalId,
    system: (str(row.attributes.system) ?? 'other') as ClusterNetwork['system'],
    ...(str(row.attributes.systemPredefinedType)
      ? { systemPredefinedType: str(row.attributes.systemPredefinedType) }
      : {}),
    segments: Array.isArray(row.properties?.segments) ? (row.properties.segments as ClusterNetwork['segments']) : [],
    nodes: Array.isArray(row.properties?.nodes) ? (row.properties.nodes as ClusterNetwork['nodes']) : [],
  }));

  return {
    id: project?.ifcGlobalId ?? 'cluster',
    name: project?.name ?? 'Cluster',
    geoReference,
    buildings,
    storeys,
    zones,
    networks,
    assets,
    alignments,
    materials,
    surfaces,
  };
}
