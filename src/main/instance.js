/**
 * A card's own instance of its template (UPDATES U29). Every card that uses a template is drawn from that one template, but a card can keep
 * a few changes of its own — its art, a custom line of text, a moved or recoloured element — without becoming a different template. What a
 * card changed is kept as a small patch of the template, not as a copy of it, so a change to the template still reaches every card, except in
 * the elements that card changed itself:
 *
 *   { v: 1,
 *     set:    [{ t: <target>, a: { "<attribute>": "value" | null (remove it) }, inner: "<new content of a text element>" }],
 *     remove: [<target>, …],
 *     add:    [{ parent: <target> | null, before: <target> | null, xml: "<element …/>" }] }
 *
 * A target is the element's id (its `data-spadewick-id`, or failing that its plain `id`) or, for an element with neither, its place in the
 * template: the list of child indexes from the root. Everything is worked out on the template's own text, so its comments and markers
 * (slots, fills) are untouched.
 */
import { parseXml, serialize, elementsOf } from './svgImport/xml.js'
import { tr } from '../shared/i18n.js'

const ID = 'data-spadewick-id'
const MAX_PATCH_BYTES = 400_000
const UNSAFE = /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i
const idOf = el => el.attrs?.[ID] ?? el.attrs?.id ?? null

/** Every element of a tree with its id (or null), its path, and its parent. */
function flatten(root) {
  const list = []
  const visit = (el, path, parent) => {
    const node = { el, id: idOf(el), path, parent, index: list.length }
    list.push(node)
    elementsOf(el).forEach((kid, i) => visit(kid, [...path, i], node))
  }
  visit(root, [], null)
  return list
}

const innerOf = el => el.children.map(c => (c.tag ? serialize(c) : c.text)).join('')
const samePath = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/** The patch that turns the template source `base` into the source `edited`, or null when they differ in nothing a card may keep. */
export function diffInstance(base, edited) {
  const B = flatten(parseXml(base).root), E = flatten(parseXml(edited).root)
  const byId = new Map()
  for (const n of B) if (n.id !== null && !byId.has(n.id)) byId.set(n.id, n)
  const byPath = new Map(B.map(n => [n.path.join('.'), n]))
  // which element of the template each element of the edited source is: by id, else by place when the template's element has no id
  const matchOf = new Map(), taken = new Set()
  for (const n of E) {
    const b = n.id !== null ? byId.get(n.id) : null
    if (b && !taken.has(b)) { matchOf.set(n, b); taken.add(b) }
  }
  for (const n of E) {
    if (matchOf.has(n)) continue
    const b = byPath.get(n.path.join('.'))
    if (b && b.id === null && b.el.tag === n.el.tag && !taken.has(b)) { matchOf.set(n, b); taken.add(b) }
  }
  const target = b => (b.id !== null ? b.id : b.path)
  const set = [], remove = [], add = []
  for (const [n, b] of matchOf) {
    const a = {}
    for (const name of new Set([...Object.keys(n.el.attrs), ...Object.keys(b.el.attrs)])) {
      if (name === ID || name === 'id') continue
      if (n.el.attrs[name] !== b.el.attrs[name]) a[name] = n.el.attrs[name] === undefined ? null : n.el.attrs[name]
    }
    const entry = { t: target(b) }
    if (Object.keys(a).length) entry.a = a
    if (b.el.tag === 'text' && innerOf(n.el) !== innerOf(b.el)) entry.inner = innerOf(n.el)
    if (entry.a || entry.inner !== undefined) set.push(entry)
  }
  const gone = b => b.id !== null && !taken.has(b)
  for (const b of B) {
    if (!gone(b)) continue
    let up = b.parent, covered = false
    while (up && !covered) { covered = gone(up); up = up.parent }   // the topmost removed element takes what is inside it
    if (!covered) remove.push(target(b))
  }
  for (const n of E) {
    if (matchOf.has(n)) continue
    let up = n.parent, covered = false
    while (up && !covered) { covered = !matchOf.has(up); up = up.parent }
    if (covered) continue
    const parent = n.parent && matchOf.get(n.parent) ? target(matchOf.get(n.parent)) : null
    const sibling = E.find(m => m.parent === n.parent && m.index > n.index && matchOf.has(m))
    add.push({ parent, before: sibling ? target(matchOf.get(sibling)) : null, xml: serialize(n.el) })
  }
  if (!set.length && !remove.length && !add.length) return null
  return checkPatch({ v: 1, ...(set.length ? { set } : {}), ...(remove.length ? { remove } : {}), ...(add.length ? { add } : {}) })
}

