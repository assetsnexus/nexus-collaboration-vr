import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyAgentIdentity, vrmLabelFromUrl } from './agent-identity.ts'

describe('applyAgentIdentity', () => {
  it('substitutes {agent} and warns that the VRM mesh is not the name', () => {
    const out = applyAgentIdentity(
      'You are {agent}, a helpful VRM companion. Keep replies short.',
      'Beta',
      'Sample',
    )
    assert.match(out, /^You are Beta,/)
    assert.match(out, /avatar mesh is Sample/)
    assert.match(out, /not as the mesh name/)
    assert.doesNotMatch(out, /You are Sample/)
  })

  it('rewrites a legacy hardcoded mesh persona', () => {
    const out = applyAgentIdentity(
      'You are Xeni, a helpful VRM companion. Prefer compact [nod] tags.',
      'Beta',
      'Sample',
    )
    assert.match(out, /^You are Beta,/)
    assert.doesNotMatch(out, /You are Sample/)
  })

  it('prepends the tab name when the prompt has no identity', () => {
    const out = applyAgentIdentity('Prefer compact [nod] tags.', 'Alpha')
    assert.match(out, /^You are Alpha\./)
    assert.match(out, /Prefer compact/)
  })

  it('does not add a mesh note when avatar and agent share a name', () => {
    const out = applyAgentIdentity('You are {agent}.', 'Sample', 'Sample')
    assert.equal(out, 'You are Sample.')
  })
})

describe('vrmLabelFromUrl', () => {
  const catalog = [{ label: 'Sample', url: '/assets/vrm/sample.vrm' }]
  it('resolves catalog labels', () => {
    assert.equal(vrmLabelFromUrl('/assets/vrm/sample.vrm', catalog), 'Sample')
    assert.equal(vrmLabelFromUrl('/other.vrm', catalog), undefined)
  })
})
