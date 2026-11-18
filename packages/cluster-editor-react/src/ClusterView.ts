/**
 * The 3D view binding.
 *
 * A canvas that executes the pure draw commands from `scene.ts`. No Three.js, no
 * WebGL: the projection is real (yaw, pitch, height) and the component is thin,
 * so the geometry stays testable and the package stays dependency-free.
 *
 * A host that wants a full WebGL renderer can reuse `buildSceneCommands` and
 * `projectPoint` with its own renderer instead of this component.
 */
import { createElement, useEffect, useRef } from 'react';
import type { ClusterModel } from '@nexus/cluster-editor-core';
import {
  DEFAULT_VIEW,
  buildSceneCommands,
  drawScene,
  pickAssetAt,
  type ViewTransform,
} from './scene.ts';

export type ClusterViewProps = {
  model: ClusterModel;
  view?: ViewTransform;
  width?: number;
  height?: number;
  /** Called with the asset id under the click, or null for empty space. */
  onSelectAsset?: (assetId: string | null) => void;
  className?: string;
};

export function ClusterView({
  model,
  view = DEFAULT_VIEW,
  width = 640,
  height = 480,
  onSelectAsset,
  className,
}: ClusterViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawScene(ctx, buildSceneCommands(model, view), width, height);
  }, [model, view, width, height]);

  return createElement('canvas', {
    ref: canvasRef,
    width,
    height,
    className,
    'data-testid': 'cluster-view',
    onClick: (event: { nativeEvent: { offsetX: number; offsetY: number } }) => {
      if (!onSelectAsset) return;
      onSelectAsset(pickAssetAt(model, view, { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }));
    },
  });
}
