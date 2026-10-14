/**
 * From a cleaned design and the person's decisions to the SVG source of a template (PRD §19.2 step 5, §19.3): tokens where
 * a layer is a field, boxes where a layer is a text frame, conditions, icons, pictures in the asset library, and a view
 * box that puts the design on the card.
 */
import { walk, elementsOf, serialize, textOf, escapeText } from './xml.js'
import { parseDeclarations } from './css.js'
import { viewBoxFor } from './size.js'
import { elementBox, toRect, num, parseTransform, multiply, applyPoint, isAxisAligned, IDENTITY } from './geometry.js'
import { ancestorMatrix, idMaker, sampleText, nameKey, kindOf } from './bind.js'
import { isReservedFieldName } from '../../shared/cardIds.js'
import { iconKey } from '../../shared/richText.js'
import { dropOffCanvas } from './canvas.js'

const TEXT_STYLE = ['fill', 'font-size', 'font-weight', 'font-style', 'font-family', 'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration', 'fill-opacity', 'opacity']
const INHERITED = ['font-size', 'font-family', 'font-weight', 'font-style', 'fill', 'text-anchor', 'letter-spacing']
const NEEDS_BOX_ANCHOR = { middle: 0.5, end: 1 }

const textNode = value => ({ text: value })
const slugify = s => nameKey(s).replace(/[^\p{L}\p{N} ]+/gu, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'field'

const invert = m => {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

const hexOf = value => {
  const v = String(value ?? '').trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(v)
  if (m) return `#${[...m[1]].map(c => c + c).join('')}`
  m = /^#([0-9a-f]{6})$/.exec(v)
  if (m) return v
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v)
  if (m) return `#${[m[1], m[2], m[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
  return null
}

const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080' }
const colorOf = value => hexOf(value) ?? NAMED[String(value ?? '').trim().toLowerCase()] ?? null

/** Replace a font family named in a value list. */
function mapFamilies(value, map) {
  return value.split(',').map(part => {
    const name = part.trim().replace(/^["']|["']$/g, '')
    const to = map.get(name.toLowerCase())
    return to ? (/[\s]/.test(to) ? `'${to}'` : to) : part.trim()
  }).join(', ')
}

const DEF_TAGS = new Set(['pattern', 'image', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'filter'])

/** Removes definitions in <defs> that nothing refers to, until no more can go. */
function pruneDefs(root) {
  for (let pass = 0; pass < 10; pass++) {
    const used = new Set()
    walk(root, el => {
      for (const v of Object.values(el.attrs)) {
        if (typeof v !== 'string') continue
        if (v.startsWith('#')) used.add(v.slice(1))
        for (const m of v.matchAll(/url\(\s*#([^)\s]+)\s*\)/g)) used.add(m[1])
      }
    })
    let removed = 0
    walk(root, el => {
      if (el.tag !== 'defs') return
      const before = el.children.length
      el.children = el.children.filter(c => !(c.tag && DEF_TAGS.has(c.tag) && c.attrs.id && !used.has(c.attrs.id)))
      removed += before - el.children.length
    })
    if (!removed) return
  }
}

/**
 * @param {object} source cleaned tree (not changed)
 * @param {object} o
 * @param {number[]} o.viewBox the design's view box after any bleed was taken off
 * @param {{ widthMm: number }} o.size
 * @param {{ mmW: number, mmH: number }} o.card
 * @param {'fit'|'keep'|'crop'} o.fit
 * @param {object[]} o.decisions { key, action, slug?, newName?, newType?, expr?, icon? }
 * @param {Record<string,string>} [o.fontMap]
 * @param {Map<string,string>} [o.assetIds] picture hash -> asset id
 * @param {{ slug: string, type: string }[]} o.fields the set's fields now
 * @param {object[]} [o.keepRemoved] { id, source } elements of an earlier import to put back
 * @returns {{ svg: string, newFields: object[], samples: Record<string,string>, bindings: object[], warnings: string[] }}
 */
/** What is not a layer: the definitions other elements use, and the parts of a text. */
const NOT_LAYERS = new Set(['defs', 'style', 'clipPath', 'mask', 'pattern', 'symbol', 'marker', 'linearGradient', 'radialGradient', 'filter', 'title', 'desc', 'metadata', 'tspan', 'stop', 'script'])
/** A design this large keeps its first layers and says so (every layer costs the editor a handle). */
const MAX_LAYERS = 2000
/** A name a tool gives an element by itself (`path1234`, `g12`): the kind of element says more. */
const GENERIC_NAME = /^(g|rect|path|circle|ellipse|line|polygon|polyline|text|image|use|svg|group|layer)[\s_.-]*\d*$/i

export function buildTemplate(source, o) {
  const root = structuredClone(source)
  const warnings = []
  const decisions = new Map(o.decisions.map(d => [d.key, d]))
  const slugsTaken = new Set(o.fields.map(f => f.slug))
  const newFields = [], samples = {}, bindings = []
  const idFor = idMaker(new Set())
  const nodes = new Map(), parents = new Map(), chains = new Map(), byId = new Map()
  walk(root, (el, anc) => {
    if (el.key !== undefined) nodes.set(el.key, el)
    if (el.attrs.id) byId.set(el.attrs.id, el)
    parents.set(el, anc[anc.length - 1] ?? null)
    chains.set(el, [...anc])
  })

  // ---- fonts ----
  const fontMap = new Map(Object.entries(o.fontMap ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  if (fontMap.size) {
    walk(root, el => {
      if (el.attrs['font-family']) el.attrs['font-family'] = mapFamilies(el.attrs['font-family'], fontMap)
      if (el.attrs.style && /font-family/i.test(el.attrs.style)) {
        const d = parseDeclarations(el.attrs.style)
        d['font-family'] = mapFamilies(d['font-family'], fontMap)
        el.attrs.style = Object.entries(d).map(([k, v]) => `${k}:${v}`).join(';')
      }
      for (const c of el.children) if (c.text !== undefined && el.tag === 'style') c.text = c.text.replace(/font-family\s*:\s*([^;}]+)/gi, (m, v) => `font-family:${mapFamilies(v, fontMap)}`)
    })
  }

  const inherited = (el, name) => {
    if (el.attrs[name]) return el.attrs[name]
    for (const a of [...(chains.get(el) ?? [])].reverse()) if (a.attrs[name]) return a.attrs[name]
    return null
  }

  const fieldSlugFor = d => {
    if (d.action !== 'new') return d.slug
    if (d.createdSlug) return d.createdSlug
    let base = d.slug && /^[a-z][a-z0-9_]*$/.test(d.slug) ? d.slug : slugify(d.newName ?? 'field')
    if (!/^[a-z]/.test(base)) base = `f_${base}`
    if (isReservedFieldName(base)) base = `${base}_field`
    let slug = base, n = 1
    while (slugsTaken.has(slug)) slug = `${base}_${++n}`
    slugsTaken.add(slug)
    d.createdSlug = slug
    return slug
  }
  const declareField = (d, slug, sample) => {
    if (d.action !== 'new') return
    if (!newFields.some(f => f.slug === slug)) newFields.push({ name: d.newName || slug, slug, type: d.newType ?? 'text', sample: sample ?? null })
  }

  // ---- decisions, in document order ----
  const boxes = []
  for (const d of o.decisions) if (d.action === 'box') boxes.push(d)
  const order = []
  walk(root, el => { if (el.key !== undefined && decisions.has(el.key)) order.push(el) })

  for (const el of order) {
    const d = decisions.get(el.key)
    el.occurrence = d.occurrence ?? 0
    const kind = kindOf(el)
    if (d.action === 'none' || d.action === 'box') continue
    if (d.action === 'show' || d.action === 'hide') {
      el.attrs[d.action === 'show' ? 'data-spadewick-show-if' : 'data-spadewick-hide-if'] = d.expr
      el.attrs['data-spadewick-id'] = idFor(el.name || `${d.action}_${d.expr}`)
      bindings.push({ name: d.name ?? el.name, occurrence: el.occurrence ?? 0, action: d.action, expr: d.expr, id: el.attrs['data-spadewick-id'] })
      continue
    }
    if (d.action === 'icon') { bindIcon(el, d); continue }
    if (d.action === 'free' && kind === 'text') { freeText(el, d); continue }
    if ((d.action === 'field' || d.action === 'token' || d.action === 'new') && kind === 'text') { bindText(el, d); continue }
    if (d.action === 'image' || (d.action === 'field' && kind !== 'text') || (d.action === 'new' && d.newType === 'image_ref')) { bindImage(el, d); continue }
    if (d.action === 'color' || (d.action === 'new' && d.newType === 'color')) { bindColor(el, d); continue }
  }

  function record(el, d, slug, extra = {}) {
    bindings.push({ name: d.name ?? el.name ?? '', occurrence: el.occurrence ?? 0, action: d.action === 'new' ? 'field' : d.action, slug, id: el.attrs['data-spadewick-id'], ...extra })
  }

  function bindText(el, d) {
    const slug = d.action === 'token' ? d.slug : fieldSlugFor(d)
    const sample = sampleText(el).replace(/\{\{[^}]*\}\}/g, '').trim() || null
    const spans = elementsOf(el).filter(c => c.tag === 'tspan')
    const first = spans[0]
    // The look of the text: on the text, or on its first line (Figma and Sketch put it there)
    for (const k of TEXT_STYLE) {
      if (el.attrs[k]) continue
      const v = (first && first.attrs[k]) || inherited(el, k) || null
      if (v && INHERITED.includes(k) || (first && first.attrs[k])) el.attrs[k] = v
    }
    if (el.attrs.x === undefined && first?.attrs.x !== undefined) el.attrs.x = first.attrs.x
    if (el.attrs.y === undefined && first?.attrs.y !== undefined) el.attrs.y = first.attrs.y
    el.attrs.x ??= '0'; el.attrs.y ??= '0'
    if (el.attrs['font-size'] === undefined) el.attrs['font-size'] = '16'
    foldTransform(el)
    const keepToken = d.action === 'token' || d.fromToken
    el.attrs['data-spadewick-id'] = idFor(slug)
    if (keepToken) {
      // The text already holds its token (maybe among other words): it stays as written
      el.children = [{ text: escapeText(textOf(el).replace(/\s+/g, ' ').trim()) }]
      declareField(d, slug, null)
      record(el, d, slug)
      return
    }
    el.children = [{ text: `{{${slug}}}` }]
    el.attrs['data-spadewick-field'] = slug
    declareField(d, slug, sample)
    if (sample !== null) samples[slug] ??= sample
    // A box rectangle named like the text gives it its frame
    const boxDecision = boxes.find(b => b.boxFor === el.key)
    if (boxDecision) applyBox(el, nodes.get(boxDecision.key), boxDecision)
    record(el, d, slug)
  }

  /** A text moved (and evenly scaled) by its own transform, as Illustrator writes every text, is put where it is: x, y and font size. */
  function foldTransform(text) {
    if (!text.attrs.transform) return
    const m = parseTransform(text.attrs.transform)
    const k = Math.abs(m[0])
    if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9 || m[0] <= 0 || Math.abs(m[0] - m[3]) > 1e-9) return
    const [x, y] = applyPoint(m, num(text.attrs.x), num(text.attrs.y))
    const r = n => Math.round(n * 1000) / 1000
    text.attrs.x = String(r(x)); text.attrs.y = String(r(y))
    if (k !== 1) {
      const size = parseFloat(text.attrs['font-size'])
      if (Number.isFinite(size)) text.attrs['font-size'] = String(r(size * k))
      for (const a of ['letter-spacing', 'word-spacing']) { const v = parseFloat(text.attrs[a]); if (Number.isFinite(v) && /^-?[\d.]+(px)?$/.test(text.attrs[a])) text.attrs[a] = String(r(v * k)) }
    }
    delete text.attrs.transform
  }

  /** Text the person types instead of a field: it stays in the template, drawn with the look of the original. */
  function freeText(el, d) {
    const spans = elementsOf(el).filter(c => c.tag === 'tspan')
    const first = spans[0]
    for (const k of TEXT_STYLE) {
      if (el.attrs[k]) continue
      const v = (first && first.attrs[k]) || inherited(el, k) || null
      if (v) el.attrs[k] = v
    }
    const x = el.attrs.x ?? first?.attrs.x ?? '0'
    el.attrs.x = x
    el.attrs.y ??= first?.attrs.y ?? '0'
    if (el.attrs['font-size'] === undefined) el.attrs['font-size'] = '16'
    foldTransform(el)
    const lines = String(d.text ?? '').replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10))
    const size = num(el.attrs['font-size'], 16)
    el.children = lines.length === 1
      ? [textNode(escapeText(lines[0]))]
      : lines.map((l, i) => ({ tag: 'tspan', attrs: i ? { x: el.attrs.x, dy: String(Math.round(size * 1.2 * 100) / 100) } : {}, children: [textNode(escapeText(l))] }))
    el.attrs['data-spadewick-id'] = idFor(d.name || 'text')
    record(el, d, undefined, { text: String(d.text ?? '') })
  }

  function applyBox(text, rect, bd) {
    if (!rect) return
    if (text.attrs.transform) { warnings.push('boxTransform'); return }
    const rc = rect.attrs.transform ? multiply(ancestorMatrix(chains.get(rect)), parseTransform(rect.attrs.transform)) : ancestorMatrix(chains.get(rect))
    if (!isAxisAligned(rc)) { warnings.push('boxRotated'); return }
    const inv = invert(ancestorMatrix(chains.get(text)))
    const b = elementBox({ ...rect, attrs: { ...rect.attrs, transform: undefined } }, rc)
    if (!b || !inv) return
    const [x0, y0] = applyPoint(inv, b[0], b[1]), [x1, y1] = applyPoint(inv, b[2], b[3])
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
    const anchor = text.attrs['text-anchor']
    const ax = NEEDS_BOX_ANCHOR[anchor] ?? 0
    const r = n => Math.round(n * 100) / 100
    text.attrs.x = String(r(x + w * ax)); text.attrs.y = String(r(y)); text.attrs.width = String(r(w)); text.attrs.height = String(r(h))
    const size = num(text.attrs['font-size'], 16)
    text.attrs['data-spadewick-text-fit'] = 'shrink'
    text.attrs['data-spadewick-text-max-size'] = String(r(size))
    text.attrs['data-spadewick-text-min-size'] = String(Math.max(6, Math.round(size * 0.5)))
    // An invisible frame is only a guide; a drawn one stays
    const fill = String(rect.attrs.fill ?? '').toLowerCase()
    const visible = (fill && fill !== 'none' && fill !== 'transparent') || (rect.attrs.stroke && rect.attrs.stroke !== 'none')
    if (!visible || num(rect.attrs.opacity, 1) === 0) parents.get(rect).children = parents.get(rect).children.filter(c => c !== rect)
    bd.applied = true
  }

  function localBox(el) {
    const b = elementBox({ ...el, attrs: { ...el.attrs, transform: undefined } }, IDENTITY)
    return toRect(b)
  }

  /** The picture an element shows: its own, or the one in the pattern that fills it (Figma fills a rectangle with a pattern). */
  function pictureOf(el) {
    if (el.image) return el.image
    const m = /url\(#([^)\s]+)\)/.exec(el.attrs.fill ?? '')
    const pattern = m && byId.get(m[1])
    if (!pattern || pattern.tag !== 'pattern') return null
    let found = null
    walk(pattern, c => {
      if (found) return false
      if (c.image) found = c.image
      else if (c.tag === 'use' && c.attrs.href?.startsWith('#')) { const t = byId.get(c.attrs.href.slice(1)); if (t?.image) found = t.image }
    })
    return found
  }

  function bindImage(el, d) {
    const slug = d.action === 'field' || d.action === 'image' ? d.slug : fieldSlugFor(d)
    let sample = null
    const pic = pictureOf(el)
    if (pic && o.assetIds?.get(pic.hash)) sample = `asset:${o.assetIds.get(pic.hash)}`
    const parent = parents.get(el)
    const idx = parent.children.indexOf(el)
    if (el.tag === 'image') {
      el.attrs.href = `{{${slug}}}`
      el.attrs.preserveAspectRatio ??= 'xMidYMid slice'
      el.attrs['data-spadewick-id'] = idFor(slug)
      delete el.image; delete el.linked
      declareField(d, slug, sample)
      if (sample) samples[slug] ??= sample
      record(el, d, slug)
      return
    }
    const rect = localBox(el)
    if (!rect || rect[2] <= 0 || rect[3] <= 0) { warnings.push('imageNoBox'); return }
    const img = { tag: 'image', attrs: { 'data-spadewick-id': idFor(slug), x: String(rect[0]), y: String(rect[1]), width: String(rect[2]), height: String(rect[3]), href: `{{${slug}}}`, preserveAspectRatio: 'xMidYMid slice' }, children: [] }
    if (el.attrs.transform) img.attrs.transform = el.attrs.transform
    const replacement = [img]
    const rounded = (el.tag === 'rect' && (num(el.attrs.rx) > 0 || num(el.attrs.ry) > 0)) || ['ellipse', 'circle', 'path', 'polygon'].includes(el.tag)
    if (rounded) {
      const clipId = `clip-${img.attrs['data-spadewick-id']}`
      const shape = { ...structuredClone(el), attrs: { ...el.attrs } }
      delete shape.attrs.transform; delete shape.attrs.fill; delete shape.attrs.stroke; delete shape.attrs.style; delete shape.attrs['data-spadewick-id']; delete shape.attrs.id
      shape.children = []
      let defs = elementsOf(root).find(c => c.tag === 'defs')
      if (!defs) { defs = { tag: 'defs', attrs: {}, children: [] }; root.children.unshift(defs) }
      defs.children.push({ tag: 'clipPath', attrs: { id: clipId }, children: [shape] })
      img.attrs['clip-path'] = `url(#${clipId})`
    }
    // A frame drawn around the picture stays, without its fill
    if (el.attrs.stroke && el.attrs.stroke !== 'none') {
      const frame = structuredClone(el); frame.attrs.fill = 'none'; delete frame.attrs['data-spadewick-id']
      replacement.push(frame)
    }
    parent.children.splice(idx, 1, ...replacement)
    declareField(d, slug, sample)
    record(el, d, slug, { id: img.attrs['data-spadewick-id'] })
  }

  function bindColor(el, d) {
    const slug = d.action === 'color' ? d.slug : fieldSlugFor(d)
    const original = colorOf(el.attrs.fill)
    el.attrs.fill = `{{${slug}}}`
    el.attrs['data-spadewick-id'] = idFor(el.name || slug)
    declareField(d, slug, original)
    if (original) samples[slug] ??= original
    record(el, d, slug)
  }

  function bindIcon(el, d) {
    const name = iconKey(d.icon ?? '')
    if (!name) return
    if (el.tag === 'text') {
      el.attrs['data-spadewick-rich'] = 'true'
      el.attrs['data-spadewick-id'] = idFor(el.name || `icon_${name}`)
      const own = textOf(el).replace(/\s+/g, ' ').trim()
      for (const k of TEXT_STYLE) if (!el.attrs[k] && inherited(el, k)) el.attrs[k] = inherited(el, k)
      const spans = elementsOf(el).filter(c => c.tag === 'tspan')
      if (el.attrs.x === undefined && spans[0]?.attrs.x !== undefined) el.attrs.x = spans[0].attrs.x
      if (el.attrs.y === undefined && spans[0]?.attrs.y !== undefined) el.attrs.y = spans[0].attrs.y
      el.children = [textNode(`{icon:${name}}${own ? ` ${own}` : ''}`)]
      bindings.push({ name: d.name ?? el.name, occurrence: el.occurrence ?? 0, action: 'icon', icon: name, id: el.attrs['data-spadewick-id'] })
      return
    }
    const rect = localBox(el)
    if (!rect || rect[3] <= 0) { warnings.push('imageNoBox'); return }
    const parent = parents.get(el)
    const fill = colorOf(el.attrs.fill) ?? '#000000'
    const size = rect[3]
    const text = {
      tag: 'text',
      attrs: { 'data-spadewick-id': idFor(el.name || `icon_${name}`), 'data-spadewick-rich': 'true', x: String(Math.round((rect[0] + rect[2] / 2) * 100) / 100), y: String(Math.round((rect[1] + size * 0.5 + size * 0.85 - size / 2) * 100) / 100), 'font-size': String(Math.round(size * 100) / 100), 'text-anchor': 'middle', fill },
      children: [textNode(`{icon:${name}}`)]
    }
    if (el.attrs.transform) text.attrs.transform = el.attrs.transform
    parent.children.splice(parent.children.indexOf(el), 1, text)
    bindings.push({ name: d.name ?? el.name, occurrence: el.occurrence ?? 0, action: 'icon', icon: name, id: text.attrs['data-spadewick-id'] })
  }

  // ---- pictures ----
  walk(root, (el, anc) => {
    if (el.tag !== 'image') return
    const parent = anc[anc.length - 1]
    if (el.dropped) { parent.children = parent.children.filter(c => c !== el); return }
    if (String(el.attrs.href ?? '').startsWith('{{')) return
    if (el.image && o.assetIds?.get(el.image.hash)) { el.attrs.href = `{{@asset.${o.assetIds.get(el.image.hash)}}}`; delete el.image; return }
    // A picture that is not there: a grey box where it was
    const w = num(el.attrs.width), h = num(el.attrs.height)
    const box = { tag: 'rect', attrs: { x: el.attrs.x ?? '0', y: el.attrs.y ?? '0', width: String(w), height: String(h), fill: '#cccccc' }, children: [] }
    if (el.attrs.transform) box.attrs.transform = el.attrs.transform
    parent.children.splice(parent.children.indexOf(el), 1, box)
  })

  // ---- every element of the design is a layer of its own: the editor can select, move, resize and recolour each one, whatever group it is in ----
  let layers = 0
  walk(root, el => {
    if (el === root) return
    if (NOT_LAYERS.has(el.tag)) return false          // definitions, and the pieces of a text, are not layers
    if (layers >= MAX_LAYERS) { if (!warnings.includes('layersLimit')) warnings.push('layersLimit'); return false }
    layers++
    if (!el.attrs['data-spadewick-id']) el.attrs['data-spadewick-id'] = idFor(el.name && !GENERIC_NAME.test(el.name) ? el.name : el.tag)
    if (el.tag === 'text') return false
  })

  // ---- elements of an earlier import that are kept ----
  for (const k of o.keepRemoved ?? []) {
    if (k.node) root.children.push(k.node)
  }

  // ---- definitions nothing uses any more (the pattern of a picture that became a picture slot) ----
  pruneDefs(root)

  // ---- the root ----
  const vbIn = viewBoxFor(o.viewBox, o.size, o.card, o.fit)
  const widthPx = o.widthPx ?? 500
  const heightPx = Math.round(widthPx * o.card.mmH / o.card.mmW)
  const offCanvas = dropOffCanvas(root, vbIn)
  if (offCanvas) warnings.push('offCanvas')
  root.attrs = { xmlns: 'http://www.w3.org/2000/svg', width: String(widthPx), height: String(heightPx), viewBox: vbIn.join(' ') }
  // The checks that ran on names are no longer needed in the stored source
  walk(root, el => { for (const k of ['key', 'name', 'occurrence', 'image', 'linked', 'dropped']) delete el[k] })
  return { svg: serialize(root), newFields, samples, bindings, warnings, viewBox: vbIn }
}
