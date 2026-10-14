/**
 * Lengths, transforms and bounding boxes for the SVG import (PRD §19): enough geometry to place a text box or an image
 * where a design had its rectangle, to highlight an element in the review and to crop a thumbnail of it.
 */
import { elementsOf, textOf } from './xml.js'

// ---------------------------------------------------------------------------
// Lengths
// ---------------------------------------------------------------------------

const MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 }
const PX_MM = 25.4 / 96

/** `"12.5mm"` -> { value: 12.5, unit: 'mm' }; no unit means user units ('' ); a percentage is kept as '%'. */
export function parseLength(text) {
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|mm|cm|in|pt|pc|q|%|em|ex)?\s*$/i.exec(String(text ?? ''))
  return m ? { value: Number(m[1]), unit: (m[2] ?? '').toLowerCase() } : null
}

/** Millimetres of a length with a physical unit (px counts as 1/96 in, as in CSS); null for user units, %, em. */
export function lengthToMm(len, userUnitMm = null) {
  if (!len) return null
  if (MM[len.unit] !== undefined) return len.value * MM[len.unit]
  if (len.unit === 'px') return len.value * PX_MM
  if (len.unit === '' && userUnitMm) return len.value * userUnitMm
  return null
}

export const num = (v, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback }

// ---------------------------------------------------------------------------
// Transforms: [a b c d e f] as in SVG
// ---------------------------------------------------------------------------

export const IDENTITY = [1, 0, 0, 1, 0, 0]

export const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
]

export const applyPoint = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function parseTransform(text) {
  let m = IDENTITY
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let t
  while ((t = re.exec(String(text ?? '')))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number)
    if (a.some(n => !Number.isFinite(n))) continue
    let n = null
    switch (t[1]) {
      case 'matrix': if (a.length === 6) n = a; break
      case 'translate': n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break
      case 'scale': n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break
      case 'rotate': {
        const r = (a[0] ?? 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
        n = [c, s, -s, c, 0, 0]
        if (a.length === 3) n = multiply(multiply([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]])
        break
      }
      case 'skewX': n = [1, 0, Math.tan((a[0] ?? 0) * Math.PI / 180), 1, 0, 0]; break
      case 'skewY': n = [1, Math.tan((a[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0]; break
    }
    if (n) m = multiply(m, n)
  }
  return m
}

/** Whether a matrix only moves and scales (no rotation or skew): a box stays a box. */
export const isAxisAligned = m => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9

// ---------------------------------------------------------------------------
// Bounding boxes: [minX, minY, maxX, maxY] or null
// ---------------------------------------------------------------------------

const grow = (b, x, y) => { if (!b) return [x, y, x, y]; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); return b }
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])

/** Points along an SVG path (curves by their control points and an arc by samples), for a bounding box. */
function pathPoints(d) {
  const pts = []
  const tokens = String(d ?? '').match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g) ?? []
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0
  const read = () => Number(tokens[i++])
  const hasNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])
  const push = (px, py) => pts.push([px, py])
  let guard = 0
  while (i < tokens.length && guard++ < 200000) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++]
    else if (!cmd) break
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    if (C === 'Z') { x = sx; y = sy; continue }
    if (!hasNum()) continue
    if (C === 'M' || C === 'L' || C === 'T') {
      const nx = read() + (rel ? x : 0), ny = read() + (rel ? y : 0)
      x = nx; y = ny; push(x, y)
      if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L' }
    } else if (C === 'H') { x = read() + (rel ? x : 0); push(x, y) }
    else if (C === 'V') { y = read() + (rel ? y : 0); push(x, y) }
    else if (C === 'C') {
      for (let k = 0; k < 3; k++) { push(read() + (rel ? x : 0), read() + (rel ? y : 0)) }
      const last = pts[pts.length - 1]; x = last[0]; y = last[1]
    } else if (C === 'S' || C === 'Q') {
      for (let k = 0; k < 2; k++) { push(read() + (rel ? x : 0), read() + (rel ? y : 0)) }
      const last = pts[pts.length - 1]; x = last[0]; y = last[1]
    } else if (C === 'A') {
      const rx = Math.abs(read()), ry = Math.abs(read()), rot = read(), large = read(), sweep = read()
      const nx = read() + (rel ? x : 0), ny = read() + (rel ? y : 0)
      for (const p of arcSamples(x, y, rx, ry, rot, large, sweep, nx, ny)) push(p[0], p[1])
      x = nx; y = ny; push(x, y)
    } else break
  }
  return pts
}

function arcSamples(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return []
  const phi = rotDeg * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = c * dx + s * dy, y1p = -s * dx + c * dy
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const out = []
  for (let k = 1; k < 16; k++) {
    const t = t1 + dt * k / 16
    out.push([c * rx * Math.cos(t) - s * ry * Math.sin(t) + cx, s * rx * Math.cos(t) + c * ry * Math.sin(t) + cy])
  }
  return out
}

/** Own geometry of one element, before its transform: a box [x0, y0, x1, y1] list of points, or null. */
function ownPoints(el) {
  const a = el.attrs
  switch (el.tag) {
    case 'rect': case 'image': case 'use': {
      const w = num(a.width), h = num(a.height)
      if (el.tag === 'use' || !(w > 0 || h > 0)) return null
      const x = num(a.x), y = num(a.y)
      return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    }
    case 'circle': { const r = num(a.r), x = num(a.cx), y = num(a.cy); return r > 0 ? [[x - r, y - r], [x + r, y + r]] : null }
    case 'ellipse': { const rx = num(a.rx), ry = num(a.ry), x = num(a.cx), y = num(a.cy); return rx > 0 && ry > 0 ? [[x - rx, y - ry], [x + rx, y + ry]] : null }
    case 'line': return [[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]]
    case 'polygon': case 'polyline': {
      const n = String(a.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite)
      const pts = []
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]])
      return pts.length ? pts : null
    }
    case 'path': { const p = pathPoints(a.d); return p.length ? p : null }
    default: return null
  }
}

/**
 * The box of an element in the coordinates of the root (all transforms from `parentMatrix` down are applied). Text has no
 * geometry that can be measured here, so it is estimated from its font size and length.
 */
export function elementBox(el, parentMatrix = IDENTITY, textLength = () => 0) {
  const m = el.attrs.transform ? multiply(parentMatrix, parseTransform(el.attrs.transform)) : parentMatrix
  let box = null
  const pts = ownPoints(el)
  if (pts) for (const [x, y] of pts) { const [px, py] = applyPoint(m, x, y); box = grow(box, px, py) }
  if (el.tag === 'text') {
    const size = num(el.attrs['font-size'], 16)
    const lines = elementsOf(el).filter(c => c.tag === 'tspan')
    for (const line of lines.length ? lines : [el]) {
      const x = num(line.attrs.x ?? el.attrs.x), y = num(line.attrs.y ?? el.attrs.y)
      const w = textOf(line).length * size * 0.55
      const anchor = el.attrs['text-anchor'] ?? line.attrs['text-anchor']
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
      for (const [px, py] of [[x0, y - size * 0.85], [x0 + w, y + size * 0.25]]) { const [qx, qy] = applyPoint(m, px, py); box = grow(box, qx, qy) }
    }
  }
  if (!['defs', 'symbol', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'style', 'text'].includes(el.tag)) {
    for (const c of elementsOf(el)) box = union(box, elementBox(c, m, textLength))
  }
  return box
}

/** `[x, y, w, h]` from a corner box. */
export const toRect = b => (b ? [b[0], b[1], b[2] - b[0], b[3] - b[1]] : null)
