/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_API_KEY?: string
  readonly VITE_OPENROUTER_API_KEY?: string
  readonly VITE_OPENROUTER_BASE_URL?: string
  readonly VITE_INLINE_CHARACTER_TAGS?: string
  readonly VITE_DEBUG_CHARACTER_TAGS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
