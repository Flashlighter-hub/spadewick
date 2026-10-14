/**
 * The settings of a production export (PRD §17.3), checked and completed. Everything the dialog can send goes through here, so the
 * engine and a saved setting can rely on what they find.
 */
import { tr } from '../../shared/i18n.js'

export const STANDARDS = ['x4', 'x1a', 'plain']
export const INTENTS = ['relative', 'perceptual', 'saturation', 'absolute']
export const BACK_LAYOUTS = ['separate', 'after', 'interleaved', 'once']
export const DIE_MODES = ['none', 'spot', 'layer', 'both']

export const DEFAULTS = Object.freeze({
  standard: 'x4',
  colour: 'cmyk',                 // 'cmyk' | 'rgb' (keep RGB: PDF/X-4 only)
  profileId: 'bundled:crpc1',
  intent: 'relative',
  blackPoint: true,
  dpi: 300,
  bleedMm: 3,
  safeMm: 3,
  cropMarks: false,
  registrationMarks: false,
  marksMarginMm: 10,
  backLayout: 'separate',
  cardBack: 'template',           // 'template' (each card's back, else the plain colour) | 'color' | 'asset' | 'none' (no backs)
  cardBackColor: '#1a1a2e',
  cardBackAssetId: undefined,
  dieLine: 'none',
  dieSpotName: 'DieCut',
  dieRadiusMm: 3.175,
  inkLimit: 300,                  // percent, or null for none
  usePrintColors: true,
  imageCompression: 'lossless',   // 'lossless' | 'jpeg' (PRD §17.3)
  jpegQuality: 90,
  repeatCopies: false,
  title: undefined
})

const num = (v, min, max, label) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(tr('errors.productionSetting', { setting: label }))
  return n
}
const oneOf = (v, list, label) => {
  if (!list.includes(v)) throw new Error(tr('errors.productionSetting', { setting: label }))
  return v
}

/** @returns the settings with every value checked and every missing one defaulted; throws a message naming the setting that is wrong */
export function normalizeProduction(opts = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) }
  const out = { ...o }
  out.standard = oneOf(o.standard, STANDARDS, 'standard')
  out.colour = oneOf(o.colour, ['cmyk', 'rgb'], 'colour')
  if (out.colour === 'rgb' && out.standard !== 'x4' && out.standard !== 'plain') throw new Error(tr('errors.productionRgbNeedsX4'))
  out.intent = oneOf(o.intent, INTENTS, 'intent')
  out.blackPoint = !!o.blackPoint
  out.dpi = Math.round(num(o.dpi, 72, 1200, 'dpi'))
  out.bleedMm = num(o.bleedMm, 0, 20, 'bleed')
  out.safeMm = num(o.safeMm, 0, 20, 'safe area')
  out.cropMarks = !!o.cropMarks
  out.registrationMarks = !!o.registrationMarks
  out.marksMarginMm = num(o.marksMarginMm, 3, 30, 'marks margin')
  out.backLayout = oneOf(o.backLayout, BACK_LAYOUTS, 'fronts and backs')
  out.cardBack = oneOf(o.cardBack, ['template', 'color', 'asset', 'none'], 'card back')
  out.dieLine = oneOf(o.dieLine, DIE_MODES, 'die line')
  out.dieSpotName = String(o.dieSpotName ?? 'DieCut').trim()
  if (!out.dieSpotName || out.dieSpotName.length > 40 || /[()\\]/.test(out.dieSpotName)) throw new Error(tr('errors.productionSetting', { setting: 'die line name' }))
  out.dieRadiusMm = num(o.dieRadiusMm, 0, 15, 'corner radius')
  out.inkLimit = o.inkLimit === null || o.inkLimit === '' || o.inkLimit === 0 ? null : num(o.inkLimit, 100, 400, 'ink limit')
  out.usePrintColors = !!o.usePrintColors
  out.imageCompression = oneOf(o.imageCompression, ['lossless', 'jpeg'], 'image compression')
  out.jpegQuality = Math.round(num(o.jpegQuality, 50, 100, 'JPEG quality'))
  out.repeatCopies = !!o.repeatCopies
  if (!/^#[0-9a-f]{6}$/i.test(String(out.cardBackColor ?? ''))) out.cardBackColor = DEFAULTS.cardBackColor
  return out
}

/** Whether the file carries marks or a die line in the margin (the page is then larger than the bleed box). */
export const hasMarks = s => s.cropMarks || s.registrationMarks

/** What the file's document information says about the standard: never a claim of conformance (PRD §17.3, R4). */
export function standardLabel(standard) {
  return standard === 'x1a' ? 'PDF/X-1a-style, unvalidated' : standard === 'x4' ? 'PDF/X-4-style, unvalidated' : 'CMYK PDF, no standard claimed'
}
