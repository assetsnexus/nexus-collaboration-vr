# Changelog

## 0.2.0 (unreleased)

### character-kit

- Exported `DEFAULT_SAMPLE_VRM` from `@nexus/character-kit` (same URL previously private to `SceneRoom`) so portal play mode and other hosts can resolve the default avatar without forking the string.
- No behavior change for `SceneRoom` — it now imports the shared constant.
