# Third-party animation assets

Files under `apps/playground/public/assets/vrma/` (excluding `test.vrma`).

| File | Source | License |
|------|--------|---------|
| `idle.vrma` | [moeru-ai/airi](https://github.com/moeru-ai/airi) `idle_loop.vrma` | MIT |
| `wave.vrma`, `wave_left.vrma`, `wave_both.vrma` | [Kiu-Q/hikari-archive](https://github.com/Kiu-Q/hikari-archive) | MIT |
| `stretch.vrma`, `sport.vrma`, `v_sign.vrma`, `airplane.vrma` | hikari-archive idle_* | MIT |
| `v_sign_short` (derived clip) | same `v_sign.vrma`, hold compressed to ~⅓ length | MIT |
| `sit.vrma`, `sit_wave.vrma`, `stand_up.vrma`, `look_around_turn.vrma` | hikari-archive sit / sitWave / standUp / turnAround | MIT |
| `think.vrma`, `sad.vrma`, `look_around.vrma`, `surprised.vrma`, `sleepy.vrma`, `angry.vrma`, `blush.vrma`, `clap.vrma`, `relax_pose.vrma`, `look_around_sleepy.vrma` | [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer) | MIT |
| `talk.vrma`, `weight_shift.vrma`, `weight_shift_sway.vrma`, `weight_shift_stand.vrma` | [Sunwood-ai-labs/GeminiVRM](https://github.com/Sunwood-ai-labs/GeminiVRM) ACCAD→VRMA | ACCAD BVH **CC BY 3.0**; [vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma) MIT |

`test.vrma` is unused (pixiv demo T-pose arm).

**Procedural** (character-kit, relative-to-rest): `nod`, `nod_soft`, `agree`, `disagree`, `scratch_nose`, `weight_shift_lean_l/r`, `crouch_idle` (true knee crouch — not chair sit), locomotion `walk` / `run` / `walk_careful` / `walk_crouch` / `walk_crawl` / `walk_roll`, `jump`. Override clip ids per model via `manifest.locomotion`.

Logical ids with random variants: `weight_shift`, `look_around`, `nod`, `wave`, `stretch`, `sit`.

## Avatar mesh

Drop a `.vrm` into `apps/playground/public/assets/vrm/` (see the playground README). The pixiv three-vrm sample is the default. Do not commit private character meshes.
