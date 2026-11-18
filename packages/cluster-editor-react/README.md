# @nexus/cluster-editor-react

React binding over `@nexus/cluster-editor-core`.

**Status: state binding, summary and a canvas 3D view.** The editing rules and
undo/redo are implemented and tested; the view is a real projection (yaw, pitch,
height) rendered to a canvas, with no Three.js dependency.

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

## The view

`ClusterView` renders the model to a `<canvas>`: zones as filled polygons,
network segments as lines, assets as markers, with click-to-select.

The projection and the draw commands are pure, so the geometry is testable
without a canvas:

```ts
import { buildSceneCommands, projectPoint, DEFAULT_VIEW } from '@nexus/cluster-editor-react';

const commands = buildSceneCommands(model, { ...DEFAULT_VIEW, yawDeg: 45 });
```

`pitchDeg` is the tilt from top-down: `0` is a plan view (height ignored), `90`
is a side view. A host that wants WebGL can reuse `projectPoint` and
`buildSceneCommands` with its own renderer instead of the component.

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

24 tests: reducer behaviour (add/update/remove/paint/material/replace, undo, redo,
history cap, no-op actions), the summary render, and the scene (projection at
plan and side pitch, yaw rotation, draw-command order, picking, and a recording
context).
