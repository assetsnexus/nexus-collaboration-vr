# Agent skills for OpenClaw / Hermes

How to ship and install the VRM / scene skill packs that live under [`skills/`](../skills/).

## Two layers

1. **Workspace skill** (`SKILL.md`) — teaches the agent *when* and *how* to call tools.
2. **Host tools** — your UI (playground, [BAL Agent Fleet Manager](https://github.com/AR-General/BAL-Agent-Fleet-Manager), or custom app) must register OpenAI tool schemas and execute them (e.g. `CHARACTER_SKILL.allTools()`).

Installing a skill without a host that implements the tools does nothing useful.

## Preferred install: GitHub sync

Keep skills current by syncing from this repo:

[https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills)

```bash
DEST=/path/to/agent/workspace
# sparse clone skills only, then:
cp -R skills/character skills/scene skills/object skills/robot "$DEST/skills/"
```

Tell the agent (once it can write its workspace and reach GitHub):

> Sync `skills/` from `assetsnexus/nexus-collaboration-vr` into this workspace. Prefer git pull over a stale download.

## Alternative: one-shot download

Copy folders from a release zip or raw `SKILL.md` files. Fine for demos; prefer git for production agents.

## Packs in this repo

| Folder | Prefix | Package |
|--------|--------|---------|
| `skills/character/` | `character_` | `@nexus/character-kit` |
| `skills/scene/` | `scene_` | `@nexus/scene-kit` |
| `skills/object/` | `object_` | `@nexus/objects-kit` |
| `skills/robot/` | `robot_` | `@nexus/robots-kit` |

Canonical character prose also lives at `packages/character-kit/skill/SKILL.md` (keep in sync with `skills/character/`).

## Fleet / controller tools (separate)

Calling HTTP tools on a private fleet cockpit (`fleet_*`, `room_*`, …) is documented in that product’s **Connect Agent** guide — not here. Kits skills do not replace an `OC_CONTROLLER_API_KEY`.

## Programmatic use

```ts
import { CHARACTER_SKILL } from '@nexus/character-kit'
import { SCENE_SKILL } from '@nexus/scene-kit'
import { OBJECT_SKILL } from '@nexus/objects-kit'
import { ROBOT_SKILL } from '@nexus/robots-kit'

const tools = [
  ...CHARACTER_SKILL.allTools(),
  ...SCENE_SKILL.allTools(),
  ...OBJECT_SKILL.allTools(),
  ...ROBOT_SKILL.allTools(),
]
```
