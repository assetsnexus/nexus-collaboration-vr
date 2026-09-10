import { parseClothesMaterialName, uniqueClothesItems, type ClothesItem } from './clothes-parse.js'

interface GltfJson {
  materials?: Array<{ name?: string }>
  meshes?: Array<{ name?: string }>
  nodes?: Array<{ name?: string }>
}

/** Collect clothing ids from a glTF JSON document (VRM materials / mesh names). */
export function listClothesFromGltfJson(json: GltfJson): ClothesItem[] {
  const names: string[] = []
  for (const mat of json.materials ?? []) {
    if (mat.name) names.push(mat.name)
  }
  for (const mesh of json.meshes ?? []) {
    if (mesh.name) names.push(mesh.name)
  }
  for (const node of json.nodes ?? []) {
    if (node.name) names.push(node.name)
  }
  const items: ClothesItem[] = []
  for (const name of names) {
    const item = parseClothesMaterialName(name)
    if (item) items.push(item)
  }
  return uniqueClothesItems(items)
}

/** Parse the JSON chunk of a GLB / VRM buffer. */
export function readGlbJson(data: ArrayBuffer): GltfJson | null {
  const bytes = new Uint8Array(data)
  if (bytes.length < 20) return null
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (magic !== 'glTF') return null
  const view = new DataView(data)
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, true)
    const ctype = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    offset += 8
    if (ctype.replace(/\0/g, '') === 'JSON') {
      const jsonBytes = bytes.subarray(offset, offset + length)
      try {
        return JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson
      } catch {
        return null
      }
    }
    offset += length
  }
  return null
}

export function listClothesFromVrmBuffer(data: ArrayBuffer): ClothesItem[] {
  const json = readGlbJson(data)
  if (!json) return []
  return listClothesFromGltfJson(json)
}
