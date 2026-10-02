/**
 * Cardboard-style stereo + barrel distortion for three ^0.180.
 * Uses core StereoCamera (maintained) + a small fullscreen distortion pass — not the abandoned Cardboard SDK / webxr-polyfill.
 */

import * as THREE from 'three'
import type { ViewerDistortion } from './viewer-profiles.js'
import { clampIpdM } from './viewer-profiles.js'

const DISTORTION_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const DISTORTION_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform vec2 uEyeOffset; // 0 or 0.5 in x for left/right half
uniform float uK1;
uniform float uK2;
uniform float uScale;
varying vec2 vUv;

void main() {
  // Map full-screen UV into this eye's half, then to centred [-1,1]
  vec2 eyeUv = vec2((vUv.x - uEyeOffset.x) * 2.0, vUv.y);
  vec2 c = eyeUv * 2.0 - 1.0;
  float r = length(c);
  float rr = r * r;
  float f = (1.0 + uK1 * rr + uK2 * rr * rr) * uScale;
  // Inverse sample: pull from undistorted source
  vec2 src = c;
  if (r > 1e-5) {
    float r0 = r / max(f, 1e-5);
    src = c * (r0 / r);
  }
  vec2 halfUv = (src * 0.5 + 0.5);
  // Outside lens: black
  if (halfUv.x < 0.0 || halfUv.x > 1.0 || halfUv.y < 0.0 || halfUv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 sampleUv = vec2(uEyeOffset.x + halfUv.x * 0.5, halfUv.y);
  gl_FragColor = texture2D(tDiffuse, sampleUv);
}
`

export type PhoneVrStereoOpts = {
  ipdM?: number
  distortion?: ViewerDistortion
  distortionScale?: number
}

/**
 * Side-by-side stereo renderer with optional barrel distortion post-pass.
 */
export class PhoneVrStereoRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly stereo = new THREE.StereoCamera()
  private readonly size = new THREE.Vector2()
  private target: THREE.WebGLRenderTarget | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh
  private distortionEnabled = true

  constructor(renderer: THREE.WebGLRenderer, opts: PhoneVrStereoOpts = {}) {
    this.renderer = renderer
    this.stereo.aspect = 0.5
    this.setEyeSeparation(opts.ipdM ?? 0.064)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uEyeOffset: { value: new THREE.Vector2(0, 0) },
        uK1: { value: opts.distortion?.k1 ?? 0.34 },
        uK2: { value: opts.distortion?.k2 ?? 0.55 },
        uScale: { value: opts.distortionScale ?? 1 },
      },
      vertexShader: DISTORTION_VERT,
      fragmentShader: DISTORTION_FRAG,
      depthTest: false,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.scene.add(this.mesh)
  }

  setEyeSeparation(ipdM: number): void {
    this.stereo.eyeSep = clampIpdM(ipdM)
  }

  setDistortion(distortion: ViewerDistortion, scale = 1): void {
    this.material.uniforms.uK1!.value = distortion.k1
    this.material.uniforms.uK2!.value = distortion.k2
    this.material.uniforms.uScale!.value = scale
  }

  setDistortionEnabled(enabled: boolean): void {
    this.distortionEnabled = enabled
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    this.size.set(w, h)
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose()
      this.target = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      })
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const width = this.size.x || this.renderer.domElement.width || 1
    const height = this.size.y || this.renderer.domElement.height || 1
    if (!this.target) this.setSize(width, height)

    const persp =
      camera instanceof THREE.PerspectiveCamera
        ? camera
        : (camera as THREE.PerspectiveCamera)
    this.stereo.update(persp)

    const half = Math.floor(width / 2)
    const prevAutoClear = this.renderer.autoClear

    if (this.distortionEnabled && this.target) {
      this.renderer.setRenderTarget(this.target)
      this.renderer.clear()
      this.renderer.setScissorTest(true)

      this.renderer.setViewport(0, 0, half, height)
      this.renderer.setScissor(0, 0, half, height)
      this.renderer.render(scene, this.stereo.cameraL)

      this.renderer.setViewport(half, 0, width - half, height)
      this.renderer.setScissor(half, 0, width - half, height)
      this.renderer.render(scene, this.stereo.cameraR)

      this.renderer.setScissorTest(false)
      this.renderer.setRenderTarget(null)

      // Composite with per-eye barrel (two fullscreen passes with eye offset)
      this.material.uniforms.tDiffuse!.value = this.target.texture
      this.renderer.autoClear = true
      this.renderer.clear()
      this.renderer.autoClear = false

      this.material.uniforms.uEyeOffset!.value.set(0, 0)
      this.renderer.setViewport(0, 0, half, height)
      this.renderer.setScissorTest(true)
      this.renderer.setScissor(0, 0, half, height)
      this.renderer.render(this.scene, this.camera)

      this.material.uniforms.uEyeOffset!.value.set(0.5, 0)
      this.renderer.setViewport(half, 0, width - half, height)
      this.renderer.setScissor(half, 0, width - half, height)
      this.renderer.render(this.scene, this.camera)

      this.renderer.setScissorTest(false)
      this.renderer.setViewport(0, 0, width, height)
      this.renderer.autoClear = prevAutoClear
      return
    }

    // Plain SBS without distortion
    this.renderer.autoClear = true
    this.renderer.clear()
    this.renderer.autoClear = false
    this.renderer.setScissorTest(true)
    this.renderer.setViewport(0, 0, half, height)
    this.renderer.setScissor(0, 0, half, height)
    this.renderer.render(scene, this.stereo.cameraL)
    this.renderer.setViewport(half, 0, width - half, height)
    this.renderer.setScissor(half, 0, width - half, height)
    this.renderer.render(scene, this.stereo.cameraR)
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, width, height)
    this.renderer.autoClear = prevAutoClear
  }

  dispose(): void {
    this.target?.dispose()
    this.target = null
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}
