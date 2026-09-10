import { Object3D, Vector3 } from 'three'
import type { VRM } from '@pixiv/three-vrm'

/** AIRI-style automatic blink (expression morph). */
export class BlinkController {
  private isBlinking = false
  private blinkProgress = 0
  private timeSinceLastBlink = 0
  private nextBlinkTime = 1 + Math.random() * 5
  private readonly blinkDuration = 0.2
  private readonly minInterval = 1
  private readonly maxInterval = 6

  update(vrm: VRM | null, delta: number): void {
    if (!vrm?.expressionManager) return

    this.timeSinceLastBlink += delta
    if (!this.isBlinking && this.timeSinceLastBlink >= this.nextBlinkTime) {
      this.isBlinking = true
      this.blinkProgress = 0
    }

    if (this.isBlinking) {
      this.blinkProgress += delta / this.blinkDuration
      const blinkValue = Math.sin(Math.PI * Math.min(1, this.blinkProgress))
      vrm.expressionManager.setValue('blink', blinkValue)
      if (this.blinkProgress >= 1) {
        this.isBlinking = false
        this.timeSinceLastBlink = 0
        vrm.expressionManager.setValue('blink', 0)
        this.nextBlinkTime =
          this.minInterval + Math.random() * (this.maxInterval - this.minInterval)
      }
    }
  }
}

/** Naive idle eye saccades around the current look-at target. */
export class IdleEyeSaccades {
  private nextSaccadeAfter = -1
  private timeSinceLastSaccade = 0
  private readonly fixationTarget = new Vector3()
  private readonly proxy = new Object3D()
  private enabled = true
  private amplitude = 1

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  setAmplitude(value: number): void {
    this.amplitude = Math.max(0, value)
  }

  update(vrm: VRM | null, baseTarget: Object3D, delta: number): void {
    if (!vrm?.lookAt) return
    if (!this.enabled || this.amplitude <= 0.01) {
      this.proxy.position.copy(baseTarget.position)
      vrm.lookAt.target = this.proxy
      return
    }

    const span = 0.48 * this.amplitude
    if (this.timeSinceLastSaccade >= this.nextSaccadeAfter || this.nextSaccadeAfter < 0) {
      this.fixationTarget.set(
        baseTarget.position.x + (Math.random() - 0.5) * span,
        baseTarget.position.y + (Math.random() - 0.5) * span * 0.7,
        baseTarget.position.z + (Math.random() - 0.5) * span * 0.25,
      )
      this.timeSinceLastSaccade = 0
      this.nextSaccadeAfter = 0.5 + Math.random() * 3
    }

    this.proxy.position.lerp(this.fixationTarget, Math.min(1, delta * 8))
    vrm.lookAt.target = this.proxy
    this.timeSinceLastSaccade += delta
  }

  /** Snap eyes back to camera / explicit look-at (conversation). */
  snapTo(baseTarget: Object3D): void {
    this.fixationTarget.copy(baseTarget.position)
    this.proxy.position.copy(baseTarget.position)
    this.timeSinceLastSaccade = 0
    this.nextSaccadeAfter = 2 + Math.random() * 2
  }
}
