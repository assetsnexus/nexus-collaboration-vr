import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  looksLikeSceneRef,
  parseSceneRef,
  sceneRefLabel,
  splitTrailingSceneTarget,
} from './scene-ref.ts'

describe('parseSceneRef', () => {
  it('parses @participant and object ids', () => {
    assert.deepEqual(parseSceneRef('@beta'), { kind: 'participant', id: 'beta' })
    assert.deepEqual(parseSceneRef('participant:alpha'), { kind: 'participant', id: 'alpha' })
    assert.deepEqual(parseSceneRef('seat'), { kind: 'object', id: 'seat' })
    assert.equal(parseSceneRef('forward=1'), null)
    assert.equal(sceneRefLabel({ kind: 'participant', id: 'beta' }), '@beta')
  })
})

describe('splitTrailingSceneTarget', () => {
  it('splits gesture:@agent without eating walk kv', () => {
    assert.deepEqual(splitTrailingSceneTarget('wave:@beta'), {
      body: 'wave',
      target: '@beta',
    })
    assert.deepEqual(splitTrailingSceneTarget('wave|angry=30:@alpha'), {
      body: 'wave|angry=30',
      target: '@alpha',
    })
    assert.deepEqual(splitTrailingSceneTarget('walk:forward=1'), { body: 'walk:forward=1' })
    assert.equal(looksLikeSceneRef('forward=1'), false)
  })

  it('does not treat mood:/gesture:/look: value as a scene target', () => {
    assert.deepEqual(splitTrailingSceneTarget('mood:playful'), { body: 'mood:playful' })
    assert.deepEqual(splitTrailingSceneTarget('gesture:sad'), { body: 'gesture:sad' })
    assert.deepEqual(splitTrailingSceneTarget('g:wave'), { body: 'g:wave' })
    assert.deepEqual(splitTrailingSceneTarget('look:camera'), { body: 'look:camera' })
    assert.deepEqual(splitTrailingSceneTarget('emotion:happy'), { body: 'emotion:happy' })
  })
})
