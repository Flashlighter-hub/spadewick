/**
 * Template storage (PRD §7.7): bundling a project template with what it needs, copying a library
 * or package template into a project (the clone rule), and the library on disk.
 *
 * One layout serves everything. A library item, an unpacked package and a bundle being built all
 * look like this, and a `.spadewick-template` file is simply that folder as a ZIP:
 *
 *   manifest.json            name, version, card size, templates, fonts, assets, palette, fields
 *   templates/*.svg          the template (role "main") and, if it inherits, its parent
 *   fonts/*                  only fonts that may be passed on
 *   assets/*                 the fixed images the template places with {{@asset.<id>}}
 *   mockup/cards.json        sample cards (at most 12), mockup/images/*, mockup/preview-N.png
 */
import { createHash, randomUUID } from 'crypto'
import { wrapChildFragment } from '../shared/templateChild.js'
import { join, basename, extname, dirname } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, statSync, renameSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'
import { rasterize } from './safeRaster.js'
import sharp from 'sharp'
import { rowOf, changesFor, recordChange } from './core/history.js'
import { importAssetFile } from './core/assets.js'
import { importFontFile } from './core/fonts.js'
import { extractSlugs } from './formula.js'
import { applyDynamicText } from './dynamicText.js'
import { defaultFontFiles, DEFAULT_FAMILIES, readFontInfo, readEmbeddingFlags, isSfnt } from './fontFiles.js'
import { renderCard } from './render.js'
import { normalizeCardSize, sizeColumns, sizeOfRow, sameCardSize, getCardSize } from './cardSize.js'
import { nextCardCode } from './cardIds.js'
import { starterTemplates } from './templateStarters.js'
import { sanitizeSvg } from '../shared/svgSafety.js'
import { upgradeLegacyMarkup } from '../shared/legacy.js'
import { isReservedFieldName } from '../shared/cardIds.js'
import { CARD_SIZE_BY_ID } from '../shared/cardSizes.js'
import { COND_ATTR, FIELD_ATTR, renameSlugInSvg } from '../shared/svgTokens.js'
import { tr } from '../shared/i18n.js'
import pkg from '../../package.json'

export const FORMAT = 1
export const LIMITS = { maxBytes: 100 * 1024 * 1024, maxEntries: 500, maxMockupCards: 12, maxNameLength: 200 }

const FIELD_TYPES = new Set(['text', 'number', 'boolean', 'image_ref', 'color', 'formula', 'rich_text'])
const sha = buf => createHash('sha256').update(buf).digest('hex')
const shaFile = file => sha(readFileSync(file))
const IMAGE = '(png|jpe?g|webp|svg)'
/** The only paths a package may contain. Anything else is refused, so a hostile archive cannot smuggle files in. */
export const ENTRY_PATTERN = new RegExp(`^(manifest\\.json|templates/[A-Za-z0-9._-]+\\.svg|fonts/[A-Za-z0-9._-]+\\.(ttf|otf|ttc)|assets/[A-Za-z0-9._-]+\\.${IMAGE}|mockup/cards\\.json|mockup/images/[A-Za-z0-9._-]+\\.${IMAGE}|mockup/preview-\\d{1,3}\\.png)$`, 'i')

const fail = message => { throw new Error(message) }

// ---------------------------------------------------------------------------
// Reading and checking a folder
// ---------------------------------------------------------------------------

const isStr = (v, max = 2000) => typeof v === 'string' && v.length <= max
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)

