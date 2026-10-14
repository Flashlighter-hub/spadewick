/**
 * Automatic binding (PRD §19.3): which element of a design is which field, from the name a tool wrote for it (id, layer name,
 * label) and from the text it holds. Proposes; the person confirms (only exact matches are pre-checked).
 */
import { walk, textOf, elementsOf } from './xml.js'
import { iconKey } from '../../shared/richText.js'
import { elementBox, toRect, IDENTITY, multiply, parseTransform } from './geometry.js'

/** Names design tools give to a layer nobody named. */
const GENERIC = /^(rectangle|rect|ellipse|circle|oval|line|path|vector|group|layer|frame|image|shape|polygon|polyline|union|subtract|intersect|exclude|mask|clip|clippath|defs|text|combined shape|boolean|star|component|instance|slice|artboard|bg|background|svg)([\s_-]*\d+)*([\s_-]*(copy|rectangle|path|shape))?[\s_-]*(\d+)?$|^(g|rect|path|circle|ellipse|line|polygon|image|use|text|tspan|mask|clip|clippath|filter|lineargradient|radialgradient|stop|symbol|pattern|defs|svg|layer|frame|group)[\s_-]*\d*$|^(untitled|new)\b/i

/** A name compared loosely: case, spaces, hyphens and underscores do not count. */
export const nameKey = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_-]+/g, ' ').trim()

/** The same, without a trailing copy number (`name 1`, `name_2`): how a tool makes a second `name` unique. */
const baseKey = key => key.replace(/\s\d+$/, '')

const tokens = key => key.split(' ').filter(Boolean)

function editDistanceAtMostOne(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * @param {string} key loose name of the element
 * @param {object[]} fields the set's fields { name, slug, type }
 * @param {(f: object) => boolean} usable which fields this kind of element may be bound to
 * @returns {{ field: object, confidence: 'exact' | 'close', note: string | null } | null}
 */
export function matchField(key, fields, usable) {
  if (!key) return null
  const pool = fields.filter(usable)
  const exact = pool.find(f => nameKey(f.slug) === key || nameKey(f.name) === key)
  if (exact) return { field: exact, confidence: 'exact', note: null }
  const base = baseKey(key)
  if (base !== key) {
    const dup = pool.find(f => nameKey(f.slug) === base || nameKey(f.name) === base)
    if (dup) return { field: dup, confidence: 'close', note: 'copy' }
  }
  const kt = tokens(base)
  const contained = pool.filter(f => {
    const ft = tokens(nameKey(f.name)), st = tokens(nameKey(f.slug))
    const within = (small, big) => small.length > 0 && small.every(t => big.includes(t))
    return (within(kt, ft) || within(ft, kt) || within(kt, st) || within(st, kt)) && Math.min(kt.length, ft.length) >= 1
  }).sort((a, b) => a.name.length - b.name.length)
  if (contained.length) return { field: contained[0], confidence: 'close', note: 'words' }
  const typo = pool.find(f => editDistanceAtMostOne(base, nameKey(f.name)) || editDistanceAtMostOne(base, nameKey(f.slug)))
  if (typo) return { field: typo, confidence: 'close', note: 'spelling' }
  return null
}

const TEXT_TYPES = new Set(['text', 'number', 'boolean', 'formula', 'rich_text'])
const SHAPE_TAGS = new Set(['rect', 'ellipse', 'circle', 'path', 'polygon', 'polyline', 'line'])
const SKIP = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'marker', 'style', 'tspan', 'stop'])

/** The kind of an element for binding: text, image, shape (has a fill) or group. */
export const kindOf = el => (el.tag === 'text' ? 'text' : el.tag === 'image' ? 'image' : SHAPE_TAGS.has(el.tag) ? 'shape' : el.tag === 'g' ? 'group' : 'other')

/** `if:cost > 3`, `hide-if:...`, `icon:fire` (a design tool may have turned the colon into a hyphen or underscore: only the colon is read). */
export function specialOf(name) {
  const m = /^\s*(if|hide-if|icon)\s*:\s*(.+?)\s*$/i.exec(name ?? '')
  if (!m) return null
  const type = m[1].toLowerCase()
  return { type: type === 'if' ? 'show' : type === 'hide-if' ? 'hide' : 'icon', value: m[2] }
}

