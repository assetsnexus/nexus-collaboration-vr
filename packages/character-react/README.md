# @nexus/character-react

React wrappers around `@nexus/character-kit` — `CompanionHost`, `SceneRoom`, avatar configuration UI, and lip-sync helpers.

See [library-in-your-ui.md](../../docs/library-in-your-ui.md) for kit concepts; this package owns the React lifecycle (canvas ref, load/dispose).

```tsx
import { CompanionCanvas, AvatarStudio, useLipSyncPlayback } from '@nexus/character-react'
```

Portal and other hosts can reuse `presencePersistence.ts` helpers to read/write soft presence fields on user profiles.
