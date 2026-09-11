import type { ChatCompletionTool } from './types.ts'

/** Scene catalog / browse tools — prefix scene_. */
export const SCENE_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'scene_list_objects',
      description:
        'List named places/props/robots in the 3D scene (id, kind, position, yaw, radius, tags). Optional filters + limit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive match on id, label, kind' },
          kind: {
            type: 'string',
            description: 'object | robot | avatar | landmark | …',
          },
          tag: { type: 'string' },
          ids: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number', description: 'Max rows (default 20, max 50)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_overview',
      description:
        'Compact scene summary around this avatar: nearby objects/robots/avatars. Prefer over scene_list_objects to avoid bloating context.',
      parameters: {
        type: 'object',
        properties: {
          radius: { type: 'number', description: 'Meters (default 20, max 80)' },
          radiusM: { type: 'number', description: 'Alias of radius' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_get_object',
      description: 'Get one scene entity by id (metadata + pose; may include compact spec).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          target: { type: 'string', description: 'Alias of id' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_query',
      description:
        'Filter entities by radius from self/@slug/object, kind, tag. Returns compact rows.',
      parameters: {
        type: 'object',
        properties: {
          radius: { type: 'number' },
          from: {
            description: 'Origin: "self", "@slug", object id, or {x,z}',
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' },
                },
              },
            ],
          },
          kind: { type: 'string' },
          tag: { type: 'string' },
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_move_object',
      description: 'Move a prop/robot (not avatars). to:{x,y,z} world meters.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          to: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          durationMs: { type: 'number' },
        },
        required: ['id', 'to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_glow_object',
      description: 'Pulse an object with emissive glow (alias of object_play_effect glow).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          color: { type: 'string' },
          durationMs: { type: 'number' },
          intensity: { type: 'number' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
]

export const SCENE_TOOL_ALIASES: Record<string, string> = {
  list_objects: 'scene_list_objects',
  'scene.list_objects': 'scene_list_objects',
  get_object: 'scene_get_object',
  'scene.get_object': 'scene_get_object',
  overview: 'scene_overview',
  'scene.overview': 'scene_overview',
  query: 'scene_query',
  'scene.query': 'scene_query',
  move_object: 'scene_move_object',
  glow: 'scene_glow_object',
  glow_object: 'scene_glow_object',
}

for (const def of SCENE_TOOL_DEFINITIONS) {
  const canonical = def.function.name
  const action = canonical.replace(/^scene_/, '')
  SCENE_TOOL_ALIASES[action] = canonical
  SCENE_TOOL_ALIASES[`scene.${action}`] = canonical
}

const CANONICAL = new Set(SCENE_TOOL_DEFINITIONS.map((t) => t.function.name))

export const SCENE_IMMEDIATE_TOOLS = new Set([
  'scene_list_objects',
  'scene_overview',
  'scene_get_object',
  'scene_query',
  'scene_move_object',
  'scene_glow_object',
])

export function resolveSceneToolName(raw: string): string | null {
  const name = String(raw || '').trim()
  if (!name) return null
  if (CANONICAL.has(name)) return name
  const mapped = SCENE_TOOL_ALIASES[name] || SCENE_TOOL_ALIASES[name.toLowerCase()]
  return mapped && CANONICAL.has(mapped) ? mapped : null
}

export function isSceneSkillTool(name: string): boolean {
  return resolveSceneToolName(name) != null
}

export function isImmediateSceneTool(name: string): boolean {
  const canonical = resolveSceneToolName(name)
  return canonical != null && SCENE_IMMEDIATE_TOOLS.has(canonical)
}