/** Text of a `<text>` as a person reads it: lines are the tspans that start a new line. */
export function sampleText(el) {
  const spans = elementsOf(el).filter(c => c.tag === 'tspan')
  if (!spans.length) return textOf(el).replace(/\s+/g, ' ').trim()
  const lines = []
  let lastY = null
  for (const s of spans) {
    const t = textOf(s)
    const y = s.attrs.y ?? (s.attrs.dy ? `dy${s.attrs.dy}` : null)
    if (lines.length && (y === null || y === lastY)) lines[lines.length - 1] += t
    else lines.push(t)
    lastY = y
  }
  const direct = el.children.filter(c => c.text !== undefined).map(c => c.text).join('').trim()
  return (direct && !lines.length ? direct : lines.join('\n')).replace(/[ \t]+/g, ' ').trim()
}

const slugify = s => nameKey(s).replace(/[^\p{L}\p{N} ]+/gu, '').trim().replace(/\s+/g, '_')

/** Unique, readable `data-spadewick-id`s. */
export function idMaker(taken = new Set()) {
  return base => {
    const root = slugify(base) || 'element'
    let id = root, n = 1
    while (taken.has(id)) id = `${root}_${++n}`
    taken.add(id)
    return id
  }
}

/** The combined transform of an element's ancestors (not its own). */
export const ancestorMatrix = ancestors => ancestors.reduce((m, a) => (a.attrs.transform ? multiply(m, parseTransform(a.attrs.transform)) : m), IDENTITY)

/**
 * Candidates for binding, in document order.
 * @param {object} root cleaned tree whose elements have `key` and `name`
 * @param {{ name: string, slug: string, type: string }[]} fields
 * @param {{ kept?: object[] }} [opts] kept: bindings of an earlier import of the same design (re-import), by name
 */
