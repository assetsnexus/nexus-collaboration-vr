import { normalizeFrame, normalizePose, xzDistance } from './frame.ts'
import type {
  CompactSceneEvent,
  SceneAuthority,
  SceneEntity,
  SceneEntityDigest,
  SceneEntityKind,
  SceneFrame,
  SceneGraphSnapshot,
  SceneOp,
  SceneOwner,
  ScenePose,
  ToolBinding,
} from './types.ts'
import { DEFAULT_SCENE_FRAME } from './types.ts'

const MAX_ENTITIES = 128
const MAX_OPS_LOG = 64

export type SceneGraphListener = (ev: {
  op: SceneOp
  entity?: SceneEntity
  event: CompactSceneEvent
}) => void

function newOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function normalizeKind(kind: unknown): SceneEntityKind {
  const k = String(kind || 'object').trim().toLowerCase() || 'object'
  if (k === 'machine') return 'robot'
  return k
}

function normalizeOwner(raw: unknown): SceneOwner {
  if (!raw || typeof raw !== 'object') return { type: 'system' }
  const rec = raw as Record<string, unknown>
  const type =
    rec.type === 'agent' || rec.type === 'user' || rec.type === 'system' ? rec.type : 'system'
  const slug = typeof rec.slug === 'string' ? rec.slug.trim() : undefined
  return slug ? { type, slug } : { type }
}

function cloneEntity(e: SceneEntity): SceneEntity {
  return {
    ...e,
    pose: { ...e.pose },
    tags: [...e.tags],
    owner: { ...e.owner },
    effects: e.effects ? [...e.effects] : undefined,
    bindings: e.bindings ? [...e.bindings] : undefined,
    spec: e.spec,
  }
}

/**
 * Headless scene graph. Renderer is a subscriber — never the source of truth.
 */
export class SceneGraph {
  private frame: SceneFrame = { ...DEFAULT_SCENE_FRAME }
  private entities = new Map<string, SceneEntity>()
  private bindings = new Map<string, ToolBinding>()
  private appliedOps = new Set<string>()
  private opLog: SceneOp[] = []
  private rev = 0
  private listeners = new Set<SceneGraphListener>()
  readonly authority: SceneAuthority

  constructor(opts?: { frame?: Partial<SceneFrame>; authority?: SceneAuthority }) {
    this.frame = normalizeFrame(opts?.frame)
    this.authority = opts?.authority === 'server' ? 'server' : 'client'
  }

  getFrame(): SceneFrame {
    return { ...this.frame, origin: { ...this.frame.origin } }
  }

  setFrame(frame: Partial<SceneFrame>): void {
    this.frame = normalizeFrame({ ...this.frame, ...frame })
  }

  getRev(): number {
    return this.rev
  }

  list(): SceneEntity[] {
    return [...this.entities.values()].map(cloneEntity)
  }

  get(id: string): SceneEntity | undefined {
    const e = this.entities.get(id)
    return e ? cloneEntity(e) : undefined
  }

  listBindings(): ToolBinding[] {
    return [...this.bindings.values()].map((b) => structuredClone(b))
  }

  getBinding(id: string): ToolBinding | undefined {
    const b = this.bindings.get(id)
    return b ? structuredClone(b) : undefined
  }

