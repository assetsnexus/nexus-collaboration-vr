# @openclaw/voice-kit

Browser voice helpers: Silero VAD, Whisper (Transformers.js), Speaches STT, Fish Audio TTS, Azure stub.

**Pair with a 3D canvas:** [../../docs/library-in-your-ui.md](../../docs/library-in-your-ui.md#voice-kit-api) (`FishTts` + `StreamingPcmPlayer` + `CompanionHost.speakWithLipSync`).

Used by oc-controller frontend and the Vue playground. Keep API keys in the host app — this package does not persist secrets.

```ts
import { FishTts, SpeachesStt, createSileroVadSession } from '@openclaw/voice-kit'
import { StreamingPcmPlayer, FISH_PCM_SAMPLE_RATE } from '@openclaw/voice-kit/pcm-player'
```
