import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_EXPORT_KIND,
  parseAgentExport,
  portableConfigFromPane,
  stringifyAgentExport,
  summarizeAgentExport,
} from './agent-export.ts'

const sample = {
  label: 'Alpha',
  baseUrl: '/api/llm',
  apiKey: 'secret-key',
  model: 'deepseek/deepseek-v4-flash',
  vocabulary: ['Alpha', 'OpenClaw'],
  defaultMood: 'curious',
  vrmUrl: '/assets/vrm/sample.vrm',
  clothesIds: ['Tops001'],
  clothesOverlayId: 'cat-ear',
  clothesOverlayItems: [{ sourceId: 'cat-ear', itemId: 'CatTail' }],
  wardrobeByModel: {
    sample: {
      clothesIds: ['Tops001'],
      clothesOverlayId: 'cat-ear',
      clothesOverlayItems: [{ sourceId: 'cat-ear', itemId: 'CatTail' }],
    },
  },
}

describe('stringifyAgentExport', () => {
  it('wraps portable fields and omits runtime identity', () => {
    const json = stringifyAgentExport(sample)
    const parsed = JSON.parse(json) as {
      kind: string
      version: number
      agent: { label: string; id?: string; messages?: unknown; apiKey?: string }
    }
    assert.equal(parsed.kind, AGENT_EXPORT_KIND)
    assert.equal(parsed.version, 1)
    assert.equal(parsed.agent.label, 'Alpha')
    assert.equal(parsed.agent.apiKey, 'secret-key')
    assert.equal(parsed.agent.id, undefined)
    assert.equal(parsed.agent.messages, undefined)
  })
})

describe('parseAgentExport', () => {
  it('round-trips the envelope', () => {
    const result = parseAgentExport(stringifyAgentExport(sample))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.agent.label, 'Alpha')
    assert.equal(result.agent.baseUrl, '/api/llm')
    assert.deepEqual(result.agent.clothesOverlayItems, [
      { sourceId: 'cat-ear', itemId: 'CatTail' },
    ])
    assert.equal(result.agent.wardrobeByModel?.sample?.clothesOverlayId, 'cat-ear')
  })

  it('accepts a bare agent object', () => {
    const result = parseAgentExport(JSON.stringify({ label: 'Beta', vrmUrl: '/assets/vrm/hoodie.vrm' }))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.agent.label, 'Beta')
    assert.equal(result.agent.vrmUrl, '/assets/vrm/hoodie.vrm')
  })

  it('rejects settings JSON, empty text, and unknown kinds', () => {
    assert.equal(parseAgentExport('').ok, false)
    assert.equal(parseAgentExport('{').ok, false)
    assert.equal(parseAgentExport(JSON.stringify({ sttProvider: 'browser-whisper' })).ok, false)
    assert.equal(parseAgentExport(JSON.stringify({ kind: 'other', label: 'X' })).ok, false)
    assert.equal(parseAgentExport(JSON.stringify({ label: 'OnlyName' })).ok, false)
  })

  it('accepts a single-item array and drops duplicate overlay pieces', () => {
    const result = parseAgentExport(
      JSON.stringify([
        {
          label: 'Gamma',
          model: 'x-ai/grok-4.6',
          clothesOverlayItems: [
            { sourceId: 'hoodie', itemId: 'Tops002' },
            { sourceId: 'hoodie', itemId: 'Tops002' },
            { itemId: 'missing-source' },
          ],
        },
      ]),
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.agent.clothesOverlayItems, [
      { sourceId: 'hoodie', itemId: 'Tops002' },
    ])
  })
})

describe('portableConfigFromPane', () => {
  it('keeps wardrobe and drops blank labels', () => {
    const cfg = portableConfigFromPane(sample)
    assert.equal(cfg.label, 'Alpha')
    assert.equal(cfg.wardrobeByModel?.sample?.clothesIds?.[0], 'Tops001')
    assert.equal(summarizeAgentExport(cfg).includes('Alpha'), true)
    assert.equal(summarizeAgentExport(cfg).includes('sample'), true)
  })
})
