import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import sharp from 'sharp'
import { PDFDocument, rgb } from 'pdf-lib'
import { dirOf } from './context.js'
import { richSlugsOfSet, plainValues } from '../richFields.js'
import { openProjectDb } from '../db.js'
import { renderCard, effectiveTemplateId, effectiveBackTemplateId } from '../render.js'
import { getCardSize } from '../cardSize.js'
import { CARD_SIZE_BY_ID } from '../../shared/cardSizes.js'
import { evaluateFormula, isTruthy } from '../formula.js'
import { createResolver, needsContext } from './values.js'
import { tr } from '../../shared/i18n.js'
import { ttsImageLink, normalizeLinkMode } from '../ttsLinks.js'
import { sheetLayout, rowsFor, deckScale, placeDecks } from '../ttsLayout.js'
import { applyCloudLinks, ttsImageFiles } from '../ttsCloud.js'

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const exportTts = (ctx, opts) => exportTTS(dirOf(ctx), opts)
export const exportPdf = (ctx, opts) => exportPDF(dirOf(ctx), opts)
export const exportPngSheet = (ctx, opts) => exportPNGSheet(dirOf(ctx), opts)

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getDb(projectDir) {
  return openProjectDb(projectDir)
}

function getMeta(db, key) {
  return db.prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value ?? null
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'export'
}

