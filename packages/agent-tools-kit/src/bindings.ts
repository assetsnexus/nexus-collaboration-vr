import type { ChatCompletionTool, SceneGraph, ScenePose, ToolBinding } from '@nexus/scene-kit'
import { createEntityId } from '@nexus/scene-kit'
import { playObjectEffect, spawnObject, stopObjectEffect } from '@nexus/objects-kit'

export type ToolCallEvent = {
  tool: string
  status?: 'start' | 'progress' | 'end' | string
  agent?: string
  toolCallId?: string
  subagent?: boolean
}

export type ToolsVizDefaults = {
  enabled: boolean
  /** Auto-spawn sphere in front of agent for unmatched tools. */
  spawnPreset: 'sphere-front' | 'off'
  onStart: string
  onProgress: string
  onEnd: string
}

export const DEFAULT_TOOLS_VIZ: ToolsVizDefaults = {
  enabled: true,
  spawnPreset: 'sphere-front',
  onStart: 'glow',
  onProgress: 'pulse',
  onEnd: 'stop',
}

const KIND_COLORS: Record<string, string> = {
  search: '#66ccff',
  shell: '#ffaa44',
  write: '#88ff88',
  read: '#c0a0ff',
  web: '#66ccff',
  tool: '#ffcc33',
}

export function colorForTool(tool: string): string {
  const t = tool.toLowerCase()
  if (t.includes('search') || t.includes('web') || t.includes('browse')) return KIND_COLORS.search!
  if (t.includes('shell') || t.includes('exec')) return KIND_COLORS.shell!
  if (t.includes('write') || t.includes('edit')) return KIND_COLORS.write!
  if (t.includes('read') || t.includes('recall')) return KIND_COLORS.read!
  return KIND_COLORS.tool!
}

function toolMatches(binding: ToolBinding, ev: ToolCallEvent): boolean {
  const want = binding.match.tool
  if (want !== '*' && want.toLowerCase() !== ev.tool.toLowerCase()) {
    // prefix / contains match for namespaced tools
    if (!ev.tool.toLowerCase().includes(want.toLowerCase())) return false
  }
  if (binding.match.agent && ev.agent && binding.match.agent.replace(/^@/, '') !== ev.agent.replace(/^@/, '')) {
    return false
  }
  if (binding.match.subagent && !ev.subagent) return false
  return true
}

export type ToolBindingHost = {
  graph: SceneGraph
  defaults?: ToolsVizDefaults
  /** Resolve agent world pose for auto-spawn. */
  getAgentPose?: (slug: string) => ScenePose | undefined
  playEffect?: (entityId: string, effect: string) => void
  stopEffect?: (entityId: string, effect?: string) => void
}

/**
 * Apply tool_call / tool_progress events to the scene graph.
 * Returns entity ids that were touched.
 */
export function handleToolCallEvent(host: ToolBindingHost, ev: ToolCallEvent): string[] {
  const defaults = host.defaults ?? DEFAULT_TOOLS_VIZ
  if (!defaults.enabled) return []

  const touched: string[] = []
  const bindings = host.graph.listBindings().filter((b) => toolMatches(b, ev))
  const status = (ev.status || 'start').toLowerCase()

  const applyTo = (entityId: string, binding: ToolBinding) => {
    touched.push(entityId)
    if (status === 'end' || status === 'done' || status === 'error') {
      const effect = binding.onEnd || defaults.onEnd
      if (effect === 'stop') {
        host.stopEffect?.(entityId)
        stopObjectEffect(host.graph, entityId)
      } else {
        host.playEffect?.(entityId, effect)
        playObjectEffect(host.graph, entityId, effect)
      }
      return
    }
    if (status === 'progress') {
      const effect = binding.onProgress || defaults.onProgress
      host.playEffect?.(entityId, effect)
      playObjectEffect(host.graph, entityId, effect)
      return
    }
    const effect = binding.onStart || defaults.onStart
    host.playEffect?.(entityId, effect)
    playObjectEffect(host.graph, entityId, effect, { color: colorForTool(ev.tool) })
  }

  for (const binding of bindings) {
    if ('entityId' in binding.target) {
      applyTo(binding.target.entityId, binding)
    } else if (binding.target.spawnPreset === 'sphere-front') {
      const id = ensureFrontSphere(host, ev, binding.id)
      if (id) applyTo(id, binding)
    }
  }

  if (!bindings.length && defaults.spawnPreset === 'sphere-front') {
    const id = ensureFrontSphere(host, ev, `auto-${ev.tool}`)
    if (id) {
      touched.push(id)
      if (status === 'end' || status === 'done' || status === 'error') {
        host.stopEffect?.(id)
        stopObjectEffect(host.graph, id)
      } else if (status === 'progress') {
        host.playEffect?.(id, defaults.onProgress)
        playObjectEffect(host.graph, id, defaults.onProgress)
      } else {
        host.playEffect?.(id, defaults.onStart)
        playObjectEffect(host.graph, id, defaults.onStart, { color: colorForTool(ev.tool) })
      }
    }
  }

  return touched
}

