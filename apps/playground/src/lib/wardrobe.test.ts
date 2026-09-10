import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  catalogIdFromUrl,
  DEMO_VRM_IDS,
  filterDemoCatalog,
  isDemoVrmId,
} from './demo-mode.ts'
import {
  mergeClothesIntoWardrobe,
  seedWardrobe,
  switchPaneVrm,
} from './wardrobe.ts'

const catalog = [
  { id: 'optional-face', url: '/assets/vrm/optional-face.vrm' },
  { id: 'hoodie', url: '/assets/vrm/hoodie.vrm' },
  { id: 'tori', url: '/assets/vrm/tori.vrm' },
]

describe('demo catalog', () => {
  it('keeps the maintained public list', () => {
    assert.deepEqual([...DEMO_VRM_IDS], [
      'hoodie',
      'tori',
      'curt',
      'apollo',
      'bob',
      'sample',
    ])
    assert.equal(isDemoVrmId('hoodie'), true)
    assert.equal(isDemoVrmId('optional-face'), false)
  })

  it('hides non-demo models only when demo mode is on', () => {
    const items = catalog.map((v) => ({ id: v.id }))
    assert.equal(filterDemoCatalog(items, false).length, 3)
    assert.deepEqual(
      filterDemoCatalog(items, true).map((v) => v.id),
      ['hoodie', 'tori'],
    )
  })
})

describe('per-bot per-model wardrobe', () => {
  it('restores overlays from other models after switching away and back', () => {
    const pane = {
      vrmUrl: catalog[0]!.url,
      clothesId: 'default',
      clothesOverlayId: 'cat-ear',
      clothesOverlayItems: [{ sourceId: 'cat-ear', itemId: 'CatTail' }],
    }
    const toHoodie = switchPaneVrm(
      pane,
      catalog[1]!.url,
      catalogIdFromUrl(pane.vrmUrl, catalog),
      catalogIdFromUrl(catalog[1]!.url, catalog),
    )
    assert.equal(toHoodie.vrmUrl, catalog[1]!.url)
    assert.equal(toHoodie.clothesOverlayItems, undefined)

    const withHoodieTail = mergeClothesIntoWardrobe(
      toHoodie,
      {
        clothesOverlayId: 'hoodie',
        clothesOverlayItems: [{ sourceId: 'hoodie', itemId: 'Tops002' }],
      },
      'hoodie',
    )
    const backToSample = switchPaneVrm(
      { ...toHoodie, ...withHoodieTail },
      catalog[0]!.url,
      'hoodie',
      'optional-face',
    )
    assert.equal(backToSample.vrmUrl, catalog[0]!.url)
    assert.deepEqual(backToSample.clothesOverlayItems, [
      { sourceId: 'cat-ear', itemId: 'CatTail' },
    ])
    assert.equal(backToSample.wardrobeByModel?.hoodie?.clothesOverlayItems?.[0]?.itemId, 'Tops002')
  })

  it('seeds the current model slot without wiping later slots', () => {
    const seeded = seedWardrobe(
      { vrmUrl: catalog[0]!.url, clothesId: 'none', clothesIds: [] },
      'optional-face',
    )
    assert.equal(seeded.wardrobeByModel?.['optional-face']?.clothesId, 'none')
    const again = seedWardrobe(
      { ...seeded, clothesId: 'default', clothesIds: undefined },
      'optional-face',
    )
    assert.equal(again.wardrobeByModel?.['optional-face']?.clothesId, 'none')
  })
})
