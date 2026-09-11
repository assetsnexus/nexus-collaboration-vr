import * as THREE from 'three'

export type DeskBuildOpts = {
  /** Overall width (X). Default 1.28 m */
  width?: number
  /** Tabletop height above floor. Default 0.74 m */
  height?: number
  /** Depth (Z). Default 0.68 m */
  depth?: number
  /** Tabletop thickness. Default 0.04 m */
  topThickness?: number
  /** Leg cross-section. Default 0.045 m */
  legSize?: number
  /** Main wood color. */
  color?: string
  /** Slightly darker legs. */
  legColor?: string
}

/**
 * Simple office desk: top + apron + 4 legs.
 * Origin is on the floor at the desk center (Y-up); legs rest on y=0.
 */
export function createDeskMesh(opts: DeskBuildOpts = {}): THREE.Group {
  const width = Math.max(0.6, opts.width ?? 1.28)
  const height = Math.max(0.5, opts.height ?? 0.74)
  const depth = Math.max(0.4, opts.depth ?? 0.68)
  const topT = Math.max(0.02, opts.topThickness ?? 0.04)
  const leg = Math.max(0.03, opts.legSize ?? 0.045)
  const color = parseColor(opts.color, 0x8b7355)
  const legColor = parseColor(opts.legColor, 0x5c4a38)

  const wood = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.05,
  })
  const woodDark = new THREE.MeshStandardMaterial({
    color: legColor,
    roughness: 0.78,
    metalness: 0.04,
  })

  const root = new THREE.Group()
  root.name = 'furniture-desk'

  const top = new THREE.Mesh(new THREE.BoxGeometry(width, topT, depth), wood)
  top.position.y = height - topT / 2
  top.castShadow = true
  top.receiveShadow = true
  root.add(top)

  // Thin apron under the top for a bit of structure.
  const apronH = Math.min(0.06, height * 0.08)
  const apronInset = leg * 1.2
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(width - apronInset * 2, apronH, depth - apronInset * 2),
    woodDark,
  )
  apron.position.y = height - topT - apronH / 2
  apron.castShadow = true
  root.add(apron)

  const legH = height - topT
  const insetX = width / 2 - leg / 2 - 0.04
  const insetZ = depth / 2 - leg / 2 - 0.04
  const corners: Array<[number, number]> = [
    [-insetX, -insetZ],
    [insetX, -insetZ],
    [-insetX, insetZ],
    [insetX, insetZ],
  ]
  for (const [lx, lz] of corners) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(leg, legH, leg), woodDark)
    post.position.set(lx, legH / 2, lz)
    post.castShadow = true
    post.receiveShadow = true
    root.add(post)
  }

  root.userData.furniture = 'desk'
  root.userData.floorAnchored = true
  root.userData.radius = Math.max(width, depth) * 0.45
  return root
}

function parseColor(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  try {
    return new THREE.Color(raw.trim()).getHex()
  } catch {
    return fallback
  }
}

/** True when catalog / tags should use the procedural desk mesh. */
export function isDeskCatalogId(id: string | undefined | null): boolean {
  const s = String(id || '')
    .trim()
    .toLowerCase()
  return s === 'desk' || s === 'desk-5' || s.startsWith('desk-')
}
