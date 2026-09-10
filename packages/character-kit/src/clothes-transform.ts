export interface ClothesPieceTransform {
  mirrorX: boolean
  mirrorY: boolean
  mirrorZ: boolean
  offsetX: number
  offsetY: number
  offsetZ: number
  /** Uniform scale. 1 = bind size. */
  scale: number
  /** Euler degrees. */
  rotateX: number
  rotateY: number
  rotateZ: number
}

export interface ClothesOverlayPiece {
  sourceId: string
  sourceUrl: string
  itemId: string
  transform?: Partial<ClothesPieceTransform>
}

const OFFSET_MAX = 2
const SCALE_MIN = 0.05
const SCALE_MAX = 4
const ROTATE_MAX = 180

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function defaultClothesTransform(): ClothesPieceTransform {
  return {
    mirrorX: false,
    mirrorY: false,
    mirrorZ: false,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    scale: 1,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
  }
}

export function normalizeClothesTransform(
  raw?: Partial<ClothesPieceTransform> | null,
): ClothesPieceTransform {
  const base = defaultClothesTransform()
  if (!raw) return base
  return {
    mirrorX: Boolean(raw.mirrorX),
    mirrorY: Boolean(raw.mirrorY),
    mirrorZ: Boolean(raw.mirrorZ),
    offsetX: clamp(Number(raw.offsetX ?? 0), -OFFSET_MAX, OFFSET_MAX),
    offsetY: clamp(Number(raw.offsetY ?? 0), -OFFSET_MAX, OFFSET_MAX),
    offsetZ: clamp(Number(raw.offsetZ ?? 0), -OFFSET_MAX, OFFSET_MAX),
    scale: clamp(Number(raw.scale ?? 1), SCALE_MIN, SCALE_MAX),
    rotateX: clamp(Number(raw.rotateX ?? 0), -ROTATE_MAX, ROTATE_MAX),
    rotateY: clamp(Number(raw.rotateY ?? 0), -ROTATE_MAX, ROTATE_MAX),
    rotateZ: clamp(Number(raw.rotateZ ?? 0), -ROTATE_MAX, ROTATE_MAX),
  }
}

export function isIdentityClothesTransform(t: ClothesPieceTransform): boolean {
  return (
    !t.mirrorX &&
    !t.mirrorY &&
    !t.mirrorZ &&
    t.offsetX === 0 &&
    t.offsetY === 0 &&
    t.offsetZ === 0 &&
    t.scale === 1 &&
    t.rotateX === 0 &&
    t.rotateY === 0 &&
    t.rotateZ === 0
  )
}

export function clothesOverlayKey(sourceId: string, itemId: string): string {
  return `${sourceId}::${itemId}`
}

/** True when an odd number of axis mirrors flips triangle winding (det < 0). */
export function isOddAxisMirror(mirrorX: boolean, mirrorY: boolean, mirrorZ: boolean): boolean {
  return Boolean(mirrorX) !== Boolean(mirrorY) !== Boolean(mirrorZ)
}

export function compactClothesTransform(
  t: ClothesPieceTransform,
): Partial<ClothesPieceTransform> | undefined {
  if (isIdentityClothesTransform(t)) return undefined
  const out: Partial<ClothesPieceTransform> = {}
  if (t.mirrorX) out.mirrorX = true
  if (t.mirrorY) out.mirrorY = true
  if (t.mirrorZ) out.mirrorZ = true
  if (t.offsetX) out.offsetX = t.offsetX
  if (t.offsetY) out.offsetY = t.offsetY
  if (t.offsetZ) out.offsetZ = t.offsetZ
  if (t.scale !== 1) out.scale = t.scale
  if (t.rotateX) out.rotateX = t.rotateX
  if (t.rotateY) out.rotateY = t.rotateY
  if (t.rotateZ) out.rotateZ = t.rotateZ
  return out
}
