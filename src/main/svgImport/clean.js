/**
 * Clean-up of an imported design (PRD §19.2 step 3, §19.5): everything that must not be stored or previewed is taken out and
 * counted, so the person can read what happened. Works on the tree of xml.js and changes it in place.
 */
import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { resolve, relative, extname, isAbsolute } from 'path'
import { walk, elementsOf, textOf } from './xml.js'
import { parseStyleSheet, appliedDeclarations, parseDeclarations, declarationsToText, PRESENTATION, familiesIn } from './css.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

const DROP = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas'])
const ANIMATION = new Set(['animate', 'animateTransform', 'animateMotion', 'animateColor', 'set', 'discard'])
const EDITOR_ATTR = /^(inkscape:|sodipodi:|sketch:|i:|serif:|figma:|adobe:|xmlns:(?!xlink)|enable-background$|version$|baseProfile$)/
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'initial'])

const sniff = b => {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}
const EXT_OF = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }

/** The name under which a design tool wrote an element: what binding looks at (PRD §19.3). */
export function nameOf(el) {
  const a = el.attrs
  for (const k of ['data-name', 'inkscape:label', 'id', 'aria-label']) {
    const v = a[k]
    if (typeof v === 'string' && v.trim()) return decodeToolName(v.trim())
  }
  return ''
}

