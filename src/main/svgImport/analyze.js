/**
 * Reading a design (PRD §19.2): parse, clean up, find the size and the binding candidates. Pure: no project, no files except
 * the pictures a design links to.
 */
import { createHash } from 'crypto'
import { parseXml, walk, elementsOf, serialize, SvgParseError } from './xml.js'
import { cleanTree, attachLinked } from './clean.js'
import { generatorOf, readSize, proposeCardSize, rankCardSizes, sameShape } from './size.js'
import { findCandidates, findOutlinedText, nameKey } from './bind.js'
import { elementBox, toRect } from './geometry.js'
import { ancestorMatrix } from './bind.js'
import { dropOffCanvas } from './canvas.js'

export { SvgParseError }

/** A path of element indices for every element: the same cleaned design always gives the same keys. */
function assignKeys(root) {
  const go = (node, prefix) => {
    elementsOf(node).forEach((c, i) => { c.key = prefix ? `${prefix}.${i}` : String(i); go(c, c.key) })
  }
  root.key = ''
  go(root, '')
}

const round2 = n => Math.round(n * 100) / 100
const MAX_FINGERPRINTS = 1500

/** What an element looked like, to tell later what changed (PRD §19.4): its name, where it is and a hash of its markup. */
function fingerprintOf(root) {
  const out = []
  const seen = new Map()
  walk(root, (el, anc) => {
    if (el === root) return
    if (['defs', 'style', 'clipPath', 'mask', 'linearGradient', 'radialGradient'].includes(el.tag) || anc.some(a => ['defs', 'clipPath', 'mask'].includes(a.tag))) return false
    const name = el.name
    if (!name || /^(g|rect|path|circle|ellipse|line|polygon|text|image|use)[\s_-]*\d*$/i.test(name)) return
    const k = nameKey(name)
    const occ = seen.get(k) ?? 0
    seen.set(k, occ + 1)
    if (out.length >= MAX_FINGERPRINTS) return false
    const rect = toRect(elementBox(el, ancestorMatrix(anc), e => e.children.reduce((n, c) => n + (c.text ?? '').length, 0)))
    out.push({ name, occurrence: occ, tag: el.tag, rect: rect ? rect.map(round2) : null, hash: createHash('sha1').update(serialize(stripKeys(el))).digest('hex').slice(0, 12) })
  })
  return out
}

const stripKeys = el => ({ tag: el.tag, attrs: el.image ? { ...el.attrs, 'data-picture': el.image.hash } : el.attrs, children: el.children.map(c => (c.tag ? stripKeys(c) : c)) })

/** What changed between the fingerprints of two versions of a design: names added, removed, moved or restyled. */
export function diffFingerprints(before, after) {
  const id = f => `${nameKey(f.name)}#${f.occurrence}`
  const old = new Map((before ?? []).map(f => [id(f), f]))
  const now = new Map(after.map(f => [id(f), f]))
  const added = [], removed = [], moved = [], restyled = []
  for (const [k, f] of now) {
    const o = old.get(k)
    if (!o) { added.push(f.name); continue }
    const differs = i => o.rect && f.rect && Math.abs(o.rect[i] - f.rect[i]) > 0.5
    if (differs(0) || differs(1) || differs(2) || differs(3)) moved.push(f.name)
    else if (o.hash !== f.hash) restyled.push(f.name)
  }
  for (const [k, f] of old) if (!now.has(k)) removed.push(f.name)
  return { added, removed, moved, restyled }
}

/**
 * @param {string} source the SVG text
 * @param {object} o
 * @param {{ name: string, slug: string, type: string }[]} o.fields
 * @param {string} [o.baseDir] where linked pictures are looked for
 * @param {Record<string,string>} [o.linked] element key -> path the person chose for a linked picture
 * @param {string[]} [o.searchDirs] folders the person pointed at: a linked picture not next to the design is looked for there, by name
 * @param {number} [o.bleedMm] bleed the file includes on each side, cut off
 * @param {Set<string>} o.availableFonts families (lower case) the project can draw
 * @param {object[]} [o.kept] bindings of an earlier import (re-import)
 * @param {{ mmW: number, mmH: number }} [o.fixedCard] the size of a template that is being re-imported (its size is locked)
 */
