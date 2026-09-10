# Demo assets

## VRM

Runtime avatars live in `apps/playground/public/assets/vrm/` (the Vite public folder). Files are **not** committed (see `.gitignore`). Fetch the pixiv sample or drop your own `.vrm`:

```bash
mkdir -p apps/playground/public/assets/vrm
curl -L -o apps/playground/public/assets/vrm/sample.vrm \
  "https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm"
```

Optional extra filenames the catalog will pick up if present: `optional-face`, `blue-or-green`, `cat-ear`, `hoodie`, `tori`, and other entries listed in `apps/playground/src/lib/storage.ts`.

`.glb` files that contain a `VRM` / `VRMC_vrm` glTF extension **are** VRM — rename to `.vrm`. Plain GLB without that extension will not load as a companion.

Community catalogs (check licenses): see the [package README](../README.md#where-to-get-vrm-models).

## Clothes

Playground native clothes are checkboxes grouped by slot (Tops / Bottoms / Shoes / Onepiece / Accessory) discovered from VRoid materials and mesh names after load.

## VRMA gestures

Runtime pack under `apps/playground/public/assets/vrma/` — see `manifest.json` and `LICENSE-ASSETS.md`.
