/**
 * Runtime bridge to @nexus/robots-kit (kept in JS so package typecheck stays shallow).
 * @param {import('@nexus/scene-kit').SceneGraph} graph
 * @param {string} assetId
 * @param {Record<string, number>} joints
 */
export async function applyRobotJointsFromSceneFrame(graph, assetId, joints) {
  const mod = await import('@nexus/robots-kit')
  const jointList = Object.entries(joints).map(([name, angle]) => ({ name, angle }))
  mod.setRobotJoints(graph, assetId, jointList)
}
