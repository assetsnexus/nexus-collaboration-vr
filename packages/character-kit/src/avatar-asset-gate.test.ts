import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPlatformDefaultGestureAsset,
  mayAutoDownloadAvatarAsset,
} from './avatar-asset-gate.ts'

describe('mayAutoDownloadAvatarAsset', () => {
  it('allows verified catalog assets', () => {
    const decision = mayAutoDownloadAvatarAsset({
      url: 'https://cdn.example/user/custom.vrm',
      validationStatus: 'verified',
    })
    assert.deepEqual(decision, { allow: true, reason: 'verified' })
  })

  it('denies pending_admin assets', () => {
    const decision = mayAutoDownloadAvatarAsset({
      url: 'https://cdn.example/user/custom.vrma',
      validationStatus: 'pending_admin',
    })
    assert.deepEqual(decision, { allow: false, reason: 'unverified:pending_admin' })
  })

  it('allows platform default gesture / manifest URLs without status', () => {
    assert.deepEqual(
      mayAutoDownloadAvatarAsset({ url: '/assets/vrma/manifest.json' }),
      { allow: true, reason: 'platform_default' },
    )
    assert.deepEqual(
      mayAutoDownloadAvatarAsset({ url: '/assets/vrma/wave.vrma' }),
      { allow: true, reason: 'platform_default' },
    )
    assert.deepEqual(
      mayAutoDownloadAvatarAsset({
        url: 'https://host.example/dev-vrm-assets/vrma/idle.vrma',
      }),
      { allow: true, reason: 'platform_default' },
    )
  })

  it('denies missing validationStatus on custom URLs', () => {
    const decision = mayAutoDownloadAvatarAsset({
      url: 'https://cdn.example/user/pending.vrm',
    })
    assert.deepEqual(decision, { allow: false, reason: 'missing_validation_status' })
  })

  it('allows owner preview via blob: or previewUnverified', () => {
    assert.deepEqual(
      mayAutoDownloadAvatarAsset({ url: 'blob:http://localhost/abc' }),
      { allow: true, reason: 'blob_preview' },
    )
    assert.deepEqual(
      mayAutoDownloadAvatarAsset({
        url: 'https://cdn.example/user/pending.vrm',
        validationStatus: 'pending_admin',
        previewUnverified: true,
      }),
      { allow: true, reason: 'preview_unverified' },
    )
  })
})

describe('isPlatformDefaultGestureAsset', () => {
  it('matches playground pack paths only', () => {
    assert.equal(isPlatformDefaultGestureAsset('/assets/vrma/manifest.json'), true)
    assert.equal(isPlatformDefaultGestureAsset('/assets/vrma/clap.vrma'), true)
    assert.equal(isPlatformDefaultGestureAsset('/uploads/custom.vrma'), false)
    assert.equal(isPlatformDefaultGestureAsset('https://cdn.example/custom/wave.vrma'), false)
  })
})
