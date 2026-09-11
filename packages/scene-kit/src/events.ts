/**
 * Compact scene / peer-action log for group chats.
 * Generalized from character-kit SceneEventLog with spawned/moved/tool kinds.
 */

import type { CompactSceneEvent, CompactSceneEventKind } from './types.ts'

type StoredEvent = CompactSceneEvent & { seq: number }

const NOISY_OPS = new Set(['emotion', 'face', 'mood', 'camera', 'wait', 'cancel'])

export const SCENE_ACTION_LIMIT = 12
export const SCENE_COLLISION_LIMIT = 4
export const SCENE_GRAPH_EVENT_LIMIT = 8
const COLLISION_DEDUP_MS = 1200
const LOG_MAX = 120
const OUTBOUND_MAX = 40

export function isNoisySceneOp(op: string | undefined): boolean {
  return Boolean(op && NOISY_OPS.has(op))
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function publicEvent(ev: StoredEvent): CompactSceneEvent {
  return {
    at: ev.at,
    kind: ev.kind,
    agent: ev.agent,
    entityId: ev.entityId,
    op: ev.op,
    target: ev.target,
    label: ev.label,
    other: ev.other,
    distM: ev.distM,
  }
}

function relevantForAgent(
  ev: CompactSceneEvent,
  self: string,
): CompactSceneEventKind | null {
  const me = self.toLowerCase()
  if (ev.kind === 'action') {
    return ev.agent?.toLowerCase() !== me ? 'action' : null
  }
  if (ev.kind === 'collision') {
    const mine = ev.agent?.toLowerCase() === me || ev.other?.toLowerCase() === me
    return mine ? 'collision' : null
  }
  // Graph events: everyone sees deltas (digest is short).
  return ev.kind
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

  record(ev: CompactSceneEvent): CompactSceneEvent | null {
    if (ev.kind === 'action') {
      return this.recordAction({
        agent: ev.agent,
        op: ev.op || 'action',
        label: ev.label || ev.op || 'action',
        target: ev.target,
        at: ev.at,
      })
    }
    if (ev.kind === 'collision' && ev.agent && ev.other != null && ev.distM != null) {
      return this.recordCollision(ev.agent, ev.other, ev.distM, ev.at)
    }
    const at = ev.at ?? Date.now()
    const stored: StoredEvent = { ...ev, at, seq: ++this.seq }
    this.push(stored)
    return publicEvent(stored)
  }

  recordAction(input: {
    agent?: string
    op: string
    label: string
    target?: string
    source?: string
    at?: number
    entityId?: string
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
      label: input.label,
      target: input.target,
      entityId: input.entityId,
    }
    const stored: StoredEvent = { ...ev, seq: ++this.seq }
    this.push(stored)
    return publicEvent(stored)
  }

  recordCollision(a: string, b: string, distM: number, at = Date.now()): CompactSceneEvent | null {
    const left = a.trim()
    const right = b.trim()
    if (!left || !right) return null
    const key = pairKey(left.toLowerCase(), right.toLowerCase())
    const prev = this.lastCollisionAt.get(key)
    if (prev !== undefined && at - prev < COLLISION_DEDUP_MS) return null
    this.lastCollisionAt.set(key, at)
    const ev: CompactSceneEvent = {
      at,
      kind: 'collision',
      agent: left,
      other: right,
      distM: Math.round(distM * 10) / 10,
    }
    const stored: StoredEvent = { ...ev, seq: ++this.seq }
    this.push(stored)
    return publicEvent(stored)
  }

  drainForAgent(agent: string): {
    actions: CompactSceneEvent[]
    collisions: CompactSceneEvent[]
    graph: CompactSceneEvent[]
    faces: Array<{ agent: string; label: string }>
  } {
    const self = agent.trim().toLowerCase()
    const cursor = this.cursors.get(self) ?? 0
    const actions: CompactSceneEvent[] = []
    const collisions: CompactSceneEvent[] = []
    const graph: CompactSceneEvent[] = []
    let maxSeq = cursor
    for (const ev of this.events) {
      if (ev.seq <= cursor) continue
      maxSeq = Math.max(maxSeq, ev.seq)
      const kind = relevantForAgent(ev, self)
      if (!kind) continue
      const pub = publicEvent(ev)
      if (kind === 'action' && actions.length < SCENE_ACTION_LIMIT) actions.push(pub)
      else if (kind === 'collision' && collisions.length < SCENE_COLLISION_LIMIT) collisions.push(pub)
      else if (
        kind !== 'action' &&
        kind !== 'collision' &&
        graph.length < SCENE_GRAPH_EVENT_LIMIT
      ) {
        graph.push(pub)
      }
    }
    this.cursors.set(self, maxSeq)
    const faces: Array<{ agent: string; label: string }> = []
    for (const [who, label] of this.latestFace) {
      if (who.toLowerCase() === self) continue
      if (this.faceSent.get(who) === label) continue
      this.faceSent.set(who, label)
      faces.push({ agent: who, label })
    }
    return { actions, collisions, graph, faces }
  }

  consumeOutbound(limit = OUTBOUND_MAX): CompactSceneEvent[] {
    const out = this.outbound.splice(0, limit)
    return out
  }

  private push(ev: StoredEvent): void {
    this.events.push(ev)
    this.outbound.push(publicEvent(ev))
    if (this.events.length > LOG_MAX) this.events.splice(0, this.events.length - LOG_MAX)
    if (this.outbound.length > OUTBOUND_MAX) {
      this.outbound.splice(0, this.outbound.length - OUTBOUND_MAX)
    }
  }
}

export function formatSceneDigest(input: {
  actions?: CompactSceneEvent[]
  collisions?: CompactSceneEvent[]
  graph?: CompactSceneEvent[]
  faces?: Array<{ agent: string; label: string }>
}): string {
  const lines: string[] = []
  for (const ev of input.graph || []) {
    const id = ev.entityId || ev.label || '?'
    lines.push(`scene ${ev.kind}: ${id}${ev.op ? ` (${ev.op})` : ''}`)
  }
  for (const ev of input.actions || []) {
    lines.push(
      `@${ev.agent} ${ev.op || 'action'}${ev.label ? `: ${ev.label}` : ''}${
        ev.target ? ` → ${ev.target}` : ''
      }`,
    )
  }
  for (const ev of input.collisions || []) {
    lines.push(`contact @${ev.agent} ↔ @${ev.other} (~${ev.distM}m)`)
  }
  for (const f of input.faces || []) {
    lines.push(`@${f.agent} face: ${f.label}`)
  }
  return lines.slice(0, 16).join('\n')
}
