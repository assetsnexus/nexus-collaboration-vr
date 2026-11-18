/**
 * Scene projection and draw commands.
 *
 * The view is a real 3D projection (yaw + pitch + height), but the output is a
 * list of 2D draw commands rather than a Three.js scene. That keeps the binding
 * dependency-free and the geometry testable without a canvas: the component only
 * executes the commands.
 *
 * Coordinates are cluster-local ENU metres. `pitchDeg` is the tilt from
 * top-down: 0 is a plan view (height ignored), 90 is a side view.
 */
import type { ClusterModel, Vec3 } from '@nexus/cluster-editor-core';

export type ViewTransform = {
  /** Pixels per metre. */
  scale: number;
  /** Screen offset in pixels. */
  offsetX: number;
  offsetY: number;
  /** Rotation around the vertical axis, degrees. */
  yawDeg: number;
  /** Tilt from top-down, degrees (0 = plan, 90 = side). */
  pitchDeg: number;
};

export type ScreenPoint = { x: number; y: number };

export type DrawCommand =
  | { kind: 'polygon'; points: ScreenPoint[]; fill?: string; stroke?: string }
  | { kind: 'line'; points: ScreenPoint[]; stroke: string }
  | { kind: 'marker'; x: number; y: number; label: string; color?: string };

export const DEFAULT_VIEW: ViewTransform = {
  scale: 12,
  offsetX: 0,
  offsetY: 0,
  yawDeg: 30,
  pitchDeg: 35,
};

const DEG = Math.PI / 180;

/** Projects a cluster-local ENU point to screen pixels. */
export function projectPoint(point: Vec3, view: ViewTransform): ScreenPoint {
  const yaw = view.yawDeg * DEG;
  const pitch = view.pitchDeg * DEG;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const rotatedX = point.x * cosYaw - point.y * sinYaw;
  const rotatedY = point.x * sinYaw + point.y * cosYaw;
  return {
    x: rotatedX * view.scale + view.offsetX,
    y: (rotatedY * cosPitch - point.z * sinPitch) * view.scale + view.offsetY,
  };
}

/** The elevation a zone sits at: its storey's floor, or the ground. */
function zoneElevation(model: ClusterModel, storeyId: string | undefined): number {
  if (!storeyId) return 0;
  return model.storeys.find((storey) => storey.id === storeyId)?.elevation ?? 0;
}

/**
 * Builds the draw commands for a model.
 *
 * Order is back-to-front by elevation, so a first-floor zone paints over the
 * ground floor instead of under it. Assets come last so a marker is never
 * hidden by a polygon.
 */
export function buildSceneCommands(model: ClusterModel, view: ViewTransform): DrawCommand[] {
  const commands: DrawCommand[] = [];

  const zones = [...model.zones].sort(
    (a, b) => zoneElevation(model, a.storeyId) - zoneElevation(model, b.storeyId),
  );
  for (const zone of zones) {
    if (zone.points.length < 3) continue;
    const z = zoneElevation(model, zone.storeyId);
    commands.push({
      kind: 'polygon',
      points: zone.points.map((point) => projectPoint({ x: point.x, y: point.y, z }, view)),
      fill: zone.color ?? '#d9e6d9',
      stroke: '#4a6b52',
    });
  }

  for (const network of model.networks) {
    for (const segment of network.segments) {
      if (segment.points.length < 2) continue;
      commands.push({
        kind: 'line',
        points: segment.points.map((point) => projectPoint(point, view)),
        stroke: network.system === 'water' ? '#2f6fb3' : network.system === 'electric' ? '#c9a227' : '#6b7280',
      });
    }
  }

  for (const asset of model.assets) {
    const screen = projectPoint(asset.position, view);
    commands.push({
      kind: 'marker',
      x: screen.x,
      y: screen.y,
      label: asset.name,
      color: asset.productRef ? '#2f7d4f' : '#4a5568',
    });
  }

  return commands;
}

/**
 * The asset nearest to a screen point, within `radiusPx`.
 *
 * Used for click-to-select. A linear scan is fine for a click; a large scene
 * uses the core's spatial index for proximity queries instead.
 */
export function pickAssetAt(
  model: ClusterModel,
  view: ViewTransform,
  point: ScreenPoint,
  radiusPx = 12,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const asset of model.assets) {
    const screen = projectPoint(asset.position, view);
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (distance > radiusPx) continue;
    if (!best || distance < best.distance) best = { id: asset.id, distance };
  }
  return best?.id ?? null;
}

/**
 * The subset of a 2D canvas context the renderer uses.
 *
 * Declared structurally so a test can pass a recording fake and so the package
 * does not depend on DOM types.
 */
export type DrawContext = {
  clearRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fillText(text: string, x: number, y: number): void;
  // `unknown` so a real `CanvasRenderingContext2D` (whose style is
  // `string | CanvasGradient | CanvasPattern`) is assignable without DOM types.
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
};

/** Executes the draw commands on a 2D context. */
export function drawScene(
  ctx: DrawContext,
  commands: DrawCommand[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1.5;

  for (const command of commands) {
    if (command.kind === 'polygon') {
      if (command.points.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(command.points[0].x, command.points[0].y);
      for (const point of command.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      if (command.fill) {
        ctx.fillStyle = command.fill;
        ctx.fill();
      }
      if (command.stroke) {
        ctx.strokeStyle = command.stroke;
        ctx.stroke();
      }
      continue;
    }
    if (command.kind === 'line') {
      if (command.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(command.points[0].x, command.points[0].y);
      for (const point of command.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = command.stroke;
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.arc(command.x, command.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = command.color ?? '#4a5568';
    ctx.fill();
    ctx.fillStyle = '#1d2a22';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(command.label, command.x + 8, command.y + 4);
  }
}
