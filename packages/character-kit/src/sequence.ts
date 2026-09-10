import { resolveCharacterToolName } from './tools.js'
import type { LookAtTarget } from './types.js'
import type { FaceLayer } from './face-score.js'

export type SequenceOp =
  | 'play_gesture'
  | 'set_emotion'
  | 'set_expression'
  | 'set_mood'
  | 'set_clothes'
  | 'look_at'
  | 'wait'
  | 'walk'
  | 'turn'
  | 'jump'
  | 'teleport'
  | 'approach'
  | 'turn_to'

export interface SequenceStep {
  op: SequenceOp | string
  id?: string
  emotion?: string
  intensity?: number
  holdMs?: number
  name?: string
  weight?: number
  loop?: boolean
  crossFade?: number
  ms?: number
  mood?: string
  clothesId?: string
  clothesIds?: string[]
  clothesUrl?: string | null
  target?: LookAtTarget
  turn?: boolean
  faces?: FaceLayer[]
  fadeMs?: number
  /** Walk / teleport args (forward, right, objectId, …). */
  walkArgs?: Record<string, unknown>
  degrees?: number
  speed?: number
  objectId?: string
  /** Scene object id or @participant for gesture / approach / turn-to. */
  sceneTarget?: string
  approachFrom?: 'front' | 'left' | 'right' | 'back' | 'top' | 'from'
}

const SEQUENCE_OP_MAP: Record<string, SequenceOp> = {
  play_gesture: 'play_gesture',
  set_emotion: 'set_emotion',
  set_expression: 'set_expression',
  set_mood: 'set_mood',
  look_at: 'look_at',
  wait: 'wait',
  walk: 'walk',
  turn: 'turn',
  jump: 'jump',
  teleport: 'teleport',
  character_play_gesture: 'play_gesture',
  character_set_emotion: 'set_emotion',
  character_set_expression: 'set_expression',
  character_set_mood: 'set_mood',
  character_set_clothes: 'set_clothes',
  set_clothes: 'set_clothes',
  character_look_at: 'look_at',
  character_wait: 'wait',
  character_walk: 'walk',
  character_walk_to: 'walk',
  character_turn: 'turn',
  character_jump: 'jump',
  character_teleport: 'teleport',
  character_approach: 'approach',
  approach: 'approach',
  character_turn_to: 'turn_to',
  turn_to: 'turn_to',
  turnto: 'turn_to',
}

export function resolveSequenceOp(op: string): SequenceOp | null {
  const n = resolveCharacterToolName(op)
  return SEQUENCE_OP_MAP[op] ?? SEQUENCE_OP_MAP[n] ?? null
}
