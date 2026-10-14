/**
 * The properties of a text style (PRD §16.5): font, weight, slant, size, colour, spacing and effects, bundled under a name.
 * Pure: the services check what is stored with it, the engine reads what comes out, and the dialog shows it.
 *
 *   fontFamily     a font family name
 *   bold, italic, underline, strike, smallCaps   true
 *   size           a multiple of the surrounding text (1 = the same)
 *   color          a hex colour
 *   tracking       letter spacing in thousandths of an em
 *   outlineWidth   em, outlineColor  a hex colour: an outline drawn behind the text
 *   shadowX, shadowY  em, shadowColor  a hex colour: a hard shadow
 */
import { isHexColor } from './richText.js'

const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null }
const SAFE_FONT = /^[^<>"'&{}\\\n]{1,60}$/

const RULES = {
  fontFamily: v => (typeof v === 'string' && SAFE_FONT.test(v.trim()) ? v.trim() : null),
  bold: v => (v === true ? true : null),
  italic: v => (v === true ? true : null),
  underline: v => (v === true ? true : null),
  strike: v => (v === true ? true : null),
  smallCaps: v => (v === true ? true : null),
  size: v => num(v, 0.1, 5),
  color: v => (typeof v === 'string' && isHexColor(v) ? v : null),
  tracking: v => num(v, -100, 500),
  outlineWidth: v => num(v, 0, 0.3),
  outlineColor: v => (typeof v === 'string' && isHexColor(v) ? v : null),
  shadowX: v => num(v, -1, 1),
  shadowY: v => num(v, -1, 1),
  shadowColor: v => (typeof v === 'string' && isHexColor(v) ? v : null)
}

export const STYLE_KEYS = Object.keys(RULES)

/**
 * @param {object} input what a person (or a file) supplied
 * @returns {{ props: object, rejected: string[] }} the valid properties, and the names of those that were refused
 *   (a property set to null, undefined, false or an empty string is simply left out)
 */
export function normalizeStyleProps(input) {
  const props = {}, rejected = []
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!(key in RULES)) { rejected.push(key); continue }
    if (value === null || value === undefined || value === false || value === '') continue
    const ok = RULES[key](value)
    if (ok === null) rejected.push(key); else props[key] = ok
  }
  return { props, rejected }
}

/** Several styles, outermost first, merged: a later style overrides an earlier one, and switches (bold…) add up. */
export function mergeStyles(list) {
  const out = {}
  for (const p of list) for (const [k, v] of Object.entries(p ?? {})) out[k] = v
  return out
}
