# @nexus/character-kit

Three.js + three-vrm controller: moods, VRMA / procedural gestures, locomotion, scene occupancy, and OpenAI `character_*` tool schemas.

**Library usage:** [../../docs/library-in-your-ui.md](../../docs/library-in-your-ui.md). License: [MIT](../../LICENSE).

Free MIT library. Example host: [BAL Agent Fleet Manager](https://github.com/AR-General/BAL-Agent-Fleet-Manager). Utilizing platform: [AssetsNexus.org](https://assetsnexus.org). Kits repo: [nexus-collaboration-vr](https://github.com/assetsnexus/nexus-collaboration-vr).

```bash
pnpm --filter @nexus/character-kit test
```

Import:

```ts
import { CompanionHost, SceneRoom, CHARACTER_SKILL, parseInlineTags } from '@nexus/character-kit'
```

Skill text for agent workspaces: [skill/SKILL.md](skill/SKILL.md).
