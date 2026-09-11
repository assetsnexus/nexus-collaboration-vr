import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDeskMesh, isDeskCatalogId } from './furniture.ts'
import { floorOriginY } from './actions.ts'

describe('desk furniture', () => {
  it('recognizes desk catalog ids', () => {
    assert.equal(isDeskCatalogId('desk'), true)
    assert.equal(isDeskCatalogId('desk-5'), true)
    assert.equal(isDeskCatalogId('crate'), false)
  })

  it('builds a floor-anchored desk with top + legs', () => {
    const desk = createDeskMesh({ height: 0.74, width: 1.2, depth: 0.6 })
    assert.equal(desk.children.length >= 5, true)
    assert.equal(desk.userData.floorAnchored, true)
    let minY = Infinity
    let maxY = -Infinity
    desk.traverse((o) => {
      const m = o as import('three').Mesh
      if (!m.isMesh || !m.geometry) return
      m.geometry.computeBoundingBox()
      const box = m.geometry.boundingBox
      if (!box) return
      minY = Math.min(minY, box.min.y + m.position.y)
      maxY = Math.max(maxY, box.max.y + m.position.y)
    })
    assert.ok(minY >= -0.001)
    assert.ok(maxY <= 0.76)
  })

  it('places desk origin on the floor and spheres by radius', () => {
    assert.equal(floorOriginY({ shape: 'sphere', radius: 0.12, catalogId: undefined }), 0.12)
    assert.equal(
      floorOriginY({
        shape: 'box',
        catalogId: 'desk',
        size: { x: 1.2, y: 0.74, z: 0.6 },
        radius: 0.7,
      }),
      0,
    )
  })
})
