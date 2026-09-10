import { pipeline, env } from '@huggingface/transformers'
import {
  buildInitialPrompt,
  float32ToWavBlob,
  type SttProvider,
  type SttResult,
  type SttTranscribeOptions,
} from './types.js'

export type WhisperModelId =
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small.en'
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-base'
  | 'onnx-community/whisper-base'
  | string

export interface BrowserWhisperOptions {
  model?: WhisperModelId
  /** Prefer WebGPU when available */
  device?: 'webgpu' | 'wasm' | 'auto'
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4'
}

type AsrPipeline = (
  audio: Float32Array | string,
  opts?: Record<string, unknown>,
) => Promise<{ text: string } | Array<{ text: string }>>

type WhisperDtype = NonNullable<BrowserWhisperOptions['dtype']>

/**
 * In-browser Whisper via Transformers.js (default STT).
 * Pair with Silero VAD; pass 16 kHz Float32 from VAD or a WAV/WebM blob.
 */
export class BrowserWhisperStt implements SttProvider {
  readonly id = 'browser-whisper'
  private pipe: AsrPipeline | null = null
  private loading: Promise<void> | null = null
  private readonly model: string
  private readonly device: 'webgpu' | 'wasm' | 'auto'
  private readonly dtype: WhisperDtype

  constructor(options: BrowserWhisperOptions = {}) {
    this.model = options.model ?? 'Xenova/whisper-base.en'
    this.device = options.device ?? 'auto'
    this.dtype = options.dtype ?? 'q8'
    // Allow remote model fetch in playground
    env.allowLocalModels = false
  }

  async prepare(): Promise<void> {
    if (this.pipe) return
    if (this.loading) return this.loading
    this.loading = (async () => {
      const device =
        this.device === 'auto'
          ? typeof navigator !== 'undefined' && 'gpu' in navigator
            ? 'webgpu'
            : 'wasm'
          : this.device
      console.info('[voice-kit] loading Whisper', { model: this.model, device })
      const load = async (dev: 'webgpu' | 'wasm') => {
        // Transformers.js pipeline typings are extremely wide; keep a narrow local iface.
        const asr = await (pipeline as (task: string, model: string, opts: object) => Promise<AsrPipeline>)(
          'automatic-speech-recognition',
          this.model,
          { device: dev, dtype: this.dtype },
        )
        return asr
      }
      try {
        this.pipe = await load(device === 'webgpu' ? 'webgpu' : 'wasm')
      } catch (err) {
        console.warn('[voice-kit] WebGPU Whisper failed, falling back to wasm', err)
        this.pipe = await load('wasm')
      }
      console.info('[voice-kit] Whisper ready')
    })()
    return this.loading
  }

  async transcribe(audio: Blob | ArrayBuffer, opts: SttTranscribeOptions = {}): Promise<SttResult> {
    await this.prepare()
    if (!this.pipe) throw new Error('Whisper pipeline not ready')

    const t0 = performance.now()
    const floatAudio = await decodeToMono16k(audio)
    const prompt = buildInitialPrompt(opts.vocabulary, opts.prompt)

    const out = await this.pipe(floatAudio, {
      language: opts.language,
      task: 'transcribe',
      // initial_prompt support varies by model revision; pass when present
      ...(prompt ? { initial_prompt: prompt } : {}),
    })

    const text = Array.isArray(out)
      ? out.map((o) => o.text).join(' ').trim()
      : (out.text ?? '').trim()

    return {
      text,
      language: opts.language,
      durationMs: Math.round(performance.now() - t0),
      provider: this.id,
    }
  }

  dispose(): void {
    this.pipe = null
    this.loading = null
  }
}

async function decodeToMono16k(audio: Blob | ArrayBuffer): Promise<Float32Array> {
  if (audio instanceof Float32Array) return audio
  const buf = audio instanceof ArrayBuffer ? audio : await audio.arrayBuffer()

  // If already PCM from VAD we often get Float32 wrapped — check WAV magic
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  const isWav = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46

  if (!isWav && buf.byteLength % 4 === 0 && buf.byteLength > 44) {
    // Heuristic: raw float32 from VAD (no container)
    // VAD already 16k — but Blob from float32ToWavBlob is preferred path
  }

  const AudioCtx =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0))
    const mono = decoded.numberOfChannels === 1
      ? decoded.getChannelData(0)
      : mixDown(decoded)
    return resample(mono, decoded.sampleRate, 16000)
  } finally {
    await ctx.close()
  }
}

/** Helper: turn VAD float32 into something Whisper can ingest via decode path */
export function vadPcmToWavBlob(pcm: Float32Array): Blob {
  return float32ToWavBlob(pcm, 16000)
}

function mixDown(buf: AudioBuffer): Float32Array {
  const len = buf.length
  const out = new Float32Array(len)
  const ch = buf.numberOfChannels
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) out[i]! += data[i]! / ch
  }
  return out
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = src - i0
    out[i] = input[i0]! * (1 - t) + input[i1]! * t
  }
  return out
}
