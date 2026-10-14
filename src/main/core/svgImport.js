/**
 * SVG import and automatic binding (PRD §19): a design drawn in another tool becomes a data-driven template. The work is
 * in `src/main/svgImport/`; this service reads the file, knows the project's fields and fonts, and writes the result
 * (new fields, the pictures of the design as assets, the template) as one undo step.
 */
import { randomUUID } from 'crypto'
import { join, dirname, basename, extname } from 'path'
import { readFileSync, statSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { rasterize as rasterizeSvg } from '../safeRaster.js'
import sharp from 'sharp'
import { dbOf, dirOf } from './context.js'
import { importAssetFile } from './assets.js'
import { recordChange, rowOf, changesFor } from './history.js'
import * as cards from './cards.js'
import { analyzeDesign, previewSvg, diffFingerprints, SvgParseError } from '../svgImport/analyze.js'
import { buildTemplate } from '../svgImport/build.js'
import { parseXml, walk } from '../svgImport/xml.js'
import { nameKey } from '../svgImport/bind.js'
import { normalizeCardSize, sizeColumns, sizeOfRow, sameCardSize } from '../cardSize.js'
import { BUNDLED_FACES, defaultFontFiles, DEFAULT_FAMILIES, mapGenericFonts } from '../fontFiles.js'
import { tr } from '../../shared/i18n.js'

const MAX_BYTES = 20 * 1024 * 1024
const COMPLEX_ELEMENTS = 3000
const THUMBS = 40

const parseJson = text => { try { return text ? JSON.parse(text) : null } catch { return null } }

/** The design file as text, or why it cannot be imported. */
function readDesign(path) {
  if (!path) throw new Error(tr('errors.svgNoFile'))
  let st
  try { st = statSync(path) } catch { throw new Error(tr('errors.svgFileUnreadable', { file: basename(String(path)) })) }
  if (!st.isFile()) throw new Error(tr('errors.svgFileUnreadable', { file: basename(path) }))
  if (st.size > MAX_BYTES) throw new Error(tr('errors.svgTooLarge', { file: basename(path), mb: 20 }))
  return { text: readFileSync(path, 'utf8'), bytes: st.size }
}

/** The families the project can draw, as the fonts name them. */
function fontFamilies(d) {
  const names = new Set(BUNDLED_FACES.map(f => f.family))
  for (const f of d.prepare('SELECT family_name FROM fonts').all()) names.add(f.family_name)
  return [...names].sort((a, b) => a.localeCompare(b))
}
const availableFonts = d => new Set(fontFamilies(d).map(f => f.toLowerCase()))

function fontFilesOf(d, dir) {
  const files = defaultFontFiles()
  for (const f of d.prepare('SELECT filename FROM fonts').all()) { const p = join(dir, 'fonts', f.filename); if (existsSync(p)) files.push(p) }
  return files
}

/** Drawn in the helper process: a design from outside can make the drawing engine panic, and that must not stop the application. */
function rasterize(svg, width, fontFiles) {
  return rasterizeSvg(mapGenericFonts(svg), {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontFiles, defaultFontFamily: DEFAULT_FAMILIES.sans, sansSerifFamily: DEFAULT_FAMILIES.sans, serifFamily: DEFAULT_FAMILIES.serif, monospaceFamily: DEFAULT_FAMILIES.mono }
  }, { what: 'imported design' })
}

/** Which design file(s) to import: asks the person. */
export async function pick(ctx) {
  const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.importSvg'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('dialogs.svgFiles'), extensions: ['svg'] }] })
  return { paths: r.canceled ? [] : r.filePaths }
}

/** A picture for a linked image the design refers to but that was not found. */
export async function pickImage(ctx) {
  const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.locateImage'), properties: ['openFile'], filters: [{ name: tr('dialogs.imageFiles'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
  return { path: r.canceled ? null : r.filePaths[0] }
}

function importedOrigin(d, templateId) {
  if (!templateId) return { row: null, origin: null }
  const row = d.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  if (!row) throw new Error(tr('errors.templateNotFound'))
  const origin = parseJson(row.origin)
  if (origin?.source !== 'svg-import') throw new Error(tr('errors.svgNotImported'))
  return { row, origin }
}