/** Illustrator writes `_` and spaces as `_x5F_` and `_x20_` in ids. */
export function decodeToolName(s) {
  return s.replace(/_x([0-9a-f]{2,4})_/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

const isHidden = el => {
  const a = el.attrs
  if (/^\s*none\s*$/i.test(a.display ?? '') || /^\s*(hidden|collapse)\s*$/i.test(a.visibility ?? '')) return true
  const st = a.style ? parseDeclarations(a.style) : null
  return !!st && (/^none$/i.test(st.display ?? '') || /^(hidden|collapse)$/i.test(st.visibility ?? ''))
}

const urlOf = value => /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi

/**
 * @param {object} root parsed <svg>
 * @param {{ baseDir?: string, linked?: Record<string, string> }} [opts] baseDir: where linked images are looked for
 * @returns {{ report: object, images: Map<string, { mime: string, buffer: Buffer }>, keptStyles: boolean }}
 */
export function cleanTree(root, opts = {}) {
  const report = {
    removed: { scripts: 0, handlers: 0, foreignObjects: 0, animations: 0, metadata: 0, hidden: 0, externalRefs: 0, styleImports: 0, fontFaces: 0, unsupportedImages: 0 },
    images: { embedded: 0, linked: [] },
    unsupported: {},
    fonts: [],
    elementCount: 0,
    styleSheetKept: false
  }
  const images = new Map()
  const unsupported = kind => { report.unsupported[kind] = (report.unsupported[kind] ?? 0) + 1 }

  // ---- style sheets: understood rules go onto the elements, the rest stays ----
  const sheets = []
  walk(root, el => { if (el.tag === 'style' && (!el.attrs.type || /css/i.test(el.attrs.type))) sheets.push(el) })
  let rules = [], complex = false
  for (const s of sheets) {
    const p = parseStyleSheet(s.children.map(c => (c.text !== undefined ? c.text : '')).join(''))
    rules.push(...p.rules.map(r => ({ ...r, order: r.order + rules.length * 10000 })))
    complex ||= p.complex
    report.removed.styleImports += p.imports
    report.removed.fontFaces += p.fontFaces
  }
  if (!complex) {
    walk(root, el => {
      if (el.tag === 'style') return
      const applied = rules.length ? appliedDeclarations(rules, el) : {}
      const inline = el.attrs.style ? parseDeclarations(el.attrs.style) : {}
      const style = {}
      for (const [k, v] of Object.entries({ ...applied, ...inline })) {
        if (PRESENTATION.has(k) && !(k === 'transform' && el.attrs.transform && !(k in inline) && !(k in applied))) el.attrs[k] = v
        else style[k] = v
      }
      if (Object.keys(style).length) el.attrs.style = declarationsToText(style)
      else delete el.attrs.style
      if (rules.length) delete el.attrs.class
    })
    walk(root, (el, anc) => { if (el.tag === 'style') { const p = anc[anc.length - 1]; if (p) p.children = p.children.filter(c => c !== el) } })
  } else {
    report.styleSheetKept = true
    // Kept, but harmless: no imports, no fonts, no outside addresses
    for (const s of sheets) {
      for (const c of s.children) {
        if (c.text === undefined) continue
        c.text = c.text.replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(urlOf(), (m, q, u) => (u.startsWith('#') || u.startsWith('data:image/') ? m : 'none'))
      }
    }
  }

  // ---- removing what must not stay ----
  const refs = new Set()
  const prune = (el, anc) => {
    const parent = anc[anc.length - 1]
    const kill = counter => { parent.children = parent.children.filter(c => c !== el); if (counter) report.removed[counter]++; return false }
    const tag = el.tag
    el.name = nameOf(el)
    delete el.attrs['data-name']
    if (DROP.has(tag)) return kill(tag === 'foreignObject' ? 'foreignObjects' : 'scripts')
    if (ANIMATION.has(tag)) return kill('animations')
    if (tag === 'metadata' || tag === 'title' || tag === 'desc' || tag.includes(':') && !tag.startsWith('svg:')) return kill('metadata')
    if (/^(sodipodi|inkscape|sketch|i|x|adobe|rdf|cc|dc)\b/i.test(tag)) return kill('metadata')
    if (isHidden(el) && !anc.some(a => ['defs', 'symbol', 'clipPath', 'mask', 'pattern'].includes(a.tag)) && !['stop', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'defs', 'symbol', 'filter'].includes(tag)) return kill('hidden')
    if (el.attrs['xlink:href'] !== undefined) {
      if (el.attrs.href === undefined) el.attrs.href = el.attrs['xlink:href']
      delete el.attrs['xlink:href']
    }
    for (const k of Object.keys(el.attrs)) {
      if (k.startsWith('xlink:')) { delete el.attrs[k]; continue }
      const v = el.attrs[k]
      if (/^on/i.test(k)) { delete el.attrs[k]; report.removed.handlers++; continue }
      if (EDITOR_ATTR.test(k)) { delete el.attrs[k]; report.removed.metadata++; continue }
      if (typeof v === 'string' && /javascript:|vbscript:/i.test(v)) { delete el.attrs[k]; report.removed.handlers++; continue }
      if (k === 'href' || k === 'xlink:href') {
        if (v.startsWith('#')) { refs.add(v.slice(1)); continue }
        if (tag === 'image' && /^data:image\//i.test(v)) continue
        if (tag === 'image') continue                           // linked picture: handled below
        report.removed.externalRefs++; delete el.attrs[k]; continue
      }
      if (typeof v === 'string' && /url\(/i.test(v)) {
        el.attrs[k] = v.replace(urlOf(), (m, q, u) => { if (u.startsWith('#')) { refs.add(u.slice(1)); return m } report.removed.externalRefs++; return 'none' })
      }
    }
    if (el.attrs.style && /url\(/i.test(el.attrs.style)) {
      el.attrs.style = el.attrs.style.replace(urlOf(), (m, q, u) => (u.startsWith('#') ? m : (report.removed.externalRefs++, 'none')))
    }
    return true
  }
  const pruneAll = node => {
    for (const c of [...node.children]) {
      if (!c.tag) continue
      if (prune(c, [node]) !== false) pruneAll(c)
    }
  }
  pruneAll(root)

  // ---- images and print-unsafe features ----
  walk(root, el => {
    report.elementCount++
    const t = el.tag
    if (t === 'filter') unsupported('filter')
    else if (t === 'mask') unsupported('mask')
    else if (t === 'pattern') unsupported('pattern')
    if (el.attrs.filter && !/^none$/i.test(el.attrs.filter) && t !== 'filter') unsupported('filterUse')
    if (el.attrs['mix-blend-mode'] && !/^normal$/i.test(el.attrs['mix-blend-mode']) || /mix-blend-mode\s*:\s*(?!normal)/i.test(el.attrs.style ?? '')) unsupported('blendMode')
    if (t === 'image') {
      const href = el.attrs.href ?? el.attrs['xlink:href'] ?? ''
      delete el.attrs['xlink:href']
      const data = /^data:(image\/[a-z0-9.+-]+)?(;[^,]*)?,/i.exec(href)
      if (data) {
        const base64 = /;base64/i.test(data[2] ?? '')
        const raw = href.slice(data[0].length)
        let buf = null
        try { buf = base64 ? Buffer.from(raw.replace(/\s+/g, ''), 'base64') : Buffer.from(decodeURIComponent(raw), 'latin1') } catch { buf = null }
        const mime = buf && buf.length <= MAX_IMAGE_BYTES ? sniff(buf) : null
        if (!mime) { report.removed.unsupportedImages++; el.attrs.href = ''; el.dropped = true; return }
        const hash = createHash('sha1').update(buf).digest('hex').slice(0, 20)
        if (!images.has(hash)) images.set(hash, { mime, buffer: buf, bytes: buf.length })
        el.image = { hash, mime }
        el.attrs.href = ''
        report.images.embedded++
        return
      }
      el.attrs.href = ''
      el.linked = { href }
    }
  })

  // ---- fonts ----
  const counts = new Map()
  const addFamilies = (value) => {
    const list = familiesIn(value)
    if (!list.length) return
    const first = list[0]
    counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  walk(root, el => {
    if (el.attrs['font-family']) addFamilies(el.attrs['font-family'])
    if (el.attrs.style) { const d = parseDeclarations(el.attrs.style); if (d['font-family']) addFamilies(d['font-family']) }
    if (el.attrs.font && /\d.*\s+\S/.test(el.attrs.font)) { /* shorthand: not read */ }
  })
  for (const s of sheets) if (report.styleSheetKept) for (const c of s.children) if (c.text) for (const m of c.text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) addFamilies(m[1])
  report.fonts = [...counts].filter(([f]) => !GENERIC_FONTS.has(f.toLowerCase())).map(([family, uses]) => ({ family, uses }))
  return { report, images, keptStyles: report.styleSheetKept, referenced: refs }
}

/**
 * Linked pictures: found next to the design (or supplied by the person, by element key) they become embedded pictures,
 * the others stay marked as missing. Run after the elements have keys.
 * @returns {{ key: string, href: string, found: boolean }[]}
 */
export function attachLinked(root, images, opts = {}) {
  const out = []
  walk(root, el => {
    if (!el.linked) return
    const href = el.linked.href
    // the person's own choice first, then next to the design; failing both, the folders the person has pointed at (where a design keeps its textures)
    const candidate = [opts.linked?.[el.key], resolveLinked(href, opts.baseDir), ...searchedIn(href, opts.searchDirs)].find(c => c && existsSync(c) && IMAGE_EXT.has(extname(c).toLowerCase()))
    if (candidate) {
      try {
        const buf = statSync(candidate).size <= MAX_IMAGE_BYTES ? readFileSync(candidate) : null
        const mime = buf ? sniff(buf) : null
        if (mime) {
          const hash = createHash('sha1').update(buf).digest('hex').slice(0, 20)
          if (!images.has(hash)) images.set(hash, { mime, buffer: buf, bytes: buf.length })
          el.image = { hash, mime }; delete el.linked
          out.push({ key: el.key, href, found: true })
          return
        }
      } catch { /* stays missing */ }
    }
    out.push({ key: el.key, href, found: false })
  })
  return out
}

/** The file of a linked picture's name in each of the folders the person has pointed at (by name only: the path in the design is not followed there). */
function searchedIn(href, dirs) {
  if (!Array.isArray(dirs) || !href) return []
  const clean = decodeURI(String(href).replace(/^file:\/+/i, '').split(/[?#]/)[0])
  const name = clean.split(/[\\/]/).pop()
  if (!name || name === '.' || name === '..') return []
  return dirs.filter(d => typeof d === 'string' && d).slice(0, 10).map(d => resolve(d, name))
}

/** A linked picture's path, only when it lies inside the folder of the design (no absolute path, no `..` out of it). */
function resolveLinked(href, baseDir) {
  if (!baseDir || !href || /^[a-z][a-z0-9+.-]*:/i.test(href.replace(/^file:\/\/\/?/i, '')) && !/^file:/i.test(href)) return null
  const clean = decodeURI(href.replace(/^file:\/+/i, '').split(/[?#]/)[0])
  if (isAbsolute(clean) || /^[a-z]:/i.test(clean)) return null
  const full = resolve(baseDir, clean)
  const rel = relative(baseDir, full)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? full : null
}

export { EXT_OF, textOf, elementsOf }
