# Local data (not committed)

Everything in this folder except this README is gitignored.

Use it for private meshes, VRoid source files, and custom prompts. Point the playground at a mesh by copying a `.vrm` into `apps/playground/public/assets/vrm/` (also gitignored) or set `VITE_SYSTEM_PROMPT` in `.env.local`.

| Path | Purpose |
|------|---------|
| `meshes/` | Private `.vrm` / `.vroid` (do not put these under `docs/`) |
| `.env.local` next to the playground | API keys (`VITE_LLM_API_KEY`, `VITE_OPENROUTER_API_KEY`, `VITE_SYSTEM_PROMPT`) |

Runtime catalog still reads from `apps/playground/public/assets/vrm/` (see `VRM_CATALOG` in `apps/playground/src/lib/storage.ts`).
