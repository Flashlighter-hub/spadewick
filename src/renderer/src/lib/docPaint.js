/**
 * Gradients, shadows, blur, blend mode and the colours a template uses (A80): how the canvas editor writes and reads them in the SVG.
 * Each element gets definitions of its own (`grad_<id>`, `fx_<id>`), so changing one never changes another. Same rules as docEdit.js:
 * a DOM document in, changed in place, one call is one step of undo, and only standard node traversal is used.
 */
import { NS, childElements, descendants, urlRef, findByPlainId, ensureDefs } from './docEdit.js'

const ID = 'data-spadewick-id'
const round = v => Math.round(v * 100) / 100

/** `#abc`, `#aabbcc` or `#aabbccdd` as `#aabbcc` (lower case), or null for anything else (a name, a token, a url). */
export function normalizeHex(value) {
  const t = String(value ?? '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(t)) return t
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  if (/^#[0-9a-f]{8}$/.test(t)) return t.slice(0, 7)
  return null
}

/** Is another element still using this definition? */
function stillUsed(doc, id, except) {
  for (const el of descendants(doc.documentElement)) {
    if (el === except) continue
    for (const a of ['fill', 'stroke', 'filter']) if (urlRef(el.getAttribute(a)) === id) return true
  }
  return false
}

/** Remove one of our own definitions when nothing points to it any more. */
function dropDefinition(doc, id, except) {
  if (!id || !/^(grad|fx)_/.test(id) || stillUsed(doc, id, except)) return
  const node = findByPlainId(doc, id)
  node?.parentNode?.removeChild(node)
}

const percent = v => {
  const s = String(v ?? '0').trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.min(100, Math.max(0, s.endsWith('%') ? n : n * 100)) * 10) / 10
}

/** The gradient an element is filled with: { type: 'linear' | 'radial', angle, stops: [{ offset (0 to 100), color, opacity (0 to 1) }], complex } or null. */
export function readGradient(doc, el) {
  const id = urlRef(el.getAttribute('fill'))
  const g = id && findByPlainId(doc, id)
  if (!g || (g.localName !== 'linearGradient' && g.localName !== 'radialGradient')) return null
  const stops = childElements(g).filter(c => c.localName === 'stop').map(s => ({
    offset: percent(s.getAttribute('offset')),
    color: normalizeHex(s.getAttribute('stop-color')) ?? '#000000',
    opacity: s.hasAttribute('stop-opacity') ? Math.min(1, Math.max(0, parseFloat(s.getAttribute('stop-opacity')) || 0)) : 1
  }))
  const type = g.localName === 'radialGradient' ? 'radial' : 'linear'
  const n = a => parseFloat(g.getAttribute(a))
  const dx = (Number.isFinite(n('x2')) ? n('x2') : 1) - (Number.isFinite(n('x1')) ? n('x1') : 0)
  const dy = (Number.isFinite(n('y2')) ? n('y2') : 0) - (Number.isFinite(n('y1')) ? n('y1') : 0)
  const angle = type === 'linear' ? Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360) : 0
  // A gradient made elsewhere (in user space, transformed, or inherited) is shown, and replaced by a simple one when edited
  const complex = g.getAttribute('gradientUnits') === 'userSpaceOnUse' || g.hasAttribute('gradientTransform') || g.hasAttribute('href') || g.hasAttribute('xlink:href')
  return { type, angle, stops, complex }
}

/** Fill an element with a gradient of its own, or, with null, let go of the gradient (the caller then sets a colour). */
export function writeGradient(doc, el, g) {
  const own = `grad_${el.getAttribute(ID) || 'x'}`
  const old = urlRef(el.getAttribute('fill'))
  if (!g) { if (old) dropDefinition(doc, old, el); return }
  const pc = v => Math.round(Math.min(100, Math.max(0, Number(v) || 0)) * 10) / 10     // a stop's position as given: already a percentage
  const stops = g.stops.map(s => ({ offset: pc(s.offset), color: normalizeHex(s.color) ?? '#000000', opacity: s.opacity ?? 1 })).sort((p, q) => p.offset - q.offset)
  const gone = findByPlainId(doc, own)
  gone?.parentNode?.removeChild(gone)
  const node = doc.createElementNS(NS, g.type === 'radial' ? 'radialGradient' : 'linearGradient')
  node.setAttribute('id', own)
  if (g.type === 'radial') { node.setAttribute('cx', '0.5'); node.setAttribute('cy', '0.5'); node.setAttribute('r', '0.5') }
  else {
    const t = ((Number(g.angle) || 0) * Math.PI) / 180
    const f = v => String(Math.round(v * 1000) / 1000)
    node.setAttribute('x1', f(0.5 - Math.cos(t) / 2)); node.setAttribute('y1', f(0.5 - Math.sin(t) / 2))
    node.setAttribute('x2', f(0.5 + Math.cos(t) / 2)); node.setAttribute('y2', f(0.5 + Math.sin(t) / 2))
  }
  for (const s of stops) {
    const stop = doc.createElementNS(NS, 'stop')
    stop.setAttribute('offset', `${s.offset}%`)
    stop.setAttribute('stop-color', s.color)
    if (s.opacity < 1) stop.setAttribute('stop-opacity', String(round(s.opacity)))
    node.appendChild(stop)
  }
  ensureDefs(doc).appendChild(node)
  el.setAttribute('fill', `url(#${own})`)
  if (old && old !== own) dropDefinition(doc, old, el)
}

