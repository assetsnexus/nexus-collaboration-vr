import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSceneDiffPrompt, formatSceneGraphPrompt } from './prompt.ts'
import { SceneEventLog, formatSceneDigest } from './events.ts'

describe('prompt', () => {
  it('stays compact', () => {
    const text = formatSceneGraphPrompt({
      selfSlug: 'me',
      selfPose: { x: 0, z: 0 },
      entities: [
        { id: 'ball', kind: 'object', label: 'Ball', x: 1, y: 0.1, z: 0, yaw: 0 },
      ],
    })
    assert.match(text, /Nearby scene entities/)
    assert.ok(text.split('\n').length <= 16)
  })

  it('formats diffs', () => {
    const diff = formatSceneDiffPrompt({
      prev: [{ id: 'a', kind: 'object', label: 'A', x: 0, y: 0, z: 0, yaw: 0 }],
      next: [{ id: 'a', kind: 'object', label: 'A', x: 2, y: 0, z: 0, yaw: 0 }],
    })
    assert.match(String(diff), /moved/)
  })
})

describe('SceneEventLog', () => {
  it('drains graph events for an agent', () => {
    const log = new SceneEventLog()
    log.record({ at: Date.now(), kind: 'spawned', entityId: 'ball', op: 'spawn', label: 'Ball' })
    const d = log.drainForAgent('alpha')
    assert.equal(d.graph.length, 1)
    assert.match(formatSceneDigest(d), /spawned/)
  })
})
