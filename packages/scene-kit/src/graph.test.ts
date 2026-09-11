import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SceneGraph, createEntityId } from './graph.ts'
import { MemoryTransport, StorageTransport, attachAutoPersist, restoreGraph } from './transport.ts'

describe('SceneGraph', () => {
  it('spawns, moves, and removes idempotently', () => {
    const g = new SceneGraph()
    const id = createEntityId('sphere')
    const a = g.apply({
      kind: 'spawn',
      entityId: id,
      payload: {
        id,
        kind: 'object',
        label: 'Ball',
        pose: { x: 1, y: 0.15, z: 2, yaw: 0 },
        radius: 0.15,
        spec: { shape: 'sphere', color: '#ff0' },
      },
    })
    assert.equal(a.ok, true)
    assert.equal(g.list().length, 1)

    const again = g.apply({
      opId: a.op.opId,
      kind: 'spawn',
      entityId: id,
      payload: a.op.payload,
    })
    assert.equal(again.ok, true)
    assert.equal(g.list().length, 1)

    g.apply({ kind: 'move', entityId: id, payload: { pose: { x: 3, y: 0.15, z: 2, yaw: 1 } } })
    assert.equal(g.get(id)?.pose.x, 3)

    g.apply({ kind: 'remove', entityId: id })
    assert.equal(g.list().length, 0)
  })

  it('aliases machine → robot kind', () => {
    const g = new SceneGraph()
    const id = 'bot1'
    g.apply({
      kind: 'spawn',
      entityId: id,
      payload: { id, kind: 'machine', label: 'Arm', pose: { x: 0, y: 0, z: 0, yaw: 0 } },
    })
    assert.equal(g.get(id)?.kind, 'robot')
  })

  it('persists via StorageTransport', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
    }
    const g = new SceneGraph()
    const transport = new StorageTransport('sess-1', storage)
    const off = attachAutoPersist(g, transport)
    g.apply({
      kind: 'spawn',
      entityId: 'a',
      payload: { id: 'a', kind: 'object', label: 'A', pose: { x: 0, y: 0, z: 0, yaw: 0 } },
    })
    off()

    const g2 = new SceneGraph()
    assert.equal(restoreGraph(g2, new StorageTransport('sess-1', storage)), true)
    assert.equal(g2.get('a')?.label, 'A')

    const mem = new MemoryTransport()
    mem.publish(g2.snapshot())
    const g3 = new SceneGraph()
    g3.restore(mem.load())
    assert.equal(g3.list().length, 1)
  })
})
