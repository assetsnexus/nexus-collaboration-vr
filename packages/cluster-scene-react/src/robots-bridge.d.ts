import type { SceneGraphRef } from './scene-graph-ref.js'

export function applyRobotJointsFromSceneFrame(
  graph: SceneGraphRef,
  assetId: string,
  joints: Record<string, number>,
): Promise<void>
