# character-kit + voice-kit

**Free to use** (MIT) VRM companions for your own UI: Three.js + three-vrm, gestures, ambient presence, OpenAI `character_*` tools, and optional STT/TTS.

License: **[MIT](LICENSE)** (VRMA clips under `apps/playground/public/assets/vrma/` have their own MIT / CC BY notices).

![Group chat with 3D VRM companions](docs/screenshots/01-group-chat-3d.png)

![Operator portal](docs/screenshots/02-operator-portal.png)

![Channel matrix](docs/screenshots/03-channel-matrix.png)

**oc-controller** is a small [integration example](../oc-controller/) (private agent-fleet cockpit). **[AssetsNexus.org](https://assetsnexus.org)** is a utilizing platform (Nexus Agents). The kits do not require either UI.

## Use in your app

**[docs/library-in-your-ui.md](docs/library-in-your-ui.md)** — `CompanionHost` (one canvas), `SceneRoom` (many avatars), LLM tools, Fish TTS + lip-sync.

Doc index: [docs/README.md](docs/README.md). Agent skill text: [packages/character-kit/skill/SKILL.md](packages/character-kit/skill/SKILL.md).

## Packages

| Path | Name | Role |
|------|------|------|
| `packages/character-kit` | `@nexus/character-kit` | three + three-vrm + VRMA + lip-sync; OpenAI `character_*` tool schemas |
| `packages/voice-kit` | `@nexus/voice-kit` | Silero VAD, browser Whisper, Speaches STT, Fish TTS |
| `apps/playground` | `@nexus/vrm-playground` | Vue reference app (not required at runtime) |

```json
{
  "dependencies": {
    "@nexus/character-kit": "file:../path/to/dev-vrm/packages/character-kit",
    "@nexus/voice-kit": "file:../path/to/dev-vrm/packages/voice-kit",
    "three": "^0.180.0"
  }
}
```

`three` is a peer of character-kit. Vite aliases, asset serving, and a React canvas example: [library-in-your-ui.md](docs/library-in-your-ui.md).

## Playground (optional)

```bash
pnpm install
mkdir -p apps/playground/public/assets/vrm
curl -L -o apps/playground/public/assets/vrm/sample.vrm \
  "https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm"
pnpm dev
```

Open http://localhost:5177

- Per-pane OpenAI-compatible `baseUrl` / API key / model (`localStorage`)
- Vite proxy: `/api/llm` → `LLM_PROXY_TARGET`, `/api/speaches` → `SPEACHES_URL`
- Compact tags: `[nod]`, `[wave|angry=30]`, `[mood:playful]`, `[walk:forward=1]`

Keys and custom system prompts: `.env.local` (`VITE_LLM_API_KEY`, `VITE_SYSTEM_PROMPT`). Private meshes: [`local/`](local/README.md) (gitignored).

## Where to get VRM models

Check each file’s VRM license (avatar use, commercial, redistribution). **Do not commit `.vrm` meshes.**

| Source | URL |
|--------|-----|
| [VRoid Hub](https://hub.vroid.com/) | Official catalog; download only models that allow third-party use |
| [VRoid Studio](https://vroid.com/en/studio) | Create and export your own |
| [vrm.dev](https://vrm.dev/en/) | Format spec and samples |
| [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | MIT demo mesh |
| [Ready Player Me](https://readyplayer.me/) | Create + export VRM |
| [BOOTH](https://booth.pm/) | Creator store (free/paid) |

Avoid unsigned “free VRM pack” dumps. A `.glb` is only a VRM if it contains `VRM` / `VRMC_vrm` extras.

## What stays out of git

| Kind | Where |
|------|--------|
| API keys | `.env.local` / host app env |
| Private meshes | `local/meshes/`, `apps/playground/public/assets/vrm/` |
| Custom prompts | `VITE_SYSTEM_PROMPT` or your product’s workspace dir |

## Example hosts

- **[oc-controller](../oc-controller/)** — small cockpit to privately manage a self-hosted fleet and channels (integration example).
- **[AssetsNexus.org](https://assetsnexus.org)** — utilizing platform. Prefer **Nexus Agents** for professional work (context/brain management, privacy, agent RBAC, 2000+ physical-world skills, MCP). You can still attach them to oc-controller like OpenClaw or Hermes.

Embed the kits in any React, Vue, or vanilla app.
