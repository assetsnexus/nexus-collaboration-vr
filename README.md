# services/dev-vrm

Framework-agnostic VRM character kit, voice providers, and a Vue playground.

**Embed in your own UI:** [docs/library-in-your-ui.md](docs/library-in-your-ui.md) — `CompanionHost`, `SceneRoom`, LLM `character_*` tools, Fish TTS / STT. Doc index: [docs/README.md](docs/README.md).

The oc-controller frontend consumes the kits as a local library (`file:../../dev-vrm/packages/...`).

## Packages

| Path | Name | Role |
|------|------|------|
| `packages/character-kit` | `@openclaw/character-kit` | three + three-vrm + VRMA + lip-sync; OpenAI `character_*` tool schemas |
| `packages/voice-kit` | `@openclaw/voice-kit` | Silero VAD, browser Whisper, Speaches STT, Fish TTS, Azure stubs |
| `apps/playground` | `@openclaw/vrm-playground` | Multi-pane chat, mic STT, TTS + lip-sync, 3D viewport |

## Quick start

```bash
cd services/dev-vrm
pnpm install
mkdir -p apps/playground/public/assets/vrm
curl -L -o apps/playground/public/assets/vrm/sample.vrm \
  "https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm"
pnpm dev
```

Open http://localhost:5177

VRMA clips under `apps/playground/public/assets/vrma/` are third-party (MIT / CC BY 3.0) — see `apps/playground/public/assets/vrma/LICENSE-ASSETS.md`. Do not commit private `.vrm` meshes.

### Playground settings

- Per-pane OpenAI-compatible `baseUrl` / API key / model (stored in `localStorage`)
- Vite proxy: `/api/llm` → `LLM_PROXY_TARGET` (default `http://127.0.0.1:8080`), `/api/speaches` → `SPEACHES_URL`
- Per-agent mood, VRM model, and clothes
- STT: **browser Whisper** (default) or Speaches
- TTS: Fish Audio API key + reference id → lip-sync via `three-vrm-lip-sync`
- Compact tags: `[nod]`, `[wave|angry=30]`, `[mood:playful]`, `[walk:forward=1]`, `[teleport:seat]` (`VITE_INLINE_CHARACTER_TAGS`, default on)

Skill doc: [packages/character-kit/skill/SKILL.md](packages/character-kit/skill/SKILL.md).

## Use from oc-controller

The portal frontend aliases `@openclaw/character-kit` and `@openclaw/voice-kit` to these packages. After changing kit source, the Vite dev server on `:3080` reloads; Docker frontend builds copy the packages from `services/`. Same wiring is documented for other apps in [docs/library-in-your-ui.md](docs/library-in-your-ui.md).

## Where to get VRM models

Official / reputable sources (always read the model’s VRM license): [VRoid Hub](https://hub.vroid.com/), [VRoid Studio](https://vroid.com/en/studio) (export your own), [vrm.dev](https://vrm.dev/en/), the [pixiv/three-vrm](https://github.com/pixiv/three-vrm) sample mesh, [Ready Player Me](https://readyplayer.me/), [BOOTH](https://booth.pm/). Details: [../oc-controller/frontend/README.md](../oc-controller/frontend/README.md#where-to-get-vrm-models).

## Model / ownership notes

- Chat LLM: user-supplied keys in localStorage or Vite env (`VITE_LLM_API_KEY`, `VITE_OPENROUTER_API_KEY`) — never commit `.env.local`
- STT weights: Hugging Face via Transformers.js (browser) or Speaches
- TTS: Fish Audio (user key). Azure Foundry = stub only
