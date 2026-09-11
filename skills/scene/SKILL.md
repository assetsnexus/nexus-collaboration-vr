---
name: scene
description: Shared 3D scene graph browse/move/glow tools (scene_*) for OpenClaw/Hermes when a SceneGraph host is attached.
---

# scene skill

Canonical OpenAI function prefix: **`scene_`**.

Install: copy this folder to `workspace/skills/scene/`. Prefer sync from [nexus-collaboration-vr `skills/`](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills).

```ts
import { SCENE_SKILL } from '@nexus/scene-kit'
const tools = SCENE_SKILL.allTools()
```

## Tools

| Tool | When |
|------|------|
| `scene_overview` | Compact digest before inventing geometry |
| `scene_query` | Filter entities |
| `scene_list_objects` | List places/props (`query`, `kind`, `tag`, `ids`, `limit`) |
| `scene_get_object` | One entity by id |
| `scene_move_object` | Move props/robots (not avatars) |
| `scene_glow_object` | Highlight an entity |

Coords: meters, ground plane XZ. Spawn/edit meshes with **`object_*`**; machines with **`robot_*`**.

Related: [character](../character/SKILL.md), [object](../object/SKILL.md), [robot](../robot/SKILL.md).
