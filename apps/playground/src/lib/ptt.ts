export const PTT_MIN_DURATION_MS = 280
export const PTT_MIN_BYTES = 256

export type PttStopReason = 'submit' | 'cancel'

export function pttShouldArm(button: number): boolean {
  return button === 0
}

export function pttResultUsable(opts: {
  reason: PttStopReason
  durationMs: number
  byteLength: number
}): boolean {
  if (opts.reason !== 'submit') return false
  if (!Number.isFinite(opts.durationMs) || opts.durationMs < PTT_MIN_DURATION_MS) return false
  if (!Number.isFinite(opts.byteLength) || opts.byteLength < PTT_MIN_BYTES) return false
  return true
}

export function pickRecorderMimeType(
  isTypeSupported: (mime: string) => boolean,
): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((m) => isTypeSupported(m))
}

/**
 * Hold-to-talk capture. Collects a Blob via MediaRecorder and an AnalyserNode
 * for live levels. Tracks are stopped on stop/cancel/dispose.
 */
export class PushToTalkRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private startedAt = 0
  private mimeType = 'audio/webm'
  private gen = 0
  private ctx: AudioContext

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  get live(): boolean {
    return this.recorder?.state === 'recording'
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  async start(): Promise<void> {
    this.cleanupGraph()
    this.chunks = []
    const gen = ++this.gen
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    if (gen !== this.gen) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
      throw new Error('ptt superseded')
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.source.connect(this.analyser)

    const mime = pickRecorderMimeType((m) => MediaRecorder.isTypeSupported(m))
    this.mimeType = mime ?? 'audio/webm'
    this.recorder = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (ev) => {
      if (ev.data?.size) this.chunks.push(ev.data)
    }
    this.startedAt = performance.now()
    this.recorder.start(80)
    console.info('[playground] ptt start')
  }

  async stop(reason: PttStopReason): Promise<{ blob: Blob; durationMs: number } | null> {
    this.gen += 1
    const rec = this.recorder
    const durationMs = performance.now() - this.startedAt
    if (!rec) {
      this.cleanupGraph()
      return null
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      const finish = () => {
        if (reason !== 'submit') {
          resolve(null)
          return
        }
        resolve(new Blob(this.chunks, { type: rec.mimeType || this.mimeType }))
      }
      if (rec.state === 'recording') {
        rec.onstop = finish
        try {
          rec.stop()
        } catch (err) {
          console.warn('[playground] ptt recorder stop', err)
          finish()
        }
      } else {
        finish()
      }
    })

    this.cleanupGraph()
    if (!blob) {
      console.info('[playground] ptt discard', { reason, durationMs })
      return null
    }
    if (!pttResultUsable({ reason, durationMs, byteLength: blob.size })) {
      console.info('[playground] ptt too short', { durationMs, bytes: blob.size })
      return null
    }
    console.info('[playground] ptt submit', { durationMs: Math.round(durationMs), bytes: blob.size })
    return { blob, durationMs }
  }

  dispose(): void {
    this.gen += 1
    try {
      if (this.recorder?.state === 'recording') this.recorder.stop()
    } catch {
      /* already stopped */
    }
    this.cleanupGraph()
  }

  private cleanupGraph(): void {
    this.recorder = null
    this.chunks = []
    try {
      this.source?.disconnect()
    } catch {
      /* already disconnected */
    }
    this.source = null
    this.analyser = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
