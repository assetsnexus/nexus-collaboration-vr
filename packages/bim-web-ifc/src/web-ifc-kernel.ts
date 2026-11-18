/**
 * `web-ifc` adapter for the `BimKernel` seam.
 *
 * The cluster model is IFC-shaped, so this adapter maps the standard entities a
 * BIM tool expects — project, site, building, storey, space, element, material,
 * placement, aggregation, material association — and keeps the app-specific
 * fields in one custom property set (`Pset_ClusterData`).
 *
 * That split is deliberate:
 *
 * - a BIM tool opens the file and sees real spatial structure, placements and
 *   materials;
 * - the cluster round-trips exactly, because the pset carries the fields IFC has
 *   no slot for (product refs, model overrides, coverage, zone polygons).
 *
 * Not exported yet (documented, not silently dropped): extruded-solid geometry
 * for zones and standard `IfcElementQuantity` sets. The seam is stable, so
 * adding them does not change a caller.
 */
import {
  IfcAPI,
  IFCPROJECT,
  IFCSITE,
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCSPACE,
  IFCBUILDINGELEMENTPROXY,
  IFCMATERIAL,
  IFCRELASSOCIATESMATERIAL,
  IFCRELAGGREGATES,
  IFCLOCALPLACEMENT,
  IFCAXIS2PLACEMENT3D,
  IFCCARTESIANPOINT,
  IFCDIRECTION,
  IFCPROPERTYSET,
  IFCPROPERTYSINGLEVALUE,
  IFCTEXT,
  IFCRELDEFINESBYPROPERTIES,
} from 'web-ifc';
import type { BimKernel } from '@nexus/cluster-editor-core';
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
} from '@nexus/cluster-editor-core';

const PSET_NAME = 'Pset_ClusterData';
const PSET_VERSION = 1;

/** The fields IFC has no first-class slot for, keyed by entity id. */
type ClusterDataPset = {
  kind: 'cluster-data';
  version: number;
  /** The cluster id, because an IFC GlobalId is a different alphabet. */
  modelId?: string;
  /** IFC GlobalId → the original cluster id, so a round-trip keeps identity. */
  ids?: Record<string, string>;
  geoReference?: ClusterGeoReference;
  buildings?: Record<string, Pick<ClusterBuilding, 'footprint' | 'storeyIds' | 'ifcGlobalId'>>;
  storeys?: Record<string, { buildingId: string; height?: number; ifcGlobalId?: string }>;
  zones?: Record<string, Pick<ClusterZone, 'points' | 'storeyId' | 'color' | 'label' | 'configuration'>>;
  materials?: Record<
    string,
    Pick<ClusterMaterial, 'kind' | 'color' | 'textureUrl' | 'productRef' | 'coverage' | 'ifcGlobalId'> & { id?: string }
  >;
  surfaces?: Record<
    string,
    Pick<ClusterSurface, 'ownerId' | 'ownerKind' | 'kind' | 'materialId' | 'areaM2' | 'lengthM' | 'points' | 'ifcGlobalId'>
  >;
  assets?: Record<
    string,
    Pick<
      ClusterAsset,
      | 'storeyId'
      | 'rotationDeg'
      | 'scale'
      | 'blueprintRef'
      | 'productRef'
      | 'modelRef'
      | 'materialOverrides'
      | 'quantity'
      | 'configuration'
      | 'ifcGlobalId'
    >
  >;
  alignments?: Record<string, Pick<ClusterAlignment, 'horizontal' | 'vertical'>>;
  networks?: Record<string, Pick<ClusterNetwork, 'system' | 'systemPredefinedType' | 'segments' | 'nodes'>>;
};

function text(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === 'string' ? inner : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === 'number' && Number.isFinite(inner) ? inner : undefined;
  }
  return undefined;
}

function refId(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === 'number' ? inner : undefined;
  }
  return undefined;
}


/** Decimal degrees → `IfcCompoundPlaneAngleMeasure` (deg, min, sec, millionth). */
function compoundAngle(degrees: number): number[] {
  const sign = (value: number): number => (value < 0 ? -1 : 1);
  const abs = Math.abs(degrees);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const secFloat = (minFloat - min) * 60;
  const sec = Math.floor(secFloat);
  const micro = Math.round((secFloat - sec) * 1e6);
  return [sign(degrees) * deg, min, sec, micro];
}

