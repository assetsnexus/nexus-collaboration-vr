import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { headOnlyGestureBones, scratchNoseGestureBones, proceduralFramesAreOverlay, proceduralIdleBones } from './procedural-gestures.ts'

describe('head-only procedural gestures', () => {
  it('does not key arms, hands, or shoulders', () => {
    const bones = headOnlyGestureBones()
    assert.ok(bones.includes('neck'))
    assert.ok(bones.includes('head'))
    for (const bone of bones) {
      assert.equal(
        /arm|hand|shoulder|finger/i.test(bone),
        false,
        `unexpected limb bone ${bone}`,
      )
    }
  })
})

describe('scratch_nose procedural pose', () => {
  it('keys the right arm only, not the left', () => {
    const bones = scratchNoseGestureBones()
    assert.ok(bones.includes('rightUpperArm'))
    assert.ok(bones.includes('rightLowerArm'))
    assert.ok(!bones.some((b) => b.startsWith('left')))
  })

  it('is an overlay clip so idle can keep the left arm', () => {
    assert.equal(proceduralFramesAreOverlay(scratchNoseGestureBones()), true)
    assert.equal(proceduralFramesAreOverlay(headOnlyGestureBones()), true)
    assert.equal(proceduralFramesAreOverlay(['hips', 'spine']), false)
  })
})

describe('procedural idle', () => {
  it('keys both arms so fallback rest is not bind T-pose', () => {
    const bones = proceduralIdleBones()
    assert.ok(bones.includes('leftUpperArm'))
    assert.ok(bones.includes('rightUpperArm'))
    assert.ok(bones.includes('spine'))
  })
})
