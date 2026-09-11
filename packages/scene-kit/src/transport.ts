import type { SceneGraph } from './graph.ts'
import type { SceneGraphSnapshot } from './types.ts'

export type SceneTransport = {
  readonly kind: string
  publish(snapshot: SceneGraphSnapshot): void
  load(): SceneGraphSnapshot | null
}

/** Single-tab in-memory (optionally shared across hosts in-process). */
export class MemoryTransport implements SceneTransport {
  readonly kind = 'memory'
  private snap: SceneGraphSnapshot | null = null

  publish(snapshot: SceneGraphSnapshot): void {
    this.snap = structuredClone(snapshot)
  }

  load(): SceneGraphSnapshot | null {
    return this.snap ? structuredClone(this.snap) : null
  }
}

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export const SCENE_STORAGE_PREFIX = 'oc-chat-scene:'

export function sceneStorageKey(sessionId: string): string {
  return `${SCENE_STORAGE_PREFIX}${sessionId}`
}

/** Persist full graph (specs as JSON refs, never binary meshes). */
export class StorageTransport implements SceneTransport {
  readonly kind = 'storage'
  private readonly sessionId: string
  private readonly storage: StorageLike | null

  constructor(sessionId: string, storage: StorageLike | null) {
    this.sessionId = sessionId
    this.storage = storage
  }

  publish(snapshot: SceneGraphSnapshot): void {
    if (!this.storage || !this.sessionId) return
    try {
      this.storage.setItem(sceneStorageKey(this.sessionId), JSON.stringify(snapshot))
    } catch {
      /* quota / private mode */
    }
  }

  load(): SceneGraphSnapshot | null {
    if (!this.storage || !this.sessionId) return null
    try {
      const raw = this.storage.getItem(sceneStorageKey(this.sessionId))
      if (!raw) return null
      const parsed = JSON.parse(raw) as SceneGraphSnapshot
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entities)) return null
      return parsed
    } catch {
      return null
    }
  }
}

export function attachAutoPersist(graph: SceneGraph, transport: SceneTransport): () => void {
  const persist = () => transport.publish(graph.snapshot())
  return graph.subscribe(() => persist())
}

export function restoreGraph(graph: SceneGraph, transport: SceneTransport): boolean {
  const snap = transport.load()
  if (!snap) return false
  graph.restore(snap)
  return true
}
