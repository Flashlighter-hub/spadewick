/**
 * What the field types mean, in one place (UPDATES U23): which are worked out rather than typed, how a Choice or Tags field keeps its
 * allowed values, how a Lookup names what it pulls, and the card status lists (UPDATES U26).
 *
 * The settings of a field live in its `validation` column as JSON: { min, max, regex, required } for any type, { options } for a Choice
 * or Tags field, { from, set, match, show } for a Lookup. A Tags value is stored as its tags joined by ", ".
 */

/** The settings of a field: its `validation` column read as JSON (a broken value reads as no settings). */
export function parseRules(validation) {
  if (!validation) return {}
  if (typeof validation === 'object') return validation
  try { return JSON.parse(validation) } catch { return {} }
}

export const FIELD_TYPES = ['text', 'number', 'boolean', 'image_ref', 'color', 'formula', 'rich_text', 'choice', 'tags', 'lookup']

/** Types whose value is worked out from other data and never stored in the card. */
export const isComputed = type => type === 'formula' || type === 'lookup'

/** Types that hold one of a list of allowed values. */
export const hasOptions = type => type === 'choice' || type === 'tags'

/** The allowed values of a Choice or Tags field, as the person wrote them (empty when the list is not set). */
export function optionsOf(field) {
  const list = parseRules(field?.validation).options
  return Array.isArray(list) ? list.map(String).filter(o => o.trim() !== '') : []
}

/** The settings of a Lookup field: the field of this card that holds the key, the set it looks in, the column matched, the column shown. */
export function lookupOf(field) {
  const r = parseRules(field?.validation)
  return { from: String(r.from ?? ''), set: String(r.set ?? ''), match: String(r.match ?? ''), show: String(r.show ?? '') }
}

/** The tags in a stored Tags value, in the order written, each once. */
export function splitTags(text) {
  const seen = new Set()
  const out = []
  for (const part of String(text ?? '').split(/[,;\n]/)) {
    const tag = part.trim()
    if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); out.push(tag) }
  }
  return out
}

export const joinTags = list => list.join(', ')

/** The allowed value that `value` was most likely meant to be ("Suport" for "Support"), or null when none is close. */
export function closestOption(value, options) {
  const v = String(value).trim().toLowerCase()
  let best = null, bestDistance = Infinity
  for (const option of options) {
    const d = editDistance(v, option.toLowerCase())
    if (d < bestDistance) { best = option; bestDistance = d }
  }
  return best !== null && bestDistance <= Math.max(1, Math.min(3, Math.floor(v.length / 3))) ? best : null
}

function editDistance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]
}

/** The card status values, in the order a card moves through them (UPDATES U26). */
export const STATUSES = ['idea', 'draft', 'playtest', 'final']
export const ART_STATUSES = ['needs_art', 'draft', 'final']

/** `status_mode` of a set: 0 none, 1 status, 2 status and art status. */
export const STATUS_MODES = [0, 1, 2]

export const validStatus = v => v === null || v === '' || STATUSES.includes(v)
export const validArtStatus = v => v === null || v === '' || ART_STATUSES.includes(v)
