/**
 * Components in the template document (PRD §7.10): how a component of the library is put into a template, kept up to date, changed a
 * little (colours and words), made from a part of the template, and let go. Same rules as docEdit.js: a DOM document in, changed in
 * place, one call is one step of undo, and only standard node traversal is used.
 *
 * A component in a template is a group with the component's parts copied inside; the template needs nothing from the library to draw:
 *   <g data-spadewick-id="cost_badge_1" data-spadewick-component="<library id>" data-spadewick-component-name="Cost badge"
 *      data-spadewick-component-version="3" data-spadewick-overrides='{"badge":{"fill":"#ff0000"}}' transform="translate(…)">
 *     <circle data-spadewick-id="badge" data-spadewick-part="badge" …/> …
 *   </g>
 * Every part with a name keeps the name it had in the library in `data-spadewick-part`, which is how an update finds it again, and how
 * the colours and words the template changed are put back after the parts are replaced by the library's newer ones.
 */
import { NS, childElements, childNodesOf, descendants, findById, findByPlainId, ensureDefs, idsOf, uniqueId, freshId, urlRef } from './docEdit.js'

export const COMPONENT = 'data-spadewick-component'
export const NAME = 'data-spadewick-component-name'
export const VERSION = 'data-spadewick-component-version'
export const OVERRIDES = 'data-spadewick-overrides'
export const PART = 'data-spadewick-part'
const ID = 'data-spadewick-id'
const round = v => Math.round(v * 100) / 100

/** What a part may have changed in an instance */
export const OVERRIDE_KEYS = ['fill', 'stroke', 'text']
const SHAPES = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text'])

const attrsOf = el => Array.from({ length: el.attributes.length }, (_, i) => el.attributes[i])

/** The plain ids (gradients, filters, clips…) an element and what is inside it point to. */
export function refsIn(el) {
  const found = new Set()
  const scan = e => {
    for (const a of attrsOf(e)) {
      for (const m of a.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) found.add(m[1])
      if ((a.name === 'href' || a.name === 'xlink:href') && a.value.startsWith('#')) found.add(a.value.slice(1))
    }
  }
  scan(el)
  for (const d of descendants(el)) scan(d)
  return found
}

/** Point every reference in the element (and inside it) at the new name of what was renamed. */
function rewriteRefs(el, map) {
  if (!map.size) return
  const fix = e => {
    for (const a of attrsOf(e)) {
      let v = a.value
      for (const [from, to] of map) {
        v = v.split(`url(#${from})`).join(`url(#${to})`).split(`url('#${from}')`).join(`url('#${to}')`).split(`url("#${from}")`).join(`url("#${to}")`)
        if ((a.name === 'href' || a.name === 'xlink:href') && v === `#${from}`) v = `#${to}`
      }
      if (v !== a.value) e.setAttribute(a.name, v)
    }
  }
  fix(el)
  for (const d of descendants(el)) fix(d)
}

// ---------------------------------------------------------------------------
// Reading an instance
// ---------------------------------------------------------------------------

export const isInstance = el => !!el && el.localName === 'g' && el.hasAttribute(COMPONENT)

export function readOverrides(g) {
  try {
    const raw = JSON.parse(g.getAttribute(OVERRIDES) || '{}')
    const out = {}
    for (const [part, o] of Object.entries(raw ?? {})) {
      if (!o || typeof o !== 'object') continue
      const keep = {}
      for (const k of OVERRIDE_KEYS) if (typeof o[k] === 'string') keep[k] = o[k]
      if (Object.keys(keep).length) out[part] = keep
    }
    return out
  } catch { return {} }
}

/** { id, name, version, overrides } of an instance, or null for anything else. */
export function componentInfo(el) {
  if (!isInstance(el)) return null
  return { id: el.getAttribute(COMPONENT), name: el.getAttribute(NAME) || '', version: Number(el.getAttribute(VERSION)) || 1, overrides: readOverrides(el) }
}

/** The instance an element is a part of (the nearest one above it): { id, name }, or null. */
export function instanceAbove(el) {
  for (let p = el?.parentNode; p && p.nodeType === 1; p = p.parentNode) if (isInstance(p)) return { id: p.getAttribute(ID), name: p.getAttribute(NAME) || '' }
  return null
}

const partsOfGroup = g => [...descendants(g)].filter(e => e.hasAttribute(PART))

