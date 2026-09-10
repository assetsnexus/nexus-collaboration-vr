import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeFaceWeight,
  parseFaceLayers,
  parseFaceScore,
  parseGestureFaceToken,
  aliasFaceName,
} from './face-score.ts'

describe('parseFaceScore', () => {
  it('treats 0–100 as percent and 0–1 as weight', () => {
    assert.equal(parseFaceScore('30'), 0.3)
    assert.equal(parseFaceScore('30%'), 0.3)
    assert.equal(parseFaceScore('0.3'), 0.3)
    assert.equal(parseFaceScore(30), 0.3)
    assert.equal(parseFaceScore(0.45), 0.45)
    assert.equal(normalizeFaceWeight(150), 1)
  })

  it('defaults omitted scores to a mild 0.4', () => {
    assert.equal(parseFaceScore(''), 0.4)
    assert.equal(parseFaceScore(undefined), 0.4)
  })
})

describe('parseFaceLayers / parseGestureFaceToken', () => {
  it('parses pipe gesture+face and plus-blends', () => {
    assert.deepEqual(parseGestureFaceToken('wave|angry=30'), {
      gesture: 'wave',
      layers: [{ name: 'angry', weight: 0.3 }],
    })
    assert.deepEqual(parseGestureFaceToken('lough|happy=30'), {
      gesture: 'lough',
      layers: [{ name: 'happy', weight: 0.3 }],
    })
    assert.deepEqual(parseFaceLayers('angry=30+surprised=10'), [
      { name: 'angry', weight: 0.3 },
      { name: 'surprised', weight: 0.1 },
    ])
  })

  it('aliases angy → angry', () => {
    assert.equal(aliasFaceName('angy'), 'angry')
    assert.deepEqual(parseFaceLayers('angy=30'), [{ name: 'angry', weight: 0.3 }])
  })
})
