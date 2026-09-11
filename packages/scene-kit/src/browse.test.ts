import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { avatarsAsEntities, filterEntities } from './browse.ts'
import { SceneGraph } from './graph.ts'

describe('browse', () => {
  it('filters by kind and radius', () => {
    const g = new SceneGraph()
    g.apply({
      kind: 'spawn',
      entityId: 'near',
      payload: { id: 'near', kind: 'object', label: 'N', pose: { x: 1, y: 0, z: 0, yaw: 0 } },
    })
    g.apply({
      kind: 'spawn',
      entityId: 'far',
      payload: { id: 'far', kind: 'robot', label: 'F', pose: { x: 50, y: 0, z: 0, yaw: 0 } },
    })
    const { rows, total } = filterEntities(g.list(), {
      from: { x: 0, z: 0 },
      radius: 5,
      kind: 'object',
    })
    assert.equal(total, 1)
    assert.equal(rows[0]?.id, 'near')
  })

  it('maps occupants to avatar entities', () => {
    const av = avatarsAsEntities([{ slug: 'alpha', x: 1, z: 2, facing: 0.5, present: true }])
    assert.equal(av[0]?.kind, 'avatar')
    assert.equal(av[0]?.pose.z, 2)
  })
})
