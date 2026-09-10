import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CLOTHES_DEFAULT_ID,
  CLOTHES_NONE_ID,
  groupClothesByCategory,
  isClothesItemSelected,
  normalizeClothesId,
  parseClothesIdList,
  parseClothesMaterialName,
  resolveClothesSelection,
  summarizeClothesSelection,
  uniqueClothesItems,
  type ClothesItem,
} from './clothes-parse.ts'
import { nearestMappedAncestorName, namedNodeDepth } from './clothes-graft-tree.ts'
import {
  compactClothesTransform,
  defaultClothesTransform,
  isIdentityClothesTransform,
  isOddAxisMirror,
  normalizeClothesTransform,
} from './clothes-transform.ts'

describe('normalizeClothesId', () => {
  it('defaults empty to default', () => {
    assert.equal(normalizeClothesId(undefined), CLOTHES_DEFAULT_ID)
    assert.equal(normalizeClothesId(''), CLOTHES_DEFAULT_ID)
  })

  it('maps aliases to none/default', () => {
    assert.equal(normalizeClothesId('NONE'), CLOTHES_NONE_ID)
    assert.equal(normalizeClothesId('off'), CLOTHES_NONE_ID)
    assert.equal(normalizeClothesId('all'), CLOTHES_DEFAULT_ID)
  })
})

describe('parseClothesIdList / resolveClothesSelection', () => {
  it('splits plus-joined slot ids', () => {
    assert.deepEqual(parseClothesIdList('tops+shoes'), ['tops', 'shoes'])
    assert.deepEqual(parseClothesIdList(' tops | bottoms ; shoes '), ['tops', 'bottoms', 'shoes'])
  })

  it('treats omitted spec as default and empty ids as none', () => {
    assert.deepEqual(resolveClothesSelection({}), { mode: 'default', ids: [] })
    assert.deepEqual(resolveClothesSelection({ id: 'none' }), { mode: 'none', ids: [] })
    assert.deepEqual(resolveClothesSelection({ ids: [] }), { mode: 'none', ids: [] })
  })

  it('prefers ids over a single id', () => {
    assert.deepEqual(resolveClothesSelection({ id: 'default', ids: ['tops', 'shoes'] }), {
      mode: 'items',
      ids: ['tops', 'shoes'],
    })
    assert.equal(summarizeClothesSelection({ mode: 'items', ids: ['tops', 'shoes'] }), 'tops+shoes')
  })
})

describe('isClothesItemSelected / groupClothesByCategory', () => {
  const tops: ClothesItem = { id: 'tops-002', label: 'Tops 002', category: 'tops' }
  const shoes: ClothesItem = { id: 'shoes-002', label: 'Shoes 002', category: 'shoes' }
  const glasses: ClothesItem = { id: 'accessory-glasses', label: 'Glasses', category: 'accessory' }

  it('selects by item id or category', () => {
    const sel = { mode: 'items' as const, ids: ['shoes'] }
    assert.equal(isClothesItemSelected(shoes, sel), true)
    assert.equal(isClothesItemSelected(tops, sel), false)
    assert.equal(isClothesItemSelected(tops, { mode: 'default', ids: [] }), true)
    assert.equal(isClothesItemSelected(tops, { mode: 'none', ids: [] }), false)
  })

  it('groups slots in VRoid order', () => {
    const groups = groupClothesByCategory([glasses, shoes, tops])
    assert.deepEqual(
      groups.map((g) => g.category),
      ['tops', 'shoes', 'accessory'],
    )
    assert.equal(groups[0]!.items[0]!.id, 'tops-002')
  })
})

