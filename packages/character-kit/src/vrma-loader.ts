import { loadCachedGltf } from './asset-cache.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation'
import type { FetchCachedOptions } from './asset-cache.js'

const inflight = new Map<string, Promise<VRMAnimation[]>>()

function createVrmaLoader(): GLTFLoader {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  return loader
}

export type LoadVrmAnimationsOptions = FetchCachedOptions & {
  onProgress?: (ratio: number) => void
}

/**
 * Decode a VRMA once per URL and reuse the humanoid tracks for every avatar.
 * Clips are still bound per VRM via createVRMAnimationClip.
 */
export function loadVrmAnimations(
  url: string,
  loader: GLTFLoader = createVrmaLoader(),
  opts: LoadVrmAnimationsOptions = {},
): Promise<VRMAnimation[]> {
  const existing = inflight.get(url)
  if (existing) {
    opts.onProgress?.(1)
    return existing
  }

  const pending = loadCachedGltf(loader, url, opts.onProgress, opts)
    .then((gltf) => (gltf.userData.vrmAnimations ?? []) as VRMAnimation[])
    .catch((err) => {
      inflight.delete(url)
      throw err
    })
  inflight.set(url, pending)
  return pending.then((animations) => {
    if (!animations.length) inflight.delete(url)
    return animations
  })
}

export function clearVrmAnimationCache(): void {
  inflight.clear()
}
