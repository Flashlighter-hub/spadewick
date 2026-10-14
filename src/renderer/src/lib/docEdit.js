/**
 * Edits of the template document that the canvas editor makes (A80): grouping, copying, moving by an offset, gradients, effects and
 * the colours a template already uses. Each function takes a DOM document and changes it in place; the editor serialises it
 * afterwards, as it does for every edit, so one call is one step of undo.
 *
 * Only standard node traversal is used (no selector engine), so the same code runs on the browser's DOM and in the unit tests.
 */

export const NS = 'http://www.w3.org/2000/svg'
const ID = 'data-spadewick-id'
const round = v => Math.round(v * 100) / 100

/** The id inside `url(#id)`, or null. */
export const urlRef = v => /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/.exec(String(v ?? '').trim())?.[1] ?? null

/** An element (a gradient, a filter) by its plain `id`. */
export function findByPlainId(doc, id) {
  for (const el of descendants(doc.documentElement)) if (el.getAttribute('id') === id) return el
  return null
}

/** The document's `<defs>`, made when it has none. */
export function ensureDefs(doc) {
  const root = doc.documentElement
  const found = childElements(root).find(e => e.localName === 'defs')
  if (found) return found
  const defs = doc.createElementNS(NS, 'defs')
  root.insertBefore(defs, root.firstChild)
  return defs
}

const list = collection => Array.from({ length: collection.length }, (_, i) => collection[i])   // a NodeList or a NamedNodeMap, in any DOM
export const childNodesOf = node => list(node.childNodes)
export const childElements = node => childNodesOf(node).filter(n => n.nodeType === 1)

export function* descendants(node) {
  for (const c of childElements(node)) { yield c; yield* descendants(c) }
}

export function findById(doc, id) {
  for (const el of descendants(doc.documentElement)) if (el.getAttribute(ID) === id) return el
  return null
}

export const idsOf = doc => new Set([...descendants(doc.documentElement)].map(e => e.getAttribute(ID)).filter(Boolean))

/** A name that is free in the document: `rect_1` becomes `rect_1_copy`, then `rect_1_copy2`... (`taken` holds names already handed out). */
export function uniqueId(doc, base, taken = new Set()) {
  const used = idsOf(doc)
  const stem = base.replace(/_copy\d*$/, '')
  let n = 1
  let name = `${stem}_copy`
  while (used.has(name) || taken.has(name)) name = `${stem}_copy${++n}`
  taken.add(name)
  return name
}

/** A free name for something new of a kind (`group_1`, `group_2`...). */
export function freshId(doc, kind) {
  const used = idsOf(doc)
  let n = 1
  while (used.has(`${kind}_${n}`)) n++
  return `${kind}_${n}`
}

/** What is not a layer: the definitions other elements use, and the parts of a text. */
const NOT_LAYERS = new Set(['defs', 'style', 'clipPath', 'mask', 'pattern', 'symbol', 'marker', 'linearGradient', 'radialGradient', 'filter', 'title', 'desc', 'metadata', 'tspan', 'stop', 'script'])
const GENERIC_NAME = /^(g|rect|path|circle|ellipse|line|polygon|polyline|text|image|use|svg|group|layer)[\s_.-]*\d*$/i
export const MAX_LAYERS = 2000

/**
 * Give every element that has no `data-spadewick-id` one, so that each is a layer of its own that can be selected, moved, resized and
 * recoloured (a design drawn elsewhere has layers only for the elements that were bound). Names come from the element's own id when it
 * is a real name, else from its kind (`path`, `path_2`...). Definitions and the parts of a text are left alone, and a document keeps at
 * most `max` layers. Changed in place.
 * @returns {{ added: number, limited: boolean }}
 */