function fromCompoundAngle(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const [deg, min, sec, micro = 0] = value.map(Number);
  if (![deg, min, sec, micro].every(Number.isFinite)) return undefined;
  const sign = deg < 0 ? -1 : 1;
  return sign * (Math.abs(deg) + min / 60 + sec / 3600 + micro / 3.6e9);
}

function guid(seed: string): string {
  // IFC GlobalId is a 22-char base64 string. This is a stable, readable stand-in
  // with a hash suffix, so two ids that sanitize to the same prefix still differ.
  const clean = seed.replace(/[^A-Za-z0-9_$]/g, '_');
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(36).padStart(7, '0');
  return `${clean.slice(0, 14)}_${suffix}`.slice(0, 22).padEnd(22, '_');
}

/**
 * The kernel. `importIfc` and `exportIfc` share one `IfcAPI` instance, which is
 * expensive to initialise (WASM), so a host should keep one kernel for its
 * lifetime.
 */
export function createWebIfcKernel(): BimKernel {
  let apiPromise: Promise<IfcAPI> | null = null;

  async function api(): Promise<IfcAPI> {
    if (!apiPromise) {
      apiPromise = (async () => {
        const instance = new IfcAPI();
        await instance.Init();
        return instance;
      })();
    }
    return apiPromise;
  }

  return {
    name: 'web-ifc',

    async importIfc(bytes: Uint8Array): Promise<ClusterModel> {
      const ifc = await api();
      const modelID = ifc.OpenModel(bytes);
      try {
        const data = readClusterData(ifc, modelID);
        return readModel(ifc, modelID, data);
      } finally {
        ifc.CloseModel(modelID);
      }
    },

    async exportIfc(model: ClusterModel): Promise<Uint8Array> {
      const ifc = await api();
      const modelID = ifc.CreateModel({
        schema: 'IFC4',
        name: model.name || 'Cluster',
        description: ['cluster-editor-core export'],
        authors: ['Nexus'],
        organizations: ['Nexus'],
        authorization: 'none',
      });
      try {
        writeModel(ifc, modelID, model);
        return ifc.SaveModel(modelID);
      } finally {
        ifc.CloseModel(modelID);
      }
    },
  };
}

