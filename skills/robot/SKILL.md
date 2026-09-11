---
name: robot
description: Place thin robot/machine entities (robot_*) with glTF + joint poses in a SceneGraph host.
---

# robot skill

Canonical OpenAI function prefix: **`robot_`**.

Install: copy this folder to `workspace/skills/robot/`. Prefer sync from [nexus-collaboration-vr `skills/`](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills).

```ts
import { ROBOT_SKILL } from '@nexus/robots-kit'
const tools = ROBOT_SKILL.allTools()
```

## Tools

| Tool | When |
|------|------|
| `robot_spawn` | Place a machine (catalog / glTF URL) |
| `robot_set_joints` | Set joint angles |
| `robot_play` | Play a named motion clip if defined |

No live URDF/ROS drivers in these kits — presentation only. Industrial drivers live on AssetsNexus.

Related: [scene](../scene/SKILL.md), [object](../object/SKILL.md).
