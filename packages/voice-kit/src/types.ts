export interface SttResult {
  text: string
  language?: string
  durationMs?: number
  provider: string
}

export interface SttTranscribeOptions {
  language?: string
  /** Domain vocabulary → Speaches hotwords / Whisper initial_prompt */
  vocabulary?: string[]
  prompt?: string
  signal?: AbortSignal
}

export interface SttProvider {
  readonly id: string
  /** Optional warm-up (download Whisper weights, etc.) */
  prepare?(): Promise<void>
  transcribe(audio: Blob | ArrayBuffer, opts?: SttTranscribeOptions): Promise<SttResult>
  dispose?(): void
}

export interface VadFrameInfo {
  /** Silero P(speech) for this frame */
  isSpeech: number
  /** RMS of the 16 kHz frame */
  rms: number
}

export interface VadCallbacks {
  onSpeechStart?: () => void
  onSpeechEnd: (audio: Float32Array) => void | Promise<void>
  onVadMisfire?: () => void
  onStatus?: (status: string) => void
  /** Fired every VAD frame (~30ms) while listening — used for mic level UI. */
  onFrameProcessed?: (info: VadFrameInfo) => void
}

export interface VadSession {
  start(): Promise<void>
  pause(): void
  resume(): void
  destroy(): void
  readonly listening: boolean
}

export interface TtsSpeakOptions {
  voice?: string
  speed?: number
  format?: 'mp3' | 'wav' | 'opus' | 'pcm'
  signal?: AbortSignal
}

export interface TtsResult {
  audio: ArrayBuffer
  mimeType: string
  provider: string
  voice?: string
}

export interface TtsProvider {
  readonly id: string
  speak(text: string, opts?: TtsSpeakOptions): Promise<TtsResult>
  dispose?(): void
}

export function buildInitialPrompt(vocabulary: string[] | undefined, prompt?: string): string | undefined {
  const parts: string[] = []
  if (prompt?.trim()) parts.push(prompt.trim())
  if (vocabulary?.length) {
    parts.push(`Vocabulary: ${vocabulary.map((w) => w.trim()).filter(Boolean).join(', ')}.`)
  }
  return parts.length ? parts.join(' ') : undefined
}

export function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
