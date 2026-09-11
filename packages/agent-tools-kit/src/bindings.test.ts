import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SceneGraph } from '../../scene-kit/src/index.ts'
import { bindTool, handleToolCallEvent, DEFAULT_TOOLS_VIZ } from './bindings.ts'

describe('agent-tools bindings', () => {
  it('auto-spawns a sphere on unmatched tool start', () => {
    const graph = new SceneGraph()
    const touched = handleToolCallEvent(
      {
        graph,
        defaults: { ...DEFAULT_TOOLS_VIZ, enabled: true },
        getAgentPose: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
      },
      { tool: 'web_search', status: 'start', agent: 'alpha' },
    )
    assert.ok(touched.length >= 1)
    assert.ok(graph.list().some((e) => e.tags.includes('tool-viz')))
  })

  it('binds explicit entity', () => {
    const graph = new SceneGraph()
    graph.apply({
      kind: 'spawn',
      entityId: 'lamp',
      payload: {
        id: 'lamp',
        kind: 'object',
        label: 'Lamp',
        pose: { x: 0, y: 0, z: 0, yaw: 0 },
        spec: { shape: 'sphere' },
      },
    })
    bindTool(graph, { tool: 'shell', entityId: 'lamp' })
    const touched = handleToolCallEvent(
      { graph, defaults: { ...DEFAULT_TOOLS_VIZ, spawnPreset: 'off' } },
      { tool: 'shell', status: 'start', agent: 'alpha' },
    )
    assert.deepEqual(touched, ['lamp'])
  })
})