function ensureFrontSphere(host: ToolBindingHost, ev: ToolCallEvent, key: string): string | null {
  const slug = (ev.agent || 'agent').replace(/^@/, '')
  const existing = host.graph
    .list()
    .find((e) => e.tags.includes(`tool-viz:${key}`) && e.owner.slug === slug)
  if (existing) return existing.id

  const pose = host.getAgentPose?.(slug)
  const id = createEntityId('tool')
  const result = spawnObject(host.graph, {
    id,
    label: ev.tool,
    color: colorForTool(ev.tool),
    shape: 'sphere',
    radius: 0.12,
    at: 'front',
    callerPose: pose,
    ownerSlug: slug,
    tags: ['tool-viz', `tool-viz:${key}`, ev.subagent ? 'subagent' : 'tool'],
  })
  return result.ok ? id : null
}

export function bindTool(
  graph: SceneGraph,
  opts: {
    id?: string
    tool: string
    entityId?: string
    spawnPreset?: 'sphere-front'
    agent?: string
    onStart?: string
    onProgress?: string
    onEnd?: string
  },
) {
  const id = opts.id || createEntityId('bind')
  const target =
    opts.entityId != null
      ? { entityId: opts.entityId }
      : { spawnPreset: opts.spawnPreset || ('sphere-front' as const) }
  return graph.apply({
    kind: 'bind_tool',
    entityId: opts.entityId,
    payload: {
      id,
      match: { tool: opts.tool, agent: opts.agent },
      target,
      onStart: opts.onStart || 'glow',
      onProgress: opts.onProgress || 'pulse',
      onEnd: opts.onEnd || 'stop',
    },
  })
}

export function unbindTool(graph: SceneGraph, id: string) {
  return graph.apply({ kind: 'unbind_tool', payload: { id } })
}

export const TOOLS_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'tools_bind',
      description: 'Link a tool name to a scene object (or auto sphere-front) with glow/pulse effects.',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          entityId: { type: 'string' },
          spawnPreset: { type: 'string', description: 'sphere-front' },
          onStart: { type: 'string' },
          onProgress: { type: 'string' },
          onEnd: { type: 'string' },
        },
        required: ['tool'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tools_unbind',
      description: 'Remove a tool→object binding by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tools_set_defaults',
      description: 'Enable/disable default tool-call spheres and effect names.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          spawnPreset: { type: 'string' },
          onStart: { type: 'string' },
          onProgress: { type: 'string' },
          onEnd: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
]

export const TOOLS_SKILL = {
  id: 'agent-tools',
  prefix: 'tools',
  name: 'agent-tools',
  description: 'Visualize agent tool calls on scene objects.',
  tools: TOOLS_TOOL_DEFINITIONS,
  allTools() {
    return [...TOOLS_TOOL_DEFINITIONS]
  },
} as const