export function analyzeDesign(source, o) {
  const { root, comments } = parseXml(source)
  const generator = generatorOf(comments, root.attrs)
  const cleaned = cleanTree(root)
  assignKeys(root)
  const linked = attachLinked(root, cleaned.images, { baseDir: o.baseDir, linked: o.linked, searchDirs: o.searchDirs })
  cleaned.report.images.linked = linked
  const size0 = readSize(root.attrs, generator)
  if (!size0) throw new SvgParseError('no size')
  let { viewBox } = size0
  let { widthMm, heightMm } = size0
  const bleed = Number(o.bleedMm) > 0 ? Number(o.bleedMm) : 0
  if (bleed) {
    const unit = widthMm / viewBox[2]
    const b = bleed / unit
    if (viewBox[2] - 2 * b > 0 && viewBox[3] - 2 * b > 0) {
      viewBox = [viewBox[0] + b, viewBox[1] + b, viewBox[2] - 2 * b, viewBox[3] - 2 * b]
      widthMm -= 2 * bleed; heightMm -= 2 * bleed
    }
  }
  const size = { ...size0, viewBox, widthMm, heightMm }
  const fonts = cleaned.report.fonts.map(f => ({ ...f, status: o.availableFonts.has(f.family.toLowerCase()) ? 'available' : 'missing' }))
  const proposal = o.fixedCard
    ? { cardSize: 'fixed', cardMmW: o.fixedCard.mmW, cardMmH: o.fixedCard.mmH, preset: false, alternatives: [] }
    : proposeCardSize(widthMm, heightMm, !size0.assumed)
  const card = { mmW: proposal.cardMmW, mmH: proposal.cardMmH }
  const rows = findCandidates(root, o.fields, { kept: o.kept })
  return {
    root, images: cleaned.images, report: { ...cleaned.report, fonts },
    size, proposal, shapeDiffers: !sameShape(viewBox, card),
    rows, outlined: findOutlinedText(root, o.fields), fingerprint: fingerprintOf(root), generator,
    ranked: rankCardSizes(widthMm, heightMm, !size0.assumed).slice(0, 6).map(r => r.id)
  }
}

const IMAGE_TAGS = new Set(['image'])

/**
 * An SVG of the cleaned design that can be drawn right away (pictures in place, missing pictures as boxes), for the preview and
 * for the thumbnails of the review. `viewBox` can be narrowed to show one element.
 */
export function previewSvg(root, images, viewBox, width = 360) {
  const copy = structuredClone(root)
  dropOffCanvas(copy, viewBox)
  walk(copy, (el, anc) => {
    if (!IMAGE_TAGS.has(el.tag)) return
    const parent = anc[anc.length - 1]
    const img = el.image && images.get(el.image.hash)
    if (img) { el.attrs.href = `data:${img.mime};base64,${img.buffer.toString('base64')}`; return }
    if (el.dropped) { parent.children = parent.children.filter(c => c !== el); return }
    const box = { tag: 'rect', attrs: { x: el.attrs.x ?? '0', y: el.attrs.y ?? '0', width: el.attrs.width ?? '0', height: el.attrs.height ?? '0', fill: '#cccccc' }, children: [] }
    if (el.attrs.transform) box.attrs.transform = el.attrs.transform
    parent.children.splice(parent.children.indexOf(el), 1, box)
  })
  const h = Math.max(1, Math.round(width * viewBox[3] / viewBox[2]))
  copy.attrs = { xmlns: 'http://www.w3.org/2000/svg', width: String(width), height: String(h), viewBox: viewBox.join(' ') }
  return serialize(copy)
}
