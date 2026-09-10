import type { TtsProvider, TtsResult, TtsSpeakOptions } from './types.js'
import { FISH_PCM_SAMPLE_RATE } from './pcm-player.js'

export interface FishTtsOptions {
  apiKey: string
  /** Fish Audio reference / model id */
  referenceId?: string
  baseUrl?: string
  defaultVoice?: string
}

/**
 * Fish Audio TTS — https://docs.fish.audio
 * POST /v1/tts with text + reference_id.
 */
export class FishTts implements TtsProvider {
  readonly id = 'fish'
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly referenceId?: string
  private readonly defaultVoice?: string

  constructor(options: FishTtsOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error('FishTts: apiKey required')
    }
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'https://api.fish.audio').replace(/\/$/, '')
    this.referenceId = options.referenceId
    this.defaultVoice = options.defaultVoice
  }

  async speak(text: string, opts: TtsSpeakOptions = {}): Promise<TtsResult> {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('FishTts: empty text')

    const format = opts.format ?? 'mp3'
    const res = await this.request(trimmed, format, opts)
    const audio = await res.arrayBuffer()
    const mime =
      format === 'wav'
        ? 'audio/wav'
        : format === 'opus'
          ? 'audio/ogg'
          : format === 'pcm'
            ? 'audio/pcm'
            : 'audio/mpeg'

    return {
      audio,
      mimeType: mime,
      provider: this.id,
      voice: opts.voice ?? this.defaultVoice ?? this.referenceId,
    }
  }

  /** HTTP-stream 16-bit PCM so the caller can play the first chunk immediately. */
  async speakPcmStream(text: string, opts: TtsSpeakOptions = {}): Promise<Response> {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('FishTts: empty text')
    return this.request(trimmed, 'pcm', opts)
  }

  private async request(
    text: string,
    format: NonNullable<TtsSpeakOptions['format']>,
    opts: TtsSpeakOptions,
  ): Promise<Response> {
    const referenceId = opts.voice ?? this.defaultVoice ?? this.referenceId
    if (!referenceId) {
      throw new Error('FishTts: voice / referenceId required')
    }

    const body: Record<string, unknown> = {
      text,
      reference_id: referenceId,
      format,
      normalize: true,
      latency: 'balanced',
      chunk_length: 100,
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    }
    if (format === 'mp3') body.mp3_bitrate = 128
    if (format === 'pcm') body.sample_rate = FISH_PCM_SAMPLE_RATE

    const res = await fetch(`${this.baseUrl}/v1/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        // S2 for [bracket] emotion / delivery annotations
        model: 's2.1-pro',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Fish TTS ${res.status}: ${errBody.slice(0, 400)}`)
    }

    return res
  }
}

/** Play ArrayBuffer via HTMLAudioElement; returns MediaStream for lip-sync if possible. */
export async function playAudioBuffer(
  audio: ArrayBuffer,
  mimeType: string,
): Promise<{ element: HTMLAudioElement; stream: MediaStream | null }> {
  const blob = new Blob([audio], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const element = new Audio(url)
  element.preload = 'auto'

  let stream: MediaStream | null = null
  try {
    // captureStream is Chromium; optional
    const el = element as HTMLAudioElement & { captureStream?: () => MediaStream }
    if (typeof el.captureStream === 'function') {
      stream = el.captureStream()
    }
  } catch {
    stream = null
  }

  await new Promise<void>((resolve, reject) => {
    element.onended = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    element.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('audio playback failed'))
    }
    void element.play().catch(reject)
  })

  return { element, stream }
}

/**
 * Decode TTS bytes and play through AudioContext; returns MediaStreamDestination stream
 * suitable for VRMLipSync.useStream.
 */
export async function playViaAudioContext(
  audio: ArrayBuffer,
  audioContext: AudioContext,
): Promise<{
  stream: MediaStream
  stop: () => void
  ended: Promise<void>
  analyser: AnalyserNode
}> {
  const buffer = await audioContext.decodeAudioData(audio.slice(0))
  const source = audioContext.createBufferSource()
  source.buffer = buffer
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 256
  const dest = audioContext.createMediaStreamDestination()
  source.connect(analyser)
  analyser.connect(dest)
  analyser.connect(audioContext.destination)
  let stopped = false
  const ended = new Promise<void>((resolve) => {
    source.onended = () => resolve()
  })
  source.start()
  return {
    stream: dest.stream,
    analyser,
    stop: () => {
      if (stopped) return
      stopped = true
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
    },
    ended,
  }
}
