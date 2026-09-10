import {
  buildInitialPrompt,
  type SttProvider,
  type SttResult,
  type SttTranscribeOptions,
} from './types.js'

export interface SpeachesSttOptions {
  /** e.g. http://127.0.0.1:8090 */
  baseUrl: string
  apiKey?: string
  model?: string
  /** Extra form fields forwarded to Speaches / OpenAI-compatible API */
  extraForm?: Record<string, string>
}

/**
 * Speaches (faster-whisper) OpenAI-compatible transcriptions client.
 */
export class SpeachesStt implements SttProvider {
  readonly id = 'speaches'
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly model: string
  private readonly extraForm: Record<string, string>

  constructor(options: SpeachesSttOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.model = options.model ?? 'Systran/faster-distil-whisper-large-v3'
    this.extraForm = options.extraForm ?? {}
  }

  async transcribe(audio: Blob | ArrayBuffer, opts: SttTranscribeOptions = {}): Promise<SttResult> {
    const t0 = performance.now()
    const blob =
      audio instanceof Blob
        ? audio
        : new Blob([audio], { type: 'audio/wav' })

    const form = new FormData()
    form.append('file', blob, 'audio.wav')
    form.append('model', this.model)
    form.append('response_format', 'json')
    if (opts.language) form.append('language', opts.language)

    const prompt = buildInitialPrompt(opts.vocabulary, opts.prompt)
    if (prompt) form.append('prompt', prompt)

    // Speaches / faster-whisper hotwords (comma-separated) when supported
    if (opts.vocabulary?.length) {
      form.append('hotwords', opts.vocabulary.join(','))
    }

    for (const [k, v] of Object.entries(this.extraForm)) {
      form.append(k, v)
    }

    const headers: Record<string, string> = {}
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const res = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
      signal: opts.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Speaches STT ${res.status}: ${body.slice(0, 400)}`)
    }

    const data = (await res.json()) as { text?: string; language?: string }
    return {
      text: (data.text ?? '').trim(),
      language: data.language ?? opts.language,
      durationMs: Math.round(performance.now() - t0),
      provider: this.id,
    }
  }
}
