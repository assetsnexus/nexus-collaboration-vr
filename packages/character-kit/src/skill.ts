import {
  CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
  CHARACTER_TOOL_DEFINITIONS,
  SCENE_TOOL_DEFINITIONS,
  isCharacterSkillTool,
  isDeferredCharacterTool,
  isImmediateCharacterTool,
  resolveCharacterToolName,
} from './tools.js'
import type { ChatCompletionTool } from './types.js'

/** OpenAI / Hermes / OpenClaw function-name prefix. Always `character_*`. */
export const CHARACTER_SKILL_PREFIX = 'character'

export const CHARACTER_SKILL_ID = 'character'

export function characterToolName(action: string): string {
  const a = action.replace(/^character[._]/, '')
  return `${CHARACTER_SKILL_PREFIX}_${a}`
}

export interface CharacterSkillCatalog {
  gestureIds: string[]
  moods: string[]
  expressions: Array<{ name: string; kind: string }>
  clothes?: string[]
}

/**
 * One skill object for playground, OpenClaw, and Hermes:
 * OpenAI tool schemas + name resolver + prompt fragment.
 */
export const CHARACTER_SKILL = {
  id: CHARACTER_SKILL_ID,
  prefix: CHARACTER_SKILL_PREFIX,
  name: 'character',
  description:
    'Browser VRM companion: gestures, face, ambient moods, clothes, look-at, walk, scene objects. Client-executed OpenAI tools.',
  tools: CHARACTER_TOOL_DEFINITIONS,
  locomotionTools: CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
  sceneTools: SCENE_TOOL_DEFINITIONS,
  resolveToolName: resolveCharacterToolName,
  isCharacterTool: isCharacterSkillTool,
  isImmediate: isImmediateCharacterTool,
  isDeferred: isDeferredCharacterTool,
  allTools(): ChatCompletionTool[] {
    return [
      ...CHARACTER_TOOL_DEFINITIONS,
      ...CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
      ...SCENE_TOOL_DEFINITIONS,
    ]
  },
} as const

