import type { CharacterController } from '@nexus/character-kit'

export interface CharacterDirective {
  emotion?: string
  gesture?: string
  intensity?: number
  look?: 'camera' | null
  loop?: boolean
}

const LINE_RE = /CHARACTER:\s*(\{[^\n]*\})/i
const TAG_RE = /<character\b([^>]*)\/?>/i

/**
 * Hermes API runs tools server-side and ignores client OpenAI `tools`.
 * Directives are therefore embedded in assistant text (any line).
 */
export function extractCharacterDirective(content: string): {
  directive: CharacterDirective | null
  spoken: string
} {
  let spoken = content
  let directive: CharacterDirective | null = null

  const line = spoken.match(LINE_RE)
  if (line?.[1]) {
    try {
      directive = JSON.parse(line[1]) as CharacterDirective
      spoken = spoken.replace(line[0], '').replace(/\n{3,}/g, '\n\n').trim()
    } catch {
      /* ignore bad JSON */
    }
  }

  if (!directive) {
    const tag = spoken.match(TAG_RE)
    if (tag) {
      directive = parseAttrs(tag[1] ?? '')
      spoken = spoken.replace(tag[0], '').replace(/\n{3,}/g, '\n\n').trim()
    }
  }

  return { directive, spoken }
}

function parseAttrs(raw: string): CharacterDirective {
  const out: CharacterDirective = {}
  const re = /(\w+)\s*=\s*["']([^"']*)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const key = m[1]!
    const val = m[2]!
    if (key === 'emotion') out.emotion = val
    else if (key === 'gesture') out.gesture = val
    else if (key === 'look') out.look = val === 'camera' ? 'camera' : null
    else if (key === 'intensity') out.intensity = Number(val)
    else if (key === 'loop') out.loop = val === 'true' || val === '1'
  }
  return out
}

export function applyCharacterDirective(
  controller: CharacterController | null | undefined,
  directive: CharacterDirective | null,
): string[] {
  if (!controller || !directive) return []
  const applied: string[] = []
  if (directive.emotion) {
    controller.setEmotion(directive.emotion, directive.intensity ?? 1, 4000)
    applied.push(`emotion=${directive.emotion}`)
  }
  if (directive.gesture) {
    controller.playGesture(directive.gesture, Boolean(directive.loop), 0.25)
    applied.push(`gesture=${directive.gesture}`)
  }
  if (directive.look !== undefined) {
    controller.lookAt(directive.look === 'camera' ? 'camera' : null)
    applied.push(`look=${directive.look}`)
  }
  return applied
}

/** Body language for “speaking” without lip-sync / TTS. */
export function playSpeakingBeat(
  controller: CharacterController | null | undefined,
  opts: { joke?: boolean } = {},
): void {
  if (!controller) return
  controller.lookAt('camera')
  controller.setEmotion('relaxed', 0.7, 1500)
  controller.playGesture('think', false, 0.2)
  window.setTimeout(() => {
    controller.setEmotion('happy', 1, 5000)
    controller.playGesture('talk', true, 0.25)
  }, 900)
  window.setTimeout(() => {
    controller.playGesture(opts.joke ? 'nod' : 'wave', false, 0.3)
    controller.setEmotion('happy', 0.85, 3000)
  }, 5500)
}

export const CHARACTER_DIRECTIVE_SYSTEM = `You control a 3D VRM avatar in the user's browser.
Hermes cannot run avatar tools itself. Before every spoken reply, emit ONE line in this exact format (JSON only, no markdown):
CHARACTER:{"emotion":"happy","gesture":"wave"}
Then a blank line, then your short spoken reply (1–3 sentences, no emoji spam).

Allowed emotion: neutral, happy, angry, sad, relaxed, surprised
Allowed gesture: idle, wave, nod, think, talk, sad
Optional keys: intensity (0..1), loop (boolean), look ("camera")
If no motion is needed: CHARACTER:{"emotion":"neutral"}`

