/** Minimal scene graph surface for joint fan-out (full type: `@nexus/scene-kit`). */
export type SceneGraphRef = {
  get(id: string): { spec?: object } | null | undefined
}