export function buildCharacterSkillPrompt(opts: {
  catalog: CharacterSkillCatalog
  inlineTagsEnabled?: boolean
  ttsEnabled?: boolean
  ttsGuide?: string
}): string {
  const gestures =
    opts.catalog.gestureIds.length > 0
      ? opts.catalog.gestureIds.join(', ')
      : 'idle, wave, nod, think, talk, sad, agree, disagree, look_around'
  const moods =
    opts.catalog.moods.length > 0
      ? opts.catalog.moods.join(', ')
      : 'neutral, relaxed, happy, playful, curious, focused, tired, sad, excited'
  const clothes =
    opts.catalog.clothes && opts.catalog.clothes.length > 0
      ? opts.catalog.clothes.join(', ')
      : 'none, default'

  const grouped = { emotion: [] as string[], viseme: [] as string[], other: [] as string[] }
  for (const e of opts.catalog.expressions) {
    if (e.kind === 'emotion') grouped.emotion.push(e.name)
    else if (e.kind === 'viseme') grouped.viseme.push(e.name)
    else grouped.other.push(e.name)
  }
  const emotions =
    grouped.emotion.length > 0
      ? grouped.emotion.join(', ')
      : 'neutral, happy, angry, sad, relaxed, surprised'
  const visemes =
    grouped.viseme.length > 0 ? grouped.viseme.join(', ') : 'aa, ih, ou, ee, oh'
  const extras = grouped.other.length > 0 ? grouped.other.join(', ') : '(none on this model)'

  const inlineBlock = opts.inlineTagsEnabled
    ? `
## Compact motion tags (preferred for simple beats)
All tools are prefixed \`character_\` (also accept \`character.play_gesture\`). For ordinary replies, put square-bracket cues in the spoken text instead of calling tools. The client strips them from chat and from TTS.

Chains use commas, optional spaces. Pipe attaches a scored face from the live catalog. Scores are 0–100 (30 = 30% blend). Prefer 20–50 while talking; avoid 100.

- Gesture: [nod] [wave]
- Gesture + face: [wave|angry=30] [laugh|happy=30]  (typos: angy→angry, lough→laugh)
- Chain beats: [nod|happy=40, wave|surprised=25]
- Layer extra shapes with + (comma is the chain splitter): [wave|angry=30+surprised=10]
- Face-only: [happy=35] [emotion:angry=30]
- Wait: 2s, 400ms
- Ambient mood: [mood:playful] or [playful] when that id is only a mood
- Live faces: ${emotions}
- Gesture ids: ${gestures}
- Look: [look:camera]
- Clothes: [clothes:none] [clothes:default] [clothes:tops+shoes] — slot ids: ${clothes}
- Walk / turn / jump: [walk:forward=1] [walk:backward=3] [turn:90] [jump]
- Approach / face: [approach:seat] [approach:seat,from=left] [turnto:@alice] [wave:@bob]
- Teleport: [teleport:seat] [teleport:seat,side=left,distance=1.5] [tp:camera]
- Tags at the START of the reply play with speech; tags at the END play after TTS finishes
- After the spoken beat the face eases back to the current mood rest face (not a hard cut to neutral)
- Bare Fish tags like [happy] are voice only. Use [happy=30] or [wave|happy=30] for the 3D face.

Use \`character_run_sequence\` / other \`character_*\` tools only for complex overlapping or conditional performances.
`.trim()
    : `
## Avatar tools (all prefixed character_)
Call tools to animate; never print tool JSON as chat text. Dotted names (\`character.play_gesture\`) are accepted.
`.trim()

  const toolsBlock = `
## Scene frame (Y-up, meters)
Avatar spawns at (0,0,0) facing the camera. World +X = screen right, +Y = up, +Z = toward camera (default camera ~0,1.95,2.2, orbit target at head height).
List places with scene_list_objects before teleporting. Prefer objectId over raw xz.
character_teleport objectId: stand on side (default front-to-front), distance meters past the object radius, always face the object.
character_walk: prefer forward/right meters (aliases: backward/back → −forward, left → −right); objectId uses the same stand-beside pose. Default face=keep so turn→walk→turn draws a square; pass face=camera only to face the user after arriving. gait=walk|run|careful|crouch|crawl|roll (clips + nominal speed). Long paths (>4s at walk speed) auto-run.
character_turn degrees: +right −left. Chain turn then walk:forward=N for polygons; do not reset face between legs.

## character_* tools (skill id: ${CHARACTER_SKILL_ID})
- character_set_emotion — scored face (0–100 or 0–1). Live: ${emotions}. Eases in; returns to mood rest after the beat / holdMs
- character_set_expression — raw blendshape from character_list_expressions
- character_play_gesture — ids: ${gestures}. Optional emotion+intensity (same as [wave|angry=30]). Optional target=@participant or object id turns toward it and stays ([wave:@alice])
- character_look_at
- character_wait — ms between beats
- character_run_sequence — multi-step (play_gesture / set_emotion / set_expression / set_mood / look_at / wait / walk / approach / turn_to)
- character_cancel — soft-cancel prior timeline
- character_list_gestures | character_list_expressions | character_list_moods | character_list_clothes
- character_set_mood — ambient moods: ${moods}. Each mood has a rest face the performance face eases back to
- character_set_clothes — none | default | slot ids (combine with + or ids[]): ${clothes}. Optional overlay url adds that VRM's clothes on top of native slots
- character_walk — forward/right meters, or to:{x,z}, or objectId (+ side/distance). gait walk/run/careful/crouch/crawl/roll; auto-run if >4s walk. Tool result includes final pose + nearby objects
- character_approach — walk to object/@participant. from=front|left|right|back|top. Default auto gait so the trip takes <5s. Faces the target.
- character_turn — degrees (+right −left). Tool result includes final pose + nearby objects
- character_turn_to — face an object or @participant and keep that heading
- character_stop | character_jump | character_teleport (prefer objectId)
- scene_overview — compact nearby catalog (radius meters, default 20). Prefer this over a full list
- scene_get_object — details for one id or @participant
- scene_list_objects — filtered catalog when you need more than the overview
- scene_move_object — smooth move a prop with a tracing line
- scene_glow_object — pulse glow (color, durationMs)

## Face (per loaded VRM)
- Emotions: ${emotions}
- Visemes (lip-sync owns these while TTS plays): ${visemes}
- Other: ${extras}

## Ambient life
Idle fidgets are automatic. Use character_set_mood / [mood:…] to steer. Do not spam play_gesture for idle/weight_shift/scratch_nose/stretch/sit.
`.trim()

  const parts = [inlineBlock, toolsBlock]
  if (opts.ttsEnabled && opts.ttsGuide) parts.push(opts.ttsGuide)
  return parts.join('\n\n')
}
