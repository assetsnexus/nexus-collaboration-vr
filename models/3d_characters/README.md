# Staging inbox

Paste VRM / VRM-in-GLB files here only temporarily.

The playground serves avatars from:

`services/dev-vrm/apps/playground/public/assets/vrm/`

A `.glb` is usable **only if** it contains VRM glTF extras (`VRM` or `VRMC_vrm`). Those are renamed to `.vrm` and moved into `public/assets/vrm/`, then listed in `apps/playground/src/lib/storage.ts` (`VRM_CATALOG`).