export function layerize(doc, max = MAX_LAYERS) {
  const taken = idsOf(doc)
  let count = taken.size, added = 0, limited = false
  const slug = s => String(s).trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[^A-Za-z_]+/, '').replace(/_+$/, '') || 'element'
  const free = base => {
    let id = base, n = 1
    while (taken.has(id)) id = `${base}_${++n}`
    taken.add(id)
    return id
  }
  const visit = node => {
    for (const el of childElements(node)) {
      const tag = el.localName
      if (NOT_LAYERS.has(tag)) continue
      if (!el.getAttribute(ID)) {
        if (count >= max) { limited = true; continue }
        const own = el.getAttribute('id')
        el.setAttribute(ID, free(slug(own && !GENERIC_NAME.test(own) ? own : tag)))
        added++; count++
      }
      if (tag !== 'text') visit(el)
    }
  }
  visit(doc.documentElement)
  return { added, limited }
}

/** `ids` without the ones that sit inside another of them (moving the outer one moves those too). */
export function topLevel(doc, ids) {
  const set = new Set(ids)
  return ids.filter(id => {
    const el = findById(doc, id)
    for (let p = el?.parentNode; p && p.nodeType === 1; p = p.parentNode) if (set.has(p.getAttribute?.(ID))) return false
    return !!el
  })
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** Put the elements into one `<g>`, where the front-most of them was. Needs two or more with the same parent. */
export function groupElements(doc, ids) {
  const els = topLevel(doc, ids).map(id => findById(doc, id)).filter(Boolean)
  if (els.length < 2) return { error: 'tooFew' }
  const parent = els[0].parentNode
  if (els.some(e => e.parentNode !== parent)) return { error: 'differentParents' }
  const order = childElements(parent)
  els.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const id = freshId(doc, 'group')
  const g = doc.createElementNS(NS, 'g')
  g.setAttribute(ID, id)
  parent.insertBefore(g, els[els.length - 1].nextSibling)
  for (const el of els) g.appendChild(el)
  return { id }
}

// What a group may carry and still be taken apart without losing anything: where it is, and what its children inherit
const KEEP_ON_UNGROUP = new Set([ID, 'transform', 'fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor'])
const INHERITED = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor']

/** Take a group apart: its children take its place and keep their look and position. Refused for a group with opacity, effects or conditions. */
export function ungroupElement(doc, id) {
  const g = findById(doc, id)
  if (!g || g.localName !== 'g') return { error: 'notGroup' }
  for (const a of list(g.attributes)) if (!KEEP_ON_UNGROUP.has(a.name)) return { error: 'effects', attribute: a.name }
  const parent = g.parentNode
  const transform = g.getAttribute('transform')
  const out = []
  for (const child of childNodesOf(g)) {
    if (child.nodeType === 1) {
      if (transform) child.setAttribute('transform', `${transform} ${child.getAttribute('transform') || ''}`.trim())
      for (const name of INHERITED) if (g.hasAttribute(name) && !child.hasAttribute(name)) child.setAttribute(name, g.getAttribute(name))
      if (child.getAttribute(ID)) out.push(child.getAttribute(ID))
    }
    parent.insertBefore(child, g)
  }
  parent.removeChild(g)
  return { ids: out }
}

// ---------------------------------------------------------------------------
// Moving by an offset, copying, pasting
// ---------------------------------------------------------------------------

const SHIFT_XY = new Set(['rect', 'image', 'svg', 'use', 'foreignObject'])

/** Move an element by (dx, dy) in its parent's units: by its own coordinates when it is plain, otherwise by a translate in front of its transform. */
export function offsetElement(el, dx, dy) {
  if (!dx && !dy) return
  const tag = el.localName
  const num = n => parseFloat(el.getAttribute(n)) || 0
  const tspansPlaced = tag === 'text' && [...descendants(el)].some(t => t.hasAttribute('x') || t.hasAttribute('y'))
  if (!el.hasAttribute('transform') && (SHIFT_XY.has(tag) || (tag === 'text' && !tspansPlaced))) {
    el.setAttribute('x', String(round(num('x') + dx))); el.setAttribute('y', String(round(num('y') + dy)))
  } else if (!el.hasAttribute('transform') && (tag === 'circle' || tag === 'ellipse')) {
    el.setAttribute('cx', String(round(num('cx') + dx))); el.setAttribute('cy', String(round(num('cy') + dy)))
  } else {
    el.setAttribute('transform', `translate(${round(dx)} ${round(dy)}) ${el.getAttribute('transform') || ''}`.trim())
  }
}

/** Give every element of the copy with an id a free one (`keepFree`: one that is free already keeps its name). Returns the id of the copy itself. */
function renameCopy(doc, copy, taken, keepFree = false) {
  const used = idsOf(doc)
  const rename = el => {
    const old = el.getAttribute(ID)
    if (!old) return
    if (keepFree && !used.has(old) && !taken.has(old)) taken.add(old)
    else el.setAttribute(ID, uniqueId(doc, old, taken))
  }
  rename(copy)
  const top = copy.getAttribute(ID)
  for (const el of descendants(copy)) rename(el)
  return top
}

/** Copy elements in place, each right behind its original and moved by (dx, dy). Returns the ids of the copies. */
export function cloneElements(doc, ids, { dx = 12, dy = 12 } = {}) {
  const taken = new Set()
  const out = []
  for (const id of topLevel(doc, ids)) {
    const el = findById(doc, id)
    const copy = el.cloneNode(true)
    out.push(renameCopy(doc, copy, taken))
    el.parentNode.insertBefore(copy, el.nextSibling)
    offsetElement(copy, dx, dy)
  }
  return out
}

/** The elements as text that can be kept and pasted into any template. */
export function serializeElements(doc, ids) {
  const ser = new XMLSerializer()
  const top = topLevel(doc, ids).map(id => findById(doc, id))
  // The gradients and filters the elements point to travel with them
  const wanted = new Set()
  for (const el of top) for (const e of [el, ...descendants(el)]) for (const a of ['fill', 'stroke', 'filter']) { const id = urlRef(e.getAttribute(a)); if (id) wanted.add(id) }
  const defs = [...wanted].map(id => findByPlainId(doc, id)).filter(Boolean).map(d => ser.serializeToString(d))
  return JSON.stringify({ spadewick: 1, xml: top.map(el => ser.serializeToString(el)), defs })
}

/** Put copied elements on top of the card, moved by (dx, dy). Returns the new ids, or null when the text is not a copy of ours. */
export function pasteElements(doc, text, { dx = 12, dy = 12 } = {}) {
  let data
  try { data = JSON.parse(text) } catch { return null }
  if (!data || data.spadewick !== 1 || !Array.isArray(data.xml)) return null
  const taken = new Set()
  const out = []
  for (const defXml of data.defs ?? []) {          // definitions this document does not have yet
    const w = new DOMParser().parseFromString(`<svg xmlns="${NS}">${defXml}</svg>`, 'image/svg+xml')
    const d = childElements(w.documentElement)[0]
    if (d && d.getAttribute('id') && !findByPlainId(doc, d.getAttribute('id'))) ensureDefs(doc).appendChild(doc.importNode(d, true))
  }
  for (const xml of data.xml) {
    const wrapper = new DOMParser().parseFromString(`<svg xmlns="${NS}">${xml}</svg>`, 'image/svg+xml')
    if (wrapper.getElementsByTagName('parsererror').length) continue
    const node = childElements(wrapper.documentElement)[0]
    if (!node) continue
    const copy = doc.importNode(node, true)
    out.push(renameCopy(doc, copy, taken, true))
    doc.documentElement.appendChild(copy)
    offsetElement(copy, dx, dy)
  }
  return out
}

export function removeElements(doc, ids) {
  for (const id of topLevel(doc, ids)) { const el = findById(doc, id); el?.parentNode?.removeChild(el) }
}
