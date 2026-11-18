# @nexus/cluster-editor-react

React binding over `@nexus/cluster-editor-core`.

**Status: state binding + summary.** The editing rules and undo/redo are
implemented and tested; the 3D view is a later binding over the same model and
the same reducer.

## Why the logic is a reducer

The editing rules — add, move, remove, paint, undo, redo — live in a pure
reducer, not in the hook. That keeps them testable without a DOM, and lets a host
that already has a store (Redux, Zustand, a Vue app) reuse them directly.

```ts
import { clusterEditorReducer, initialEditorState } from '@nexus/cluster-editor-react';

let state = initialEditorState(model);
state = clusterEditorReducer(state, { type: 'addAsset', asset });
state = clusterEditorReducer(state, { type: 'undo' });
```

Every mutation goes through `diffClusterModel`, so undo is exact and the history
is a list of patches rather than full model snapshots. History is capped at
`MAX_HISTORY` (100).

## The hook

```tsx
import { useClusterEditor, ClusterSummary } from '@nexus/cluster-editor-react';
import type { ClusterModel } from '@nexus/cluster-editor-core';

function Editor({ initial }: { initial: ClusterModel }) {
  const { model, canUndo, canRedo, undo, redo } = useClusterEditor(initial);
  return (
    <>
      <ClusterSummary model={model} />
      <button disabled={!canUndo} onClick={undo}>Undo</button>
      <button disabled={!canRedo} onClick={redo}>Redo</button>
    </>
  );
}
```

## Actions

| Action | Effect |
| --- | --- |
| `replace` | Swap the whole model (a load or a remote update). |
| `addAsset` | Add or replace an asset by id. |
| `updateAsset` | Merge changes into an existing asset. |
| `removeAsset` | Remove an asset. |
| `addMaterial` | Add or replace a material. |
| `paintSurface` | Add or replace a surface (floor, wall) with its material. |
| `undo` / `redo` | Walk the patch history. |

## Tests

```sh
pnpm --filter @nexus/cluster-editor-react test
```

16 tests: reducer behaviour (add/update/remove/paint/material/replace, undo, redo,
history cap, no-op actions) and the summary render.
