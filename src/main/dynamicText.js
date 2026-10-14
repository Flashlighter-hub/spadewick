/**
 * Dynamic text rendering — PRD §7.4
 *
 * A <text> element with `data-spadewick-field` is filled from that field and laid out inside its
 * `width` × `height` box: words wrap to the box width, explicit newlines in the value start a new
 * line, and the fit mode decides what happens when the text is too tall.
 *
 * Without a box (no `width`) the value is rendered on a single line (newlines become line breaks).
 * With a box, `y` is the TOP of the box and the first baseline sits one ascent below it.
 *
 * Text is measured with a per-character width estimate (the rasterizer has no measuring API), so
 * wrapping is approximate. Fonts with unusual proportions may need a slightly larger box.
 */

const ASCENT = 0.85           // baseline offset from the top of a line, as a fraction of font size
const DEFAULT_LINE_HEIGHT = 1.2

const NARROW = new Set("iIl1.,:;'|!`")
const WIDE = new Set('mwMW@%')

/** Estimated advance width of one character in em. */
function charEm(ch) {
  if (ch === ' ') return 0.28
  if (NARROW.has(ch)) return 0.3
  if (WIDE.has(ch)) return 0.85
  if (ch >= 'A' && ch <= 'Z') return 0.66
  if (ch >= '0' && ch <= '9') return 0.56
  return 0.52
}

export function measureWidth(text, fontSize, bold = false) {
  let em = 0
  for (const ch of text) em += charEm(ch)
  return em * fontSize * (bold ? 1.08 : 1)
}

/** Break `text` into lines no wider than `maxWidth` (Infinity = no wrapping). */
export function wrapLines(text, maxWidth, fontSize, bold = false) {
  const lines = []
  for (const paragraph of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!Number.isFinite(maxWidth)) { lines.push(paragraph); continue }
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word
      if (measureWidth(candidate, fontSize, bold) <= maxWidth) { line = candidate; continue }
      if (line) lines.push(line)
      // A single word wider than the box is broken by characters
      let rest = word
      while (measureWidth(rest, fontSize, bold) > maxWidth && rest.length > 1) {
        let n = rest.length - 1
        while (n > 1 && measureWidth(rest.slice(0, n), fontSize, bold) > maxWidth) n--
        lines.push(rest.slice(0, n)); rest = rest.slice(n)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

function truncateLine(line, maxWidth, fontSize, bold) {
  if (measureWidth(line, fontSize, bold) <= maxWidth) return line
  let s = line.trimEnd()
  while (s.length > 0 && measureWidth(`${s}…`, fontSize, bold) > maxWidth) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/**
 * Lay out `value` for the given options.
 * @returns {{ lines: string[], fontSize: number, overflow: string }}
 */
export function layoutText(value, { boxWidth, boxHeight, fit, fontSize, maxSize, minSize, lineHeight, bold }) {
  const widthLimit = boxWidth ?? Infinity
  const maxLines = size => (boxHeight ? Math.max(1, Math.floor(boxHeight / (size * lineHeight) + 1e-6)) : Infinity)
  const wrapAt = size => wrapLines(value, widthLimit, size, bold)

  switch (fit) {
    case 'shrink': {
      let size = maxSize
      let lines = wrapAt(size)
      while (size > minSize && lines.length > maxLines(size)) { size -= 1; lines = wrapAt(size) }
      return { lines, fontSize: size, overflow: '' }
    }
    case 'truncate': {
      const lines = wrapAt(fontSize)
      const cap = maxLines(fontSize)
      if (lines.length <= cap) return { lines, fontSize, overflow: '' }
      const kept = lines.slice(0, cap)
      kept[cap - 1] = truncateLine(`${kept[cap - 1]} ${lines[cap]}`, widthLimit, fontSize, bold)
      return { lines: kept, fontSize, overflow: '' }
    }
    case 'overflow': {
      const lines = wrapAt(fontSize)
      const cap = maxLines(fontSize)
      return { lines: lines.slice(0, cap), fontSize, overflow: lines.slice(cap).join(' ').trim() }
    }
    default: // 'wrap', 'clip' and unspecified: show everything (clip is applied by the template's clipPath)
      return { lines: wrapAt(fontSize), fontSize, overflow: '' }
  }
}

// ---------------------------------------------------------------------------
// SVG rewriting
// ---------------------------------------------------------------------------

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const xmlEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function getAttr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${escapeRegex(name)}="([^"]*)"`, 'i'))
  return m ? m[1] : null
}

