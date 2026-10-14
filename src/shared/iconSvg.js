/**
 * Preparing an imported SVG as an icon (PRD §16.4): made safe (§14.7), its view box read, and the app finds out whether
 * it has ONE colour (then it can follow the colour of the text around it) or several (then it keeps them).
 *
 * A single-colour icon is stored with every colour replaced by `currentColor` and `fill="currentColor"` on the root, so a
 * `color` set where the icon is drawn recolours it. A multi-colour icon is stored as it came, apart from the clean-up.
 */
import { sanitizeSvg } from './svgSafety.js'

export const MAX_ICON_SVG_BYTES = 2 * 1024 * 1024

const IGNORED = new Set(['none', 'transparent', 'inherit', 'currentcolor', ''])

const normaliseColour = c => {
  const v = String(c).trim().toLowerCase()
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : v
}

/**
 * @param {string} text the SVG source
 * @returns {{ svg: string, viewBox: number[], single: boolean, aspect: number, colors: string[] } | { error: 'notSvg'|'noSize'|'tooBig' }}
 */
export function normalizeIconSvg(text) {
  const source = String(text ?? '')
  if (Buffer.byteLength(source) > MAX_ICON_SVG_BYTES) return { error: 'tooBig' }
  let svg = sanitizeSvg(source)
  const open = /<svg\b([^>]*)>/i.exec(svg)
  const close = svg.lastIndexOf('</svg')
  if (!open || close < open.index) return { error: 'notSvg' }
  const attrs = open[1]
  const attr = name => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)?.slice(1).find(v => v !== undefined)

  let viewBox = null
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) viewBox = vb
  else {
    const w = parseFloat(attr('width')), h = parseFloat(attr('height'))
    if (w > 0 && h > 0) viewBox = [0, 0, w, h]
  }
  if (!viewBox) return { error: 'noSize' }

  let inner = svg.slice(open.index + open[0].length, close)
  inner = inner.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, '')
  const hasStyleBlock = /<style[\s>]/i.test(inner)

  // The colours the icon uses, from attributes and from style declarations
  const colors = new Set()
  let multi = hasStyleBlock
  const note = value => {
    const v = String(value).trim()
    if (/url\(/i.test(v)) { multi = true; return }
    if (!IGNORED.has(v.toLowerCase())) colors.add(normaliseColour(v))
  }
  for (const m of inner.matchAll(/\b(?:fill|stroke|stop-color)\s*=\s*"([^"]*)"/gi)) note(m[1])
  for (const m of inner.matchAll(/\b(?:fill|stroke|stop-color)\s*:\s*([^;"']+)/gi)) note(m[1])
  if (/<(linearGradient|radialGradient|pattern|image)\b/i.test(inner)) multi = true
  const single = !multi && colors.size <= 1

  if (single) {
    const toCurrent = (_, name, value) => (IGNORED.has(value.trim().toLowerCase()) ? _ : `${name}="currentColor"`)
    inner = inner.replace(/\b(fill|stroke)\s*=\s*"([^"]*)"/gi, (m, name, value) => toCurrent(m, name, value))
    inner = inner.replace(/\b(fill|stroke)\s*:\s*([^;"']+)/gi, (m, name, value) => (IGNORED.has(value.trim().toLowerCase()) ? m : `${name}:currentColor`))
  }
  // A single-colour icon keeps its own colour as the root `color`: drawn as it is, it looks as it did; drawn with another
  // `color` (to follow the text), it takes that one.
  const own = colors.size ? [...colors][0] : '#000000'
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}"${single ? ` fill="currentColor" color="${own}"` : ''}>${inner.trim()}</svg>`
  return { svg: out, viewBox, single, aspect: viewBox[2] / viewBox[3], colors: [...colors] }
}

/** The inner markup and view box of a stored icon SVG, for drawing it nested in a card. */
export function iconSvgParts(stored) {
  const open = /<svg\b([^>]*)>/i.exec(stored)
  if (!open) return null
  const vb = /viewBox\s*=\s*"([^"]*)"/i.exec(open[1])?.[1].trim().split(/[\s,]+/).map(Number)
  if (!vb || vb.length !== 4 || !vb.every(Number.isFinite)) return null
  const close = stored.lastIndexOf('</svg')
  return { viewBox: vb, inner: stored.slice(open.index + open[0].length, close), single: /\sfill="currentColor"/.test(open[1]), ownColor: /\scolor="([^"]*)"/.exec(open[1])?.[1] ?? null }
}
