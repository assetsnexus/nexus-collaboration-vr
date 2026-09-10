# Phase 2 — Locomotion & contact events

Status: **ground walk / turn / jump / teleport-to-object implemented** in character-kit + playground. Navmesh, contact events, and Hermes `character.arrived` injection are still later.

## Implemented (this milestone)

| Tool | Behavior |
|------|----------|
| `character_walk` | Relative `forward`/`right` meters, or `to:{x,z}`, or `objectId` (+ `side`/`distance`). Optional `speed` m/s. `gait`: `walk` \| `run` \| `careful` \| `crouch` \| `crawl` \| `roll` (clip + nominal speed). Paths that would take **>4s at walk speed** auto-upgrade to **run** (unless gait is crawl/crouch/careful/roll). |
| `character_turn` | Degrees (+right / −left) |
| `character_stop` | Cancel seek |
| `character_jump` | Hop |
| `character_teleport` | Instant; prefer `objectId` (front-to-front default, always face target) |
| `scene_list_objects` | Catalog with `query` / `kind` / `tag` / `ids` / `limit` |
| `scene_get_object` | One object by id |

Playground: virtual joystick + optional keyboard (WASD/arrows/QE/space). Stick cancels LLM seek.

After locomotion, if the avatar stands still for **60s** (not seated), body yaw eases back so they face the user/camera again.

### Gaits & model overrides

Procedural loops: `walk`, `run`, `walk_careful`, `walk_crouch`, `walk_crawl`, `walk_roll`. Stick speed picks a gait band; LLM `gait` locks the clip for that seek.

Optional in the gesture pack manifest:

```json
{
  "gestures": [{ "id": "my_run", "url": "/assets/vrma/my_run.vrma", "loop": true }],
  "locomotion": {
    "walk": "walk",
    "run": "my_run",
    "careful": "walk_careful",
    "crouch": "walk_crouch",
    "crawl": "walk_crawl",
    "roll": "walk_roll"
  }
}
```

Alias: `character_walk_to` → `character_walk`.

## Still later

1. Navmesh / obstacle AABBs / `character.blocked`
2. Emit `character.arrived` / `character.contact` into the Hermes session
3. Landmark-rich glTF scenes (beyond spawn/camera/seat + demo markers)
4. Richer VRMA locomotion packs (procedural walk/run/crouch/careful/crawl/roll fallbacks exist; override via `manifest.locomotion`)

## Proposed events (browser → Hermes) — not wired yet

```json
{
  "type": "character.contact",
  "objectId": "door_01",
  "region": "hand_r",
  "force": 0.4,
  "at": 1735689600000
}
```

Types: `character.arrived` | `character.blocked` | `character.contact` | `character.touched` | `character.gesture_end` | `character.speak_end`.

## Non-goals

- Full physics / ragdoll
- Multiplayer presence
- Server-side animation authority