function setAttr(attrs, name, value) {
  const pattern = new RegExp(`(^|\\s)${escapeRegex(name)}="[^"]*"`, 'i')
  return pattern.test(attrs) ? attrs.replace(pattern, `$1${name}="${value}"`) : `${attrs} ${name}="${value}"`
}

const DYNAMIC_ATTRS = [
  'data-spadewick-field', 'data-spadewick-text-fit', 'data-spadewick-text-max-size',
  'data-spadewick-text-min-size', 'data-spadewick-overflow-target', 'data-spadewick-line-height'
]

export function applyDynamicText(svg, fields) {
  // Matches both <text …>…</text> and self-closing <text … />
  return svg.replace(/<text\b([^>]*?)(\/>|>([\s\S]*?)<\/text>)/g, (full, rawAttrs) => {
    const attrs = rawAttrs.replace(/\/\s*$/, '')
    const slug = getAttr(attrs, 'data-spadewick-field')
    if (!slug) return full

    const value = String(fields[slug] ?? '')
    const fit = (getAttr(attrs, 'data-spadewick-text-fit') ?? 'wrap').toLowerCase()
    const sizeAttr = Number(getAttr(attrs, 'font-size'))
    const maxSize = Number(getAttr(attrs, 'data-spadewick-text-max-size')) || sizeAttr || 14
    const minSize = Number(getAttr(attrs, 'data-spadewick-text-min-size')) || 7
    const fontSize = sizeAttr || maxSize
    const lineHeight = Number(getAttr(attrs, 'data-spadewick-line-height')) || DEFAULT_LINE_HEIGHT
    const boxWidth = Number(getAttr(attrs, 'width')) || undefined
    const boxHeight = Number(getAttr(attrs, 'height')) || undefined
    const overflowId = getAttr(attrs, 'data-spadewick-overflow-target')
    const bold = /bold|[6-9]00/.test(getAttr(attrs, 'font-weight') ?? '')
    const anchor = getAttr(attrs, 'text-anchor') ?? 'start'

    const layout = layoutText(value, { boxWidth, boxHeight, fit, fontSize, maxSize, minSize, lineHeight, bold })

    // Strip the data attributes so the final SVG is clean
    let clean = attrs
    for (const a of DYNAMIC_ATTRS) clean = clean.replace(new RegExp(`\\s+${a}="[^"]*"`, 'g'), '')
    clean = setAttr(clean, 'font-size', String(layout.fontSize))

    // Position lines: with a box, (x, y) is its top-left corner; otherwise y is the first baseline
    const x = Number(getAttr(attrs, 'x')) || 0
    const y = Number(getAttr(attrs, 'y')) || 0
    const lineX = boxWidth ? x + (anchor === 'middle' ? boxWidth / 2 : anchor === 'end' ? boxWidth : 0) : x
    const firstBaseline = boxWidth || boxHeight ? y + layout.fontSize * ASCENT : y
    const step = layout.fontSize * lineHeight

    const r = n => Math.round(n * 100) / 100
    const tspans = layout.lines
      .map((line, i) => `<tspan x="${r(lineX)}" y="${r(firstBaseline + i * step)}">${xmlEscape(line)}</tspan>`)
      .join('')
    clean = clean.replace(/\s+(x|y)="[^"]*"/g, '') // x/y now live on the tspans

    let out = `<text${clean}>${tspans}</text>`
    if (overflowId && layout.overflow) {
      out += `<!-- spadewick:overflow-content id="${xmlEscape(overflowId)}" -->${xmlEscape(layout.overflow)}<!-- spadewick:overflow-end -->`
    }
    return out
  })
}
