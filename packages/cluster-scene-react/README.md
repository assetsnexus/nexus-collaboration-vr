# @nexus/cluster-scene-react

React widgets for ANX cluster rooms: searchable cluster list, 3D room viewer (`SceneRoomCanvas` + `@nexus/scene-client`), agent invite form, and a small app shell.

Host apps wire region commands:

- `listClusters` → `anx.cluster.list`
- `inviteParticipant` / `addRoomParticipant` → existing room invite path
- `sceneClient` or factory with rooms socket + join ticket

Peer dependency `@nexus/scene-client` is also bundled via `file:` to `anx-npm-modules/packages/scene-client` for monorepo dev; published apps should depend on `@nexus/scene-client` explicitly.

No 2D editor, schematic, play toolbelt, WebXR, or camera beamer — viewport + list only.
