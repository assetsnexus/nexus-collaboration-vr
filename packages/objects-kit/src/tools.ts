import type { ChatCompletionTool } from '@nexus/scene-kit'

export const OBJECT_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'object_spawn',
      description:
        'Spawn a primitive or catalog mesh in the scene. Default at=front (1.2m in front of you).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          shape: {
            type: 'string',
            description: 'box | sphere | cylinder | plane | cone | capsule',
          },
          color: { type: 'string' },
          radius: { type: 'number' },
          catalogId: { type: 'string' },
          url: { type: 'string' },
          spec: { type: 'object' },
          at: {
            description: 'front | here | @slug | {x,y,z}',
            oneOf: [{ type: 'string' }, { type: 'object' }],
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_write',
      description: 'Rewrite ObjectSpec on an existing entity (shape, color, material, url).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          spec: { type: 'object' },
          color: { type: 'string' },
          shape: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_set_color',
      description: 'Set object color / emissive quickly.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          color: { type: 'string' },
          emissive: { type: 'string' },
        },
        required: ['id', 'color'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_list_catalog',
      description: 'List optional packaged models the host provides (desk-5, …).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          tag: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_play_effect',
      description: 'Play a named effect clip: glow, pulse, spin, bob, blink, fade, or custom.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          effect: { type: 'string' },
          color: { type: 'string' },
          durationMs: { type: 'number' },
        },
        required: ['id', 'effect'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_stop_effect',
      description: 'Stop one or all effects on an object.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          effect: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_define_effect',
      description: 'Register a custom effect clip JSON for later object_play_effect.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          ops: { type: 'array', items: { type: 'object' } },
        },
        required: ['id', 'ops'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'object_remove',
      description: 'Remove an object from the scene graph.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
]

export const OBJECT_TOOL_ALIASES: Record<string, string> = {
  spawn: 'object_spawn',
  'object.spawn': 'object_spawn',
  write: 'object_write',
  set_color: 'object_set_color',
  play_effect: 'object_play_effect',
  stop_effect: 'object_stop_effect',
  define_effect: 'object_define_effect',
  remove_object: 'object_remove',
}

for (const def of OBJECT_TOOL_DEFINITIONS) {
  const canonical = def.function.name
  const action = canonical.replace(/^object_/, '')
  OBJECT_TOOL_ALIASES[action] = canonical
  OBJECT_TOOL_ALIASES[`object.${action}`] = canonical
}

const CANONICAL = new Set(OBJECT_TOOL_DEFINITIONS.map((t) => t.function.name))

export function resolveObjectToolName(raw: string): string | null {
  const name = String(raw || '').trim()
  if (!name) return null
  if (CANONICAL.has(name)) return name
  const mapped = OBJECT_TOOL_ALIASES[name] || OBJECT_TOOL_ALIASES[name.toLowerCase()]
  return mapped && CANONICAL.has(mapped) ? mapped : null
}

export function isObjectSkillTool(name: string): boolean {
  return resolveObjectToolName(name) != null
}

export const OBJECT_SKILL = {
  id: 'object',
  prefix: 'object',
  name: 'object',
  description: 'Spawn and animate editable 3D objects in the shared scene.',
  tools: OBJECT_TOOL_DEFINITIONS,
  resolveToolName: resolveObjectToolName,
  isObjectTool: isObjectSkillTool,
  allTools() {
    return [...OBJECT_TOOL_DEFINITIONS]
  },
} as const