export function findCandidates(root, fields, opts = {}) {
  const rows = []
  const textLen = el => textOf(el).length
  const tokenSlugs = new Set(fields.map(f => f.slug))
  const keptByName = new Map()
  for (const b of opts.kept ?? []) {
    const k = `${nameKey(b.name)}#${b.occurrence ?? 0}`
    keptByName.set(k, b)
  }
  const occurrences = new Map()
  const boxRects = new Map() // loose name of a `<x>_box` rectangle -> row
  const textRows = new Map() // loose name -> text rows

  walk(root, (el, anc) => {
    if (el === root) return
    if (SKIP.has(el.tag) || anc.some(a => SKIP.has(a.tag))) return false
    const kind = kindOf(el)
    if (kind === 'other') return
    if (anc.some(a => a.tag === 'text')) return false
    const meaningful = c => !SKIP.has(c.tag)
    // A group that only wraps one text, picture or shape is that thing's name (Illustrator names the layer, not the object)
    if (kind === 'group' && elementsOf(el).filter(meaningful).length === 1 && ['text', 'image', 'shape'].includes(kindOf(elementsOf(el).filter(meaningful)[0]))) return
    let name = el.name ?? ''
    const parent = anc[anc.length - 1]
    if ((!name || GENERIC.test(name.trim())) && parent && parent !== root && parent.tag === 'g' && parent.name && !GENERIC.test(parent.name.trim()) && elementsOf(parent).filter(meaningful).length === 1) name = parent.name
    const named = name && !GENERIC.test(name.trim())
    const key = named ? nameKey(name) : ''
    const special = named ? specialOf(name) : null
    const box = toRect(elementBox(el, ancestorMatrix(anc), textLen))
    const row = { key: el.key, tag: el.tag, kind, name: named ? name : '', rect: box, sample: null, proposal: { action: 'none' }, confidence: 'none', note: null, options: [] }
    const occ = key ? (occurrences.get(key) ?? 0) : 0
    if (key) occurrences.set(key, occ + 1)
    row.occurrence = occ
    row.fingerprintName = named ? name : ''

    if (kind === 'text') {
      row.sample = sampleText(el)
      row.options = fields.filter(f => TEXT_TYPES.has(f.type)).map(f => f.slug)
      const content = textOf(el)
      const token = /\{\{\s*([\w-]+)\s*\}\}/.exec(content)
      if (token) {
        const slug = token[1]
        row.proposal = tokenSlugs.has(slug) ? { action: 'token', slug } : { action: 'new', slug, newName: slug, newType: 'text', fromToken: true }
        row.confidence = 'token'
        row.note = tokenSlugs.has(slug) ? 'token' : 'tokenNew'
      } else if (special?.type === 'icon') {
        row.proposal = { action: 'icon', icon: iconKey(special.value) }; row.confidence = 'exact'
      } else if (special) {
        row.proposal = { action: special.type, expr: special.value }; row.confidence = 'exact'
      } else if (key) {
        const m = matchField(key, fields, f => TEXT_TYPES.has(f.type))
        if (m) { row.proposal = { action: 'field', slug: m.field.slug }; row.confidence = m.confidence; row.note = m.note }
        else row.proposal = { action: 'none', suggestNew: { name: titleCase(name), type: 'text' } }
      }
      const loose = key
      if (loose) { const l = textRows.get(loose) ?? []; l.push(row); textRows.set(loose, l) }
    } else {
      if (!named) { if (kind !== 'image') return; row.name = ''; row.options = fields.filter(f => f.type === 'image_ref').map(f => f.slug) }
      if (named || kind === 'image') {
        if (special?.type === 'icon') { row.proposal = { action: 'icon', icon: iconKey(special.value) }; row.confidence = 'exact' }
        else if (special) { row.proposal = { action: special.type, expr: special.value }; row.confidence = 'exact' }
        else if (key) {
          const imageOk = f => f.type === 'image_ref'
          const colorOk = f => f.type === 'color'
          const wantsImage = kind === 'image' || kind === 'shape' || kind === 'group'
          const m = (wantsImage && matchField(key, fields, imageOk)) || null
          const c = (!m && (kind === 'shape') && matchField(key, fields, colorOk)) || null
          if (m) { row.proposal = { action: 'image', slug: m.field.slug }; row.confidence = m.confidence; row.note = m.note }
          else if (c) { row.proposal = { action: 'color', slug: c.field.slug }; row.confidence = c.confidence; row.note = c.note }
          else if (/ box$| ?box$/.test(key) && el.tag === 'rect') {
            const owner = key.replace(/ ?box$/, '').trim()
            if (owner) { row.boxFor = owner; row.proposal = { action: 'box' }; row.confidence = 'exact' }
          } else if (kind === 'image') {
            row.proposal = { action: 'none', suggestNew: { name: titleCase(name), type: 'image_ref' } }
          } else return   // a named shape or group that matches nothing is just artwork
        } else if (kind === 'image') {
          row.proposal = { action: 'none' }
        } else return
        row.options = [...fields.filter(f => (kind === 'shape' ? ['image_ref', 'color'] : ['image_ref']).includes(f.type)).map(f => f.slug)]
      }
      if (row.boxFor) boxRects.set(row.boxFor, row)
    }

    // an earlier import's decision for this element (re-import): kept as it was
    const kept = keptByName.get(`${nameKey(row.fingerprintName || '')}#${occ}`)
    if (kept && row.fingerprintName) {
      const slugOk = !kept.slug || tokenSlugs.has(kept.slug) || kept.action === 'new'
      if (slugOk) {
        row.proposal = { action: kept.action, slug: kept.slug, expr: kept.expr, icon: kept.icon, text: kept.text }
        row.confidence = 'kept'; row.note = null
      }
    }
    rows.push(row)
  })

  // A box rectangle belongs to the text of the same name: pre-checked when that text is bound exactly
  for (const [owner, boxRow] of boxRects) {
    const texts = textRows.get(owner)
    if (!texts) { boxRow.confidence = 'none'; boxRow.proposal = { action: 'none' }; boxRow.boxFor = null; continue }
    boxRow.boxForKey = texts[0].key
  }
  return rows
}

const titleCase = s => String(s).trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase())

/** Elements named like a field that hold no text but only shapes: text that was already turned into outlines. */
export function findOutlinedText(root, fields) {
  const out = []
  walk(root, (el, anc) => {
    if (el === root) return
    if (SKIP.has(el.tag)) return false
    if (!['g', 'path'].includes(el.tag)) return
    const name = el.name ?? ''
    if (!name || GENERIC.test(name.trim())) return
    const key = nameKey(name)
    const hit = /outline/.test(key) || fields.filter(f => TEXT_TYPES.has(f.type)).some(f => nameKey(f.slug) === key || nameKey(f.name) === key)
    if (!hit) return
    let hasText = false, paths = 0
    walk(el, c => { if (c.tag === 'text') hasText = true; if (c.tag === 'path') paths++ })
    if (!hasText && paths) out.push({ key: el.key, name })
    return false
  })
  return out
}
