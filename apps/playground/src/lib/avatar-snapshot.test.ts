import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatAvatarSnapshot } from './avatar-snapshot.ts'

describe('formatAvatarSnapshot', () => {
  it('names the agent and forbids defaulting the body on a new session', () => {
    const text = formatAvatarSnapshot({
      agentName: 'Beta',
      vrmLabel: 'Sample',
      mood: 'focused',
      clothesId: 'default',
      clothesIds: ['Tops001'],
      overlays: ['cat-ear:ear'],
      gesture: 'idle',
      pose: { x: 0.5, z: -1, facing: 0, grounded: true, moving: false },
    })
    assert.match(text, /You are Beta/)
    assert.match(text, /mesh file is Sample/)
    assert.match(text, /Tops001/)
    assert.match(text, /does not reload the 3D model/)
    assert.match(text, /Do not strip clothes/)
    assert.match(text, /fix it with character_\*/)
  })
})
