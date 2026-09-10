# Staging inbox

Paste VRM / VRM-in-GLB files here only temporarily, or keep private files in [`../../local/meshes/`](../../local/README.md) (gitignored).

The playground serves avatars from:

`services/dev-vrm/apps/playground/public/assets/vrm/`

A `.glb` is usable **only if** it contains VRM glTF extras (`VRM` or `VRMC_vrm`). Those are renamed to `.vrm` and moved into `public/assets/vrm/`, then listed in `apps/playground/src/lib/storage.ts` (`VRM_CATALOG`).
