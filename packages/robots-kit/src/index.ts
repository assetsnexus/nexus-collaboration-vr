export type { RobotJoint, RobotSpecV1 } from './spec.ts'
export { normalizeRobotSpec } from './spec.ts'

export {
  ROBOT_TOOL_DEFINITIONS,
  ROBOT_TOOL_ALIASES,
  ROBOT_SKILL,
  resolveRobotToolName,
  spawnRobot,
  setRobotJoints,
  playRobotClip,
} from './tools.ts'
export type { SpawnRobotArgs } from './tools.ts'

export { RobotSceneLayer } from './robot-layer.ts'
