import {
  SCENE_TOOL_DEFINITIONS,
  isImmediateSceneTool,
  isSceneSkillTool,
  resolveSceneToolName,
} from './tools.ts'
import type { ChatCompletionTool } from './types.ts'

export const SCENE_SKILL_PREFIX = 'scene'
export const SCENE_SKILL_ID = 'scene'

export const SCENE_SKILL = {
  id: SCENE_SKILL_ID,
  prefix: SCENE_SKILL_PREFIX,
  name: 'scene',
  description:
    'Browse and signal a shared 3D scene graph (objects, robots, avatars). Client- or server-authoritative.',
  tools: SCENE_TOOL_DEFINITIONS,
  resolveToolName: resolveSceneToolName,
  isSceneTool: isSceneSkillTool,
  isImmediate: isImmediateSceneTool,
  allTools(): ChatCompletionTool[] {
    return [...SCENE_TOOL_DEFINITIONS]
  },
} as const

export function buildSceneSkillPrompt(opts?: { objectsEnabled?: boolean; robotsEnabled?: boolean }): string {
  const lines = [
    'Scene tools (meters, ground XZ): use scene_overview before inventing geometry.',
    'scene_query / scene_list_objects for filters; scene_get_object for one id.',
    'scene_move_object / scene_glow_object for props/robots (not avatars).',
  ]
  if (opts?.objectsEnabled !== false) {
    lines.push('Spawn/edit meshes with object_* tools (object_spawn, object_write, object_play_effect).')
  }
  if (opts?.robotsEnabled !== false) {
    lines.push('Machines use robot_* tools (robot_spawn, robot_set_joints).')
  }
  return lines.join('\n')
}
