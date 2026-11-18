/**
 * IFC-shaped cluster model.
 *
 * The cluster editor is GeoBIM-native: positions are real-world (a projected
 * CRS plus a local ENU frame), and the model mirrors the IFC entities a
 * federated model uses, so import and export are a mapping rather than a
 * translation layer.
 *
 * This package is framework-free on purpose. The portal (Vue 2), the reference
 * app (React 19) and partner apps all consume the same model and the same pure
 * functions; only the rendering binding differs.
 *
 * Units: metres, Z-up, right-handed. Angles in degrees unless a field says
 * otherwise.
 */

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** A polygon in cluster-local ENU metres. */
export type Polygon = Vec2[];

/**
 * Georeference of a cluster.
 *
 * `anchor` is the WGS84 point the local ENU frame is centred on. `projectedCrs`
 * and `mapConversion` mirror `IfcProjectedCRS` / `IfcMapConversion`, so an IFC
 * file can be placed without guessing.
 */
export type ClusterGeoReference = {
  /** WGS84 anchor of the local ENU frame. */
  anchor: { latitude: number; longitude: number; elevation: number };
  /** EPSG code of the projected CRS, e.g. 25832. */
  projectedCrs?: number;
  /** `IfcMapConversion`: eastings/northings of the anchor in the projected CRS. */
  mapConversion?: {
    eastings: number;
    northings: number;
    orthogonalHeight: number;
    /** Degrees, counter-clockwise from the projected CRS X axis. */
    xAxisAbscissa?: number;
    xAxisOrdinate?: number;
    scale?: number;
  };
  /** Rotation of the local grid against true north, in degrees. */
  gridRotationDeg?: number;
  /** Vertical datum note, e.g. `DHHN2016`. */
  heightModel?: string;
};

/** `IfcBuilding`. */
export type ClusterBuilding = {
  id: string;
  name: string;
  /** Optional footprint in cluster-local ENU metres. */
  footprint?: Polygon;
  /** Storey ids, bottom to top. */
  storeyIds: string[];
  /** IFC GlobalId when the building came from an imported model. */
  ifcGlobalId?: string;
};

/** `IfcBuildingStorey`. */
export type ClusterStorey = {
  id: string;
  buildingId: string;
  name: string;
  /** Elevation of the storey's floor in metres, cluster-local. */
  elevation: number;
  /** Storey height in metres. */
  height: number;
  ifcGlobalId?: string;
};

/** Zone kinds. `room` maps to `IfcSpace`. */
export type ClusterZoneKind = 'room' | 'bed' | 'field' | 'parking' | 'other';

/** A zone: a polygon with a kind, optionally bound to a storey. */
export type ClusterZone = {
  id: string;
  name: string;
  kind: ClusterZoneKind;
  points: Polygon;
  /** Storey the zone belongs to, when it is a room. */
  storeyId?: string;
  color?: string;
  label?: string;
  /** Free-form configuration (parking limits, bed metadata, …). */
  configuration?: Record<string, unknown>;
};

/** Network system kinds, mapped to `IfcDistributionSystem`. */
export type ClusterNetworkSystem =
  | 'water'
  | 'electric'
  | 'ethernet'
  | 'wifi'
  | 'data'
  | 'other';

export type ClusterNetworkSegment = {
  id: string;
  /** Polyline in cluster-local ENU metres; `z` is the segment elevation. */
  points: Vec3[];
  /** `IfcFlowDirectionEnum`-shaped. */
  flowDirection?: 'source' | 'sink' | 'both' | 'notdefined';
  properties?: Record<string, unknown>;
};

export type ClusterNetworkNode = {
  id: string;
  position: Vec3;
  /** Interfaces exposed at this node (sockets, outlets, ports). */
  interfaces?: Array<{ id: string; type: string; properties?: Record<string, unknown> }>;
};

export type ClusterNetwork = {
  id: string;
  name: string;
  system: ClusterNetworkSystem;
  /** `IfcDistributionSystem.predefinedType`, when known. */
  systemPredefinedType?: string;
  segments: ClusterNetworkSegment[];
  nodes: ClusterNetworkNode[];
};

/** An asset placed in the cluster. */
export type ClusterAsset = {
  id: string;
  name: string;
  /** Blueprint the asset was instantiated from, when known. */
  blueprintRef?: string;
  position: Vec3;
  /** Degrees around Z. */
  rotationDeg?: number;
  scale?: Vec3;
  /** Storey the asset sits on, when it is inside a building. */
  storeyId?: string;
  /** IFC GlobalId when the asset came from an imported model. */
  ifcGlobalId?: string;
  configuration?: Record<string, unknown>;
};

/** IFC4x3 alignment: a horizontal polyline with a vertical profile. */
export type ClusterAlignment = {
  id: string;
  name: string;
  /** Horizontal geometry in cluster-local ENU metres. */
  horizontal: Vec2[];
  /** Vertical profile: station (m) → elevation (m). */
  vertical: Array<{ station: number; elevation: number }>;
};

/** The editable cluster model. */
export type ClusterModel = {
  id: string;
  name: string;
  geoReference: ClusterGeoReference;
  buildings: ClusterBuilding[];
  storeys: ClusterStorey[];
  zones: ClusterZone[];
  networks: ClusterNetwork[];
  assets: ClusterAsset[];
  alignments: ClusterAlignment[];
  /** Terrain samples, when a terrain provider is wired. */
  terrain?: ClusterTerrain;
};

/** Current vs must elevation for earthworks. */
export type ClusterTerrain = {
  /** Grid origin in cluster-local ENU metres. */
  origin: Vec2;
  /** Cell size in metres. */
  cellSize: number;
  /** Row-major current elevations (metres). */
  current: number[];
  /** Row-major target elevations (metres). `undefined` means "no change". */
  must?: number[];
  /** Number of columns; rows = current.length / columns. */
  columns: number;
};

/** A movement vector, used for the live-position trace. */
export type MovementVector = {
  from: Vec3;
  to: Vec3;
  /** Metres per second, when the source reports it. */
  speed?: number;
  /** Degrees, clockwise from north. */
  headingDeg?: number;
  at: string;
};
