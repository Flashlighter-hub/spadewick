/**
 * Manufacturer presets (PRD §18): a saved bundle of what a manufacturer asks for. This is the format, its checks and the arithmetic
 * that goes with it; the shipped presets are in `src/main/presets/shipped.js` and the user's own in the application's library folder.
 *
 * A value the manufacturer's guide did not state (or that was not read in full) is listed in `verify` and left at a safe default;
 * the interface shows it, so nothing is guessed silently (PRD §18.3).
 */

export const PRESET_FORMAT = 1
export const KINDS = ['pdf', 'images', 'both']
export const COLOURS = ['cmyk', 'rgb', 'either']
export const STANDARDS = ['x4', 'x1a', 'plain']
export const BACK_LAYOUTS = ['separate', 'after', 'interleaved', 'once']
export const DIE_MODES = ['none', 'spot', 'layer', 'both']
export const IMAGE_FORMATS = ['png', 'jpeg']
export const STALE_DAYS = 365

/** Preset fields whose values can be listed in `verify` (not confirmed with the manufacturer's guide). */
export const VERIFIABLE = ['bleed', 'safe', 'dpi', 'colour', 'profile', 'standard', 'die', 'deck', 'sizes', 'pixels']

const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

/**
 * @param {object} p a preset
 * @returns {string[]} what is wrong with it (empty when it is valid): messages for developers and for the import dialog
 */
export function validatePreset(p) {
  const e = []
  if (!p || typeof p !== 'object') return ['not an object']
  if (p.format !== PRESET_FORMAT) e.push('format')
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.id)) e.push('id')
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) e.push('name')
  if (typeof p.manufacturer !== 'string' || p.manufacturer.length > 80) e.push('manufacturer')
  if (p.guideUrl != null && (typeof p.guideUrl !== 'string' || !/^https?:\/\//.test(p.guideUrl))) e.push('guideUrl')
  if (!isDate(p.checkedOn)) e.push('checkedOn')
  if (typeof p.proofTested !== 'boolean') e.push('proofTested')
  if (!KINDS.includes(p.kind)) e.push('kind')
  if (p.sizes != null && (!Array.isArray(p.sizes) || p.sizes.some(s => typeof s !== 'string'))) e.push('sizes')
  if (!isNum(p.bleedMm, 0, 20)) e.push('bleedMm')
  if (!isNum(p.safeMm, 0, 20)) e.push('safeMm')
  if (!isNum(p.dpi, 72, 1200)) e.push('dpi')
  if (!COLOURS.includes(p.colour)) e.push('colour')
  if (p.profileHint != null && typeof p.profileHint !== 'string') e.push('profileHint')
  if (!STANDARDS.includes(p.standard)) e.push('standard')
  if (!BACK_LAYOUTS.includes(p.backLayout)) e.push('backLayout')
  if (!p.die || !DIE_MODES.includes(p.die.mode) || !isNum(p.die.radiusMm, 0, 15)) e.push('die')
  if (p.rules != null && (typeof p.rules !== 'object' || (p.rules.inkLimit != null && !isNum(p.rules.inkLimit, 100, 400)))) e.push('rules')
  if (p.minimums != null && typeof p.minimums !== 'object') e.push('minimums')
  if (p.deck != null) {
    const d = p.deck
    if (typeof d !== 'object' || [d.min, d.max, d.multiple].some(v => v != null && !(Number.isInteger(v) && v >= 1 && v <= 10000)) || (d.min != null && d.max != null && d.min > d.max)) e.push('deck')
  }
  if (!IMAGE_FORMATS.includes(p.imageFormat ?? 'png')) e.push('imageFormat')
  if (p.pixels != null && (!isNum(p.pixels.width, 1, 20000) || !isNum(p.pixels.height, 1, 20000) || !isNum(p.pixels.forTrimMmW, 1, 500) || !isNum(p.pixels.forTrimMmH, 1, 500))) e.push('pixels')
  if (p.pixels != null && !e.includes('bleedMm') && !e.includes('dpi')) {
    // the pixel size a manufacturer states must be what trim plus twice the bleed makes at the resolution
    const w = pixelsFor(p.pixels.forTrimMmW, p.bleedMm, p.dpi), h = pixelsFor(p.pixels.forTrimMmH, p.bleedMm, p.dpi)
    if (Math.abs(w - p.pixels.width) > 1 || Math.abs(h - p.pixels.height) > 1) e.push('pixelsMismatch')
  }
  if (!Array.isArray(p.verify) || p.verify.some(v => !VERIFIABLE.includes(v))) e.push('verify')
  if (typeof p.notes !== 'string' || p.notes.length > 1000) e.push('notes')
  return e
}

/** Pixels across a card of `trimMm` with `bleedMm` on each side at `dpi`. */
export const pixelsFor = (trimMm, bleedMm, dpi) => Math.round((trimMm + 2 * bleedMm) / 25.4 * dpi)

/** Whole days since the date the guide was read (`checkedOn`, as YYYY-MM-DD). */
export const ageDays = (checkedOn, now = new Date()) => Math.floor((now.getTime() - Date.parse(`${checkedOn}T00:00:00Z`)) / 86400000)

/** A preset older than a year is marked "re-check" (PRD §18.2). */
export const isStale = (checkedOn, now = new Date()) => ageDays(checkedOn, now) > STALE_DAYS

/** A copy with a new id and name, for the user to change; it is never the shipped one. */
export function duplicate(p, id, name) {
  return { ...structuredClone(p), id, name, shipped: false, basedOn: p.shipped === false ? (p.basedOn ?? p.id) : p.id }
}

/** What the deck-size rule says about a number of cards: nothing, or what is wrong and what would fix it (PRD §17.7). */
export function deckProblem(deck, count) {
  if (!deck) return null
  const { min, max, multiple } = deck
  if (min != null && count < min) return { problem: 'min', count, min, add: min - count }
  if (max != null && count > max) return { problem: 'max', count, max, remove: count - max }
  if (multiple != null && count % multiple !== 0) {
    const rest = count % multiple
    return { problem: 'multiple', count, multiple, add: multiple - rest, remove: rest }
  }
  return null
}