/** The shadow and blur an element has: { shadow: { dx, dy, blur, color, opacity } | null, blur, foreign } (foreign: a filter this editor did not make). */
export function readEffects(doc, el) {
  const id = urlRef(el.getAttribute('filter'))
  if (!id) return { shadow: null, blur: 0, foreign: false }
  const f = findByPlainId(doc, id)
  if (!f || f.localName !== 'filter') return { shadow: null, blur: 0, foreign: true }
  const parts = childElements(f)
  const blurEl = parts.find(c => c.localName === 'feGaussianBlur')
  const shadowEl = parts.find(c => c.localName === 'feDropShadow')
  const foreign = parts.some(c => c.localName !== 'feGaussianBlur' && c.localName !== 'feDropShadow')
  const num = (e, a, d = 0) => { const v = parseFloat(e.getAttribute(a)); return Number.isFinite(v) ? v : d }
  return {
    blur: blurEl ? num(blurEl, 'stdDeviation') : 0,
    shadow: shadowEl ? { dx: num(shadowEl, 'dx', 2), dy: num(shadowEl, 'dy', 2), blur: num(shadowEl, 'stdDeviation', 2), color: normalizeHex(shadowEl.getAttribute('flood-color')) ?? '#000000', opacity: num(shadowEl, 'flood-opacity', 1) } : null,
    foreign
  }
}

/** Give an element a shadow and/or a blur through a filter of its own; with neither, take the filter away. */
export function writeEffects(doc, el, fx) {
  const own = `fx_${el.getAttribute(ID) || 'x'}`
  const old = urlRef(el.getAttribute('filter'))
  const blur = Math.max(0, Number(fx?.blur) || 0)
  const sh = fx?.shadow
  const gone = findByPlainId(doc, own)
  gone?.parentNode?.removeChild(gone)
  if (!blur && !sh) {
    el.removeAttribute('filter')
    if (old && old !== own) dropDefinition(doc, old, el)
    return
  }
  const f = doc.createElementNS(NS, 'filter')
  f.setAttribute('id', own)
  for (const [a, v] of [['x', '-50%'], ['y', '-50%'], ['width', '200%'], ['height', '200%']]) f.setAttribute(a, v)
  if (blur) {
    const b = doc.createElementNS(NS, 'feGaussianBlur')
    b.setAttribute('in', 'SourceGraphic'); b.setAttribute('stdDeviation', String(round(blur)))
    if (sh) b.setAttribute('result', 'blurred')
    f.appendChild(b)
  }
  if (sh) {
    const d = doc.createElementNS(NS, 'feDropShadow')
    if (blur) d.setAttribute('in', 'blurred')
    d.setAttribute('dx', String(round(Number(sh.dx) || 0))); d.setAttribute('dy', String(round(Number(sh.dy) || 0)))
    d.setAttribute('stdDeviation', String(round(Math.max(0, Number(sh.blur) || 0))))
    d.setAttribute('flood-color', normalizeHex(sh.color) ?? '#000000')
    d.setAttribute('flood-opacity', String(round(Math.min(1, Math.max(0, sh.opacity ?? 0.5)))))
    f.appendChild(d)
  }
  ensureDefs(doc).appendChild(f)
  el.setAttribute('filter', `url(#${own})`)
  if (old && old !== own) dropDefinition(doc, old, el)
}

/** One property of an element's `style`, or ''. */
export function getStyleProp(el, name) {
  for (const part of String(el.getAttribute('style') || '').split(';')) {
    const i = part.indexOf(':')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

/** Set (or, for an empty value, remove) one property of an element's `style`, keeping the others. */
export function setStyleProp(el, name, value) {
  const kept = String(el.getAttribute('style') || '').split(';').map(p => p.trim()).filter(p => p && p.slice(0, p.indexOf(':')).trim() !== name)
  if (value) kept.push(`${name}:${value}`)
  if (kept.length) el.setAttribute('style', kept.join(';')); else el.removeAttribute('style')
}

/** The colours a template already uses, in the order they first appear (hex only, `#rrggbb`), so they can be offered again. */
export function documentColours(doc, limit = 18) {
  const out = []
  const seen = new Set()
  for (const el of descendants(doc.documentElement)) {
    for (const a of ['fill', 'stroke', 'stop-color', 'flood-color']) {
      const hex = normalizeHex(el.getAttribute(a))
      if (hex && !seen.has(hex)) { seen.add(hex); out.push(hex) }
    }
  }
  return out.slice(0, limit)
}
