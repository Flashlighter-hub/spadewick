/**
 * Card ID patterns (PRD §5.8). Pure functions, shared by the main process (which generates IDs)
 * and the Card IDs dialog (which previews them).
 *
 * A pattern is literal text plus the tokens {set}, {n}, {n:4} (zero-padded) and {author}.
 */
export const DEFAULT_PATTERN = '{set}-{n:4}'
export const RESERVED_FIELD = 'card_id'
export const AUTHOR_LENGTH = 2

const TOKEN = /\{(set|n|author)(?::(\d+))?\}/g

/** Split a pattern into literal and token parts, or return { error } (a key of the `cardIds.pattern*` strings). */
export function parsePattern(pattern) {
  const text = String(pattern ?? '')
  if (!text.trim()) return { error: 'patternEmpty' }
  const parts = []
  let last = 0, hasN = false
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ literal: text.slice(last, m.index) })
    if (m[2] !== undefined && m[1] !== 'n') return { error: 'patternBadPadding' }
    const pad = m[2] === undefined ? 0 : Number(m[2])
    if (pad > 12) return { error: 'patternBadPadding' }
    if (m[1] === 'n') hasN = true
    parts.push({ token: m[1], pad })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ literal: text.slice(last) })
  const leftover = parts.filter(p => p.literal !== undefined).map(p => p.literal).join('')
  if (/[{}]/.test(leftover)) return { error: 'patternUnknownToken' }
  if (!hasN) return { error: 'patternNeedsNumber' }
  if (/[\\/:*?"<>|\x00-\x1f]/.test(leftover)) return { error: 'patternBadCharacter' }
  return { parts }
}

/** Render a pattern to an ID. `values` = { set, n, author }. Assumes the pattern is valid. */
export function formatCardId(pattern, { set = '', n = 1, author = '' } = {}) {
  const { parts } = parsePattern(pattern)
  if (!parts) return ''
  return parts.map(p => {
    if (p.literal !== undefined) return p.literal
    if (p.token === 'set') return set
    if (p.token === 'author') return author
    return String(n).padStart(p.pad, '0')
  }).join('')
}

/** A regular expression whose first group is the number, for finding the highest number in use. */
export function patternRegex(pattern) {
  const { parts } = parsePattern(pattern)
  if (!parts) return null
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const src = parts.map(p => {
    if (p.literal !== undefined) return esc(p.literal)
    if (p.token === 'set') return '[A-Za-z0-9]{2,6}'
    if (p.token === 'author') return `[A-Za-z0-9]{${AUTHOR_LENGTH}}`
    return '(\\d+)'
  }).join('')
  return new RegExp(`^${src}$`)
}

/** Set codes are 2–6 letters or digits, upper case. */
export function normalizeSetCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const isValidSetCode = code => /^[A-Z0-9]{2,6}$/.test(String(code ?? ''))

/** "Fire Creatures" → FIRE. `taken` is a Set of codes already used; a number is added to avoid a clash. */
export function deriveSetCode(name, taken = new Set()) {
  const words = String(name ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  let base = (words[0] ?? '').slice(0, 4)
  if (base.length < 2) base = words.map(w => w[0]).join('').slice(0, 4)
  if (base.length < 2) base = (base + 'SET').slice(0, 3)
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i)
    const candidate = base.slice(0, 6 - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
  return base
}

/** Same rules as slugs: a card_id column must never become an ordinary field. */
export function isReservedFieldName(nameOrSlug) {
  const slug = String(nameOrSlug ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return slug === RESERVED_FIELD
}

const AUTHOR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function randomAuthorCode(random = Math.random) {
  let out = ''
  for (let i = 0; i < AUTHOR_LENGTH; i++) out += AUTHOR_ALPHABET[Math.floor(random() * AUTHOR_ALPHABET.length)]
  return out
}
