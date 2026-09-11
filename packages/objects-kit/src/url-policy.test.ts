import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertUrlAllowed, parseAllowHosts } from './url-policy.ts'

describe('url policy', () => {
  it('allows relative and same-origin', () => {
    assert.equal(assertUrlAllowed('/assets/desk.glb', { externalSources: 'off', allowHosts: [] }).ok, true)
    assert.equal(
      assertUrlAllowed('https://cdn.example/a.glb', {
        externalSources: 'allowlist',
        allowHosts: [],
        pageOrigin: 'https://cdn.example',
      }).ok,
      true,
    )
  })

  it('blocks private hosts', () => {
    const r = assertUrlAllowed('http://127.0.0.1/x.glb', { externalSources: 'open', allowHosts: [] })
    assert.equal(r.ok, false)
  })

  it('parses allow hosts', () => {
    assert.deepEqual(parseAllowHosts('A.com, b.org'), ['a.com', 'b.org'])
  })
})
