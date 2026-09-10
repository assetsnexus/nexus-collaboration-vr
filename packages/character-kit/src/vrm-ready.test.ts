import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import { vrmSceneIsRenderable } from './vrm-ready.ts'

describe('vrmSceneIsRenderable', () => {
  it('rejects an empty group', () => {
    assert.equal(vrmSceneIsRenderable(new THREE.Group()), false)
  })

  it('accepts a mesh with positions', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    assert.equal(vrmSceneIsRenderable(root), true)
  })

  it('rejects a mesh whose world matrix is NaN', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    root.position.set(Number.NaN, 0, 0)
    assert.equal(vrmSceneIsRenderable(root), false)
  })

  it('accepts a finite mesh even if an empty helper node has NaN', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const helper = new THREE.Object3D()
    helper.position.set(Number.NaN, 0, 0)
    root.add(helper)
    assert.equal(vrmSceneIsRenderable(root), true)
  })
})
