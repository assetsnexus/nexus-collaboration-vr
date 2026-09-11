import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeRobotSpec } from './spec.ts'

describe('RobotSpec', () => {
  it('defaults to capsule stand-in', () => {
    const s = normalizeRobotSpec(null)
    assert.equal(s.standIn, 'capsule')
    assert.deepEqual(s.joints, [])
  })

  it('keeps joints', () => {
    const s = normalizeRobotSpec({
      joints: [{ name: 'shoulder', angle: 0.5 }, { name: '', angle: 1 }],
    })
    assert.equal(s.joints?.length, 1)
    assert.equal(s.joints?.[0]?.name, 'shoulder')
  })
})
