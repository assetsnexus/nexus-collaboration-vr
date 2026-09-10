/**
 * Incremental 16-bit PCM playback through AudioContext.
 * Schedules chunks as they arrive so TTS can start before the full clip exists.
 */

export const FISH_PCM_SAMPLE_RATE = 24_000;

export type StreamingPcmPlayerOptions = {
  sampleRate?: number;
  /** Fired once the first buffer is actually started on a running context. */
  onStart?: () => void;
  onLevel?: (level: number) => void;
  onEnded?: () => void;
  /** Autoplay policy: context never reached running. */
  onBlocked?: () => void;
  /** Playing but analyser energy stays near zero. */
  onSilent?: () => void;
  silenceTimeoutMs?: number;
  blockedTimeoutMs?: number;
};

const LEVEL_INTERVAL_MS = 80;
const DEFAULT_SILENCE_MS = 2500;
const DEFAULT_BLOCKED_MS = 400;
const SCHEDULE_AHEAD_S = 0.06;

export async function resumeAudioContext(
  ctx: AudioContext,
  timeoutMs = DEFAULT_BLOCKED_MS,
): Promise<boolean> {
  if (ctx.state !== "running") {
    try {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, timeoutMs);
        }),
      ]);
    } catch {
      return false;
    }
  }
  const state: AudioContextState = ctx.state;
  return state === "running";
}

export class StreamingPcmPlayer {
  private readonly analyser: AnalyserNode;
  private readonly dest: MediaStreamAudioDestinationNode;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private leftover = new Uint8Array(0);
  private nextTime = 0;
  private playbackStartAt = 0;
  private pending = 0;
  private inputEnded = false;
  private stopped = false;
  private started = false;
  private heardAudio = false;
  private endedSettled = false;
  private levelTimer = 0;
  private silenceTimer = 0;
  private silentMs = 0;
  private readonly endedPromise: Promise<void>;
  private resolveEnded!: () => void;
  readonly stream: MediaStream;

  constructor(
    private readonly ctx: AudioContext,
    private readonly opts: StreamingPcmPlayerOptions = {},
  ) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.dest = ctx.createMediaStreamDestination();
    this.analyser.connect(this.dest);
    this.analyser.connect(ctx.destination);
    this.stream = this.dest.stream;
    this.endedPromise = new Promise((resolve) => {
      this.resolveEnded = resolve;
    });
  }

  get sampleRate(): number {
    return this.opts.sampleRate ?? FISH_PCM_SAMPLE_RATE;
  }

  get ended(): Promise<void> {
    return this.endedPromise;
  }

  get speaking(): boolean {
    return this.started && !this.stopped && this.ctx.state === "running";
  }

  /** AudioContext time when the first buffer started (0 if not started). */
  get audioStartTime(): number {
    return this.playbackStartAt;
  }

  /** Seconds of PCM already scheduled from the start of playback. */
  get scheduledDuration(): number {
    if (!this.playbackStartAt || this.nextTime <= 0) return 0;
    return Math.max(0, this.nextTime - this.playbackStartAt);
  }

  /** Current playback position relative to audio start (seconds). */
  get currentOffset(): number {
    if (!this.playbackStartAt) return 0;
    return Math.max(0, this.ctx.currentTime - this.playbackStartAt);
  }

  async ensureRunning(): Promise<boolean> {
    const ok = await resumeAudioContext(this.ctx, this.opts.blockedTimeoutMs ?? DEFAULT_BLOCKED_MS);
    if (!ok) {
      this.opts.onBlocked?.();
      this.stop();
    }
    return ok;
  }

  feed(bytes: Uint8Array): void {
    if (this.stopped || !bytes.byteLength) return;
    const merged = new Uint8Array(this.leftover.byteLength + bytes.byteLength);
    merged.set(this.leftover, 0);
    merged.set(bytes, this.leftover.byteLength);
    const usable = merged.byteLength - (merged.byteLength % 2);
    if (usable < 2) {
      this.leftover = merged;
      return;
    }
    this.leftover = merged.slice(usable);
    const samples = usable / 2;
    if (!samples) return;

    const audioBuffer = this.ctx.createBuffer(1, samples, this.sampleRate);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(merged.buffer, merged.byteOffset, usable);
    for (let i = 0; i < samples; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyser);
    const startAt = Math.max(this.ctx.currentTime + SCHEDULE_AHEAD_S, this.nextTime);
    if (this.nextTime === 0) {
      this.nextTime = startAt;
      this.playbackStartAt = startAt;
    }
    source.onended = () => {
      this.sources.delete(source);
      this.pending -= 1;
      this.maybeFinish();
    };
    this.sources.add(source);
    this.pending += 1;
    try {
      source.start(startAt);
    } catch {
      this.sources.delete(source);
      this.pending -= 1;
      return;
    }
    this.nextTime = startAt + audioBuffer.duration;
    this.markStarted(startAt);
  }

  markEnd(): void {
    this.inputEnded = true;
    this.maybeFinish();
  }

  async consume(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const running = await this.ensureRunning();
    if (!running) return;
    try {
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) this.feed(value);
      }
    } catch (err) {
      if (!this.stopped) throw err;
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* already cancelled */
      }
      this.markEnd();
    }
    await this.ended;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    window.clearInterval(this.levelTimer);
    window.clearInterval(this.silenceTimer);
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.pending = 0;
    this.opts.onLevel?.(0);
    this.finish();
  }

  private markStarted(startAt: number): void {
    if (this.started || this.stopped) return;
    if (this.ctx.state !== "running") {
      this.opts.onBlocked?.();
      this.stop();
      return;
    }
    this.started = true;
    const delayMs = Math.max(0, (startAt - this.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.stopped) return;
      this.opts.onStart?.();
      this.startMeters();
    }, delayMs);
  }

  private startMeters(): void {
    const levelData = new Uint8Array(this.analyser.fftSize);
    this.levelTimer = window.setInterval(() => {
      if (this.stopped) return;
      this.analyser.getByteTimeDomainData(levelData);
      let sum = 0;
      for (let i = 0; i < levelData.length; i += 1) {
        const n = ((levelData[i] ?? 128) - 128) / 128;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / Math.max(1, levelData.length));
      this.opts.onLevel?.(Math.min(1, rms * 6));
    }, LEVEL_INTERVAL_MS);

    const silenceMs = this.opts.silenceTimeoutMs ?? DEFAULT_SILENCE_MS;
    this.silentMs = 0;
    this.silenceTimer = window.setInterval(() => {
      if (this.stopped || !this.started) return;
      this.analyser.getByteTimeDomainData(levelData);
      let sum = 0;
      for (let i = 0; i < levelData.length; i += 1) {
        const n = ((levelData[i] ?? 128) - 128) / 128;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / Math.max(1, levelData.length));
      if (rms > 0.012) {
        this.silentMs = 0;
        this.heardAudio = true;
        return;
      }
      if (this.heardAudio) {
        this.silentMs = 0;
        return;
      }
      this.silentMs += LEVEL_INTERVAL_MS;
      if (this.silentMs >= silenceMs) {
        this.opts.onSilent?.();
        this.stop();
      }
    }, LEVEL_INTERVAL_MS);
  }

  private maybeFinish(): void {
    if (!this.inputEnded || this.pending > 0 || this.stopped) return;
    window.clearInterval(this.levelTimer);
    window.clearInterval(this.silenceTimer);
    this.opts.onLevel?.(0);
    this.finish();
  }

  private finish(): void {
    if (this.endedSettled) return;
    this.endedSettled = true;
    this.opts.onEnded?.();
    this.resolveEnded();
  }
}