const fieldsOf = (d, setId) => d.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(setId)

function runAnalysis(ctx, o) {
  const d = dbOf(ctx)
  const { text, bytes } = readDesign(o.path)
  const fields = fieldsOf(d, o.setId)
  const { row, origin } = importedOrigin(d, o.templateId)
  let a
  try {
    a = analyzeDesign(text, {
      fields, baseDir: dirname(o.path), linked: o.linked, searchDirs: o.searchDirs, bleedMm: o.bleedMm ?? origin?.bleedMm, availableFonts: availableFonts(d),
      kept: origin?.bindings, fixedCard: row ? (({ mmW, mmH }) => ({ mmW, mmH }))(sizeOfRow(row)) : null
    })
  } catch (err) {
    if (err instanceof SvgParseError) throw new Error(tr('errors.svgNotSvg', { file: basename(o.path), reason: err.message }))
    throw err
  }
  return { a, d, fields, row, origin, bytes }
}

/**
 * Read a design and say what the import would do (nothing is written).
 * @param {{ path: string, setId: string, templateId?: string, bleedMm?: number, linked?: Record<string,string> }} opts
 */
export async function analyze(ctx, opts) {
  opts ??= {}
  const { a, d, fields, row, origin, bytes } = runAnalysis(ctx, opts)
  const dir = dirOf(ctx)
  const fontFiles = fontFilesOf(d, dir)
  const vb = a.size.viewBox
  // The design is drawn once; the preview and the thumbnails of the candidates are cut from that picture
  const renderWidth = Math.max(200, Math.min(1000, Math.floor(3000 * vb[2] / vb[3])))
  const whole = await rasterize(previewSvg(a.root, a.images, vb, renderWidth), renderWidth, fontFiles)
  const wholeMeta = await sharp(whole).metadata()
  const preview = (await sharp(whole).resize({ width: 420 }).png().toBuffer()).toString('base64')
  const scale = wholeMeta.width / vb[2]
  const crop = async rect => {
    const left = Math.max(0, Math.floor((rect[0] - vb[0]) * scale)), top = Math.max(0, Math.floor((rect[1] - vb[1]) * scale))
    const right = Math.min(wholeMeta.width, Math.ceil((rect[0] + rect[2] - vb[0]) * scale)), bottom = Math.min(wholeMeta.height, Math.ceil((rect[1] + rect[3] - vb[1]) * scale))
    if (right - left < 1 || bottom - top < 1) return null
    const buf = await sharp(whole).extract({ left, top, width: right - left, height: bottom - top }).resize(40, 40, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return buf.toString('base64')
  }
  let n = 0
  const rows = []
  for (const r of a.rows) {
    let thumb = null
    if (r.rect && n < THUMBS) { n++; try { thumb = await crop(r.rect) } catch { thumb = null } }
    rows.push({ ...r, thumb, checked: r.confidence === 'exact' || r.confidence === 'token' || r.confidence === 'kept' })
  }

  let reimport = null
  if (row) {
    const seen = new Set(rows.filter(r => r.confidence === 'kept').map(r => `${nameKey(r.name)}#${r.occurrence}`))
    const removed = (origin.bindings ?? []).filter(b => !seen.has(`${nameKey(b.name)}#${b.occurrence ?? 0}`)).map(b => ({ name: b.name, action: b.action, slug: b.slug ?? null, id: b.id }))
    reimport = { changes: diffFingerprints(origin.fingerprint, a.fingerprint), removed, previous: { fit: origin.fit ?? 'fit', bleedMm: origin.bleedMm ?? 0, fontMap: origin.fontMap ?? {} } }
  }

  return {
    file: { name: basename(opts.path), path: opts.path, bytes },
    size: { viewBox: vb, widthMm: round(a.size.widthMm), heightMm: round(a.size.heightMm), unit: a.size.unit, assumed: a.size.assumed, generator: a.size.generator },
    proposal: a.proposal, ranked: a.ranked, shapeDiffers: a.shapeDiffers,
    report: {
      removed: a.report.removed, images: a.report.images, unsupported: a.report.unsupported, fonts: a.report.fonts,
      elementCount: a.report.elementCount, complex: a.report.elementCount > COMPLEX_ELEMENTS, styleSheetKept: a.report.styleSheetKept
    },
    outlined: a.outlined, rows, preview, previewBox: vb,
    fields: fields.map(f => ({ name: f.name, slug: f.slug, type: f.type })),
    availableFonts: fontFamilies(d),
    reimport
  }
}

const round = n => Math.round(n * 100) / 100

/**
 * Make the template (or update the one being re-imported).
 * @param {object} opts
 * @param {string} opts.path
 * @param {string} opts.setId the set whose fields the design is bound to
 * @param {string} [opts.templateId] re-import into this template
 * @param {string} [opts.name]
 * @param {{ cardSize: string, cardMmW?: number, cardMmH?: number }} [opts.size] the card size of a new template
 * @param {'fit'|'keep'|'crop'} [opts.fit]
 * @param {number} [opts.bleedMm]
 * @param {Record<string,string>} [opts.fontMap]
 * @param {Record<string,string>} [opts.linked]
 * @param {object[]} opts.decisions { key, action, slug?, newName?, newType?, expr?, icon? }
 * @param {string[]} [opts.keepRemoved] ids of bound elements of the earlier import to keep
 * @param {boolean} [opts.sampleCard] make a card from the design's own texts when the set has none (default true)
 */
export async function apply(ctx, opts) {
  opts ??= {}
  const { a, d, fields, row, origin } = runAnalysis(ctx, opts)
  const dir = dirOf(ctx)
  const set = d.prepare('SELECT * FROM sets WHERE id = ?').get(opts.setId)
  if (!set) throw new Error(tr('errors.setNotFound'))
  const sizeIn = row ? sizeOfRow(row) : normalizeCardSize(opts.size ?? {})
  const fit = ['fit', 'keep', 'crop'].includes(opts.fit) ? opts.fit : 'fit'

  const byKey = new Map(a.rows.map(r => [r.key, r]))
  const decisions = []
  for (const x of opts.decisions ?? []) {
    const r = byKey.get(x.key)
    if (!r || x.action === 'none') continue
    decisions.push({ ...x, occurrence: r.occurrence, name: r.fingerprintName, boxFor: x.action === 'box' ? r.boxForKey : undefined, fromToken: x.fromToken ?? r.proposal.fromToken })
  }
  for (const x of decisions) {
    if ((x.action === 'show' || x.action === 'hide') && (!x.expr || String(x.expr).length > 200)) throw new Error(tr('errors.svgBadCondition', { name: byKey.get(x.key)?.name ?? '' }))
    if (x.action === 'new' && !String(x.newName ?? x.slug ?? '').trim()) throw new Error(tr('errors.svgFieldName'))
  }

  // pictures of the design go to the asset library, the ones that are used once
  const used = new Set()
  walk(a.root, el => { if (el.image) used.add(el.image.hash) })
  const tmp = mkdtempSync(join(tmpdir(), 'spadewick-svg-'))
  const assetRows = []
  const assetIds = new Map()
  try {
    mkdirSync(join(dir, 'assets'), { recursive: true })
    for (const hash of used) {
      const img = a.images.get(hash)
      const file = join(tmp, `${hash}${img.mime === 'image/png' ? '.png' : img.mime === 'image/webp' ? '.webp' : '.jpg'}`)
      writeFileSync(file, img.buffer)
      const existing = findAssetByHash(d, dir, img.buffer)
      if (existing) { assetIds.set(hash, existing.id); continue }
      const asset = await importAssetFile(d, join(dir, 'assets'), file, { record: false, originalName: `${basename(opts.path, extname(opts.path))}-${hash.slice(0, 6)}${extname(file)}` })
      if (asset) { assetIds.set(hash, asset.id); assetRows.push(asset) }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }

  const keepRemoved = []
  if (row && opts.keepRemoved?.length) {
    const old = parseXml(row.svg_source).root
    const wanted = new Set(opts.keepRemoved)
    walk(old, el => { const id = el.attrs?.['data-spadewick-id']; if (id && wanted.has(id)) { keepRemoved.push({ id, node: el }); return false } })
  }

  const built = buildTemplate(a.root, {
    viewBox: a.size.viewBox, size: a.size, card: { mmW: sizeIn.mmW, mmH: sizeIn.mmH }, fit, decisions, fontMap: opts.fontMap ?? {},
    assetIds, fields, keepRemoved
  })

  const now = Date.now()
  const originJson = JSON.stringify({
    source: 'svg-import', file: basename(opts.path), importedAt: now, generator: a.generator, fit, bleedMm: Number(opts.bleedMm) || 0,
    fontMap: opts.fontMap ?? {}, bindings: built.bindings, fingerprint: a.fingerprint
  })

  const changes = []
  let templateId, fieldIds = []
  d.transaction(() => {
    for (const asset of assetRows) changes.push({ table: 'assets', before: null, after: rowOf(d, 'assets', asset.id) })
    let order = d.prepare('SELECT COALESCE(MAX(display_order), -1) AS m FROM fields WHERE set_id = ?').get(opts.setId).m
    for (const f of built.newFields) {
      const id = randomUUID()
      d.prepare(`INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 0, ?)`)
        .run(id, opts.setId, f.name, f.slug, f.type, ++order, now)
      changes.push({ table: 'fields', before: null, after: rowOf(d, 'fields', id) })
      fieldIds.push(id)
    }
    if (row) {
      const before = rowOf(d, 'templates', row.id)
      d.prepare('UPDATE templates SET svg_source = ?, origin = ?, updated_at = ? WHERE id = ?').run(built.svg, originJson, now, row.id)
      changes.push(...changesFor(d, 'templates', [before]))
      templateId = row.id
    } else {
      templateId = randomUUID()
      const name = String(opts.name ?? '').trim() || basename(opts.path, extname(opts.path))
      d.prepare('INSERT INTO templates (id, name, parent_id, svg_source, origin, card_size, card_mm_w, card_mm_h, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)')
        .run(templateId, name, built.svg, originJson, ...sizeColumns(sizeIn), now, now)
      changes.push({ table: 'templates', before: null, after: rowOf(d, 'templates', templateId) })
      if (!set.default_template_id && sameCardSize(sizeOfRow(set), sizeIn)) {
        const before = rowOf(d, 'sets', set.id)
        d.prepare('UPDATE sets SET default_template_id = ? WHERE id = ?').run(templateId, set.id)
        changes.push(...changesFor(d, 'sets', [before]))
      }
    }
    recordChange(d, row ? 'REIMPORT_SVG' : 'IMPORT_SVG', changes, assetRows.map(a => ({ name: a.filename, presentAfter: true })))
  })()

  // A card with the design's own texts, so that there is a preview (only when the set has no card yet)
  let card = null
  const hasCards = d.prepare('SELECT 1 FROM cards WHERE set_id = ? AND deleted = 0 LIMIT 1').get(opts.setId)
  if (!row && !hasCards && opts.sampleCard !== false && Object.keys(built.samples).length) {
    const fits = sameCardSize(sizeOfRow(set), sizeIn)
    card = cards.create(ctx, { setId: opts.setId, displayName: tr('svgImport.sampleCard'), templateId: fits ? templateId : undefined, fields: built.samples })
  }
  const template = d.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  return { template, newFields: built.newFields.map(f => f.slug), warnings: built.warnings, card, pictures: assetRows.length }
}

/** An asset that already holds exactly this picture (so importing the same design twice does not fill the library). */
function findAssetByHash(d, dir, buffer) {
  const size = buffer.length
  for (const r of d.prepare('SELECT id, filename FROM assets WHERE file_size_bytes = ?').all(size)) {
    try { if (readFileSync(join(dir, 'assets', r.filename)).equals(buffer)) return r } catch { /* gone */ }
  }
  return null
}