function readClusterData(ifc: IfcAPI, modelID: number): ClusterDataPset | null {
  const psetIds = ifc.GetLineIDsWithType(modelID, IFCPROPERTYSET);
  for (let i = 0; i < psetIds.size(); i += 1) {
    const pset = ifc.GetLine(modelID, psetIds.get(i));
    if (text(pset.Name) !== PSET_NAME) continue;
    for (const handle of pset.HasProperties ?? []) {
      const propertyId = refId(handle);
      if (propertyId === undefined) continue;
      const property = ifc.GetLine(modelID, propertyId);
      if (text(property.Name) !== 'Json') continue;
      const raw = text(property.NominalValue);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as ClusterDataPset;
        if (parsed?.kind === 'cluster-data') return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readModel(ifc: IfcAPI, modelID: number, data: ClusterDataPset | null): ClusterModel {
  const resolveId = (globalId: string | undefined): string | undefined =>
    globalId ? (data?.ids?.[globalId] ?? globalId) : undefined;
  const projectId = firstId(ifc, modelID, IFCPROJECT);
  const project = projectId !== undefined ? ifc.GetLine(modelID, projectId) : null;
  const siteId = firstId(ifc, modelID, IFCSITE);
  const site = siteId !== undefined ? ifc.GetLine(modelID, siteId) : null;

  const latitude = fromCompoundAngle(site?.RefLatitude);
  const longitude = fromCompoundAngle(site?.RefLongitude);
  const elevation = typeof site?.RefElevation?.value === 'number' ? site.RefElevation.value : 0;

  const geoReference: ClusterGeoReference =
    data?.geoReference ??
    {
      anchor: {
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        elevation: elevation,
      },
    };

  const buildings: ClusterBuilding[] = idsOf(ifc, modelID, IFCBUILDING).map((id) => {
    const line = ifc.GetLine(modelID, id);
    const extra = data?.buildings?.[resolveId(text(line.GlobalId)) ?? ''];
    return {
      id: resolveId(text(line.GlobalId)) ?? String(id),
      name: text(line.Name) ?? 'Building',
      ...(extra?.footprint ? { footprint: extra.footprint } : {}),
      storeyIds: extra?.storeyIds ?? [],
      ...(extra?.ifcGlobalId ? { ifcGlobalId: extra.ifcGlobalId } : {}),
    };
  });

  const storeys: ClusterStorey[] = idsOf(ifc, modelID, IFCBUILDINGSTOREY).map((id) => {
    const line = ifc.GetLine(modelID, id);
    const key = resolveId(text(line.GlobalId)) ?? '';
    const extra = data?.storeys?.[key];
    return {
      id: key || String(id),
      buildingId: extra?.buildingId ?? '',
      name: text(line.Name) ?? 'Storey',
      elevation: typeof line.Elevation?.value === 'number' ? line.Elevation.value : 0,
      height: extra?.height ?? 0,
      ...(extra?.ifcGlobalId ? { ifcGlobalId: extra.ifcGlobalId } : {}),
    };
  });

  const zones: ClusterZone[] = idsOf(ifc, modelID, IFCSPACE).map((id) => {
    const line = ifc.GetLine(modelID, id);
    const key = resolveId(text(line.GlobalId)) ?? '';
    const extra = data?.zones?.[key];
    return {
      id: key || String(id),
      name: text(line.Name) ?? 'Zone',
      kind: (text(line.LongName) ?? 'other') as ClusterZone['kind'],
      points: extra?.points ?? [],
      ...(extra?.storeyId ? { storeyId: extra.storeyId } : {}),
      ...(extra?.color ? { color: extra.color } : {}),
      ...(extra?.label ? { label: extra.label } : {}),
      ...(extra?.configuration ? { configuration: extra.configuration } : {}),
    };
  });

  const materials: ClusterMaterial[] = idsOf(ifc, modelID, IFCMATERIAL).map((id) => {
    const line = ifc.GetLine(modelID, id);
    const key = text(line.Name) ?? String(id);
    const extra = data?.materials?.[key];
    return {
      id: extra?.id ?? key,
      name: key,
      kind: extra?.kind ?? 'other',
      ...(extra?.color ? { color: extra.color } : {}),
      ...(extra?.textureUrl ? { textureUrl: extra.textureUrl } : {}),
      ...(extra?.productRef ? { productRef: extra.productRef } : {}),
      ...(extra?.coverage ? { coverage: extra.coverage } : {}),
      ...(extra?.ifcGlobalId ? { ifcGlobalId: extra.ifcGlobalId } : {}),
    };
  });

  const surfaces: ClusterSurface[] = idsOf(ifc, modelID, IFCRELASSOCIATESMATERIAL).map((id) => {
    const line = ifc.GetLine(modelID, id);
    const key = resolveId(text(line.GlobalId)) ?? String(id);
    const extra = data?.surfaces?.[key];
    return {
      id: key,
      ownerId: extra?.ownerId ?? '',
      ownerKind: extra?.ownerKind ?? 'zone',
      kind: extra?.kind ?? 'other',
      ...(extra?.materialId ? { materialId: extra.materialId } : {}),
      ...(extra?.areaM2 !== undefined ? { areaM2: extra.areaM2 } : {}),
      ...(extra?.lengthM !== undefined ? { lengthM: extra.lengthM } : {}),
      ...(extra?.points ? { points: extra.points } : {}),
      ...(extra?.ifcGlobalId ? { ifcGlobalId: extra.ifcGlobalId } : {}),
    };
  });

  const assets: ClusterAsset[] = idsOf(ifc, modelID, IFCBUILDINGELEMENTPROXY).map((id) => {
    const line = ifc.GetLine(modelID, id);
    const key = resolveId(text(line.GlobalId)) ?? String(id);
    const extra = data?.assets?.[key];
    const position = readPlacement(ifc, modelID, line.ObjectPlacement);
    return {
      id: key,
      name: text(line.Name) ?? 'Element',
      position,
      ...(extra?.rotationDeg !== undefined ? { rotationDeg: extra.rotationDeg } : {}),
      ...(extra?.scale ? { scale: extra.scale } : {}),
      ...(extra?.storeyId ? { storeyId: extra.storeyId } : {}),
      ...(extra?.blueprintRef ? { blueprintRef: extra.blueprintRef } : {}),
      ...(extra?.productRef ? { productRef: extra.productRef } : {}),
      ...(extra?.modelRef ? { modelRef: extra.modelRef } : {}),
      ...(extra?.materialOverrides ? { materialOverrides: extra.materialOverrides } : {}),
      ...(extra?.quantity !== undefined ? { quantity: extra.quantity } : {}),
      ...(extra?.configuration ? { configuration: extra.configuration } : {}),
      ...(extra?.ifcGlobalId ? { ifcGlobalId: extra.ifcGlobalId } : {}),
    };
  });

  const alignments: ClusterAlignment[] = Object.entries(data?.alignments ?? {}).map(([id, value]) => ({
    id,
    name: id,
    horizontal: value.horizontal ?? [],
    vertical: value.vertical ?? [],
  }));

  const networks: ClusterNetwork[] = Object.entries(data?.networks ?? {}).map(([id, value]) => ({
    id,
    name: id,
    system: value.system ?? 'other',
    ...(value.systemPredefinedType ? { systemPredefinedType: value.systemPredefinedType } : {}),
    segments: value.segments ?? [],
    nodes: value.nodes ?? [],
  }));

  return {
    id: data?.modelId ?? resolveId(text(project?.GlobalId)) ?? 'cluster',
    name: text(project?.Name) ?? 'Cluster',
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

function firstId(ifc: IfcAPI, modelID: number, type: number): number | undefined {
  const ids = ifc.GetLineIDsWithType(modelID, type);
  return ids.size() > 0 ? ids.get(0) : undefined;
}

function idsOf(ifc: IfcAPI, modelID: number, type: number): number[] {
  const ids = ifc.GetLineIDsWithType(modelID, type);
  const out: number[] = [];
  for (let i = 0; i < ids.size(); i += 1) out.push(ids.get(i));
  return out;
}

function readPlacement(ifc: IfcAPI, modelID: number, handle: unknown): ClusterAsset['position'] {
  const placementId = refId(handle);
  if (placementId === undefined) return { x: 0, y: 0, z: 0 };
  const placement = ifc.GetLine(modelID, placementId);
  const axisId = refId(placement.RelativePlacement);
  if (axisId === undefined) return { x: 0, y: 0, z: 0 };
  const axis = ifc.GetLine(modelID, axisId);
  const pointId = refId(axis.Location);
  if (pointId === undefined) return { x: 0, y: 0, z: 0 };
  const point = ifc.GetLine(modelID, pointId);
  const [x = 0, y = 0, z = 0] = (point.Coordinates ?? []).map((entry: unknown) => num(entry) ?? 0);
  return { x, y, z };
}

function writeModel(ifc: IfcAPI, modelID: number, model: ClusterModel): void {
  const mk = (type: number, ...args: unknown[]) => {
    const line = ifc.CreateIfcEntity(modelID, type, ...args);
    ifc.WriteLine(modelID, line);
    return line;
  };

  const origin = mk(IFCCARTESIANPOINT, [0, 0, 0]);
  const up = mk(IFCDIRECTION, [0, 0, 1]);
  const axis = mk(IFCAXIS2PLACEMENT3D, origin, null, up);
  const placement = mk(IFCLOCALPLACEMENT, null, axis);

  const project = mk(IFCPROJECT, guid(model.id), null, model.name || 'Cluster', null, null, null, null, null, null);
  const site = mk(
    IFCSITE,
    guid(`${model.id}:site`),
    null,
    'Site',
    null,
    null,
    placement,
    null,
    null,
    null,
    compoundAngle(model.geoReference.anchor.latitude),
    compoundAngle(model.geoReference.anchor.longitude),
    model.geoReference.anchor.elevation,
    null,
    null,
  );

  const buildingHandles = new Map<string, unknown>();
  const storeyHandles = new Map<string, unknown>();
  const zoneHandles = new Map<string, unknown>();
  const assetHandles = new Map<string, unknown>();
  const materialHandles = new Map<string, unknown>();

  for (const building of model.buildings) {
    buildingHandles.set(
      building.id,
      mk(IFCBUILDING, guid(building.id), null, building.name, null, null, placement, null, null, null, null, null, null),
    );
  }

  for (const storey of model.storeys) {
    storeyHandles.set(
      storey.id,
      mk(IFCBUILDINGSTOREY, guid(storey.id), null, storey.name, null, null, placement, null, null, null, storey.elevation),
    );
  }

  for (const zone of model.zones) {
    zoneHandles.set(
      zone.id,
      mk(IFCSPACE, guid(zone.id), null, zone.name, null, null, placement, null, zone.kind, null, null),
    );
  }

  for (const material of model.materials ?? []) {
    materialHandles.set(material.id, mk(IFCMATERIAL, material.name, null, material.kind));
  }

  for (const asset of model.assets) {
    const point = mk(IFCCARTESIANPOINT, [asset.position.x, asset.position.y, asset.position.z]);
    const assetAxis = mk(IFCAXIS2PLACEMENT3D, point, null, up);
    const assetPlacement = mk(IFCLOCALPLACEMENT, placement, assetAxis);
    assetHandles.set(
      asset.id,
      mk(IFCBUILDINGELEMENTPROXY, guid(asset.id), null, asset.name, null, null, assetPlacement, null, null, null),
    );
  }

  for (const surface of model.surfaces ?? []) {
    const ownerHandle = surface.ownerKind === 'zone' ? zoneHandles.get(surface.ownerId) : buildingHandles.get(surface.ownerId);
    const materialHandle = surface.materialId ? materialHandles.get(surface.materialId) : undefined;
    if (!ownerHandle || !materialHandle) continue;
    mk(IFCRELASSOCIATESMATERIAL, guid(surface.id), null, null, null, [ownerHandle], materialHandle);
  }

  // Spatial containment: project → site → building → storey → spaces/elements.
  mk(IFCRELAGGREGATES, guid(`${model.id}:rel-site`), null, null, null, project, [site]);
  for (const building of model.buildings) {
    const handle = buildingHandles.get(building.id);
    if (handle) mk(IFCRELAGGREGATES, guid(`${building.id}:rel`), null, null, null, site, [handle]);
  }
  for (const storey of model.storeys) {
    const handle = storeyHandles.get(storey.id);
    const parent = buildingHandles.get(storey.buildingId) ?? site;
    if (handle) mk(IFCRELAGGREGATES, guid(`${storey.id}:rel`), null, null, null, parent, [handle]);
  }
  for (const zone of model.zones) {
    const handle = zoneHandles.get(zone.id);
    const parent = (zone.storeyId && storeyHandles.get(zone.storeyId)) || site;
    if (handle) mk(IFCRELAGGREGATES, guid(`${zone.id}:rel`), null, null, null, parent, [handle]);
  }
  for (const asset of model.assets) {
    const handle = assetHandles.get(asset.id);
    const parent = (asset.storeyId && storeyHandles.get(asset.storeyId)) || site;
    if (handle) mk(IFCRELAGGREGATES, guid(`${asset.id}:rel`), null, null, null, parent, [handle]);
  }

  // The app-specific fields, in one custom property set on the project.
  const ids: Record<string, string> = { [guid(model.id)]: model.id };
  for (const row of [
    ...model.buildings,
    ...model.storeys,
    ...model.zones,
    ...(model.materials ?? []),
    ...(model.surfaces ?? []),
    ...model.assets,
  ]) {
    ids[guid(row.id)] = row.id;
  }

  const data: ClusterDataPset = {
    kind: 'cluster-data',
    version: PSET_VERSION,
    modelId: model.id,
    ids,
    geoReference: model.geoReference,
    ...(model.buildings.length
      ? {
          buildings: Object.fromEntries(
            model.buildings.map((building) => [
              building.id,
              {
                ...(building.footprint ? { footprint: building.footprint } : {}),
                storeyIds: building.storeyIds,
                ...(building.ifcGlobalId ? { ifcGlobalId: building.ifcGlobalId } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(model.storeys.length
      ? {
          storeys: Object.fromEntries(
            model.storeys.map((storey) => [
              storey.id,
              {
                buildingId: storey.buildingId,
                height: storey.height,
                ...(storey.ifcGlobalId ? { ifcGlobalId: storey.ifcGlobalId } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(model.zones.length
      ? {
          zones: Object.fromEntries(
            model.zones.map((zone) => [
              zone.id,
              {
                points: zone.points,
                ...(zone.storeyId ? { storeyId: zone.storeyId } : {}),
                ...(zone.color ? { color: zone.color } : {}),
                ...(zone.label ? { label: zone.label } : {}),
                ...(zone.configuration ? { configuration: zone.configuration } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(model.materials?.length
      ? {
          materials: Object.fromEntries(
            model.materials.map((material) => [
              material.name,
              {
                id: material.id,
                kind: material.kind,
                ...(material.color ? { color: material.color } : {}),
                ...(material.textureUrl ? { textureUrl: material.textureUrl } : {}),
                ...(material.productRef ? { productRef: material.productRef } : {}),
                ...(material.coverage ? { coverage: material.coverage } : {}),
                ...(material.ifcGlobalId ? { ifcGlobalId: material.ifcGlobalId } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(model.surfaces?.length
      ? {
          surfaces: Object.fromEntries(
            model.surfaces.map((surface) => [
              surface.id,
              {
                ownerId: surface.ownerId,
                ownerKind: surface.ownerKind,
                kind: surface.kind,
                ...(surface.materialId ? { materialId: surface.materialId } : {}),
                ...(surface.areaM2 !== undefined ? { areaM2: surface.areaM2 } : {}),
                ...(surface.lengthM !== undefined ? { lengthM: surface.lengthM } : {}),
                ...(surface.points ? { points: surface.points } : {}),
                ...(surface.ifcGlobalId ? { ifcGlobalId: surface.ifcGlobalId } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(model.assets.length
      ? {
          assets: Object.fromEntries(
            model.assets.map((asset) => [
              asset.id,
              {
                ...(asset.storeyId ? { storeyId: asset.storeyId } : {}),
                ...(asset.rotationDeg !== undefined ? { rotationDeg: asset.rotationDeg } : {}),
                ...(asset.scale ? { scale: asset.scale } : {}),
                ...(asset.blueprintRef ? { blueprintRef: asset.blueprintRef } : {}),
                ...(asset.productRef ? { productRef: asset.productRef } : {}),
                ...(asset.modelRef ? { modelRef: asset.modelRef } : {}),
                ...(asset.materialOverrides ? { materialOverrides: asset.materialOverrides } : {}),
                ...(asset.quantity !== undefined ? { quantity: asset.quantity } : {}),
                ...(asset.configuration ? { configuration: asset.configuration } : {}),
                ...(asset.ifcGlobalId ? { ifcGlobalId: asset.ifcGlobalId } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(model.alignments.length
      ? {
          alignments: Object.fromEntries(
            model.alignments.map((alignment) => [
              alignment.id,
              { horizontal: alignment.horizontal, vertical: alignment.vertical },
            ]),
          ),
        }
      : {}),
    ...(model.networks.length
      ? {
          networks: Object.fromEntries(
            model.networks.map((network) => [
              network.id,
              {
                system: network.system,
                ...(network.systemPredefinedType ? { systemPredefinedType: network.systemPredefinedType } : {}),
                segments: network.segments,
                nodes: network.nodes,
              },
            ]),
          ),
        }
      : {}),
  };

  const jsonValue = ifc.CreateIfcType(modelID, IFCTEXT, JSON.stringify(data));
  const property = mk(IFCPROPERTYSINGLEVALUE, 'Json', null, jsonValue, null);
  const pset = mk(IFCPROPERTYSET, guid(`${model.id}:pset`), null, PSET_NAME, null, [property]);
  mk(IFCRELDEFINESBYPROPERTIES, guid(`${model.id}:pset-rel`), null, null, null, [project], pset);
}
