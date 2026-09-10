/**
 * Compact scene / peer-action log for group chats.
 * Bots do not share tool-call history; this is the cross-agent digest.
 */

export type SceneEventKind = 'action' | 'collision'

export interface CompactSceneEvent {
  at: number
  kind: SceneEventKind
  agent: string
  op?: string
  target?: string
  label?: string
  other?: string
  distM?: number
}

type StoredEvent = CompactSceneEvent & { seq: number }

const NOISY_OPS = new Set(['emotion', 'face', 'mood', 'camera', 'wait', 'cancel'])

export const SCENE_ACTION_LIMIT = 12
export const SCENE_COLLISION_LIMIT = 4
const COLLISION_DEDUP_MS = 1200
const LOG_MAX = 80
const OUTBOUND_MAX = 40

export function isNoisySceneOp(op: string | undefined): boolean {
  return Boolean(op && NOISY_OPS.has(op))
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function roundDist(m: number): number {
  return Math.round(m * 10) / 10
}

function publicEvent(ev: StoredEvent): CompactSceneEvent {
  return {
    at: ev.at,
    kind: ev.kind,
    agent: ev.agent,
    op: ev.op,
    target: ev.target,
    label: ev.label,
    other: ev.other,
    distM: ev.distM,
  }
}

function relevantForAgent(ev: CompactSceneEvent, self: string): 'action' | 'collision' | null {
  if (ev.kind === 'action') {
    return ev.agent.toLowerCase() !== self ? 'action' : null
  }
  const mine = ev.agent.toLowerCase() === self || ev.other?.toLowerCase() === self
  return mine ? 'collision' : null
}

export class SceneEventLog {
  private events: StoredEvent[] = []
  private outbound: CompactSceneEvent[] = []
  private latestFace = new Map<string, string>()
  private lastCollisionAt = new Map<string, number>()
  private cursors = new Map<string, number>()
  private faceSent = new Map<string, string>()
  private seq = 0

  clear(): void {
    this.events = []
    this.outbound = []
    this.latestFace.clear()
    this.lastCollisionAt.clear()
    this.cursors.clear()
    this.faceSent.clear()
    this.seq = 0
  }

  recordAction(input: {
    agent?: string
    op: string
    label: string
    target?: string
    source?: string
    at?: number
  }): CompactSceneEvent | null {
    const agent = input.agent?.trim()
    if (!agent) return null
    const at = input.at ?? Date.now()
    if (input.op === 'emotion' || input.op === 'face' || input.op === 'mood') {
      this.latestFace.set(agent, input.label)
      return null
    }
    if (isNoisySceneOp(input.op)) return null
    if (input.source === 'routine' || input.source === 'auto') return null
    if (input.source === 'user' && (input.op === 'camera' || input.op === 'gesture')) return null
    const ev: CompactSceneEvent = {
      at,
      kind: 'action',
      agent,
      op: input.op,
      label: input.label.slice(0, 48),
      target: input.target,
    }
    this.push(ev)
    return ev
  }

  recordCollision(a: string, b: string, distM: number, at = Date.now()): CompactSceneEvent | null {
    const left = a.trim()
    const right = b.trim()
    if (!left || !right || left === right) return null
    const key = pairKey(left, right)
    const prev = this.lastCollisionAt.get(key)
    if (prev !== undefined && at - prev < COLLISION_DEDUP_MS) return null
    this.lastCollisionAt.set(key, at)
    const ev: CompactSceneEvent = {
      at,
      kind: 'collision',
      agent: left,
      other: right,
      distM: roundDist(distM),
      op: 'contact',
      label: `contact ${left} ↔ ${right}`,
    }
    this.push(ev)
    return ev
  }

  snapshot(): CompactSceneEvent[] {
    return this.events.map(publicEvent)
  }

  latestFaces(): Record<string, string> {
    return Object.fromEntries(this.latestFace)
  }

  /**
   * Events not yet POSTed to the backend. Faces are latest-known, not unread.
   */
  consumeOutbound(): { events: CompactSceneEvent[]; faces: Record<string, string> } {
    const events = this.outbound.splice(0, this.outbound.length).slice(0, OUTBOUND_MAX)
    return { events, faces: this.latestFaces() }
  }

  /**
   * Compact unread digest for one bot: peer actions + collisions involving them.
   * Independent per agent so a group of N bots each see the others' moves.
   */
  drainForAgent(
    agent: string,
    limit = SCENE_ACTION_LIMIT,
  ): {
    events: CompactSceneEvent[]
    faces: Record<string, string>
  } {
    const self = agent.trim().toLowerCase()
    if (!self) return { events: [], faces: {} }
    const last = this.cursors.get(self) ?? 0
    const pending = this.events.filter((ev) => ev.seq > last)
    if (pending.length) this.cursors.set(self, pending[pending.length - 1]!.seq)

    const kept: CompactSceneEvent[] = []
    let actions = 0
    let collisions = 0
    for (const ev of pending) {
      const kind = relevantForAgent(ev, self)
      if (kind === 'action' && actions < limit) {
        kept.push(publicEvent(ev))
        actions += 1
      } else if (kind === 'collision' && collisions < SCENE_COLLISION_LIMIT) {
        kept.push(publicEvent(ev))
        collisions += 1
      }
    }

    const faces: Record<string, string> = {}
    for (const [slug, face] of this.latestFace) {
      if (slug.toLowerCase() === self) continue
      const sentKey = `${self}|${slug.toLowerCase()}`
      if (this.faceSent.get(sentKey) === face) continue
      this.faceSent.set(sentKey, face)
      faces[slug] = face
    }
    return { events: kept, faces }
  }

  peekForAgent(agent: string, limit = SCENE_ACTION_LIMIT): CompactSceneEvent[] {
    const copy = new SceneEventLog()
    copy.events = this.events.map((ev) => ({ ...ev }))
    copy.latestFace = new Map(this.latestFace)
    copy.cursors = new Map(this.cursors)
    copy.faceSent = new Map(this.faceSent)
    copy.seq = this.seq
    return copy.drainForAgent(agent, limit).events
  }

  private push(ev: CompactSceneEvent): void {
    const stored: StoredEvent = { ...ev, seq: ++this.seq }
    this.events.push(stored)
    if (this.events.length > LOG_MAX) this.events.splice(0, this.events.length - LOG_MAX)
    this.outbound.push(publicEvent(stored))
    if (this.outbound.length > OUTBOUND_MAX) {
      this.outbound.splice(0, this.outbound.length - OUTBOUND_MAX)
    }
  }
}

export function formatSceneDigest(
  events: CompactSceneEvent[],
  faces: Record<string, string> = {},
): string {
  if (!events.length && !Object.keys(faces).length) return ''
  const lines: string[] = ['Scene (since last turn, compact):']
  for (const ev of events) {
    if (ev.kind === 'collision') {
      const dist = ev.distM != null ? ` ${ev.distM}m` : ''
      lines.push(`- contact @${ev.agent} ↔ ${ev.other}${dist}`)
      continue
    }
    const target = ev.target ? ` → ${ev.target}` : ''
    const label = ev.label && ev.label !== ev.op ? ` ${ev.label}` : ''
    lines.push(`- @${ev.agent} ${ev.op ?? 'move'}${label}${target}`)
  }
  const faceBits = Object.entries(faces).map(([slug, face]) => `@${slug} ${face}`)
  if (faceBits.length) lines.push(`- faces: ${faceBits.join(', ')}`)
  return lines.join('\n')
}
