import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aliasFaceName,
  parseFaceLayers,
  parseGestureFaceToken,
} from './face-score.ts'
import {
  defaultInlineCatalog,
  parseInlineTags,
  parseWalkTagValue,
} from '../dist/inline-tags.js'

/** Mirrors GESTURE_TOKEN_ALIASES in inline-tags.ts (that module pulls .js specs). */
const GESTURE_TOKEN_ALIASES: Record<string, string> = {
  lough: 'laugh',
  laughing: 'laugh',
  chuckle: 'laugh',
  chuckling: 'laugh',
  nodding: 'nod',
  waving: 'wave',
  thinking: 'think',
}

describe('scored motion tag contract', () => {
  it('parses [gesture|face=score] the way the LLM is told to write it', () => {
    assert.deepEqual(parseGestureFaceToken('wave|angry=30'), {
      gesture: 'wave',
      layers: [{ name: 'angry', weight: 0.3 }],
    })
    assert.deepEqual(parseGestureFaceToken('lough|happy=30'), {
      gesture: 'lough',
      layers: [{ name: 'happy', weight: 0.3 }],
    })
    assert.equal(GESTURE_TOKEN_ALIASES.lough, 'laugh')
    assert.equal(aliasFaceName('angy'), 'angry')
  })

  it('splits comma chains and plus-layers extras', () => {
    const parts = 'nod|happy=40, wave|angry=30+surprised=10'
      .split(',')
      .map((p) => p.trim())
    assert.deepEqual(parseGestureFaceToken(parts[0]!), {
      gesture: 'nod',
      layers: [{ name: 'happy', weight: 0.4 }],
    })
    assert.deepEqual(parseGestureFaceToken(parts[1]!), {
      gesture: 'wave',
      layers: [
        { name: 'angry', weight: 0.3 },
        { name: 'surprised', weight: 0.1 },
      ],
    })
    assert.deepEqual(parseFaceLayers('angry=30+surprised=10'), [
      { name: 'angry', weight: 0.3 },
      { name: 'surprised', weight: 0.1 },
    ])
  })
})

describe('walk tag meters', () => {
  it('maps backward/left aliases to negative forward/right', () => {
    assert.deepEqual(parseWalkTagValue('backward=3'), { forward: -3 })
    assert.deepEqual(parseWalkTagValue('back=2'), { forward: -2 })
    assert.deepEqual(parseWalkTagValue('left=1.5'), { right: -1.5 })
    assert.deepEqual(parseWalkTagValue('forward=1,right=-0.5'), { forward: 1, right: -0.5 })
  })

  it('parses [walk:backward=3] [mood:focused] into sequence steps', () => {
    const parsed = parseInlineTags(
      '[walk:backward=3] [mood:focused] stepping back',
      defaultInlineCatalog(),
    )
    assert.ok(
      parsed.withSpeech.some(
        (s) => s.op === 'walk' && (s.walkArgs as { forward?: number })?.forward === -3,
      ),
    )
    assert.ok(parsed.withSpeech.some((s) => s.op === 'set_mood' && s.mood === 'focused'))
    assert.match(parsed.displayText, /stepping back/)
    assert.doesNotMatch(parsed.displayText, /walk:backward/)
  })

  it('emits timedCues with ttsIndex for mid-message face scores', () => {
    const parsed = parseInlineTags(
      'Hello [happy=40] there friend.',
      defaultInlineCatalog(),
    )
    assert.ok(parsed.timedCues.length >= 1)
    const cue = parsed.timedCues.find((c) => c.steps.some((s) => s.op === 'set_emotion'))
    assert.ok(cue)
    assert.equal(cue!.placement, 'mid')
    assert.ok(cue!.ttsIndex >= 'Hello '.length - 1)
    assert.doesNotMatch(parsed.ttsText, /happy=40/)
  })

  it('emits timedCues for custom expression tags like [grin]', () => {
    const catalog = {
      ...defaultInlineCatalog(),
      expressions: [...defaultInlineCatalog().expressions, 'grin'],
    }
    const parsed = parseInlineTags('Hello [grin] there.', catalog)
    const cue = parsed.timedCues.find((c) =>
      c.steps.some((s) => s.op === 'set_expression' && s.name === 'grin'),
    )
    assert.ok(cue)
    assert.equal(cue!.placement, 'mid')
    assert.ok(cue!.ttsIndex >= 'Hello '.length - 1)
    assert.doesNotMatch(parsed.ttsText, /\[grin\]/)
  })

  it('parses mood: and gesture: kv tags (colon is not a scene target)', () => {
    const mood = parseInlineTags('[mood:playful] Hey!', defaultInlineCatalog())
    assert.ok(mood.withSpeech.some((s) => s.op === 'set_mood' && s.mood === 'playful'))
    assert.equal(mood.ttsText.trim(), 'Hey!')

    const gest = parseInlineTags('[gesture:sad] oh no', defaultInlineCatalog())
    assert.ok(gest.withSpeech.some((s) => s.op === 'play_gesture' && s.id === 'sad'))
    assert.equal(gest.ttsText.trim(), 'oh no')
  })

  it('keeps Fish voice tags in ttsText and strips VRM gestures', () => {
    const parsed = parseInlineTags(
      '[wave] [happy] Hello! [laughing]',
      defaultInlineCatalog(),
    )
    assert.ok(parsed.withSpeech.some((s) => s.op === 'play_gesture' && s.id === 'wave'))
    assert.match(parsed.ttsText, /\[happy\]/)
    assert.match(parsed.ttsText, /\[laughing\]/)
    assert.doesNotMatch(parsed.ttsText, /\[wave\]/)
  })

  it('uses bare [happy] as Fish and [happy=40] as VRM face', () => {
    const fish = parseInlineTags('[happy] Hi', defaultInlineCatalog())
    assert.equal(fish.withSpeech.length, 0)
    assert.match(fish.ttsText, /\[happy\]/)

    const face = parseInlineTags('[happy=40] Hi', defaultInlineCatalog())
    assert.ok(face.withSpeech.some((s) => s.op === 'set_emotion'))
    assert.doesNotMatch(face.ttsText, /happy/)
  })
})