  subscribe(listener: SceneGraphListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Compact digest for viewport PUT / prompts (no spec). */
  digest(limit = 32): SceneEntityDigest[] {
    const rows: SceneEntityDigest[] = []
    for (const e of this.entities.values()) {
      if (rows.length >= limit) break
      rows.push({
        id: e.id,
        kind: e.kind,
        label: e.label,
        x: e.pose.x,
        y: e.pose.y,
        z: e.pose.z,
        yaw: e.pose.yaw,
        present: true,
      })
    }
    return rows
  }

  snapshot(): SceneGraphSnapshot {
    return {
      v: 1,
      frame: this.getFrame(),
      rev: this.rev,
      entities: this.list(),
      bindings: this.listBindings(),
    }
  }

  restore(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const snap = raw as Partial<SceneGraphSnapshot>
    this.entities.clear()
    this.bindings.clear()
    this.appliedOps.clear()
    this.opLog = []
    this.frame = normalizeFrame(snap.frame)
    this.rev = Number.isFinite(Number(snap.rev)) ? Math.max(0, Math.floor(Number(snap.rev))) : 0
    const entities = Array.isArray(snap.entities) ? snap.entities : []
    for (const row of entities.slice(0, MAX_ENTITIES)) {
      const e = this.normalizeEntity(row, { bumpRev: false })
      if (e) this.entities.set(e.id, e)
    }
    const bindings = Array.isArray(snap.bindings) ? snap.bindings : []
    for (const b of bindings) {
      const normalized = this.normalizeBinding(b)
      if (normalized) this.bindings.set(normalized.id, normalized)
    }
  }

  apply(op: Omit<SceneOp, 'opId' | 'at'> & { opId?: string; at?: number }): {
    ok: boolean
    op: SceneOp
    entity?: SceneEntity
    message?: string
  } {
    const full: SceneOp = {
      opId: op.opId?.trim() || newOpId(),
      kind: op.kind,
      at: op.at ?? Date.now(),
      entityId: op.entityId,
      payload: op.payload,
    }
    if (this.appliedOps.has(full.opId)) {
      return { ok: true, op: full, entity: full.entityId ? this.get(full.entityId) : undefined }
    }

    let entity: SceneEntity | undefined
    let eventKind: CompactSceneEvent['kind'] = 'action'
    let message: string | undefined

    switch (full.kind) {
      case 'spawn': {
        if (this.entities.size >= MAX_ENTITIES) {
          return { ok: false, op: full, message: `entity cap ${MAX_ENTITIES}` }
        }
        const spawned = this.normalizeEntity(
          {
            ...(full.payload || {}),
            id: full.entityId || full.payload?.id,
          },
          { bumpRev: true },
        )
        if (!spawned) return { ok: false, op: full, message: 'invalid spawn payload' }
        if (this.entities.has(spawned.id)) {
          return { ok: false, op: full, message: `entity exists: ${spawned.id}` }
        }
        this.entities.set(spawned.id, spawned)
        entity = spawned
        eventKind = 'spawned'
        full.entityId = spawned.id
        break
      }
      case 'write': {
        const cur = full.entityId ? this.entities.get(full.entityId) : undefined
        if (!cur) return { ok: false, op: full, message: 'unknown entity' }
        const next = this.normalizeEntity(
          {
            ...cur,
            ...(full.payload || {}),
            id: cur.id,
            rev: cur.rev,
          },
          { bumpRev: true },
        )
        if (!next) return { ok: false, op: full, message: 'invalid write' }
        this.entities.set(next.id, next)
        entity = next
        eventKind = 'wrote'
        break
      }
      case 'move': {
        const cur = full.entityId ? this.entities.get(full.entityId) : undefined
        if (!cur) return { ok: false, op: full, message: 'unknown entity' }
        const pose = normalizePose(full.payload?.pose ?? full.payload, cur.pose)
        const next = { ...cur, pose, rev: cur.rev + 1 }
        this.entities.set(next.id, next)
        this.rev += 1
        entity = next
        eventKind = 'moved'
        break
      }
      case 'set_tags': {
        const cur = full.entityId ? this.entities.get(full.entityId) : undefined
        if (!cur) return { ok: false, op: full, message: 'unknown entity' }
        const tags = Array.isArray(full.payload?.tags)
          ? full.payload!.tags.map((t) => String(t).trim()).filter(Boolean)
          : cur.tags
        const next = { ...cur, tags, rev: cur.rev + 1 }
        this.entities.set(next.id, next)
        this.rev += 1
        entity = next
        eventKind = 'wrote'
        break
      }
      case 'play_effect': {
        const cur = full.entityId ? this.entities.get(full.entityId) : undefined
        if (!cur) return { ok: false, op: full, message: 'unknown entity' }
        const effect = String(full.payload?.effect || full.payload?.name || '').trim()
        if (!effect) return { ok: false, op: full, message: 'effect required' }
        const effects = [...new Set([...(cur.effects || []), effect])]
        const next = { ...cur, effects, rev: cur.rev + 1 }
        this.entities.set(next.id, next)
        this.rev += 1
        entity = next
        eventKind = 'effect'
        break
      }
      case 'stop_effect': {
        const cur = full.entityId ? this.entities.get(full.entityId) : undefined
        if (!cur) return { ok: false, op: full, message: 'unknown entity' }
        const effect = String(full.payload?.effect || full.payload?.name || '').trim()
        const effects = effect
          ? (cur.effects || []).filter((e) => e !== effect)
          : []
        const next = { ...cur, effects: effects.length ? effects : undefined, rev: cur.rev + 1 }
        this.entities.set(next.id, next)
        this.rev += 1
        entity = next
        eventKind = 'effect'
        break
      }
      case 'bind_tool': {
        const binding = this.normalizeBinding(full.payload)
        if (!binding) return { ok: false, op: full, message: 'invalid binding' }
        this.bindings.set(binding.id, binding)
        if (full.entityId && 'entityId' in binding.target) {
          const cur = this.entities.get(full.entityId)
          if (cur) {
            const ids = [...new Set([...(cur.bindings || []), binding.id])]
            const next = { ...cur, bindings: ids, rev: cur.rev + 1 }
            this.entities.set(next.id, next)
            entity = next
          }
        }
        this.rev += 1
        eventKind = 'tool'
        break
      }
      case 'unbind_tool': {
        const id = String(full.payload?.id || full.entityId || '').trim()
        if (!id || !this.bindings.has(id)) {
          return { ok: false, op: full, message: 'unknown binding' }
        }
        this.bindings.delete(id)
        for (const [eid, cur] of this.entities) {
          if (!cur.bindings?.includes(id)) continue
          const bindings = cur.bindings.filter((b) => b !== id)
          this.entities.set(eid, {
            ...cur,
            bindings: bindings.length ? bindings : undefined,
            rev: cur.rev + 1,
          })
        }
        this.rev += 1
        eventKind = 'tool'
        break
      }
      case 'remove': {
        const id = full.entityId?.trim()
        if (!id || !this.entities.has(id)) {
          return { ok: false, op: full, message: 'unknown entity' }
        }
        entity = cloneEntity(this.entities.get(id)!)
        this.entities.delete(id)
        this.rev += 1
        eventKind = 'removed'
        break
      }
      default:
        return { ok: false, op: full, message: `unknown op: ${String((full as SceneOp).kind)}` }
    }

    this.appliedOps.add(full.opId)
    this.opLog.push(full)
    if (this.opLog.length > MAX_OPS_LOG) this.opLog.splice(0, this.opLog.length - MAX_OPS_LOG)

    const event: CompactSceneEvent = {
      at: full.at,
      kind: eventKind,
      entityId: full.entityId || entity?.id,
      op: full.kind,
      label: entity?.label,
      agent: entity?.owner.slug,
    }
    for (const listener of this.listeners) {
      try {
        listener({ op: full, entity: entity ? cloneEntity(entity) : undefined, event })
      } catch {
        /* host UI must not break graph */
      }
    }
    return { ok: true, op: full, entity: entity ? cloneEntity(entity) : undefined, message }
  }

  recentOps(limit = 12): SceneOp[] {
    return this.opLog.slice(-Math.max(1, limit)).map((o) => ({ ...o, payload: o.payload }))
  }

  queryNear(
    from: { x: number; z: number },
    radiusM: number,
    opts?: { kind?: string; tag?: string; limit?: number },
  ): SceneEntity[] {
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 20))
    const kind = opts?.kind?.trim().toLowerCase()
    const tag = opts?.tag?.trim().toLowerCase()
    const rows = this.list()
      .filter((e) => {
        if (kind && normalizeKind(e.kind) !== normalizeKind(kind) && e.kind !== kind) return false
        if (tag && !e.tags.some((t) => t.toLowerCase() === tag)) return false
        return xzDistance(e.pose, from) <= radiusM
      })
      .sort((a, b) => xzDistance(a.pose, from) - xzDistance(b.pose, from))
    return rows.slice(0, limit)
  }

  private normalizeEntity(
    raw: unknown,
    opts: { bumpRev: boolean },
  ): SceneEntity | null {
    if (!raw || typeof raw !== 'object') return null
    const rec = raw as Record<string, unknown>
    const id = String(rec.id || '').trim()
    if (!id) return null
    const prev = this.entities.get(id)
    const pose = normalizePose(rec.pose, prev?.pose)
    const radius = Number(rec.radius)
    const label = String(rec.label || id).trim() || id
    const tags = Array.isArray(rec.tags)
      ? rec.tags.map((t) => String(t).trim()).filter(Boolean)
      : prev?.tags || []
    const effects = Array.isArray(rec.effects)
      ? rec.effects.map((t) => String(t).trim()).filter(Boolean)
      : prev?.effects
    const bindings = Array.isArray(rec.bindings)
      ? rec.bindings.map((t) => String(t).trim()).filter(Boolean)
      : prev?.bindings
    const revBase = Number.isFinite(Number(rec.rev)) ? Math.floor(Number(rec.rev)) : prev?.rev ?? 0
    if (opts.bumpRev) this.rev += 1
    return {
      id,
      kind: normalizeKind(rec.kind ?? prev?.kind ?? 'object'),
      label,
      pose,
      radius: Number.isFinite(radius) && radius > 0 ? radius : prev?.radius ?? 0.25,
      tags,
      owner: normalizeOwner(rec.owner ?? prev?.owner),
      spec: rec.spec !== undefined ? rec.spec : prev?.spec ?? null,
      effects: effects?.length ? effects : undefined,
      bindings: bindings?.length ? bindings : undefined,
      rev: opts.bumpRev ? revBase + (prev ? 1 : 0) || this.rev : revBase,
    }
  }

  private normalizeBinding(raw: unknown): ToolBinding | null {
    if (!raw || typeof raw !== 'object') return null
    const rec = raw as Record<string, unknown>
    const id = String(rec.id || `bind_${Date.now().toString(36)}`).trim()
    const matchRaw = rec.match && typeof rec.match === 'object' ? (rec.match as Record<string, unknown>) : {}
    const tool = String(matchRaw.tool || rec.tool || '').trim()
    if (!tool) return null
    const targetRaw = rec.target && typeof rec.target === 'object' ? (rec.target as Record<string, unknown>) : rec
    let target: ToolBinding['target']
    if (typeof targetRaw.entityId === 'string' && targetRaw.entityId.trim()) {
      target = { entityId: targetRaw.entityId.trim() }
    } else if (targetRaw.spawnPreset === 'sphere-front') {
      target = { spawnPreset: 'sphere-front' }
    } else if (typeof rec.entityId === 'string' && rec.entityId.trim()) {
      target = { entityId: rec.entityId.trim() }
    } else {
      return null
    }
    return {
      id,
      match: {
        tool,
        agent: typeof matchRaw.agent === 'string' ? matchRaw.agent.trim() : undefined,
        subagent: matchRaw.subagent === true,
      },
      target,
      onStart: typeof rec.onStart === 'string' ? rec.onStart : 'glow',
      onProgress: typeof rec.onProgress === 'string' ? rec.onProgress : 'pulse',
      onEnd: typeof rec.onEnd === 'string' ? rec.onEnd : 'stop',
    }
  }
}

export function createEntityId(prefix = 'obj'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function spawnPoseAt(
  at: 'front' | 'here' | ScenePose | { x: number; y?: number; z: number },
  caller?: ScenePose,
  /** World Y for the entity origin. Floor props use 0 (mesh may be floor-anchored). */
  heightY = 0,
): ScenePose {
  const y = Number.isFinite(heightY) ? heightY : 0
  if (at === 'here') {
    return caller ? { ...caller, y } : { x: 0, y, z: 0, yaw: 0 }
  }
  if (at === 'front') {
    return caller
      ? {
          x: caller.x + Math.sin(caller.yaw) * 1.2,
          y,
          z: caller.z + Math.cos(caller.yaw) * 1.2,
          yaw: caller.yaw + Math.PI,
        }
      : { x: 0, y, z: 1.2, yaw: Math.PI }
  }
  return normalizePose(at)
}
