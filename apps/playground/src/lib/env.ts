/** Vite env boolean. Unset → defaultValue. */
export function envFlag(name: keyof ImportMetaEnv, defaultValue: boolean): boolean {
  const v = import.meta.env[name]
  if (v === undefined || v === '') return defaultValue
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase())
}