/** The parts of an instance a person can change: for each its colours and its words (a word that comes from a field is not changed here). */
export function partsOf(g) {
  const info = readOverrides(g)
  return partsOfGroup(g).filter(e => SHAPES.has(e.localName)).map(e => {
    const part = e.getAttribute(PART)
    const text = e.localName === 'text' ? e.textContent : null
    const bound = text !== null && (/\{\{/.test(text) || e.hasAttribute('data-spadewick-field') || childElements(e).length > 0)
    const fill = e.getAttribute('fill'), stroke = e.getAttribute('stroke')
    return {
      part, tag: e.localName, id: e.getAttribute(ID) ?? part, changed: !!info[part],
      fill: fill && !/^url\(|^\{\{/.test(fill) ? fill : null, stroke: stroke && !/^url\(|^\{\{/.test(stroke) ? stroke : null,
      text: text !== null && !bound ? text : null, tokens: bound ? text : null
    }
  })
}

// ---------------------------------------------------------------------------
// Putting a component into the document
// ---------------------------------------------------------------------------

function parseNode(xml) {
  const wrapper = new DOMParser().parseFromString(`<svg xmlns="${NS}">${xml}</svg>`, 'image/svg+xml')
  if (wrapper.getElementsByTagName('parsererror').length) return null
  return childElements(wrapper.documentElement)[0] ?? null
}

/** The component's definitions, in the document under free names (what the parts point to is renamed to match). Returns old name -> new name. */
function importDefs(doc, defs) {
  const map = new Map()
  const used = new Set([...descendants(doc.documentElement)].map(e => e.getAttribute('id')).filter(Boolean))
  const nodes = []
  for (const xml of defs ?? []) {
    const node = parseNode(xml)
    if (!node || !node.getAttribute('id')) continue
    const old = node.getAttribute('id')
    let name = old, n = 1
    while (used.has(name)) name = `${old}_${++n}`
    used.add(name)
    if (name !== old) { node.setAttribute('id', name); map.set(old, name) }
    nodes.push(node)
  }
  for (const node of nodes) { rewriteRefs(node, map); ensureDefs(doc).appendChild(doc.importNode(node, true)) }
  return map
}

/** The component's parts as nodes of the document, with names that are free in it. */
function importParts(doc, comp, taken) {
  const defsMap = importDefs(doc, comp.defs)
  const out = []
  for (const xml of comp.xml) {
    const node = parseNode(xml)
    if (!node) continue
    const copy = doc.importNode(node, true)
    rewriteRefs(copy, defsMap)
    for (const el of [copy, ...descendants(copy)]) {
      const old = el.getAttribute(ID)
      if (!old) continue
      if (!el.hasAttribute(PART)) el.setAttribute(PART, old)
      if (idsOf(doc).has(old) || taken.has(old)) el.setAttribute(ID, uniqueId(doc, old, taken)); else taken.add(old)
    }
    out.push(copy)
  }
  return out
}

const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'component'

/**
 * Put a component into the template, on top, with its middle at `at` (template units), scaled when the template is drawn on a canvas of
 * another width than the one the component was made on. Returns the id of the new group.
 * @param {object} comp as the library gives it: { id, name, version, refWidth, bounds, xml, defs }
 */
export function instantiate(doc, comp, { at, overrides = {} } = {}) {
  const root = doc.documentElement
  const width = parseFloat((root.getAttribute('viewBox') || '').split(/[\s,]+/)[2]) || parseFloat(root.getAttribute('width')) || comp.refWidth
  let scale = comp.refWidth > 0 ? width / comp.refWidth : 1
  if (Math.abs(scale - 1) < 0.02) scale = 1
  const target = at ?? { x: width / 2, y: (parseFloat((root.getAttribute('viewBox') || '').split(/[\s,]+/)[3]) || width) / 2 }
  const tx = round(target.x - (comp.bounds.x + comp.bounds.w / 2) * scale), ty = round(target.y - (comp.bounds.y + comp.bounds.h / 2) * scale)

  const g = doc.createElementNS(NS, 'g')
  const id = freshId(doc, slug(comp.name))
  g.setAttribute(ID, id)
  g.setAttribute(COMPONENT, comp.id)
  g.setAttribute(NAME, comp.name)
  g.setAttribute(VERSION, String(comp.version))
  g.setAttribute('transform', scale === 1 ? `translate(${tx} ${ty})` : `translate(${tx} ${ty}) scale(${round(scale)})`)
  for (const part of importParts(doc, comp, new Set([id]))) g.appendChild(part)
  root.appendChild(g)
  applyOverrides(g, overrides)
  return id
}

/** Put the colours and words of an instance's overrides on its parts (a part the component no longer has is skipped) and keep the ones that fit. */
function applyOverrides(g, overrides) {
  const kept = {}
  for (const e of partsOfGroup(g)) {
    const o = overrides[e.getAttribute(PART)]
    if (!o) continue
    if (o.fill !== undefined && e.localName !== 'line') e.setAttribute('fill', o.fill)
    if (o.stroke !== undefined) e.setAttribute('stroke', o.stroke)
    if (o.text !== undefined && e.localName === 'text' && !childElements(e).length) e.textContent = o.text
    kept[e.getAttribute(PART)] = o
  }
  if (Object.keys(kept).length) g.setAttribute(OVERRIDES, JSON.stringify(kept)); else g.removeAttribute(OVERRIDES)
}

/** Change one colour or the words of one part of an instance, and remember it as an override. `value` null puts the part back as the library has it (the caller re-applies the library version). */
export function setOverride(doc, id, part, key, value) {
  const g = findById(doc, id)
  if (!isInstance(g) || !OVERRIDE_KEYS.includes(key)) return false
  const o = readOverrides(g)
  if (value === null) { if (o[part]) { delete o[part][key]; if (!Object.keys(o[part]).length) delete o[part] } }
  else o[part] = { ...(o[part] ?? {}), [key]: String(value) }
  applyOverrides(g, o)
  return true
}

/** Replace what is inside an instance by the library's (newer) version of the component, keeping its place and its overrides. Returns false for what is not an instance. */
export function updateInstance(doc, id, comp, { keepOverrides = true } = {}) {
  const g = findById(doc, id)
  if (!isInstance(g)) return false
  const overrides = keepOverrides ? readOverrides(g) : {}
  const before = refsIn(g)
  for (const child of childNodesOf(g)) g.removeChild(child)
  const taken = new Set([id])
  for (const part of importParts(doc, comp, taken)) g.appendChild(part)
  g.setAttribute(COMPONENT, comp.id)
  g.setAttribute(NAME, comp.name)
  g.setAttribute(VERSION, String(comp.version))
  applyOverrides(g, overrides)
  // definitions only the old parts used are not left behind
  const stillPointedAt = refsIn(doc.documentElement)
  for (const old of before) {
    if (stillPointedAt.has(old)) continue
    const def = findByPlainId(doc, old)
    if (def && def.parentNode && def.parentNode.localName === 'defs') def.parentNode.removeChild(def)
  }
  return true
}

/** Let go of the library: the instance becomes a plain group, and its parts are plain elements. */
export function detach(doc, id) {
  const g = findById(doc, id)
  if (!isInstance(g)) return false
  for (const a of [COMPONENT, NAME, VERSION, OVERRIDES]) g.removeAttribute(a)
  for (const e of descendants(g)) e.removeAttribute(PART)
  return true
}

// ---------------------------------------------------------------------------
// Making a component
// ---------------------------------------------------------------------------

/** The names of the plain definitions (gradients, filters, clips) an element points to, and the definitions themselves, as source. */
function definitionsFor(doc, els) {
  const ser = new XMLSerializer()
  const wanted = new Set()
  for (const el of els) for (const id of refsIn(el)) wanted.add(id)
  const defs = []
  for (const id of wanted) { const d = findByPlainId(doc, id); if (d) { defs.push(ser.serializeToString(d)); for (const more of refsIn(d)) wanted.add(more) } }
  return defs
}

/** The parts of the elements as source, named as the library keeps them (every named part is its own name), with the definitions they use. */
export function packElements(doc, els) {
  const ser = new XMLSerializer()
  const xml = els.map(el => {
    const copy = el.cloneNode(true)
    for (const e of [copy, ...descendants(copy)]) {
      const part = e.getAttribute(PART) || e.getAttribute(ID)
      if (part) { e.setAttribute(ID, part); e.setAttribute(PART, part) }
    }
    return ser.serializeToString(copy)
  })
  return { xml, defs: definitionsFor(doc, els) }
}

/** What an instance holds, as it is now, for putting back into the library as a newer version. The overrides are part of it. */
export function packInstance(doc, id) {
  const g = findById(doc, id)
  if (!isInstance(g)) return null
  return packElements(doc, childElements(g))
}

/**
 * Make elements of the template into an instance of a component that was just saved: they are put in a group (a single group stays as it
 * is) that points to the library. Returns the id of the group.
 */
export function markAsInstance(doc, ids, comp) {
  const els = ids.map(i => findById(doc, i)).filter(Boolean)
  if (!els.length) return null
  let g = els.length === 1 && els[0].localName === 'g' && !isInstance(els[0]) ? els[0] : null
  if (!g) {
    const parent = els[0].parentNode
    const order = childElements(parent)
    els.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    g = doc.createElementNS(NS, 'g')
    g.setAttribute(ID, freshId(doc, slug(comp.name)))
    parent.insertBefore(g, els[els.length - 1].nextSibling)
    for (const el of els) g.appendChild(el)
  }
  g.setAttribute(COMPONENT, comp.id)
  g.setAttribute(NAME, comp.name)
  g.setAttribute(VERSION, String(comp.version))
  g.removeAttribute(OVERRIDES)
  for (const e of descendants(g)) if (e.getAttribute(ID) && !e.hasAttribute(PART)) e.setAttribute(PART, e.getAttribute(ID))
  return g.getAttribute(ID)
}

/** Where an instance sits: the translate and scale its transform was made with (an instance made by this module has no other). */
export function frameOf(g) {
  const t = g.getAttribute('transform') || ''
  const move = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(t)
  const scale = /scale\(\s*(-?[\d.]+)/.exec(t)
  return { x: move ? Number(move[1]) : 0, y: move ? Number(move[2]) : 0, scale: scale ? Number(scale[1]) : 1 }
}

/** A box measured on the card (template units) as the box inside the instance, where its parts are. */
export function localBounds(g, box) {
  const f = frameOf(g)
  return { x: round((box.x - f.x) / f.scale), y: round((box.y - f.y) / f.scale), w: round(box.w / f.scale), h: round(box.h / f.scale) }
}
