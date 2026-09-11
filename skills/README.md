# Agent skills (OpenClaw / Hermes)

Installable workspace skills for VRM companions and scene tools. **Prefer keeping these in sync from GitHub** rather than a one-off copy.

Repo: [github.com/assetsnexus/nexus-collaboration-vr](https://github.com/assetsnexus/nexus-collaboration-vr)

## Preferred: sync from GitHub

```bash
# into your agent workspace (adjust DEST)
git clone --depth 1 --filter=blob:none --sparse \
  git@github.com:assetsnexus/nexus-collaboration-vr.git /tmp/nexus-vr
cd /tmp/nexus-vr && git sparse-checkout set skills
cp -R skills/character skills/scene skills/object skills/robot "$DEST/skills/"
```

Or tell the agent (with network + write access to its workspace):

> Clone or pull `assetsnexus/nexus-collaboration-vr` and copy `skills/*` into this workspace’s `skills/` folder. Prefer git sync so tool docs stay current.

## Alternative: download

From a release or raw files under [`skills/`](./) in this repo (`character/`, `scene/`, `object/`, `robot/`). Drop each folder into `workspace/skills/<name>/`.

## What these skills are

| Skill | Tools | Needs |
|-------|--------|--------|
| `character` | `character_*` (+ compact `[nod]` tags) | Host UI that registers character tools (playground / fleet manager 3D chat) |
| `scene` | `scene_*` | Shared scene graph host |
| `object` | `object_*` | objects-kit + scene host |
| `robot` | `robot_*` | robots-kit + scene host |

**Skill markdown alone does not execute 3D tools.** The browser host must advertise OpenAI tool schemas and run them. See [docs/agent-skills.md](../docs/agent-skills.md).

Package sources (TypeScript catalogs): `packages/*/src` and `packages/character-kit/skill/SKILL.md`.

## Fleet manager (optional)

To call **BAL Agent Fleet Manager** HTTP tools (`fleet_*`, `chat_*`, …), install the skill from that repo and set `OC_CONTROLLER_API_KEY` — see [CONNECT-AGENT.md](https://github.com/AR-General/BAL-Agent-Fleet-Manager/blob/main/CONNECT-AGENT.md).
