---
name: object
description: Spawn and animate editable 3D props (object_*) in a shared SceneGraph host.
---

# object skill

Canonical OpenAI function prefix: **`object_`**.

Install: copy this folder to `workspace/skills/object/`. Prefer sync from [nexus-collaboration-vr `skills/`](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills).

```ts
import { OBJECT_SKILL } from '@nexus/objects-kit'
const tools = OBJECT_SKILL.allTools()
```

## Tools

| Tool | When |
|------|------|
| `object_list_catalog` | Built-in prop ids (desk, crate, …) |
| `object_spawn` | Place a catalog / glTF / primitive prop |
| `object_write` | Update pose / label / metadata |
| `object_set_color` | Recolor |
| `object_play_effect` | Glow / pulse / load billboard effects |
| `object_stop_effect` | Stop an effect |
| `object_define_effect` | Register a custom effect |
| `object_remove` | Delete an entity |

Floor placement: desks sit on `y=0`; spheres rest at `y=radius`. Browse first with `scene_overview` / `scene_list_objects`.

Related: [scene](../scene/SKILL.md), [robot](../robot/SKILL.md).