/** Parse #rgb / #rrggbb. A channel of 0 is a valid value, so only malformed input falls back. */
export function parseHex(value, fallback = { r: 0, g: 0, b: 0 }) {
  let hex = String(value ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(c => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

/**
 * Render all cards for the given setIds and return an array of
 * { card, buffer } objects in sort_order.
 */
/**
 * Which cards an export includes (PRD §10.1): everything, only `opts.cardIds`, or those matching
 * `opts.filter` — an expression in the formula language, e.g. `faction == 'Red'`.
 */
export function cardSelector(db, opts = {}) {
  if (opts.cardIds?.length) {
    const wanted = new Set(opts.cardIds)
    return card => wanted.has(card.id)
  }
  const filter = opts.filter?.trim()
  if (!filter) return () => true
  const resolver = createResolver(db)
  const context = needsContext(filter)
  return card => {
    // the card's data as every expression reads it: Formula and Lookup fields worked out, the status, the position (UPDATES U23)
    const result = evaluateFormula(filter, resolver.values(card, { context }))
    if (String(result).startsWith('#ERR')) throw new Error(tr('errors.invalidCardFilter', { detail: String(result).slice(6) }))
    return isTruthy(result)
  }
}

/** Output file name from a pattern like `{{set_name}}_{{date}}` (PRD §10.1). Always filesystem-safe. */
export function outputBaseName(db, setIds, pattern, extra = {}) {
  const setNames = setIds.map(id => db.prepare('SELECT name FROM sets WHERE id = ?').get(id)?.name ?? id).join('_')
  const project = db.prepare("SELECT value FROM project_meta WHERE key = 'name'").get()?.value ?? 'project'
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const values = {
    set_name: slugify(setNames), project_name: slugify(project),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}`,
    card_id: '', ...extra
  }
  const name = (pattern?.trim() || '{{set_name}}').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => values[k] ?? '')
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '') || 'export'
}

/**
 * Which cards an export would draw, counted without drawing them: `[{ setId, cards, copies }]` for each set that has any.
 * It reads the same rules as `renderAllCards`: the selection, the quantity and a template to draw with.
 */
export function planCards(db, setIds, opts = {}) {
  const selected = cardSelector(db, opts)
  const plan = []
  for (const setId of setIds) {
    let cards = 0, copies = 0
    for (const card of db.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(setId)) {
      if (!selected(card)) continue
      const n = opts.copies === false ? Math.min(card.quantity ?? 1, 1) : (card.quantity ?? 1)
      if (n < 1 || !effectiveTemplateId(db, card)) continue
      cards++; copies += n
    }
    if (cards) plan.push({ setId, cards, copies })
  }
  return plan
}

export async function renderAllCards(projectDir, db, setIds, cardWidth, cardHeight, opts = {}) {
  const results = []
  const selected = cardSelector(db, opts)
  for (const setId of setIds) {
    const cards = db
      .prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order')
      .all(setId)
    for (const card of cards) {
      if (!selected(card)) continue
      // PRD §6.5: a card appears `quantity` times in sheets and PDFs (0 leaves it out). It is rendered once.
      const copies = opts.copies === false ? Math.min(card.quantity ?? 1, 1) : (card.quantity ?? 1)
      if (copies < 1) continue
      if (opts.previewMax && results.length >= opts.previewMax) return results
      if (!effectiveTemplateId(db, card)) continue // no own or default template: nothing to render
      const rendered = await renderCard(projectDir, card.id, { width: cardWidth, height: cardHeight })
      const buffer = await fitToCardSize(rendered, cardWidth, cardHeight)
      for (let c = 0; c < copies && !(opts.previewMax && results.length >= opts.previewMax); c++) results.push({ card, buffer })
    }
  }
  return results
}

/**
 * The rasterizer only knows the template's own aspect ratio. When it differs from the set's card
 * size, letterbox it (transparent bars) so every export cell is exactly the card size and nothing
 * is stretched or cropped.
 */
export async function fitToCardSize(png, width, height) {
  const meta = await sharp(png).metadata()
  if (meta.width === width && meta.height === height) return png
  return sharp(png).resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
}

/**
 * Returns a PNG buffer for the card back.
 * - opts.cardBackAssetId: use a project asset
 * - opts.cardBackColor: solid hex color
 * - default: dark navy
 */
export async function renderBack(projectDir, db, cardWidth, cardHeight, opts) {
  // "None": a fully transparent back. Tabletop Simulator still needs a back image for its last slot.
  if (opts.cardBack === 'none') {
    return sharp({ create: { width: cardWidth, height: cardHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  }
  if (opts.cardBackAssetId) {
    const asset = db.prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(opts.cardBackAssetId)
    if (asset) {
      const fp = join(projectDir, 'assets', asset.filename)
      return sharp(fp)
        .resize(cardWidth, cardHeight, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer()
    }
  }
  const { r, g, b } = parseHex(opts.cardBackColor ?? '#1a1a2e', { r: 26, g: 26, b: 46 })
  return sharp({
    create: { width: cardWidth, height: cardHeight, channels: 3, background: { r, g, b } }
  }).png().toBuffer()
}

/** Is the back the set's card back (a template)? That is the choice unless a plain colour, a picture or no back was asked for. */
export const usesBackTemplates = opts => opts.cardBack === 'template' || (opts.cardBack === undefined && !opts.cardBackAssetId)

/**
 * Does a template draw the same on every card? Not when it shows a field, or has a condition that reads one. Its own picture
 * of a fixed library image is the same everywhere (`{{@asset.…}}`), and so is a hidden guide group (`hide-if="1"`).
 */
export function drawsTheSameOnEveryCard(db, templateId) {
  let source = ''
  for (let id = templateId, hops = 0; id && hops < 8; hops++) {
    const row = db.prepare('SELECT parent_id, svg_source FROM templates WHERE id = ?').get(id)
    if (!row) break
    source += row.svg_source
    id = row.parent_id
  }
  return !/\{\{\s*(?!@asset\.)/.test(source) && !/-if="(?!1")/.test(source)
}

/**
 * The back of one card for an export (PRD §7.8). With `opts.cardBack === 'template'` it is the card's own back or its set's card back,
 * drawn with the card's data; a card with no back gets the plain colour back. `cache` lets cards that share a back share the picture.
 * @returns {Promise<{ buffer: Buffer, key: string, name: string, dynamic: boolean }>}
 */
export async function backOf(projectDir, db, card, width, height, opts, cache = new Map()) {
  const templateId = usesBackTemplates(opts) ? effectiveBackTemplateId(db, card) : null
  if (!templateId) {
    if (!cache.has('@plain')) cache.set('@plain', { buffer: await renderBack(projectDir, db, width, height, usesBackTemplates(opts) ? { ...opts, cardBack: 'color', cardBackAssetId: undefined } : opts), key: '@plain', name: '', dynamic: false })
    return cache.get('@plain')
  }
  const dynamic = !drawsTheSameOnEveryCard(db, templateId)
  const key = dynamic ? `${templateId}:${card.id}` : templateId
  if (!cache.has(key)) {
    const rendered = await renderCard(projectDir, card.id, { width, height, templateId })
    cache.set(key, { buffer: await fitToCardSize(rendered, width, height), key: templateId, name: db.prepare('SELECT name FROM templates WHERE id = ?').get(templateId)?.name ?? '', dynamic })
  }
  return cache.get(key)
}

// ---------------------------------------------------------------------------
// Tabletop Simulator export — PRD §10.2
// ---------------------------------------------------------------------------

async function exportTTS(projectDir, opts) {
  const db = getDb(projectDir)
  const setIds = opts.setIds ?? []
  if (!setIds.length) throw new Error(tr('errors.noSetsSelected'))

  const outputDir = opts.outputDir ?? join(projectDir, 'exports')
  ensureDir(outputDir)

  // A set is a deck of its own, so each set has the size of its own cards: its sheet grid, its picture size and its deck scale.
  // (Cards of two sizes on one sheet would be drawn into cells of the wrong shape, and the game shapes the card after its cell.)
  const generateJson = opts.generateJson !== false
  const dimsOfSet = new Map()
  for (const id of setIds) {
    const size = getCardSize(db, id)
    const w = opts.cardWidth ?? size.widthPx, h = opts.cardHeight ?? size.heightPx
    dimsOfSet.set(id, { w, h, layout: sheetLayout(w, h), scale: deckScale(size.mmH), aspect: w / h })
  }

  // Gather set names for file naming
  const setNames = setIds
    .map(id => db.prepare('SELECT name FROM sets WHERE id = ?').get(id)?.name ?? id)
    .join('_')
  const fileBase = outputBaseName(db, setIds, opts.fileNameTemplate)

  const rendered = []
  for (const id of setIds) rendered.push(...await renderAllCards(projectDir, db, [id], dimsOfSet.get(id).w, dimsOfSet.get(id).h, opts))
  if (!rendered.length) throw new Error(tr('errors.noRenderableCardsTemplate'))

  // Backs (PRD §7.8): cards that share a back share one image; a back that shows each card's own data gets a sheet of its own.
  // Every set is a deck of its own in the game, so cards are grouped by set first.
  const backCaches = new Map()   // one for each card size: a plain back is the size of the cards, and sets of one size share their backs
  const groups = new Map()
  const addToGroup = (gk, group, item) => {
    if (!groups.has(gk)) groups.set(gk, { ...group, dims: dimsOfSet.get(group.setId), items: [] })
    groups.get(gk).items.push(item)
  }
  if (usesBackTemplates(opts)) {
    for (const item of rendered) {
      const d = dimsOfSet.get(item.card.set_id)
      const sizeKey = d.w + 'x' + d.h
      if (!backCaches.has(sizeKey)) backCaches.set(sizeKey, new Map())
      const b = await backOf(projectDir, db, item.card, d.w, d.h, opts, backCaches.get(sizeKey))
      addToGroup(`${item.card.set_id}|${b.dynamic ? '@each' : b.key}`, { setId: item.card.set_id, name: b.name, shared: b.dynamic ? null : b.buffer }, { ...item, back: b.buffer })
    }
  } else {
    const shareds = new Map()   // by card size
    for (const item of rendered) {
      const id = item.card.set_id
      const sizeKey = dimsOfSet.get(id).w + 'x' + dimsOfSet.get(id).h
      if (!shareds.has(sizeKey)) shareds.set(sizeKey, await renderBack(projectDir, db, dimsOfSet.get(id).w, dimsOfSet.get(id).h, opts))
      addToGroup(`${id}|@one`, { setId: id, name: '', shared: shareds.get(sizeKey) }, item)
    }
  }
  const groupList = [...groups.values()]
  const sheetCount = groupList.reduce((n, g) => n + Math.ceil(g.items.length / g.dims.layout.perSheet), 0)
  const writtenFiles = []
  // How the saved object refers to its images (PRD §10.2.1). TTS reads them as addresses, not as files beside the JSON.
  const imageLinks = normalizeLinkMode(opts.imageLinks)
  const linkTo = name => ttsImageLink(imageLinks, outputDir, name)

  // A card at the size of a sheet cell: never scaled up, and each picture is scaled once however many copies there are
  const fitted = new Map()
  const toCellIn = async (layout, buffer) => {
    if (!fitted.has(buffer)) {
      const m = await sharp(buffer).metadata()
      fitted.set(buffer, m.width === layout.cellW && m.height === layout.cellH ? buffer : await sharp(buffer).resize(layout.cellW, layout.cellH, { fit: 'fill' }).png().toBuffer())
    }
    return fitted.get(buffer)
  }
  const sheetPngIn = (layout, rows, composites) => sharp({
    create: { width: layout.cellW * layout.cols, height: layout.cellH * rows, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).composite(composites).png({ compressionLevel: 6 }).toBuffer()
  const slotIn = (layout, i, input) => ({ input, left: (i % layout.cols) * layout.cellW, top: Math.floor(i / layout.cols) * layout.cellH })

  let deckNum = 0
  const usedBackNames = new Set()
  const backFiles = new Map()   // back picture -> file written, so a back shared by several sets is written once
  const decks = new Map()       // set id -> the deck of that set in the game
  for (const [gi, group] of groupList.entries()) {
    if (!decks.has(group.setId)) decks.set(group.setId, { name: db.prepare('SELECT name FROM sets WHERE id = ?').get(group.setId)?.name ?? '', dims: group.dims, customDeck: {}, ids: [], cards: [] })
    const deck = decks.get(group.setId)
    const layout = group.dims.layout
    const toCell = buffer => toCellIn(layout, buffer)
    const sheetPng = (rows, composites) => sheetPngIn(layout, rows, composites)
    const slot = (i, input) => slotIn(layout, i, input)

    // The one shared back image of this group
    let backFilename = null
    const sharedBack = group.shared ? await toCell(group.shared) : null
    if (sharedBack) {
      if (!backFiles.has(group.shared)) {
        const slug = slugify(group.name)
        let name = groupList.length === 1 ? `${fileBase}_back` : `${fileBase}_back_${slug || gi + 1}`
        while (usedBackNames.has(name)) name += '_'
        usedBackNames.add(name)
        writeFileSync(join(outputDir, `${name}.png`), sharedBack)
        writtenFiles.push(`${name}.png`)
        backFiles.set(group.shared, `${name}.png`)
      }
      backFilename = backFiles.get(group.shared)
    }
    const groupSheets = Math.ceil(group.items.length / layout.perSheet)
    for (let sheetIdx = 0; sheetIdx < groupSheets; sheetIdx++) {
      deckNum++
      const slice = group.items.slice(sheetIdx * layout.perSheet, (sheetIdx + 1) * layout.perSheet)
      const rows = rowsFor(layout, slice.length)

      const composites = []
      for (const [i, it] of slice.entries()) composites.push(slot(i, await toCell(it.buffer)))
      // The card back goes in the last slot of the sheet
      if (sharedBack) composites.push(slot(layout.cols * rows - 1, sharedBack))
      const faceFilename = sheetCount === 1 ? `${fileBase}_face.png` : `${fileBase}_face_${deckNum}.png`
      writeFileSync(join(outputDir, faceFilename), await sheetPng(rows, composites))
      writtenFiles.push(faceFilename)

      // A back of its own for every card: a second sheet with each back where its front is
      let sheetBack = backFilename
      if (!group.shared) {
        sheetBack = sheetCount === 1 ? `${fileBase}_backs.png` : `${fileBase}_backs_${deckNum}.png`
        const backSlots = []
        for (const [i, it] of slice.entries()) backSlots.push(slot(i, await toCell(it.back)))
        writeFileSync(join(outputDir, sheetBack), await sheetPng(rows, backSlots))
        writtenFiles.push(sheetBack)
      }

      const sheet = {
        FaceURL:      generateJson ? linkTo(faceFilename) : faceFilename,
        BackURL:      generateJson ? linkTo(sheetBack) : sheetBack,
        NumWidth:     layout.cols,
        NumHeight:    rows,
        BackIsHidden: true,
        UniqueBack:   !group.shared,
        Type:         0
      }
      deck.customDeck[String(deckNum)] = sheet

      for (let i = 0; i < slice.length; i++) {
        const { card } = slice[i]
        const fields   = plainValues(JSON.parse(card.fields_json), richSlugsOfSet(db, card.set_id)) // a card's name and description are plain text (PRD §16.7)
        const cardId   = deckNum * 100 + i

        deck.ids.push(cardId)
        deck.cards.push({
          Name:        'Card',
          Nickname:    (opts.displayNameField ? fields[opts.displayNameField] : '') || card.display_name || '',
          Description: opts.descriptionField ? (fields[opts.descriptionField] ?? '') : '',
          CardID:      cardId,
          Transform:   cardTransform(),
          CustomDeck:  { [String(deckNum)]: sheet }
        })
      }
    }
  }

  let jsonFile = null
  if (generateJson) {
    // A deck per set, face down, as tall as the physical card and side by side on the table (PRD §10.2.2)
    const places = placeDecks([...decks.values()].map(d => ({ scale: d.dims.scale, aspect: d.dims.aspect })))
    const objectStates = [...decks.values()].map((d, i) => {
      const transform = { posX: places[i].x, posY: 1, posZ: places[i].z, rotX: 0, rotY: 180, rotZ: 180, scaleX: d.dims.scale, scaleY: 1, scaleZ: d.dims.scale }
      // A deck of one card is a card: Tabletop Simulator does not keep a one-card deck
      if (d.cards.length === 1) return { ...d.cards[0], Nickname: d.cards[0].Nickname || d.name, Transform: transform, LuaScript: '' }
      return {
        Name:             'Deck',
        Nickname:         d.name,
        Description:      '',
        LuaScript:        '',
        Transform:        transform,
        CustomDeck:       d.customDeck,
        DeckIDs:          d.ids,
        ContainedObjects: d.cards
      }
    })
    const ttsDoc = {
      SaveName:      setNames,
      GameMode:      '',
      Date:          new Date().toLocaleDateString(),
      VersionNumber: '',
      ObjectStates:  objectStates
    }
    const jsonFilename = `${fileBase}.json`
    jsonFile = join(outputDir, jsonFilename)
    writeFileSync(jsonFile, JSON.stringify(ttsDoc, null, 2))
    writtenFiles.push(jsonFilename)
  }

  return {
    outputDir, cardCount: rendered.length, sheetCount, files: writtenFiles, imageLinks: generateJson ? imageLinks : null,
    jsonFile, deckCount: decks.size, grid: gridOf([...decks.values()][0].dims.layout), grids: [...decks.values()].map(d => ({ set: d.name, ...gridOf(d.dims.layout) })),
    // The pictures to upload to Steam Cloud, when the links are to be replaced by cloud addresses (PRD §10.2.4)
    cloudFiles: generateJson && imageLinks === 'cloud' ? writtenFiles.filter(f => f.endsWith('.png')) : undefined
  }
}

const gridOf = l => ({ cols: l.cols, rows: l.rows, cellWidth: l.cellW, cellHeight: l.cellH })

/** A card inside a deck: face down like its deck. */
const cardTransform = () => ({ posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 })

/**
 * Write the Steam Cloud addresses into a copy of an exported saved object (PRD §10.2.4): `<name>.json` becomes
 * `<name>_cloud.json`. `links` maps an image file name to the address Cloud Manager gave it.
 * @returns {{ file: string, replaced: number, missing: string[] }}
 */
export function ttsCloudLinks(ctx, { jsonFile, links }) {
  void ctx
  const path = String(jsonFile ?? '')
  if (!/\.json$/i.test(path) || !existsSync(path)) throw new Error(tr('errors.ttsCloudJsonMissing', { path }))
  const { doc, replaced, missing } = applyCloudLinks(JSON.parse(readFileSync(path, 'utf8')), links)
  if (!replaced) throw new Error(tr('errors.ttsCloudNoLinks'))
  const file = path.replace(/\.json$/i, '_cloud.json')
  writeFileSync(file, JSON.stringify(doc, null, 2))
  return { file, replaced, missing }
}

/** The pictures an exported saved object needs uploaded, by file name. */
export function ttsCloudFiles(ctx, { jsonFile }) {
  void ctx
  const path = String(jsonFile ?? '')
  if (!/\.json$/i.test(path) || !existsSync(path)) throw new Error(tr('errors.ttsCloudJsonMissing', { path }))
  return ttsImageFiles(JSON.parse(readFileSync(path, 'utf8')))
}

// ---------------------------------------------------------------------------
// Print-and-play PDF export — PRD §10.3
// ---------------------------------------------------------------------------

// Physical card size presets (mm)
const CARD_PRESETS = CARD_SIZE_BY_ID

// Points per mm
const PT_PER_MM = 72 / 25.4

// Page sizes in points
const PAGE_SIZES = {
  letter:  { w: 612,  h: 792  },
  a4:      { w: 595,  h: 842  },
  a3:      { w: 842,  h: 1191 },
  legal:   { w: 612,  h: 1008 },
}

/** Least margin the layout may shrink to, in mm: what almost every printer can still print up to */
const MIN_MARGIN_MM = 5
/** Smallest gap between cards when crop marks are drawn in it, in mm (the marks and their distance to the card) */
const MIN_GAP_WITH_MARKS_MM = (6 + 3) / PT_PER_MM
const LADDER_STEP_MM = 0.5

/** How many cells of `cellW` × `cellH` fit in a width and height, with `gap` between them (all in points) */
function gridFit(usableW, usableH, cellW, cellH, gap) {
  const eps = 1e-6   // a grid that fits to the hair (3 poker cards on a Letter page) must count as fitting
  return { cols: Math.max(1, Math.floor((usableW + gap) / (cellW + gap) + eps)), rows: Math.max(1, Math.floor((usableH + gap) / (cellH + gap) + eps)) }
}

/** Values from `from` down to `floor` in steps of half a millimetre, ending on `floor` itself */
function ladder(from, floor) {
  const out = []
  for (let v = from; v > floor + 1e-9; v -= LADDER_STEP_MM) out.push(v)
  out.push(Math.min(from, floor))
  return out
}

/**
 * The margin and gap to lay a page out with (PRD §10.3.1). The ones asked for when they fit the most cards the page can take;
 * otherwise the least reduction that does: the gap first, then the margin, never below `MIN_MARGIN_MM` and, with crop marks, the gap
 * the marks need. Poker cards then fit 3 × 3 on Letter and on A4 instead of 2 × 2.
 * @returns {{ marginMm: number, gapMm: number, tightened: boolean }}
 */
export function tightenToFit({ pageW, pageH, cellW, cellH, marginMm, gapMm, minGapMm = 0 }) {
  const count = (m, g) => { const f = gridFit(pageW - 2 * m * PT_PER_MM, pageH - 2 * m * PT_PER_MM, cellW, cellH, g * PT_PER_MM); return f.cols * f.rows }
  const floorM = Math.min(marginMm, MIN_MARGIN_MM), floorG = Math.min(gapMm, minGapMm)
  const best = count(floorM, floorG)
  if (best <= count(marginMm, gapMm)) return { marginMm, gapMm, tightened: false }
  for (const m of ladder(marginMm, floorM)) for (const g of ladder(gapMm, floorG)) if (count(m, g) >= best) return { marginMm: m, gapMm: g, tightened: true }
  return { marginMm: floorM, gapMm: floorG, tightened: true }
}

/**
 * Where everything goes on a print-and-play page (PRD §10.3): the page, the grid of cells, the bleed and the margins, in points,
 * and the size of a card picture in pixels. The export and its preview both read it, so they cannot disagree.
 * `setSize` is the card size of the sets the pages are for (a chosen size in the dialog wins over it).
 */
export function pdfGeometry(db, setIds, opts, setSize = getCardSize(db, setIds[0])) {
  const dpi        = opts.dpi        ?? 300
  const cardPreset = CARD_PRESETS[opts.cardSize] ?? { w: setSize.mmW, h: setSize.mmH }
  const cardMmW    = opts.cardMmW ?? cardPreset.w
  const cardMmH    = opts.cardMmH ?? cardPreset.h
  let   marginMm   = opts.marginMm  ?? 10
  let   gapMm      = opts.gapMm     ?? 3
  const bleedMm    = opts.bleedMm   ?? 0
  const cropMarks  = opts.cropMarks ?? false
  const landscape  = opts.landscape ?? false
  const cardBacks  = (opts.cardBacks ?? false) && opts.cardBack !== 'none'  // interleaved duplex backs
  const pageKey    = opts.pageSize  ?? 'letter'

  // Page: a named size, or custom width × height in mm (PRD §10.3)
  let pageW = PAGE_SIZES[pageKey]?.w ?? PAGE_SIZES.letter.w
  let pageH = PAGE_SIZES[pageKey]?.h ?? PAGE_SIZES.letter.h
  if (pageKey === 'custom' && opts.pageMmW > 0 && opts.pageMmH > 0) { pageW = opts.pageMmW * PT_PER_MM; pageH = opts.pageMmH * PT_PER_MM }
  if (landscape) [pageW, pageH] = [pageH, pageW]

  const scaleToFit = opts.scale === 'fit'
  let tightened = false
  // An automatic grid takes as many cards as the page can hold, shrinking the margin and the gap a little when that fits more (PRD §10.3.1)
  if (!opts.cardsPerRow && !opts.cardsPerColumn && !scaleToFit && opts.fitMore !== false) {
    const bleed = bleedMm * PT_PER_MM
    ;({ marginMm, gapMm, tightened } = tightenToFit({ pageW, pageH, cellW: cardMmW * PT_PER_MM + bleed * 2, cellH: cardMmH * PT_PER_MM + bleed * 2, marginMm, gapMm, minGapMm: cropMarks ? MIN_GAP_WITH_MARKS_MM : 0 }))
  }

  // Dimensions in points
  const marginPt   = marginMm  * PT_PER_MM
  let gapPt        = gapMm     * PT_PER_MM
  let bleedPt      = bleedMm   * PT_PER_MM
  let cardPtW      = cardMmW   * PT_PER_MM
  let cardPtH      = cardMmH   * PT_PER_MM
  let cellPtW      = cardPtW   + bleedPt * 2
  let cellPtH      = cardPtH   + bleedPt * 2
  const cropMarkLen  = 6  // pt
  const cropMarkGap  = 3  // pt

  const usableW = pageW - marginPt * 2
  const usableH = pageH - marginPt * 2
  // Grid: automatic (as many as fit at true size) or manual columns × rows (PRD §10.3)
  const { cols: fitCols, rows: fitRows } = gridFit(usableW, usableH, cellPtW, cellPtH, gapPt)
  const cols    = Math.max(1, opts.cardsPerRow ? (scaleToFit ? opts.cardsPerRow : Math.min(opts.cardsPerRow, fitCols)) : fitCols)
  const rows    = Math.max(1, opts.cardsPerColumn ? (scaleToFit ? opts.cardsPerColumn : Math.min(opts.cardsPerColumn, fitRows)) : fitRows)
  if (scaleToFit) {
    // "Fit to page": scale the whole layout (cards, bleed, gaps) so the grid exactly fills the page
    const k = Math.min((usableW) / (cols * cellPtW + (cols - 1) * gapPt), (usableH) / (rows * cellPtH + (rows - 1) * gapPt))
    gapPt *= k; bleedPt *= k; cardPtW *= k; cardPtH *= k; cellPtW *= k; cellPtH *= k
  }
  const perPage = Math.max(1, cols * rows)
  // Centre the grid horizontally. This is what makes duplex printing line up: a back printed on the
  // reverse of the sheet is mirrored about the page centre, so fronts and backs only coincide when
  // the grid is symmetric about it.
  const gridPtW = cols * cellPtW + (cols - 1) * gapPt
  const leftPt  = Math.max(marginPt, (pageW - gridPtW) / 2)

  // Render pixels
  const cardPxW = Math.round(cardMmW / 25.4 * dpi)
  const cardPxH = Math.round(cardMmH / 25.4 * dpi)
  return { dpi, cardMmW, cardMmH, bleedMm, cropMarks, cardBacks, pageW, pageH, marginPt, gapPt, bleedPt, cardPtW, cardPtH, cellPtW, cellPtH, cols, rows, perPage, leftPt, cardPxW, cardPxH, cropMarkLen, cropMarkGap, marginMm, gapMm: gapPt / PT_PER_MM, tightened }
}

/**
 * The sets of an export that print together, as `[{ setIds, size }]`. With the card size chosen in the dialog every set is
 * printed at it, together; with "the set's size" each size has pages of its own (poker cards are not put in a tarot grid).
 */
export function cardSizeGroups(db, setIds, opts) {
  if (CARD_PRESETS[opts.cardSize] || opts.cardMmW || opts.cardMmH) return [{ setIds, size: getCardSize(db, setIds[0]) }]
  const groups = new Map()
  for (const id of setIds) {
    const size = getCardSize(db, id)
    const key = `${size.mmW}x${size.mmH}`
    if (!groups.has(key)) groups.set(key, { setIds: [], size })
    groups.get(key).setIds.push(id)
  }
  return [...groups.values()]
}

async function exportPDF(projectDir, opts) {
  const db = getDb(projectDir)
  const setIds = opts.setIds ?? []
  if (!setIds.length) throw new Error(tr('errors.noSetsSelected'))

  const outputDir = opts.outputDir ?? join(projectDir, 'exports')
  ensureDir(outputDir)

  const pdfDoc = await PDFDocument.create()
  const bleedColor = opts.bleedColor ? parseHex(opts.bleedColor) : null
  let cardCount = 0

  // One run of pages for each card size
  for (const group of cardSizeGroups(db, setIds, opts)) {
    const { cardBacks, pageW, pageH, marginPt, gapPt, bleedPt, bleedMm, cropMarks, cardPtW, cardPtH, cellPtW, cellPtH, cols, perPage, leftPt, cardPxW, cardPxH, cropMarkLen, cropMarkGap } = pdfGeometry(db, group.setIds, opts, group.size)
    const rendered = await renderAllCards(projectDir, db, group.setIds, cardPxW, cardPxH, opts)
    if (!rendered.length) continue
    cardCount += rendered.length
    const backCache = new Map()

    async function addCardsPage(items, mirror = false) {
      const page = pdfDoc.addPage([pageW, pageH])
      const spots = cellPositions(items.length, cols, mirror)

      for (let idx = 0; idx < items.length; idx++) {
        const { row, col } = spots[idx]
        const { buffer } = items[idx]
        const pngImage = await pdfDoc.embedPng(buffer)

        // pdf-lib origin is bottom-left
        const x = leftPt + col * (cellPtW + gapPt) + bleedPt
        const y = pageH - marginPt - (row + 1) * cellPtH - row * gapPt + bleedPt

        if (bleedMm > 0) {
          // PRD §10.3: the bleed zone is filled with the card's edge colour, or a user-chosen colour
          const c = bleedColor ?? await sampleEdgeColor(buffer, cardPxW)
          page.drawRectangle({ x: x - bleedPt, y: y - bleedPt, width: cellPtW, height: cellPtH, color: rgb(c.r / 255, c.g / 255, c.b / 255) })
        }
        page.drawImage(pngImage, { x, y, width: cardPtW, height: cardPtH })

        if (cropMarks) drawCropMarks(page, x - bleedPt, y - bleedPt, cellPtW, cellPtH, cropMarkLen, cropMarkGap)
      }
    }

    // Split into pages
    for (let i = 0; i < rendered.length; i += perPage) {
      await addCardsPage(rendered.slice(i, i + perPage))

      if (cardBacks) {
        // Interleaved back page, mirrored left-to-right so backs line up behind fronts when printed duplex
        const pageItems = rendered.slice(i, i + perPage)
        const backs = []
        for (const it of pageItems) backs.push({ buffer: (await backOf(projectDir, db, it.card, cardPxW, cardPxH, opts, backCache)).buffer })
        await addCardsPage(backs, true)
      }
    }
  }
  if (!cardCount) throw new Error(tr('errors.noRenderableCards'))

  const pdfBytes = await pdfDoc.save()
  const filename = `${outputBaseName(db, setIds, opts.fileNameTemplate)}.pdf`
  writeFileSync(join(outputDir, filename), pdfBytes)

  return { outputDir, cardCount, file: filename, pageCount: pdfDoc.getPageCount() }
}

/**
 * Grid position of each of `count` cards on a page. For the back side of a duplex sheet the columns
 * are mirrored, so each back lands exactly behind its front even on a partly filled page.
 */
export function cellPositions(count, cols, mirror = false) {
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols
    return { row: Math.floor(i / cols), col: mirror ? cols - 1 - col : col }
  })
}

/** Colour of the card's edge (top-centre, just inside), used to paint the bleed area. */
export async function sampleEdgeColor(buffer, widthPx) {
  const { data } = await sharp(buffer).flatten({ background: '#ffffff' })
    .extract({ left: Math.max(0, Math.floor(widthPx / 2)), top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return { r: data[0], g: data[1], b: data[2] }
}

/** The eight lines of the four corner crop marks around a cell rectangle: `[x1, y1, x2, y2]`, from the bottom left */
export function cropMarkLines(x, y, w, h, len, gap) {
  return [
    // Top-left
    [x - gap - len, y + h, x - gap, y + h],
    [x, y + h + gap, x, y + h + gap + len],
    // Top-right
    [x + w + gap, y + h, x + w + gap + len, y + h],
    [x + w, y + h + gap, x + w, y + h + gap + len],
    // Bottom-left
    [x - gap - len, y, x - gap, y],
    [x, y - gap - len, x, y - gap],
    // Bottom-right
    [x + w + gap, y, x + w + gap + len, y],
    [x + w, y - gap - len, x + w, y - gap]
  ]
}

/** Draw four corner crop marks around a cell rectangle */
function drawCropMarks(page, x, y, w, h, len, gap) {
  for (const [x1, y1, x2, y2] of cropMarkLines(x, y, w, h, len, gap)) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(0, 0, 0) })
  }
}

// ---------------------------------------------------------------------------
// PNG sheet export — PRD §10.4
// ---------------------------------------------------------------------------

export async function exportPNGSheet(projectDir, opts) {
  const db = getDb(projectDir)
  const setIds = opts.setIds ?? []
  if (!setIds.length) throw new Error(tr('errors.noSetsSelected'))

  const outputDir = opts.outputDir ?? join(projectDir, 'exports')
  ensureDir(outputDir)

  const cardsPerRow = opts.cardsPerRow ?? 10
  const paddingPx   = opts.paddingPx   ?? 4
  const { r: bgR, g: bgG, b: bgB } = parseHex(opts.backgroundColor ?? '#000000')
  const individualFiles = opts.individualFiles ?? false

  // Cards of one size share a sheet; each other size has a sheet of its own (a size given in the options applies to every set)
  const groups = new Map()
  for (const id of setIds) {
    const size = getCardSize(db, id)
    const w = opts.cardWidth ?? size.widthPx, h = opts.cardHeight ?? size.heightPx
    if (!groups.has(`${w}x${h}`)) groups.set(`${w}x${h}`, { setIds: [], w, h, rendered: [] })
    groups.get(`${w}x${h}`).setIds.push(id)
  }
  let drawn = 0
  for (const g of groups.values()) {
    if (opts.previewMax && drawn >= opts.previewMax) break
    g.rendered = await renderAllCards(projectDir, db, g.setIds, g.w, g.h, { ...opts, copies: !individualFiles, previewMax: opts.previewMax ? opts.previewMax - drawn : undefined })   // one file per card, never per copy
    drawn += g.rendered.length
  }
  const rendered = [...groups.values()].flatMap(g => g.rendered)
  if (!rendered.length) throw new Error(tr('errors.noRenderableCards'))

  const fileBase = outputBaseName(db, setIds, opts.fileNameTemplate)
  const writtenFiles = []

  if (individualFiles) {
    for (let i = 0; i < rendered.length; i++) {
      const { card, buffer } = rendered[i]
      const cardName = slugify(card.display_name || String(i + 1))
      // {{card_id}} in the file name pattern names each file after its card (PRD §5.8)
      const byId = /\{\{\s*card_id\s*\}\}/.test(opts.fileNameTemplate ?? '')
      let filename = byId
        ? `${outputBaseName(db, setIds, opts.fileNameTemplate, { card_id: card.card_code ?? '' })}.png`
        : `${fileBase}_${String(i + 1).padStart(3, '0')}_${cardName}.png`
      if (writtenFiles.includes(filename)) filename = filename.replace(/\.png$/, `_${i + 1}.png`)   // two cards with the same ID text never overwrite each other
      writeFileSync(join(outputDir, filename), buffer)
      writtenFiles.push(filename)
    }
  } else {
    const filled = [...groups.values()].filter(g => g.rendered.length)
    for (const [n, g] of filled.entries()) {
      const cardWidth = g.w, cardHeight = g.h
      const rows      = Math.ceil(g.rendered.length / cardsPerRow)
      const sheetW    = cardsPerRow * (cardWidth  + paddingPx) + paddingPx
      const sheetH    = rows        * (cardHeight + paddingPx) + paddingPx

      const composites = g.rendered.map(({ buffer }, i) => ({
        input: buffer,
        left:  paddingPx + (i % cardsPerRow) * (cardWidth  + paddingPx),
        top:   paddingPx + Math.floor(i / cardsPerRow) * (cardHeight + paddingPx)
      }))

      const sheetBuffer = await sharp({
        create: { width: sheetW, height: sheetH, channels: 3, background: { r: bgR, g: bgG, b: bgB } }
      })
        .composite(composites)
        .png({ compressionLevel: 6 })
        .toBuffer()

      const filename = filled.length === 1 ? `${fileBase}_sheet.png` : `${fileBase}_sheet_${n + 1}.png`
      writeFileSync(join(outputDir, filename), sheetBuffer)
      writtenFiles.push(filename)
    }
  }

  return { outputDir, cardCount: rendered.length, files: writtenFiles }
}
