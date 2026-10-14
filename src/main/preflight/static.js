/**
 * What a template says about print, without drawing a card (PRD §17.7): the trim and safe lines in its own units, the strokes and
 * their widths in points, the pictures and where they are placed, and the elements that need transparency. The parts that depend
 * on a card's text or picture are settled per card by the engine.
 */
import { parseXml, walk } from '../svgImport/xml.js'
import { parseTransform, multiply, applyPoint, isAxisAligned, IDENTITY, num } from '../svgImport/geometry.js'
import { parseDeclarations } from '../svgImport/css.js'

const PT_PER_MM = 72 / 25.4
const SKIP = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'linearGradient', 'radialGradient', 'filter', 'marker', 'style'])

const attrOrStyle = (el, name) => {
  if (el.attrs.style) { const d = parseDeclarations(el.attrs.style); if (d[name] !== undefined) return d[name] }
  return el.attrs[name]
}
const matrixOf = ancestors => ancestors.reduce((m, a) => (a.attrs.transform ? multiply(m, parseTransform(a.attrs.transform)) : m), IDENTITY)
const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
/** An element the card never shows: hidden by an always-true condition (the guides of the starter templates) or by display. */
const hidden = el => el.attrs['data-spadewick-hide-if'] === '1' || el.attrs['data-spadewick-show-if'] === '0' || /^\s*none\s*$/i.test(attrOrStyle(el, 'display') ?? '')

/**
 * @param {string} svgSource the template
 * @param {{ mmW: number, mmH: number, bleedMm: number, bleedMode: string }} card the trim size and the bleed the canvas includes
 * @param {number} safeMm
 * @returns {{ ok: boolean, unitsPerMm: number, trim: number[], safe: number[], canvas: number[], matrices: Map<string, number[]>, strokes: object[], images: object[], transparency: object[] } | { ok: false }}
 */
export function analyzeTemplate(svgSource, card, safeMm) {
  let root
  try { root = parseXml(svgSource).root } catch { return { ok: false } }
  const vbText = String(root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  const vb = vbText.length === 4 && vbText.every(Number.isFinite) ? vbText : [0, 0, num(root.attrs.width, 500), num(root.attrs.height, 700)]
  if (!(vb[2] > 0 && vb[3] > 0)) return { ok: false }
  const included = card.bleedMode === 'included' && card.bleedMm > 0 ? card.bleedMm : 0
  const unitsPerMm = vb[2] / (card.mmW + 2 * included)
  const b = included * unitsPerMm, safe = safeMm * unitsPerMm
  const trim = [vb[0] + b, vb[1] + b, vb[0] + vb[2] - b, vb[1] + vb[3] - b]
  const out = {
    ok: true, unitsPerMm, canvas: [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]], trim,
    safe: [trim[0] + safe, trim[1] + safe, trim[2] - safe, trim[3] - safe],
    matrices: new Map(), strokes: [], images: [], transparency: []
  }
  const idOf = el => el.attrs['data-spadewick-id'] ?? el.attrs.id ?? null
  walk(root, (el, anc) => {
    if (el === root) return
    if (SKIP.has(el.tag) || hidden(el)) return false
    const id = idOf(el)
    const m0 = matrixOf(anc)
    const m = el.attrs.transform ? multiply(m0, parseTransform(el.attrs.transform)) : m0
    if (id) out.matrices.set(id, m)

    // strokes: the width on the card, in points
    const stroke = attrOrStyle(el, 'stroke')
    if (stroke && !/^\s*none\s*$/i.test(stroke) && ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'].includes(el.tag)) {
      const w = num(attrOrStyle(el, 'stroke-width'), 1)
      if (w > 0 && !/^\s*0(\.0+)?\s*$/.test(String(attrOrStyle(el, 'stroke-opacity') ?? '1'))) out.strokes.push({ id, tag: el.tag, widthPt: (w * scaleOf(m)) / unitsPerMm * PT_PER_MM })
    }

    // pictures: where they are placed (an axis-aligned placement only; a rotated one is measured by its scale)
    if (el.tag === 'image') {
      const x = num(el.attrs.x), y = num(el.attrs.y), w = num(el.attrs.width), h = num(el.attrs.height)
      if (w > 0 && h > 0) {
        const [x0, y0] = applyPoint(m, x, y), [x1, y1] = applyPoint(m, x + w, y + h)
        const s = scaleOf(m)
        out.images.push({ id, href: el.attrs.href ?? '', par: el.attrs.preserveAspectRatio ?? 'xMidYMid meet', width: w * s, height: h * s, rect: isAxisAligned(m) ? [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] : null })
      }
    }

    // anything that needs live transparency (flattened in a PDF/X-1a file, §17.7)
    const opacity = num(attrOrStyle(el, 'opacity'), 1), fillOp = num(attrOrStyle(el, 'fill-opacity'), 1), strokeOp = num(attrOrStyle(el, 'stroke-opacity'), 1)
    if (opacity < 1 || (fillOp < 1 && attrOrStyle(el, 'fill') !== 'none') || (strokeOp < 1 && stroke && stroke !== 'none')) out.transparency.push({ id, kind: 'opacity' })
    else if (attrOrStyle(el, 'mix-blend-mode') && !/^normal$/i.test(attrOrStyle(el, 'mix-blend-mode'))) out.transparency.push({ id, kind: 'blend' })
    else if (attrOrStyle(el, 'filter') && !/^none$/i.test(attrOrStyle(el, 'filter'))) out.transparency.push({ id, kind: 'filter' })
    else if (attrOrStyle(el, 'mask') && !/^none$/i.test(attrOrStyle(el, 'mask'))) out.transparency.push({ id, kind: 'mask' })
  })
  return out
}

/** Whether a text colour is pure black as the screen has it. */
export const isPureBlack = fill => /^(#0{3}|#0{6}|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(String(fill ?? '').trim())

/** Light text, the kind that is printed reversed out of a dark area. */
export function isLight(fill) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(fill ?? '').trim())
  if (!m) return /^white$/i.test(String(fill ?? '').trim())
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  const [r, g, bl] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl > 200
}
