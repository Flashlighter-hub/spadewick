/**
 * The minimums the print preflight checks against (PRD §17.7). One set per project for now; manufacturer presets (§18) will
 * override them. Kept in the project (`project_meta`), so they travel with it.
 */
import { tr } from '../../shared/i18n.js'

export const MINIMUM_DEFAULTS = Object.freeze({
  textPt: 6,            // text smaller than this is a warning
  reversedTextPt: 8,    // the same for light text that is reversed out of a dark area
  strokePt: 0.25,       // strokes thinner than this may not print
  ppiWarn: 300,         // a picture below this resolution at its placed size is a warning
  ppiError: 150,        // and below this an error
  smallBlackPt: 12,     // black text up to this size should be pure black ink (100 % K)
  requireDieLine: false // a manufacturer that needs a die line (set by presets, §18)
})

const RANGES = { textPt: [1, 40], reversedTextPt: [1, 40], strokePt: [0.01, 5], ppiWarn: [50, 1200], ppiError: [20, 1200], smallBlackPt: [1, 60] }

/** The minimums with defaults for what is missing; a value out of its range is refused with the name of the setting. */
export function normalizeMinimums(input = {}) {
  const out = { ...MINIMUM_DEFAULTS }
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue
    const n = Number(input[key])
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(tr('errors.preflightSetting', { setting: key }))
    out[key] = n
  }
  if (out.ppiError > out.ppiWarn) throw new Error(tr('errors.preflightSetting', { setting: 'ppiError' }))
  out.requireDieLine = !!input.requireDieLine
  return out
}
