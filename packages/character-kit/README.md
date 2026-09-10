# @openclaw/character-kit

Three.js + three-vrm controller: moods, VRMA / procedural gestures, locomotion, scene occupancy, and OpenAI `character_*` tool schemas.

**Library usage (APIs, Vite, React canvas, LLM tools):** [../../docs/library-in-your-ui.md](../../docs/library-in-your-ui.md).

Used by:

- oc-controller frontend (`file:` dependency)
- the Vue playground in `apps/playground`

```bash
pnpm --filter @openclaw/character-kit test
```

Import:

```ts
import { CompanionHost, SceneRoom, CHARACTER_SKILL, parseInlineTags } from '@openclaw/character-kit'
```

Skill text for agent workspaces: [skill/SKILL.md](skill/SKILL.md).
