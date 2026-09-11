# Use character-kit + voice-kit + scene kits in your own UI

These packages are **free to use (MIT)** and framework-agnostic. You own the canvas, chat, and routing. The kits own Three.js, VRM load, gestures, presence, and (optionally) STT/TTS. Scene kits add a client-authoritative graph for objects/robots and tool-call visualizations.

The Vue playground and [BAL Agent Fleet Manager](https://github.com/AR-General/BAL-Agent-Fleet-Manager) (`oc-controller`) are **integration examples**. [AssetsNexus.org](https://assetsnexus.org) uses VRM companions as a utilizing platform. Copy the APIs, not a host UI.

Kits live in this repo: [nexus-collaboration-vr](https://github.com/assetsnexus/nexus-collaboration-vr).

## Out of scope here

These kits add **characters, objects, and robots** into *your* Three.js scene (meters, right-handed; optional IFC-axis helpers). They are not a building or field product.

Managed on **[AssetsNexus.org](https://assetsnexus.org)** (not in this repo):

- BIM / IFC building and location models
- Wiring, cables, MEP
- Industrial robot drivers (URDF live control, ROS, MQTT)
- In-browser VR / AR (Nexus already has this)
- Server-authoritative shared scenes, WebRTC P2P hosts

## Which class

| Need | Class | Package |
|------|--------|---------|
| One avatar in a `<canvas>` | **`CompanionHost`** | `@nexus/character-kit` |
| Several avatars, shared camera / lights | **`SceneRoom`** | `@nexus/character-kit` |
| Custom renderer / embed into an existing Three scene | **`CharacterController`** + `embed` | `@nexus/character-kit` |
| Shared props/robots graph (persist, browse, digest) | **`SceneGraph`** + transport | `@nexus/scene-kit` |
| Spawn primitives / glTF props + effects | **`ObjectSceneLayer`**, `object_*` tools | `@nexus/objects-kit` |
| Placeable robots/machines (thin) | **`RobotSceneLayer`**, `robot_*` tools | `@nexus/robots-kit` |
| Tool-call → glow/pulse spheres | **`handleToolCallEvent`** | `@nexus/agent-tools-kit` |
| Mic → text, text → audio | **`FishTts`**, **`SpeachesStt`**, **`BrowserWhisperStt`**, **`createSileroVadSession`** | `@nexus/voice-kit` |

Start with `CompanionHost` unless you need a group scene. For oc-controller-style group chat, mount `SceneRoom` for avatars and a `SceneGraph` host for objects (see `createSceneGraphHost` in the cockpit).

## Install

From a host app in the same repo (or any `file:` / published path):

```json
{
  "dependencies": {
    "@nexus/character-kit": "file:../../dev-vrm/packages/character-kit",
    "@nexus/voice-kit": "file:../../dev-vrm/packages/voice-kit",
    "@nexus/scene-kit": "file:../../dev-vrm/packages/scene-kit",
    "@nexus/objects-kit": "file:../../dev-vrm/packages/objects-kit",
    "three": "^0.180.0"
  }
}
```

`character-kit` lists `three` as a **peer**. Use one Three instance (Vite `dedupe: ["three"]` if you see duplicate `THREE` errors).

Alias to **source** in Vite so kit edits hot-reload (and so voice-kit can import `./pcm-player` without pulling Whisper):

```ts
import path from "node:path";

resolve: {
  alias: {
    "@nexus/character-kit": path.resolve(__dirname, "../dev-vrm/packages/character-kit/src/index.ts"),
    "@nexus/voice-kit": path.resolve(__dirname, "../dev-vrm/packages/voice-kit/src"),
  },
},
optimizeDeps: {
  exclude: ["@huggingface/transformers"],
  esbuildOptions: { target: "esnext" },
},
esbuild: { target: "esnext" }, // three-vrm-lip-sync uses top-level await
server: {
  fs: { allow: [/* your app root */, /* path to services/dev-vrm */] },
},
```

Serve gesture clips (and optional sample meshes) from `apps/playground/public/assets/` — oc-controller maps that tree to `/dev-vrm-assets`. VRMA license: `apps/playground/public/assets/vrma/LICENSE-ASSETS.md`. **Do not commit private `.vrm` files.**

## Minimal canvas (React)

```tsx
import { useEffect, useRef } from "react";
import { CompanionHost } from "@nexus/character-kit";

export function AvatarCanvas({ vrmUrl, gestureManifestUrl }: { vrmUrl: string; gestureManifestUrl?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<CompanionHost | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = new CompanionHost(canvas, {
      orbitControls: true,
      pointerLook: true,
      background: 0x12171c,
      agentId: "my-agent",
    });
    hostRef.current = host;
    return () => {
      host.dispose();
      hostRef.current = null;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !vrmUrl) return;
    void host.load({
      vrmUrl, // http(s) or blob: URL you already resolved
      gestureManifestUrl, // e.g. "/dev-vrm-assets/vrma/manifest.json"
      mood: "neutral",
    });
  }, [vrmUrl, gestureManifestUrl]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: 420, display: "block" }} />;
}
```

Vanilla is the same: `new CompanionHost(canvas)` → `await host.load({ vrmUrl })` → `host.dispose()` on teardown.

`vrmUrl` must be fetchable by the browser (same-origin, CORS, or `blob:` after an authenticated download). The kit does not know about oc-controller JWT or `oc-vrm:{uuid}` refs.

## CompanionHost API

Constructor: `new CompanionHost(canvas, options?)`.

**Options** (`CompanionHostOptions`): `background`, `orbitControls` (default true), `pointerLook` (default true), `bodyFollowCamera` (default false), `maxPixelRatio`, `agentId`, `logger`, `embed` (see `CharacterController`).

**Load** (`CompanionLoadOptions`):

| Field | Role |
|-------|------|
| `vrmUrl` | Mesh to fetch |
| `gestureManifestUrl` | JSON pack; relative `/assets/vrma/…` URLs are rewritten beside the manifest |
| `mood` | Ambient rest face + fidget pool (`neutral`, `happy`, `playful`, …) |
| `clothes` | `{ id }`, `{ ids }`, or `{ overlayPieces }` |
| `pointerLook` / `bodyFollowCamera` / `gazeLimits` | Gaze |
| `presence` | IdlePresenceDirector knobs (`enabled`, `mood`, `longIdleMs`, …) |

**Drive the avatar**

| Method | Role |
|--------|------|
| `load(opts)` | VRM + optional gesture pack + idle + presence |
| `playGesture(id, loop?)` | One-shot or loop VRMA / procedural id |
| `playInlineTags(text)` | Parse `[nod]`, `[wave\|angry=30]`, `[mood:playful]`, `[walk:forward=1]`, `[look:…]` |
| `playTimedSteps(steps)` | Same sequence ops, timed to TTS words |
| `setMood(mood)` | Ambient mood (not a one-shot face) |
| `setClothes(clothes)` | Native slots / overlays |
| `setMoveInput({ x, z })` | Analog stick / WASD (−1…1) |
| `speakWithLipSync(mediaStream, audioContext?)` | Visemes from the same graph as TTS playback |
| `stopLipSync()` | |
| `pausePresence` / `resumePresence` | Soft-cancel ambient while walking / speaking |
| `onAction(listener)` | Motion-feed events (`CharacterActionEvent`) |
| `inlineTagCatalog()` | Live gesture / mood / expression names for parsers |
| `listGestures()` / `listLoadedGestures()` | |
| `resize()` | Call when the canvas layout changes |
| `dispose()` | Stop RAF, drop WebGL, unbind ack listeners |

Lower-level: `host.controller` (`CharacterController`), `host.director` (`AnimationDirector`). Prefer Host methods so presence, ack gestures, and the action feed stay in sync.

Helpers: `preloadCharacterAssets(urls)`, `fetchRewrittenManifest(manifestUrl)`.

## SceneRoom API (multi-avatar)

One WebGL renderer, several VRMs, nametags, spawn slots.

```ts
import { SceneRoom, type SceneRoomOccupant } from "@nexus/character-kit";

const room = new SceneRoom(canvas, {
  gestureManifestUrl: "/dev-vrm-assets/vrma/manifest.json",
  pointerLook: true,
  onLabelClick: (id) => room.setSelected(id),
});

const occupants: SceneRoomOccupant[] = [
  { id: "alpha", label: "Alpha", slotIndex: 0, vrmUrl: "/avatars/a.vrm", present: true, mood: "neutral", statusColor: 0x7eb8ff },
  { id: "beta", label: "Beta", slotIndex: 1, vrmUrl: "/avatars/b.vrm", present: true, mood: "happy", statusColor: 0xf0c14a },
];
await room.setOccupants(occupants);

room.setSpeaking("alpha");
await room.playInlineTags("alpha", "[wave] hello");
room.applyToolCall("alpha", "character_walk", { forward: 1 });
room.frameFacing("alpha");

// persist / restore
const poses = room.snapshotOccupants();
room.applyOccupantPoses(poses);

room.dispose();
```

| Method | Role |
|--------|------|
| `setOccupants(list)` | Diff roster: load/unload, keep world pose when `x`/`z`/`facing` set |
| `addAvatar` / `removeAvatar` / `getAvatar` | Per-id `SceneRoomAvatarHandle` (`controller`, `director`, `playGesture`, …) |
| `setSelected` / `setSpeaking` | Camera / lip-sync focus |
| `playInlineTags(id, text)` / `playTimedSteps(id, steps)` | Per occupant |
| `applyToolCall(id, name, args)` | LLM `character_*` / `scene_*` on that occupant |
| `speakWithLipSync(id, stream, ctx)` | |
| `snapshotOccupants` / `applyOccupantPoses` | `{ id, x, z, facing }` |
| `drainSceneDigest(agent)` | Compact scene events for the next LLM turn |
| `onAction(listener)` | Combined motion feed |

`present: false` keeps the slot as an empty status ring (offline).

## LLM tools (client-executed)

The mesh never runs on the server. Attach OpenAI-compatible function schemas to the chat completion, then run returned `tool_calls` in the browser.

```ts
import {
  CHARACTER_SKILL,
  buildCharacterSkillPrompt,
  isImmediateCharacterTool,
  isDeferredCharacterTool,
} from "@nexus/character-kit";

const tools = CHARACTER_SKILL.allTools();
const system = buildCharacterSkillPrompt({
  catalog: {
    gestureIds: host.listGestures(),
    moods: ["neutral", "happy", "playful", "curious", "tired"],
    expressions: host.controller.listExpressions(),
  },
  inlineTagsEnabled: true,
  ttsEnabled: true,
});

// after the model returns tool_calls:
await host.director.applyToolCalls(calls);
// or: room.applyToolCall(occupantId, name, args)
```

**Immediate** (run as soon as parsed — mood, clothes, locomotion, scene, lists):  
`character_list_*`, `character_set_mood`, `character_set_clothes`, `character_walk`, `character_turn`, `character_stop`, `character_jump`, `character_teleport`, `character_approach`, `character_turn_to`, `character_cancel`, `scene_*`.

**Deferred** (queue with the spoken reply / TTS beat):  
`character_play_gesture`, `character_run_sequence`, `character_set_emotion`, `character_set_expression`, `character_look_at`, `character_wait`.

Name aliases: `character.play_gesture` and `play_gesture` resolve to `character_play_gesture`.

Prefer compact tags in assistant text for simple beats; use tools for sequences and locomotion. Details: [presence-and-tools.md](presence-and-tools.md), [phase2-locomotion.md](phase2-locomotion.md), [agent-skills.md](agent-skills.md), [skill/SKILL.md](../packages/character-kit/skill/SKILL.md).

## Inline tags (no tools)

```ts
import { parseInlineTags, defaultInlineCatalog, FISH_TTS_TAGS } from "@nexus/character-kit";

const parsed = parseInlineTags(assistantText, host.inlineTagCatalog());
// parsed.withSpeech → run during TTS
// parsed.afterTts → run after
await host.playInlineTags(assistantText);
```

Examples: `[nod]`, `[wave|angry=30]`, `[mood:playful]`, `[look:1,0,2]`, `[walk:forward=1]`, `[teleport:seat]`. Bare `[happy]` / `[break]` are **Fish TTS** annotations (`FISH_TTS_TAGS`) — leave them in the spoken string; 3D face uses `[happy=30]`.

## Voice-kit API

Keep API keys in **your** backend or env. voice-kit does not persist secrets.

```ts
import { FishTts, StreamingPcmPlayer, FISH_PCM_SAMPLE_RATE } from "@nexus/voice-kit";

const ctx = new AudioContext();
const tts = new FishTts({ apiKey, referenceId: fishVoiceId });
const player = new StreamingPcmPlayer(ctx, { sampleRate: FISH_PCM_SAMPLE_RATE });

const res = await tts.speakPcmStream(spokenText, { voice: fishVoiceId });
await host.speakWithLipSync(player.stream, ctx);
await player.consume(res.body!.getReader());
await player.ended;
host.stopLipSync();
```

| Export | Role |
|--------|------|
| `FishTts` | `speak()` (full buffer) or `speakPcmStream()` (chunked PCM) |
| `StreamingPcmPlayer` / `FISH_PCM_SAMPLE_RATE` | 24 kHz s16 playback |
| `playAudioBuffer` / `playViaAudioContext` | One-shot decode |
| `SpeachesStt` | OpenAI-compatible `/v1/audio/transcriptions` |
| `BrowserWhisperStt` | Transformers.js in-tab (heavy; exclude from `optimizeDeps` if unused) |
| `createSileroVadSession` | Mic VAD → `Float32Array` utterance |
| `AzureFoundryTts` / `AzureFoundryStt` | Stubs only |

STT: `provider.transcribe(blob, { language, vocabulary, prompt, signal })` → `{ text, provider }`.

Wire lip-sync **after** you have a `MediaStream` of the TTS output on the **same** `AudioContext`. Call `host.stopLipSync()` when the clip ends.

## CharacterController (advanced)

Use when you already have a Three scene (`embed: { scene, camera, canvas, sceneRegistry?, sceneFx? }`) or need methods Host does not wrap: `loadVRM`, `loadGesturePack`, `applyToolCall`, `listExpressions`, `ensureLipSync`, `lookAt`, locomotion snapshots.

Guest avatars in `SceneRoom` are embedded controllers: no own RAF; the room ticks them.

Always `dispose()` or you leak WebGL contexts.

## Assets checklist

1. `.vrm` URL the browser can GET  
2. Optional VRMA `manifest.json` + `.vrma` files next to it  
3. CORS if the mesh is on another origin  
4. License: each VRM has embedded usage terms; VRMA pack is MIT / CC BY — see playground `LICENSE-ASSETS.md`

Where to download meshes: [README — Where to get VRM models](../README.md#where-to-get-vrm-models).
