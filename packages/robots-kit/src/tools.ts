import type { ChatCompletionTool } from '@nexus/scene-kit'
import {
  createEntityId,
  normalizePose,
  spawnPoseAt,
  type SceneGraph,
  type ScenePose,
} from '@nexus/scene-kit'
import { normalizeRobotSpec, type RobotJoint, type RobotSpecV1 } from './spec.ts'

export const ROBOT_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'robot_spawn',
      description:
        'Spawn a robot/machine entity (glTF or capsule stand-in). Machines use kind robot.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          url: { type: 'string' },
          catalogId: { type: 'string' },
          color: { type: 'string' },
          at: {
            oneOf: [{ type: 'string' }, { type: 'object' }],
          },
          joints: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                angle: { type: 'number' },
              },
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'robot_set_joints',
      description: 'Set joint angles on a robot (no-op if mesh has no bones).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          joints: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                angle: { type: 'number' },
              },
              required: ['name', 'angle'],
            },
          },
        },
        required: ['id', 'joints'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'robot_play',
      description: 'Play a named glTF animation clip on the robot if present.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          clip: { type: 'string' },
          loop: { type: 'boolean' },
        },
        required: ['id', 'clip'],
        additionalProperties: false,
      },
    },
  },
]

export const ROBOT_TOOL_ALIASES: Record<string, string> = {
  spawn_robot: 'robot_spawn',
  set_joints: 'robot_set_joints',
  play_robot: 'robot_play',
}

for (const def of ROBOT_TOOL_DEFINITIONS) {
  const canonical = def.function.name
  const action = canonical.replace(/^robot_/, '')
  ROBOT_TOOL_ALIASES[action] = canonical
  ROBOT_TOOL_ALIASES[`robot.${action}`] = canonical
}

const CANONICAL = new Set(ROBOT_TOOL_DEFINITIONS.map((t) => t.function.name))

export function resolveRobotToolName(raw: string): string | null {
  const name = String(raw || '').trim()
  if (!name) return null
  if (CANONICAL.has(name)) return name
  const mapped = ROBOT_TOOL_ALIASES[name] || ROBOT_TOOL_ALIASES[name.toLowerCase()]
  return mapped && CANONICAL.has(mapped) ? mapped : null
}

export const ROBOT_SKILL = {
  id: 'robot',
  prefix: 'robot',
  name: 'robot',
  description: 'Place machines/robots in the scene (glTF + joint pose).',
  tools: ROBOT_TOOL_DEFINITIONS,
  resolveToolName: resolveRobotToolName,
  allTools() {
    return [...ROBOT_TOOL_DEFINITIONS]
  },
} as const

export type SpawnRobotArgs = {
  id?: string
  label?: string
  url?: string
  catalogId?: string
  color?: string
  at?: 'front' | 'here' | string | { x: number; y?: number; z: number }
  joints?: RobotJoint[]
  ownerSlug?: string
  callerPose?: ScenePose
}

export function spawnRobot(graph: SceneGraph, args: SpawnRobotArgs) {
  const id = (args.id || createEntityId('robot')).trim()
  const spec = normalizeRobotSpec({
    url: args.url,
    catalogId: args.catalogId,
    color: args.color,
    joints: args.joints,
  })
  const at = args.at ?? 'front'
  const pose =
    at === 'front' || at === 'here'
      ? spawnPoseAt(at, args.callerPose)
      : typeof at === 'object'
        ? normalizePose(at)
        : spawnPoseAt('front', args.callerPose)

  return graph.apply({
    kind: 'spawn',
    entityId: id,
    payload: {
      id,
      kind: 'robot',
      label: args.label || id,
      pose,
      radius: 0.4,
      tags: ['robot', 'machine'],
      owner: args.ownerSlug ? { type: 'agent', slug: args.ownerSlug } : { type: 'user' },
      spec,
    },
  })
}

export function setRobotJoints(graph: SceneGraph, id: string, joints: RobotJoint[]) {
  const cur = graph.get(id)
  if (!cur) return { ok: false as const, message: 'unknown entity' }
  const spec = normalizeRobotSpec({ ...(cur.spec as object), joints })
  return graph.apply({
    kind: 'write',
    entityId: id,
    payload: {
      ...cur,
      spec,
    },
  })
}

export function playRobotClip(
  graph: SceneGraph,
  id: string,
  clip: string,
  loop = false,
) {
  return graph.apply({
    kind: 'play_effect',
    entityId: id,
    payload: { effect: `clip:${clip}`, clip, loop },
  })
}

export type { RobotSpecV1, RobotJoint }