/** A patch must be small and must not carry anything that runs. Throws a message for the person when it does not pass. */
export function checkPatch(patch) {
  if (JSON.stringify(patch).length > MAX_PATCH_BYTES) throw new Error(tr('errors.instanceTooBig'))
  const pieces = [...(patch.add ?? []).map(a => a.xml), ...(patch.set ?? []).flatMap(s => [s.inner, ...Object.values(s.a ?? {})])].filter(v => typeof v === 'string')
  if (pieces.some(p => UNSAFE.test(p))) throw new Error(tr('errors.instanceUnsafe'))
  return patch
}

/** The patch a card holds, as an object, or null when it has none or it cannot be read. */
export function readPatch(json) {
  if (!json) return null
  try { const p = typeof json === 'string' ? JSON.parse(json) : json; return p && p.v === 1 ? p : null } catch { return null }
}

// ---------------------------------------------------------------------------
// Applying a patch to source text
// ---------------------------------------------------------------------------

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
const attrEscape = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescapeAttr = v => String(v).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** The elements of a source text with where each starts and ends: [{ tag, start, openEnd, closeStart, end, attrs (the text), path, parent, id }]. */
function scan(s) {
  const nodes = [], stack = []
  const counts = new Map()   // how many element children each parent has had so far
  for (const m of s.matchAll(TOKEN)) {
    if (m[1]) {   // a closing tag closes the nearest open element of that name (and any unclosed ones inside it)
      let i = stack.length - 1
      while (i >= 0 && stack[i].tag !== m[1]) i--
      if (i < 0) continue
      const closed = stack.splice(i)
      closed[0].closeStart = m.index
      for (const n of closed) { n.closeStart ??= m.index; n.end = m.index + m[0].length }
      continue
    }
    if (!m[2]) continue
    const parent = stack[stack.length - 1] ?? null
    const n = counts.get(parent) ?? 0
    counts.set(parent, n + 1)
    const attrs = m[3] ?? ''
    const named = {}
    for (const a of attrs.matchAll(ATTR)) named[a[1]] = unescapeAttr(a[2] ?? a[3] ?? a[4] ?? '')
    const node = { tag: m[2], start: m.index, openEnd: m.index + m[0].length, closeStart: null, end: null, attrs, selfClosing: m[4] === '/', parent, id: named[ID] ?? named.id ?? null, path: parent ? [...parent.path, n] : [] }
    nodes.push(node)
    if (node.selfClosing) { node.closeStart = node.end = node.openEnd } else stack.push(node)
  }
  for (const n of stack) { n.closeStart ??= s.length; n.end = s.length }
  return nodes
}

function setAttributes(attrText, changes) {
  const parts = [], seen = new Set()
  for (const m of attrText.matchAll(ATTR)) {
    if (m[1] in changes) { seen.add(m[1]); if (changes[m[1]] !== null) parts.push(`${m[1]}="${attrEscape(changes[m[1]])}"`) } else parts.push(m[0])
  }
  for (const [name, value] of Object.entries(changes)) if (!seen.has(name) && value !== null && /^[A-Za-z_:][\w:.-]*$/.test(name)) parts.push(`${name}="${attrEscape(value)}"`)
  return parts.length ? ' ' + parts.join(' ') : ''
}

/** The source with the patch on it. A change to an element that is not in the template any more is skipped; nothing here can fail a drawing. */
export function applyInstance(source, patch) {
  if (!patch) return source
  const nodes = scan(source)
  const find = t => (Array.isArray(t) ? nodes.find(n => samePath(n.path, t)) : nodes.find(n => n.id === t)) ?? null
  const edits = []   // { start, end, text }: all worked out on the original text and applied from the end, so that none shifts another
  const removed = []
  for (const t of patch.remove ?? []) { const n = find(t); if (n) { removed.push(n); edits.push({ start: n.start, end: n.end, text: '' }) } }
  const inRemoved = n => removed.some(r => n.start >= r.start && n.end <= r.end)
  for (const s of patch.set ?? []) {
    const n = find(s.t)
    if (!n || inRemoved(n)) continue
    if (s.a && Object.keys(s.a).length) {
      // the text between the tag name and the end of the start tag is written again with the changes
      edits.push({ start: n.start + 1 + n.tag.length, end: n.openEnd - (n.selfClosing ? 2 : 1), text: setAttributes(n.attrs, s.a) })
    }
    if (typeof s.inner === 'string' && !n.selfClosing) edits.push({ start: n.openEnd, end: n.closeStart, text: s.inner })
  }
  for (const a of patch.add ?? []) {
    const before = a.before !== null && a.before !== undefined ? find(a.before) : null
    const parent = a.parent !== null && a.parent !== undefined ? find(a.parent) : null
    const at = before ? before.start : parent && !parent.selfClosing ? parent.closeStart : source.lastIndexOf('</svg>')
    if (at < 0 || (parent && inRemoved(parent))) continue
    edits.push({ start: at, end: at, text: a.xml })
  }
  edits.sort((x, y) => y.start - x.start || y.end - x.end)
  let out = source
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}
