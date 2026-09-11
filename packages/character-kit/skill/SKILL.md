---
name: character
description: VRM companion motion skill — character_* tools and compact [nod,2s,wave] tags for OpenClaw and the playground client.
---

# character skill

Canonical OpenAI function prefix: **`character_`**.

Inbound aliases (do not advertise; client still accepts them):

- `character.play_gesture` (dotted)
- short names: `play_gesture`, `set_mood`, …

**Prefer GitHub sync** from [nexus-collaboration-vr `skills/character`](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills/character) (same content as repo `skills/character/`). Or copy this folder into an OpenClaw/Hermes workspace `skills/character/`. Import tools from `@nexus/character-kit`:

```ts
import { CHARACTER_SKILL, parseInlineTags } from '@nexus/character-kit'

const tools = CHARACTER_SKILL.tools // OpenAI ChatCompletionTool[]
CHARACTER_SKILL.resolveToolName('character.play_gesture') // → character_play_gesture
```

## Tools

| Tool | When |
|------|------|
| `character_play_gesture` | Play a VRMA / procedural clip; optional scored face |
| `character_set_emotion` | Scored face (eases in; returns to mood rest) |
| `character_set_expression` | Raw blendshape |
| `character_set_mood` | Ambient idle mood + rest face |
| `character_look_at` | Camera / `{x,y,z}` / clear. World points yaw the body (`turn`, default true). Optional `holdMs`. |
| `character_wait` | Pause timeline (ms) |
| `character_run_sequence` | Multi-step performance |
| `character_cancel` | Soft-cancel prior beat |
| `character_list_gestures` | Live gesture ids |
| `character_list_expressions` | Live face catalog (use these names + scores) |
| `character_list_clothes` | Clothing slots on the loaded VRM, grouped (tops/bottoms/shoes/…) |
| `character_set_clothes` | `none` / `default` / slot ids (`tops+shoes` or `ids[]`) / overlay URL (adds on top of native) |
| `character_walk` | `forward`/`right` meters, or `to:{x,z}`, or `objectId` (+ side/distance). Optional `speed` / `gait` (`walk`\|`run`\|`careful`\|`crouch`\|`crawl`\|`roll`). Auto-run if walk would take >4s |
| `character_turn` | Degrees (+right / −left) |
| `character_stop` | Cancel locomotion seek |
| `character_jump` | Hop in place |
| `character_teleport` | Instant; prefer `objectId` (front-to-front, always face target) |
| `scene_list_objects` | List places/props (`query`, `kind`, `tag`, `ids`, `limit`) |
| `scene_get_object` | One object by id |

Compact: `[clothes:none]` `[clothes:tops+shoes]` `[mood:playful]` `[wave|angry=30]` `[walk:forward=1]` `[turn:90]` `[jump]` `[teleport:seat]`

Use `CHARACTER_SKILL.allTools()` for the full chat tool list (character + locomotion + scene).

## Compact tags (preferred for simple beats)

The playground client strips these from chat and from TTS. Enable with `VITE_INLINE_CHARACTER_TAGS` (default **true**).

Scores are **0–100** (30 = 30% blend). Prefer **20–50** while talking; avoid 100. Live emotion names come from `character_list_expressions` (and the skill prompt).

```
[nod]
[wave|angry=30]
[laugh|happy=30]
[nod|happy=40, wave|surprised=25]
[wave|angry=30+surprised=10]
[happy=35]
[mood:playful]
[look:camera]
[look:1.2,1.4,-0.5]
[look:clear]
```

- Start of reply → play with speech
- End of reply → play after TTS
- After the spoken beat the face **eases back to the current mood rest face** (not a hard cut to neutral)
- `lough` → laugh clip; `angy` → angry
- Pipe `|` binds a face to a gesture. `+` layers extra shapes. Comma chains beats.
- `[look:x,y,z]` faces a world point (body yaws); `[look:camera]` / `[look:clear]` release it.

Use `character_run_sequence` only when tags are not enough.

## Fish TTS

When voice is on, Fish S2 tags stay in the spoken string (`[happy]`, `[break]`, `[chuckling]`, `[soft tone]`). Those are **voice** tags. For the 3D face use `[happy=30]` or `[wave|happy=30]`.