/** Validate a parsed manifest; returns it, or throws a message that says what is wrong. */
export function validateManifest(m, dir = null) {
  const bad = reason => fail(tr('library.invalidPackage', { reason }))
  if (!m || typeof m !== 'object' || Array.isArray(m)) bad(tr('library.reasonNotObject'))
  if (!Number.isInteger(m.format) || m.format < 1) bad(tr('library.reasonFormat'))
  if (m.format > FORMAT) fail(tr('library.packageTooNew', { found: m.format, supported: FORMAT }))
  if (!isStr(m.name, LIMITS.maxNameLength) || !m.name.trim()) bad(tr('library.reasonName'))
  for (const key of ['description', 'author', 'license']) if (m[key] != null && !isStr(m[key], 20000)) bad(tr('library.reasonText', { key }))
  if (!Number.isInteger(m.version) || m.version < 1) m.version = 1
  const list = (key, max) => { if (m[key] == null) m[key] = []; if (!Array.isArray(m[key]) || m[key].length > max) bad(tr('library.reasonList', { key })); return m[key] }
  const files = []
  const need = file => {
    if (!isStr(file, 200) || !ENTRY_PATTERN.test(file)) bad(tr('library.reasonPath', { file: String(file).slice(0, 80) }))
    if (dir && !existsSync(join(dir, file))) bad(tr('library.reasonMissingFile', { file }))
    files.push(file)
  }
  const templates = list('templates', 2)
  if (!templates.length) bad(tr('library.reasonNoTemplate'))
  templates.forEach((t, i) => {
    need(t?.file)
    if (!isStr(t.name, LIMITS.maxNameLength) || !t.name.trim()) bad(tr('library.reasonName'))
    if (t.role !== (i === 0 ? 'main' : 'parent')) bad(tr('library.reasonRoles'))
  })
  for (const f of list('fonts', 40)) { need(f?.file); if (!/^fonts\//.test(f.file)) bad(tr('library.reasonPath', { file: f.file })) }
  for (const a of list('assets', 100)) {
    need(a?.file); if (!/^assets\//.test(a.file) || !isStr(a.id, 100)) bad(tr('library.reasonPath', { file: String(a.file) }))
  }
  list('icons', 0)   // reserved for the icon library of a later version
  for (const p of list('palette', 100)) {
    if (!isStr(p?.name, 100) || !/^[A-Za-z0-9_-]+$/.test(p.name) || !isStr(p.label ?? p.name, 200) || !isHex(p.value)) bad(tr('library.reasonPalette'))
    p.label = p.label ?? p.name
  }
  const slugs = new Set()
  for (const f of list('fields', 200)) {
    if (!isStr(f?.name, 200) || !f.name.trim() || !isStr(f.slug, 100) || !/^[a-z][a-z0-9_]*$/.test(f.slug) || !FIELD_TYPES.has(f.type)) bad(tr('library.reasonField'))
    if (isReservedFieldName(f.slug) || isReservedFieldName(f.name) || slugs.has(f.slug)) bad(tr('library.reasonField'))
    for (const key of ['default_value', 'formula', 'validation']) if (f[key] != null && !isStr(f[key], 5000)) bad(tr('library.reasonField'))
    slugs.add(f.slug)
  }
  m.purpose = m.purpose === 'back' ? 'back' : undefined     // what the template is for: a card back, or (by default) the front of a card
  m.mockup = m.mockup && typeof m.mockup === 'object' ? m.mockup : { cards: null, previews: [] }
  if (m.mockup.cards != null) need(m.mockup.cards)
  m.mockup.previews = Array.isArray(m.mockup.previews) ? m.mockup.previews.slice(0, LIMITS.maxMockupCards) : []
  m.mockup.previews.forEach(need)
  if (new Set(files).size !== files.length) bad(tr('library.reasonDuplicateFile'))
  return m
}

export function readManifest(dir) {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) fail(tr('library.invalidPackage', { reason: tr('library.reasonNoManifest') }))
  let parsed
  try { parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { fail(tr('library.invalidPackage', { reason: tr('library.reasonNotJson') })) }
  return validateManifest(parsed, dir)
}

/** The template SVGs of an item, made safe, in manifest order. */
export function readTemplates(dir, manifest) {
  return manifest.templates.map(t => ({ ...t, svg: sanitizeSvg(upgradeLegacyMarkup(readFileSync(join(dir, t.file), 'utf8'))) }))
}

export function readMockupCards(dir, manifest) {
  if (!manifest.mockup.cards) return []
  try {
    const cards = JSON.parse(readFileSync(join(dir, manifest.mockup.cards), 'utf8'))
    return Array.isArray(cards) ? cards.slice(0, LIMITS.maxMockupCards).filter(c => c && typeof c === 'object') : []
  } catch { return [] }
}

/** Replace SVG files of an unpacked package by sanitised copies (the images as well as the templates). */
export function sanitizeFolder(dir, manifest) {
  for (const t of manifest.templates) {
    const file = join(dir, t.file)
    writeFileSync(file, sanitizeSvg(readFileSync(file, 'utf8')))
  }
  const images = [...manifest.assets.map(a => a.file), ...walkFiles(join(dir, 'mockup', 'images')).map(f => `mockup/images/${basename(f)}`)]
  for (const rel of images) if (extname(rel).toLowerCase() === '.svg') writeFileSync(join(dir, rel), sanitizeSvg(readFileSync(join(dir, rel), 'utf8')))
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkFiles(p, out); else out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// What a template refers to
// ---------------------------------------------------------------------------

const TOKEN_SLUG = /\{\{\s*(\w+)\s*\}\}/g

export function referencedSlugs(svgs) {
  const slugs = new Set()
  for (const svg of svgs) {
    for (const m of svg.matchAll(TOKEN_SLUG)) slugs.add(m[1])
    for (const m of svg.matchAll(FIELD_ATTR)) slugs.add(m[1])
    for (const m of svg.matchAll(COND_ATTR)) for (const s of extractSlugs(m[1])) slugs.add(s)
  }
  slugs.delete('display_name')
  return slugs
}

const referencedAssetIds = svgs => new Set(svgs.flatMap(svg => [...svg.matchAll(/\{\{\s*@asset\.([^}\s]+)\s*\}\}/g)].map(m => m[1])))

/**
 * Packages made before the project palette was removed list colours by name. They are written into the template
 * itself on the way in, so a template never depends on anything outside it (PRD §7.7).
 */
export function inlineLegacyPalette(svg, palette = []) {
  if (!palette.length && !/@palette\.|palette\(/.test(svg)) return svg
  const byName = Object.fromEntries(palette.map(p => [p.name, p.value]))
  return svg
    .replace(/\{\{\s*@palette\.([^}\s]+)\s*\}\}/g, (_, n) => byName[n] ?? '')
    .replace(/palette\(\s*(["'])([^"']+)\1\s*\)/g, (_, _q, n) => `"${byName[n] ?? n}"`)
}

/** The card size a manifest declares, as { id, mmW, mmH } (Poker when it declares none). */
export function sizeOfManifest(manifest) {
  const c = manifest.cardSize
  if (c?.id && CARD_SIZE_BY_ID[c.id]) return normalizeCardSize({ cardSize: c.id })
  return normalizeCardSize({ cardSize: c?.mmW > 0 && c?.mmH > 0 ? 'custom' : null, cardMmW: c?.mmW, cardMmH: c?.mmH })
}

// ---------------------------------------------------------------------------
// Building an item folder from a project template
// ---------------------------------------------------------------------------

const metaOf = (db, key) => db.prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value ?? null

/** The template, its parent and what they use, so the caller can show it before anything is written. */
export function describeBundle(db, projectDir, templateId, setId = null) {
  const main = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  if (!main) fail(tr('errors.templateNotFound'))
  const parent = main.parent_id ? db.prepare('SELECT * FROM templates WHERE id = ?').get(main.parent_id) : null
  const rows = [main, ...(parent ? [parent] : [])]
  const svgs = rows.map(t => sanitizeSvg(upgradeLegacyMarkup(t.svg_source)))
  const lower = svgs.join('\n').toLowerCase()

  const fonts = db.prepare('SELECT * FROM fonts').all().filter(f => lower.includes(f.family_name.toLowerCase())).map(f => {
    const file = join(projectDir, 'fonts', f.filename)
    const flags = existsSync(file) ? readEmbeddingFlags(readFileSync(file)) : null
    return { id: f.id, family: f.family_name, style: f.style, filename: f.filename, missing: !existsSync(file), restricted: !!flags?.restricted, previewOnly: !!flags?.previewOnly }
  })
  const assetIds = referencedAssetIds(svgs)
  const assets = db.prepare('SELECT * FROM assets').all().filter(a => assetIds.has(a.id))

  let fields = []
  if (setId) {
    const all = db.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(setId)
    const bySlug = new Map(all.map(f => [f.slug, f]))
    const wanted = referencedSlugs(svgs)
    const queue = [...wanted]
    while (queue.length) {   // a formula field needs the fields it reads
      const f = bySlug.get(queue.pop())
      if (f?.type === 'formula') for (const s of extractSlugs(f.formula ?? '')) if (!wanted.has(s)) { wanted.add(s); queue.push(s) }
    }
    fields = all.filter(f => wanted.has(f.slug))
  }
  return { main, parent, rows, svgs, fonts, assets, fields }
}

/**
 * Write the item folder for `templateId` into `outDir`. `fontIds` limits which fonts are included
 * (default: all that are allowed). Returns { manifest, includedFonts, skippedFonts }.
 */
export async function buildItemFolder(db, projectDir, outDir, { templateId, setId = null, meta = {}, fontIds = null, mockupCardIds = null }) {
  const bundle = describeBundle(db, projectDir, templateId, setId)
  rmSync(outDir, { recursive: true, force: true })
  for (const sub of ['templates', 'fonts', 'assets', 'mockup/images']) mkdirSync(join(outDir, sub), { recursive: true })

  const templates = bundle.rows.map((row, i) => {
    const file = `templates/${i === 0 ? 'main' : 'parent'}.svg`
    writeFileSync(join(outDir, file), bundle.svgs[i])
    return { file, name: row.name, role: i === 0 ? 'main' : 'parent' }
  })

  const includedFonts = [], skippedFonts = []
  const fontEntries = []
  for (const f of bundle.fonts) {
    const wanted = fontIds ? fontIds.includes(f.id) : true
    if (!wanted || f.restricted || f.missing) { skippedFonts.push(f); continue }
    const file = `fonts/${f.filename}`
    copyFileSync(join(projectDir, 'fonts', f.filename), join(outDir, file))
    fontEntries.push({ file, family: f.family, style: f.style })
    includedFonts.push(f)
  }

  const assetEntries = []
  for (const a of bundle.assets) {
    const src = join(projectDir, 'assets', a.filename)
    if (!existsSync(src)) continue
    const file = `assets/${a.id}${extname(a.filename).toLowerCase()}`
    copyFileSync(src, join(outDir, file))
    assetEntries.push({ id: a.id, file, name: a.original_name, sha256: shaFile(src) })
  }

  // Sample cards: the chosen ones (at most 12), else the first few cards of the set
  let mockupCards = [], previews = []
  if (setId) {
    const pool = db.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(setId)
    const chosen = (mockupCardIds?.length ? pool.filter(c => mockupCardIds.includes(c.id)) : pool.slice(0, 6)).slice(0, LIMITS.maxMockupCards)
    const slugs = new Set(bundle.fields.map(f => f.slug))
    const imageTypes = new Set(bundle.fields.filter(f => f.type === 'image_ref').map(f => f.slug))
    let n = 0
    for (const card of chosen) {
      const values = JSON.parse(card.fields_json), out = {}
      for (const [slug, v] of Object.entries(values)) {
        if (!slugs.has(slug)) continue
        if (imageTypes.has(slug) && typeof v === 'string' && v.startsWith('asset:')) {
          const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(v.slice(6))
          const src = a && join(projectDir, 'assets', a.filename)
          if (src && existsSync(src)) {
            const file = `mockup/images/${a.id}${extname(a.filename).toLowerCase()}`
            copyFileSync(src, join(outDir, file))
            out[slug] = `mockup-image:${file}`
            continue
          }
          out[slug] = ''
          continue
        }
        out[slug] = v
      }
      mockupCards.push({ display_name: card.display_name, quantity: card.quantity, fields: out })
      try {
        const png = await renderCard(projectDir, card.id, { templateId, width: 300 })
        const file = `mockup/preview-${++n}.png`
        writeFileSync(join(outDir, file), png)
        previews.push(file)
      } catch { /* a card that cannot render simply has no preview */ }
    }
    if (mockupCards.length) writeFileSync(join(outDir, 'mockup/cards.json'), JSON.stringify(mockupCards, null, 2))
  }

  const size = sizeOfRow(bundle.main)   // the template's own size, fixed when it was made
  // A template that is only ever a card back (never the front of a set or a card) is saved as one, so it comes back as a back (PRD §7.8)
  const mainId = bundle.main.id
  const asBack = db.prepare('SELECT (SELECT COUNT(*) FROM sets WHERE default_back_template_id = ?) + (SELECT COUNT(*) FROM cards WHERE back_template_id = ? AND deleted = 0) AS n').get(mainId, mainId).n > 0
  const asFront = db.prepare('SELECT (SELECT COUNT(*) FROM sets WHERE default_template_id = ?) + (SELECT COUNT(*) FROM cards WHERE template_id = ? AND deleted = 0) AS n').get(mainId, mainId).n > 0
  const manifest = {
    format: FORMAT, id: meta.id ?? randomUUID(), version: meta.version ?? 1,
    name: (meta.name ?? bundle.main.name).slice(0, LIMITS.maxNameLength), description: meta.description ?? '', author: meta.author ?? '', license: meta.license ?? '',
    appVersion: pkg.version, createdAt: Date.now(),
    cardSize: { id: size.id, mmW: size.mmW, mmH: size.mmH }, ...(asBack && !asFront ? { purpose: 'back' } : {}),
    templates, fonts: fontEntries, assets: assetEntries, icons: [],
    fields: bundle.fields.map(f => ({ name: f.name, slug: f.slug, type: f.type, default_value: f.default_value, formula: f.formula, validation: f.validation })),
    mockup: { cards: mockupCards.length ? 'mockup/cards.json' : null, previews }
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { manifest, includedFonts, skippedFonts }
}

/** Every file of a folder as zip entries (names with forward slashes). */
export function folderEntries(dir) {
  return walkFiles(dir).map(file => ({ name: file.slice(dir.length + 1).split(/[\\/]/).join('/'), file }))
}

// ---------------------------------------------------------------------------
// The clone rule
// ---------------------------------------------------------------------------

const sameRules = (a, b) => (a.validation ?? null) === (b.validation ?? null) && (a.formula ?? null) === (b.formula ?? null) && (a.default_value ?? null) === (b.default_value ?? null)

/**
 * What would clash if this item were copied into the project (and `setId`): a field with the same
 * slug but another type or rules. A set can only use a template of its own card size, so a different size
 * is reported as `sizeMismatch` and the copy is refused (PRD §10.6). Fonts and
 * images never clash: the same file is reused, and a different file with a font's name keeps the
 * project's font (reported in `notes`).
 */
export function planClone(db, projectDir, dir, manifest, setId = null, { newSet = false } = {}) {
  const clashes = [], notes = []
  if (setId) {
    for (const f of manifest.fields) {
      const mine = db.prepare('SELECT * FROM fields WHERE set_id = ? AND slug = ?').get(setId, f.slug)
      if (mine && (mine.type !== f.type || !sameRules(mine, f))) {
        clashes.push({ kind: 'field', key: f.slug, mine: { name: mine.name, type: mine.type }, theirs: { name: f.name, type: f.type }, options: ['map', 'rename', 'cancel'] })
      }
    }
  } else if (manifest.fields.length && !newSet) notes.push(tr('library.noteFieldsSkipped', { n: manifest.fields.length }))
  for (const f of manifest.fonts) {
    const info = readFontInfo(readFileSync(join(dir, f.file)))
    if (!info) continue
    const mine = db.prepare('SELECT * FROM fonts WHERE family_name = ? AND style = ?').get(info.family, info.style)
    if (mine && existsSync(join(projectDir, 'fonts', mine.filename)) && shaFile(join(projectDir, 'fonts', mine.filename)) !== shaFile(join(dir, f.file)))
      notes.push(tr('library.noteFontKept', { family: info.family, style: info.style }))
  }
  const size = getCardSize(db, setId)
  const theirs = sizeOfManifest(manifest)
  const sizeMismatch = !!setId && !newSet && !sameCardSize(size, theirs)
  if (sizeMismatch) notes.push(tr('library.noteSizeDiffers', { theirs: `${theirs.mmW} × ${theirs.mmH}`, mine: `${size.mmW} × ${size.mmH}` }))
  return { clashes, notes, sizeMismatch }
}

const uniqueName = (db, base, exceptId = null) => {
  let name = base, i = 2
  while (db.prepare('SELECT 1 FROM templates WHERE name = ? AND id IS NOT ?').get(name, exceptId)) name = `${base} ${i++}`
  return name
}

export const svgHashOf = svg => sha(svg)

const originOf = (source, item, manifest, svgs, index = 0) => JSON.stringify({
  role: index === 0 ? 'main' : 'parent',
  source, kind: item.kind ?? null, itemId: item.id ?? manifest.id, version: manifest.version, name: manifest.name,
  fingerprint: sha(JSON.stringify([svgs, manifest.fields, manifest.palette, manifest.fonts.map(f => f.file), manifest.assets.map(a => a.sha256)])),
  svgHash: sha(svgs[index] ?? ''), date: Date.now()
})

/**
 * Copy an item into the project. Everything is checked first (`resolutions` must settle every
 * clash), fonts and images are added, and then the rows are written as one undoable step.
 *
 * @param opts.setId              set that receives the field definitions (and sample cards)
 * @param opts.resolutions        { fields: {slug: 'map'|'rename'} } or 'keep-mine'
 * @param opts.source             'library' | 'package'
 * @param opts.item               { kind, id } for the origin note
 * @param opts.replaceMainId      overwrite this project template instead of adding one (update / reset)
 */
export async function applyClone(db, projectDir, dir, manifest, opts = {}) {
  const { setId = null, source = 'library', item = {}, includeSampleCards = false, makeDefault = false, asBack = false, replaceMainId = null } = opts
  const plan = planClone(db, projectDir, dir, manifest, setId)
  const keepMine = opts.resolutions === 'keep-mine'
  const res = keepMine ? { fields: {} } : (opts.resolutions ?? { fields: {} })
  const choice = c => (keepMine ? 'map' : res.fields?.[c.key])
  if (plan.sizeMismatch && !replaceMainId) fail(tr('library.sizeMismatch'))
  const existingForSize = replaceMainId ? db.prepare('SELECT * FROM templates WHERE id = ?').get(replaceMainId) : null
  if (existingForSize && !sameCardSize(sizeOfRow(existingForSize), sizeOfManifest(manifest))) fail(tr('library.sizeMismatchCopy'))
  for (const c of plan.clashes) {
    const v = choice(c)
    if (!v) fail(tr('library.unresolvedClash', { key: c.key }))
    if (v === 'cancel') fail(tr('library.cancelled'))
    if (!c.options.includes(v)) fail(tr('library.unresolvedClash', { key: c.key }))
  }
  const clashByKey = new Map(plan.clashes.map(c => [`${c.kind}:${c.key}`, c]))

  // 1. Fonts and images (files first; they are additive and harmless if the rows fail)
  const fontsDir = join(projectDir, 'fonts'); mkdirSync(fontsDir, { recursive: true })
  for (const f of manifest.fonts) {
    const data = readFileSync(join(dir, f.file))
    if (!isSfnt(data)) fail(tr('errors.notValidFont', { file: f.file }))
    await importFontFile(db, fontsDir, join(dir, f.file))
  }
  const assetMap = new Map()
  const existingBySha = new Map()
  for (const a of db.prepare('SELECT * FROM assets').all()) {
    const file = join(projectDir, 'assets', a.filename)
    if (existsSync(file)) existingBySha.set(shaFile(file), a.id)
  }
  const importImage = async (file, name) => {
    const full = join(dir, file), hash = shaFile(full)
    if (existingBySha.has(hash)) return existingBySha.get(hash)
    const row = await importAssetFile(db, join(projectDir, 'assets'), full, { record: false, originalName: name })
    if (!row) return null
    existingBySha.set(hash, row.id)
    return row.id
  }
  for (const a of manifest.assets) { const id = await importImage(a.file, a.name || basename(a.file)); if (id) assetMap.set(a.id, id) }
  const sampleCards = includeSampleCards && setId ? readMockupCards(dir, manifest) : []
  const sampleImages = new Map()
  for (const c of sampleCards) for (const v of Object.values(c.fields ?? {})) {
    if (typeof v === 'string' && v.startsWith('mockup-image:') && !sampleImages.has(v)) {
      const rel = v.slice('mockup-image:'.length)
      if (ENTRY_PATTERN.test(rel) && existsSync(join(dir, rel))) { const id = await importImage(rel, basename(rel)); if (id) sampleImages.set(v, `asset:${id}`) }
    }
  }

  // 2. Rows, in one transaction and one undo step
  const changes = []
  const out = { templateId: null, parentId: null, createdFields: [], notes: [...plan.notes] }
  const now = Date.now()
  let svgs = readTemplates(dir, manifest).map(t => inlineLegacyPalette(t.svg, manifest.palette))
  const slugMap = new Map()   // incoming slug -> slug used in this project

  db.transaction(() => {
    if (setId) {
      let order = db.prepare('SELECT COALESCE(MAX(display_order), -1) AS m FROM fields WHERE set_id = ?').get(setId).m + 1
      for (const f of manifest.fields) {
        const mine = db.prepare('SELECT * FROM fields WHERE set_id = ? AND slug = ?').get(setId, f.slug)
        const clash = clashByKey.get(`field:${f.slug}`)
        const v = clash ? choice(clash) : mine ? 'map' : 'new'
        if (v === 'map') { slugMap.set(f.slug, f.slug); continue }
        let slug = f.slug, name = f.name
        if (v === 'rename') {
          let i = 2; while (db.prepare('SELECT 1 FROM fields WHERE set_id = ? AND slug = ?').get(setId, `${f.slug}_${i}`)) i++
          slug = `${f.slug}_${i}`; name = `${f.name} ${i}`
          svgs = svgs.map(s => renameSlugInSvg(s, f.slug, slug))
        }
        slugMap.set(f.slug, slug)
        const id = randomUUID()
        db.prepare(`INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(id, setId, name, slug, f.type, f.default_value ?? null, f.formula ?? null, f.validation ?? null, order++, now)
        changes.push({ table: 'fields', before: null, after: rowOf(db, 'fields', id) })
        out.createdFields.push(slug)
      }
    }

    // fixed images: point {{@asset.<old id>}} at this project's copy (a missing image renders empty)
    svgs = svgs.map(s => s.replace(/\{\{\s*@asset\.([^}\s]+)\s*\}\}/g, (m, id) => (assetMap.has(id) ? `{{@asset.${assetMap.get(id)}}}` : m)))

    if (svgs.length > 1) svgs[0] = wrapChildFragment(svgs[0], svgs[1])   // a child is a complete document, so the canvas editor can open it

    const writeTemplate = (name, svg, parentId, existingId, origin) => {
      if (existingId) {
        const before = rowOf(db, 'templates', existingId)
        db.prepare('UPDATE templates SET svg_source = ?, parent_id = ?, origin = ?, updated_at = ? WHERE id = ?').run(svg, parentId, origin, now, existingId)
        changes.push({ table: 'templates', before, after: rowOf(db, 'templates', existingId) })
        return existingId
      }
      const id = randomUUID()
      db.prepare('INSERT INTO templates (id, name, parent_id, svg_source, origin, card_size, card_mm_w, card_mm_h, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, uniqueName(db, name), parentId, svg, origin, ...sizeColumns(sizeOfManifest(manifest)), now, now)
      changes.push({ table: 'templates', before: null, after: rowOf(db, 'templates', id) })
      return id
    }

    const origin = originOf(source, item, manifest, svgs)
    const existingMain = replaceMainId ? db.prepare('SELECT * FROM templates WHERE id = ?').get(replaceMainId) : null
    if (manifest.templates.length > 1) {
      out.parentId = writeTemplate(manifest.templates[1].name, svgs[1], null, existingMain?.parent_id ?? null, originOf(source, item, manifest, svgs, 1))
    }
    out.templateId = writeTemplate(manifest.templates[0].name, svgs[0], out.parentId, existingMain?.id ?? null, origin)
    // the main template's parent link must point at the (new) parent even when the copy had none before
    if (existingMain && out.parentId && existingMain.parent_id !== out.parentId) db.prepare('UPDATE templates SET parent_id = ? WHERE id = ?').run(out.parentId, out.templateId)

    if (setId && (makeDefault || asBack)) {
      const before = rowOf(db, 'sets', setId)
      // the template becomes the set's card back, or its default template (PRD §7.8)
      db.prepare(`UPDATE sets SET ${asBack ? 'default_back_template_id' : 'default_template_id'} = ?, updated_at = ? WHERE id = ?`).run(out.templateId, now, setId)
      changes.push({ table: 'sets', before, after: rowOf(db, 'sets', setId) })
    }

    // sample cards (at the end of the set, with fresh IDs)
    if (sampleCards.length) {
      let sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM cards WHERE set_id = ? AND deleted = 0').get(setId).m + 1
      const defaults = {}
      for (const f of db.prepare('SELECT slug, default_value FROM fields WHERE set_id = ?').all(setId)) defaults[f.slug] = f.default_value ?? ''
      // a sample card has a name; a set without a display name gets a text field for it (UPDATES U10)
      let nameSlug = db.prepare('SELECT display_field FROM sets WHERE id = ?').get(setId)?.display_field ?? null
      if (!nameSlug && sampleCards.some(c => c.display_name)) {
        const taken = new Set(Object.keys(defaults))
        const before = rowOf(db, 'sets', setId)
        if (db.prepare("SELECT 1 FROM fields WHERE set_id = ? AND slug = 'name' AND type = 'text'").get(setId)) nameSlug = 'name'   // the design's own name field names the cards
        else {
          nameSlug = ['name', 'display_name', 'card_name'].find(s => !taken.has(s)) ?? 'sample_name'
          db.prepare('UPDATE fields SET display_order = display_order + 1 WHERE set_id = ?').run(setId)
          const fid = randomUUID()
          db.prepare("INSERT INTO fields (id, set_id, name, slug, type, display_order, hidden, created_at) VALUES (?, ?, ?, ?, 'text', 0, 0, ?)").run(fid, setId, tr('fieldManager.starterName'), nameSlug, now)
          changes.push({ table: 'fields', before: null, after: rowOf(db, 'fields', fid) })
          out.createdFields.push(nameSlug)
        }
        db.prepare('UPDATE sets SET display_field = ? WHERE id = ?').run(nameSlug, setId)
        changes.push({ table: 'sets', before, after: rowOf(db, 'sets', setId) })
      }
      for (const c of sampleCards) {
        const values = { ...defaults }
        for (const [slug, v] of Object.entries(c.fields ?? {})) {
          const target = slugMap.get(slug) ?? slug
          values[target] = typeof v === 'string' && v.startsWith('mockup-image:') ? (sampleImages.get(v) ?? '') : String(v ?? '')
        }
        const id = randomUUID()
        if (nameSlug && c.display_name && !values[nameSlug]) values[nameSlug] = String(c.display_name).slice(0, 200)
        db.prepare(`INSERT INTO cards (id, set_id, card_code, template_id, quantity, fields_json, sort_order, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .run(id, setId, nextCardCode(db, setId), out.templateId, (Number.isInteger(c.quantity) && c.quantity >= 0 && c.quantity <= 999 ? c.quantity : 1), JSON.stringify(values), sort++, now, now)
        changes.push({ table: 'cards', before: null, after: rowOf(db, 'cards', id) })
      }
    }
    recordChange(db, replaceMainId ? 'UPDATE_TEMPLATE_FROM_LIBRARY' : 'USE_LIBRARY_TEMPLATE', changes)
  })()
  return out
}

// ---------------------------------------------------------------------------
// The library on disk
// ---------------------------------------------------------------------------

export const mineDir = root => join(root, 'mine')

/** A starter template written to a temporary folder in the common layout; call `cleanup()` when done. */
export function materializeStarter(id) {
  const starter = starterTemplates().find(s => s.manifest.id === id)
  if (!starter) fail(tr('library.itemMissing'))
  const dir = join(tmpdir(), `spadewick-starter-${randomUUID()}`)
  for (const [rel, text] of Object.entries(starter.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text) }
  if (starter.mockupCards.length) { mkdirSync(join(dir, 'mockup'), { recursive: true }); writeFileSync(join(dir, 'mockup/cards.json'), JSON.stringify(starter.mockupCards)) }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(starter.manifest))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Open an item of the library ({ kind: 'starter' | 'mine', id }) for reading. */
export function openItem(root, { kind, id }) {
  if (kind === 'starter') { const { dir, cleanup } = materializeStarter(id); return { dir, manifest: readManifest(dir), cleanup } }
  if (kind === 'mine' && /^[A-Za-z0-9-]{1,64}$/.test(String(id))) {
    const dir = join(mineDir(root), id)
    if (existsSync(join(dir, 'manifest.json'))) return { dir, manifest: readManifest(dir), cleanup: () => {} }
  }
  return fail(tr('library.itemMissing'))
}

export function listMine(root) {
  const base = mineDir(root)
  if (!existsSync(base)) return []
  const out = []
  for (const id of readdirSync(base)) {
    try { out.push({ kind: 'mine', id, dir: join(base, id), manifest: readManifest(join(base, id)) }) } catch { /* a damaged item is skipped, not fatal */ }
  }
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}

/** Store an item folder as "My template" `id`; returns the stored manifest. An existing item is replaced. */
export function storeMine(root, id, folder) {
  const dest = join(mineDir(root), id)
  mkdirSync(mineDir(root), { recursive: true })
  const staging = `${dest}.new`
  rmSync(staging, { recursive: true, force: true })
  renameOrCopy(folder, staging)
  rmSync(dest, { recursive: true, force: true })
  renameSync(staging, dest)
  return readManifest(dest)
}

function renameOrCopy(from, to) {
  try { renameSync(from, to) } catch {
    for (const e of folderEntries(from)) { mkdirSync(dirname(join(to, e.name)), { recursive: true }); copyFileSync(e.file, join(to, e.name)) }
    rmSync(from, { recursive: true, force: true })
  }
}

export function removeMine(root, id) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(id))) return
  rmSync(join(mineDir(root), id), { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/** A child template placed into its parent's slots, as the renderer does it (PRD §7.2). */
export function mergeWithParent(childSvg, parentSvg) {
  if (parentSvg == null) return childSvg
  const child = upgradeLegacyMarkup(childSvg)
  let merged = upgradeLegacyMarkup(parentSvg)
  for (const [, name, content] of child.matchAll(/<!--\s*spadewick:fills="([^"]+)"\s*-->([\s\S]*?)(?=<!--\s*spadewick:fills=|<\/svg>|$)/g)) {
    merged = merged.replace(new RegExp(`<!--\\s*spadewick:slot="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*-->`, 'g'), () => content)
  }
  return merged.replace(/<!--\s*spadewick:slot="[^"]*"\s*-->/g, '').replace(/<!--\s*spadewick:parent="[^"]*"\s*-->/g, '')
}

/**
 * Draw an SVG with sample values and no project: fields from `values`, images left empty.
 * Used for thumbnails of items that have no stored preview.
 */
export function rasterizeSample(svg, { values = {}, width = 240 } = {}) {
  const { out, options } = sampleInput(svg, values, width)
  return new Resvg(out, options).render().asPng()
}

/** The same drawing in the helper process, for a design the person made (a panic of the drawing engine must not stop the application). */
export function rasterizeSampleSafe(svg, { values = {}, width = 240 } = {}) {
  const { out, options } = sampleInput(svg, values, width)
  return rasterize(out, options, { what: 'template thumbnail' })
}

function sampleInput(svg, values, width) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = sanitizeSvg(upgradeLegacyMarkup(svg))
  out = out.replace(/\sdata-spadewick-hide-if="\s*(?:1|true)\s*"/g, ' style="display:none"')   // always-hidden groups (guides) stay hidden
  out = out.replace(/\sdata-spadewick-(show|hide)-if="[^"]*"/g, '')   // other conditions need a card; show everything
  out = applyDynamicText(out, values)
  out = out.replace(/\{\{\s*@asset\.[^}]*\}\}/g, '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, slug) => (slug in values ? esc(values[slug]) : ''))
  const options = { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false, fontFiles: defaultFontFiles(), defaultFontFamily: DEFAULT_FAMILIES.sans, sansSerifFamily: DEFAULT_FAMILIES.sans, serifFamily: DEFAULT_FAMILIES.serif, monospaceFamily: DEFAULT_FAMILIES.mono } }
  return { out, options }
}

/** A PNG (as a Buffer) that shows an item: its stored preview, else a drawing from its first sample card. */
export function itemThumbnail(dir, manifest, width = 240) {
  const stored = manifest.mockup.previews[0]
  if (stored && existsSync(join(dir, stored))) return readFileSync(join(dir, stored))
  try {
    const [mainT, parentT] = readTemplates(dir, manifest)
    const main = { svg: inlineLegacyPalette(mergeWithParent(mainT.svg, parentT?.svg), manifest.palette) }
    const sample = readMockupCards(dir, manifest)[0]
    const values = { display_name: sample?.display_name ?? '', '@card.id': 'CODE-0001', '@card.number': '1', '@card.count': '1' }
    for (const f of manifest.fields) values[f.slug] = f.default_value ?? ''
    Object.assign(values, Object.fromEntries(Object.entries(sample?.fields ?? {}).filter(([, v]) => !String(v).startsWith('mockup-image:'))))
    return rasterizeSample(main.svg, { values, width })
  } catch { return null }
}

/** A thumbnail for a project template: a real card that uses it, else a blank drawing. */
export async function projectTemplateThumbnail(db, projectDir, templateId, width = 240) {
  const card = db.prepare(`SELECT c.id FROM cards c LEFT JOIN sets s ON s.id = c.set_id WHERE c.deleted = 0 AND (c.template_id = ? OR (c.template_id IS NULL AND s.default_template_id = ?)) ORDER BY c.sort_order LIMIT 1`).get(templateId, templateId)
  if (card) { try { return await renderCard(projectDir, card.id, { templateId, width }) } catch { /* fall through to the blank drawing */ } }
  const row = db.prepare('SELECT svg_source FROM templates WHERE id = ?').get(templateId)
  if (!row) return null
  try {
    const parent = db.prepare('SELECT t.svg_source FROM templates t JOIN templates c ON c.parent_id = t.id WHERE c.id = ?').get(templateId)
    const svg = mergeWithParent(row.svg_source, parent?.svg_source)
    return await rasterizeSampleSafe(svg, { width })
  } catch { return null }
}

/** Plain summary of how a template differs from the library version: lines only in each. */
export function diffSummary(currentSvg, librarySvg) {
  const a = currentSvg.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const b = librarySvg.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const sa = new Set(a), sb = new Set(b)
  return { removed: a.filter(l => !sb.has(l)).length, added: b.filter(l => !sa.has(l)).length }
}