describe('parseClothesMaterialName', () => {
  it('parses VRoid tops/bottoms/shoes/onepiece', () => {
    assert.deepEqual(parseClothesMaterialName('N00_002_01_Tops_01_CLOTH (Instance)'), {
      id: 'tops-002',
      label: 'Tops 002',
      category: 'tops',
    })
    assert.deepEqual(parseClothesMaterialName('N00_001_02_Bottoms_01_CLOTH (Instance)'), {
      id: 'bottoms-001',
      label: 'Bottoms 001',
      category: 'bottoms',
    })
    assert.deepEqual(parseClothesMaterialName('N00_002_01_Shoes_01_CLOTH (Instance)'), {
      id: 'shoes-002',
      label: 'Shoes 002',
      category: 'shoes',
    })
    assert.deepEqual(parseClothesMaterialName('N00_010_01_Onepiece_00_CLOTH_01 (Instance)'), {
      id: 'onepiece-010',
      label: 'Onepiece 010',
      category: 'onepiece',
    })
  })

  it('groups glasses accessories and cat tail', () => {
    assert.deepEqual(parseClothesMaterialName('Accessory_GlassesLowFrame_01_MATCAP (Instance)'), {
      id: 'accessory-glasses',
      label: 'Glasses',
      category: 'accessory',
    })
    assert.deepEqual(parseClothesMaterialName('Accessory_GlassesLowLens_01_MATCAP (Instance)'), {
      id: 'accessory-glasses',
      label: 'Glasses',
      category: 'accessory',
    })
    assert.equal(parseClothesMaterialName('Accessory_CatTail_01_CLOTH (Instance)')?.id, 'accessory-cattail')
  })

  it('parses sample.vrm simple cloth names', () => {
    assert.deepEqual(parseClothesMaterialName('Tops_01_CLOTH'), {
      id: 'tops',
      label: 'Tops',
      category: 'tops',
    })
    assert.deepEqual(parseClothesMaterialName('Bottoms_01_CLOTH'), {
      id: 'bottoms',
      label: 'Bottoms',
      category: 'bottoms',
    })
  })

  it('parses slot mesh names without CLOTH', () => {
    assert.deepEqual(parseClothesMaterialName('Shoes_01'), {
      id: 'shoes',
      label: 'Shoes',
      category: 'shoes',
    })
  })

  it('ignores skin / face / hair', () => {
    assert.equal(parseClothesMaterialName('N00_000_00_Body_00_SKIN (Instance)'), null)
    assert.equal(parseClothesMaterialName('N00_000_00_Face_00_SKIN (Instance)'), null)
    assert.equal(parseClothesMaterialName('N00_000_Hair_00_HAIR_01 (Instance)'), null)
    assert.equal(parseClothesMaterialName('HairBack_00_HAIR'), null)
  })
})

describe('clothes piece transform', () => {
  it('clamps offset/scale/rotate and defaults identity', () => {
    const t = normalizeClothesTransform({
      offsetX: 9,
      scale: 0,
      rotateY: -400,
      mirrorX: true,
    })
    assert.equal(t.offsetX, 2)
    assert.equal(t.scale, 0.05)
    assert.equal(t.rotateY, -180)
    assert.equal(t.mirrorX, true)
    assert.equal(isIdentityClothesTransform(defaultClothesTransform()), true)
    assert.equal(isIdentityClothesTransform(t), false)
  })

  it('omits identity fields when compacting', () => {
    assert.equal(compactClothesTransform(defaultClothesTransform()), undefined)
    assert.deepEqual(
      compactClothesTransform(normalizeClothesTransform({ scale: 1.5, rotateZ: 10 })),
      { scale: 1.5, rotateZ: 10 },
    )
  })

  it('treats an odd number of axis mirrors as a winding flip', () => {
    assert.equal(isOddAxisMirror(true, false, false), true)
    assert.equal(isOddAxisMirror(true, true, false), false)
    assert.equal(isOddAxisMirror(true, true, true), true)
    assert.equal(isOddAxisMirror(false, false, false), false)
  })
})

describe('overlay bone graft mapping', () => {
  it('finds the nearest host ancestor and sorts by depth', () => {
    const hips = { name: 'J_Bip_C_Hips', parent: null }
    const tail1 = { name: 'J_Sec_HairTail', parent: hips }
    const tail2 = { name: 'J_Sec_HairTail2', parent: tail1 }
    const mapped = new Set(['J_Bip_C_Hips', 'J_Bip_C_Head'])
    assert.equal(nearestMappedAncestorName(tail1, mapped), 'J_Bip_C_Hips')
    assert.equal(nearestMappedAncestorName(tail2, mapped), 'J_Bip_C_Hips')
    assert.equal(namedNodeDepth(hips), 0)
    assert.equal(namedNodeDepth(tail2), 2)
  })
})

describe('listClothesFromGltfJson catalog names', () => {
  it('collects unique clothing from materials and mesh names', () => {
    const names = [
      'N00_002_01_Tops_01_CLOTH (Instance)',
      'N00_000_00_Body_00_SKIN (Instance)',
      'N00_002_01_Tops_01_CLOTH (Instance)',
      'Accessory_GlassesLowFrame_01_MATCAP',
      'Shoes_01',
    ]
    const items = uniqueClothesItems(
      names.map((n) => parseClothesMaterialName(n)).filter((x): x is ClothesItem => x != null),
    )
    assert.deepEqual(
      items.map((i) => i.id).sort(),
      ['accessory-glasses', 'shoes', 'tops-002'],
    )
  })
})
