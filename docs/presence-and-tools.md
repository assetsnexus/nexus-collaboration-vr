# Presence + tool wiring

How the playground keeps Sample lively on a secondary display and expressive in chat.

## Priority (highest wins)

1. Conversation performance — compact `[nod,2s,wave]` tags, or `character_run_sequence` / `character_play_gesture` / emotion (starts with spoken reply; trailing tags play after TTS)
2. Ambient one-shots — `IdlePresenceDirector` micro / medium / long tiers (mood-gated)
3. Base idle VRMA loop — `idle.vrma` (AIRI)
4. Continuous face — blink + idle eye saccades (always; saccades off while speaking)
5. Pointer over the 3D canvas — eyes + body follow the cursor (toggle on the viewport HUD)

Soft-cancel ambient on `beginSpeechBeat`; resume after `endSpeechBeat` (re-applies mood face). Pointer follow pauses while speaking (watch the camera) and while an explicit `character_look_at` / `[look:x,y,z]` is active.

## Moods (LLM-steerable ambient)

| Mood | Ambient flavor |
|------|----------------|
| `neutral` | Default calm fidgets |
| `relaxed` | Slower; rests sooner |
| `happy` / `playful` / `excited` | More nods/waves/surprises |
| `curious` / `focused` | Look-around / think |
| `tired` / `sad` | Low energy; earlier crouch |

Tools (immediate, not deferred with speech):

- `character_list_moods` — catalog + current mood + routine gesture pools
- `character_set_mood` — switch mood (face + fidget pools + long-idle scale)
- `character_list_clothes` — native slots grouped by category (tops / bottoms / shoes / onepiece / accessory)
- `character_set_clothes` — `none` (hide), `default` (all slots), several ids (`tops+shoes` or `ids[]`), or overlay URL (adds that VRM's clothes on top of native slots)

Do not drive ambient clips with `play_gesture`; set mood instead.

## Face catalogue (per loaded VRM)

`character_list_expressions` returns the live blendshape list. It is **not** a fixed Sample preset table:

| Model | Typical emotions | Notes |
|-------|------------------|--------|
| Sample / Blue or Green | VRM1 `happy angry sad relaxed surprised neutral` + visemes/blinks | No look blendshapes |
| Optional Face | VRM0 `Joy Fun Sorrow Angry Neutral Surprised` (+ A/I/U/E/O, Blink*) | three-vrm may remap some to VRM1 names after load |
| Sample (pixiv) | Full VRM1 including `lookUp/Down/Left/Right` | |

Prefer `set_emotion` / `[wave|angry=30]` for performance faces. Scores are 0–100 percent (or 0–1). The blender eases emotion channels (~220ms in, ~480ms back); binary shapes snap. Visemes stay owned by lip-sync; blink stays owned by BlinkController.

`[mood:playful]` sets the **rest face** for that mood. After a spoken beat (`endSpeechBeat`) the face eases back to that rest — not a hard cut to `neutral=1`. Chained `[nod|happy=40, wave|surprised=25]` does **not** restore between steps.

Motion debug **Face catalogue** shows grouped chips + sliders from the loaded model.

## Gaze

| Mode | When | Motion |
|------|------|--------|
| Idle | No pointer, no explicit look | Blink + saccades + small glances; wider glance after a one-shot gesture |
| Pointer | Cursor anywhere in the browser, **Mouse look** on | Head tracks within a configurable cone (default ~±20°), mapped against the 3D canvas (off-canvas = cone edge). **Eyes** use a wider cone (default ~±70°) so the iris can glance past the face. After **5s** with no mouse motion, eyes ease back to the camera (head stays until the pointer leaves the window). Spine look uses VRM `lookAt.faceFront` so VRM0 models (Hoodie, Optional Face) match VRM1 (Sample) up/down. Tune cones in the viewport gear overlay |
| Body follow | **Body follows camera** in the gear overlay (default **off**) | Orbit/tilt yaws the hips toward the viewer. Shared across agents in `localStorage`. Speech lock and `look-at` with turn still yaw the body |
| Click ack | **Nod on click** (per agent, default on) | Primary clicks on the page play a short gesture (default `nod`) without intercepting the click. Orbit/drags, buttons, dialogs, and **Motion debug** are ignored. Motion + speed live in the same gear overlay and persist on the agent pane |
| Zoom ack | **Gestures on zoom** (per agent, default on) | Wheel on the 3D canvas only. Zoom in plays `v_sign`; zoom out plays `wave`. Pickers live next to nod-on-click in the gear overlay |
| Speech | `beginSpeechBeat` … `endSpeechBeat` | Watch the camera (pointer paused) |
| `character_look_at` / `[look:x,y,z]` | Tool or tag | Face a world point; `turn` (default true) yaws the body. `holdMs` releases. `[look:clear]` / `null` returns to idle/pointer |

Toggle: viewport HUD **Mouse look** (`pointerLook`). Gear **Body follows camera** (`bodyFollowCamera`, default off). Both persist in playground settings for every agent.

## Clip catalog

See [`../apps/playground/public/assets/vrma/manifest.json`](../apps/playground/public/assets/vrma/manifest.json) and [`LICENSE-ASSETS.md`](../apps/playground/public/assets/vrma/LICENSE-ASSETS.md).

| Id | Role |
|----|------|
| `idle` | Base loop |
| `talk` | Speaking body |
| `wave`, `think`, `sad`, `surprised`, `nod`, `agree`, `disagree` | Conversation |
| `sit`, `sit_wave` | Long idle rest (chair sit) |
| `crouch_idle` | Procedural knee crouch (not sit) |
| `weight_shift`, `look_around`, `nod`, `wave`, `stretch` | Logical ids with random variants |
| `airplane`, `v_sign`, `sport`, `sleepy`, … | Extra catalogue clips |

## LLM rules

- Prefer compact `[nod]` / `[wave|angry=30]` / `[mood:playful]` tags; `character_*` tools for complex sequences
- Face scores 0–100 from the live catalog; prefer 20–50 while talking
- `character_list_moods` / `character_set_mood` for ambient rest face + fidgets
- Fish TTS annotations (`[happy]`, `[break]`) stay in the spoken string when voice is on; 3D face uses `[happy=30]`
- Performance tools deferred until spoken reply (or next tool round); trailing `[]` tags run after TTS

## Debug

Presence logs: `[idle-presence] beat { tier, gesture, mood }`.

```ts
// App.vue — faster long-rest demos
new AnimationDirector(null, { presence: { longIdleMs: 60_000, mood: 'tired' } })
```
