export type ExternalSourcesMode = 'off' | 'allowlist' | 'open'

export type UrlPolicy = {
  externalSources: ExternalSourcesMode
  /** Hostnames allowed when mode is allowlist (lowercase, no port). */
  allowHosts: string[]
  /** Same-origin always allowed when a page origin is provided. */
  pageOrigin?: string
}

export const DEFAULT_URL_POLICY: UrlPolicy = {
  externalSources: 'allowlist',
  allowHosts: [],
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Block obvious SSRF targets. */
function isBlockedHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return true
  if (/^127\./.test(host)) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  if (host === 'metadata.google.internal') return true
  return false
}

export function assertUrlAllowed(url: string, policy: UrlPolicy): { ok: true } | { ok: false; reason: string } {
  const trimmed = url.trim()
  if (!trimmed) return { ok: false, reason: 'empty url' }
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return { ok: true }
  }
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return { ok: true }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed, policy.pageOrigin || 'http://localhost')
  } catch {
    return { ok: false, reason: 'invalid url' }
  }

  if (policy.pageOrigin) {
    try {
      if (new URL(policy.pageOrigin).origin === parsed.origin) return { ok: true }
    } catch {
      /* ignore */
    }
  }

  if (policy.externalSources === 'off') {
    return { ok: false, reason: 'external sources disabled' }
  }

  const host = parsed.hostname.toLowerCase()
  if (isBlockedHost(host)) {
    return { ok: false, reason: `blocked host: ${host}` }
  }

  if (policy.externalSources === 'open') return { ok: true }

  const allow = new Set(policy.allowHosts.map((h) => h.toLowerCase()))
  if (allow.has(host)) return { ok: true }
  return { ok: false, reason: `host not in allowlist: ${host}` }
}

export function parseAllowHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}
