export type {
  SttProvider,
  SttResult,
  SttTranscribeOptions,
  TtsProvider,
  TtsResult,
  TtsSpeakOptions,
  VadCallbacks,
  VadFrameInfo,
  VadSession,
} from './types.js'

export {
  buildInitialPrompt,
  float32ToWavBlob,
} from './types.js'

export { createSileroVadSession } from './vad-silero.js'
export type { SileroVadOptions } from './vad-silero.js'

export { BrowserWhisperStt, vadPcmToWavBlob } from './stt-browser-whisper.js'
export type { BrowserWhisperOptions, WhisperModelId } from './stt-browser-whisper.js'

export { SpeachesStt } from './stt-speaches.js'
export type { SpeachesSttOptions } from './stt-speaches.js'

export { FishTts, playAudioBuffer, playViaAudioContext } from './tts-fish.js'
export type { FishTtsOptions } from './tts-fish.js'
export { StreamingPcmPlayer, resumeAudioContext, FISH_PCM_SAMPLE_RATE } from './pcm-player.js'
export type { StreamingPcmPlayerOptions } from './pcm-player.js'

export { AzureFoundryTts, AzureFoundryStt } from './tts-azure-stub.js'
export type { AzureFoundryTtsOptions } from './tts-azure-stub.js'
