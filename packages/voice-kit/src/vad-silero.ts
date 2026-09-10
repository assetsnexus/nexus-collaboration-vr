import { MicVAD } from '@ricky0123/vad-web'
import type { VadCallbacks, VadSession } from './types.js'

export interface SileroVadOptions {
  /** onnx runtime / wasm asset base — defaults to CDN paths from vad-web */
  baseAssetPath?: string
  onnxWASMBasePath?: string
  positiveSpeechThreshold?: number
  negativeSpeechThreshold?: number
  /** Frames to wait after speech drop before ending (~30ms/frame at 1536@16k) */
  redemptionFrames?: number
  minSpeechFrames?: number
}

/**
 * Silero VAD mic session. Emits Float32 PCM @ 16 kHz on speech end.
 */
export async function createSileroVadSession(
  callbacks: VadCallbacks,
  options: SileroVadOptions = {},
): Promise<VadSession> {
  let listening = false
  const vad = await MicVAD.new({
    baseAssetPath: options.baseAssetPath,
    onnxWASMBasePath: options.onnxWASMBasePath,
    positiveSpeechThreshold: options.positiveSpeechThreshold ?? 0.6,
    negativeSpeechThreshold: options.negativeSpeechThreshold ?? 0.35,
    redemptionFrames: options.redemptionFrames ?? 24,
    minSpeechFrames: options.minSpeechFrames ?? 8,
    onFrameProcessed: (probabilities, frame) => {
      if (!callbacks.onFrameProcessed) return
      let sum = 0
      for (let i = 0; i < frame.length; i++) {
        const s = frame[i]!
        sum += s * s
      }
      callbacks.onFrameProcessed({
        isSpeech: probabilities.isSpeech,
        rms: frame.length ? Math.sqrt(sum / frame.length) : 0,
      })
    },
    onSpeechStart: () => {
      callbacks.onStatus?.('speech_start')
      callbacks.onSpeechStart?.()
    },
    onSpeechEnd: (audio) => {
      callbacks.onStatus?.('speech_end')
      void callbacks.onSpeechEnd(audio)
    },
    onVADMisfire: () => {
      callbacks.onStatus?.('misfire')
      callbacks.onVadMisfire?.()
    },
  })

  return {
    get listening() {
      return listening
    },
    async start() {
      await vad.start()
      listening = true
      callbacks.onStatus?.('listening')
    },
    pause() {
      vad.pause()
      listening = false
      callbacks.onStatus?.('paused')
    },
    resume() {
      void vad.start()
      listening = true
      callbacks.onStatus?.('listening')
    },
    destroy() {
      vad.destroy()
      listening = false
      callbacks.onStatus?.('destroyed')
    },
  }
}
