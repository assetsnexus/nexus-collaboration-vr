/** Vite env boolean. Unset → defaultValue. */
export function envFlag(name: keyof ImportMetaEnv, defaultValue: boolean): boolean {
  const v = import.meta.env[name]
  if (v === undefined || v === '') return defaultValue
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase())
}

/** Optional override from `.env.local` — keep custom prompts out of git. */
export function envSystemPrompt(fallback: string): string {
  const v = import.meta.env.VITE_SYSTEM_PROMPT
  if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback
}
