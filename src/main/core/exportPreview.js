/**
 * The live preview of an export (PRD §10.7): what the first sheet, page or card of the export will look like with the options now set.
 *
 * The preview is made by the export itself, into a temporary folder that is removed again, limited to the cards of the first sheet
 * or page, so it cannot disagree with the real thing. Only a print-and-play page is drawn here, from the same page layout as the PDF
 * (`pdfGeometry`), because a PDF cannot be turned into a picture without another program.
 */
import { join } from 'path'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { dirOf } from './context.js'
import { openProjectDb } from '../db.js'
import { getCardSize } from '../cardSize.js'
import { sheetLayout, rowsFor, deckScale } from '../ttsLayout.js'
import { backOf, exportTts, exportPngSheet, planCards, renderAllCards, pdfGeometry, cardSizeGroups, sampleEdgeColor, cropMarkLines, parseHex } from './export.js'

/** Widest picture sent to the window, in pixels */
const SHOW_W = 900
/** Most cards drawn on the preview of a PNG sheet */
const PNG_MAX_CARDS = 60
const PT_PER_MM = 72 / 25.4

const dataUrl = (buffer, mime = 'image/png') => `data:${mime};base64,${buffer.toString('base64')}`

async function shown(buffer, maxW = SHOW_W) {
  const { data, info } = await sharp(buffer).resize({ width: maxW, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  return { dataUrl: dataUrl(data), width: info.width, height: info.height }
}

/**
 * @param {object} ctx
 * @param {{ kind: 'tts' | 'pdf' | 'png', options: object }} request the export options as the export dialog sends them
 * @returns {Promise<{ kind: string, pages: { part: string, dataUrl: string, width: number, height: number }[], facts: object } | { kind: string, empty: true } | { kind: string, error: string }>}
 */
export async function exportPreview(ctx, { kind, options = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spadewick-preview-'))
  try {
    const projectDir = dirOf(ctx)
    const db = openProjectDb(projectDir)
    const setIds = options.setIds ?? []
    const plan = planCards(db, setIds, options)
    if (!plan.length) return { kind, empty: true }
    const cards = plan.reduce((n, p) => n + p.copies, 0)
    if (kind === 'tts') return await previewTts(ctx, db, plan, cards, options, dir)
    if (kind === 'png') return await previewPng(ctx, db, plan, cards, options, dir)
    if (kind === 'pdf') return await previewPdf(projectDir, db, plan, cards, options)
    return { kind, empty: true }
  } catch (err) {
    return { kind, error: String(err?.message ?? err) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function previewTts(ctx, db, plan, cards, options, dir) {
  const first = plan[0]
  const size = getCardSize(db, first.setId)
  const layout = sheetLayout(size.widthPx, size.heightPx)
  const res = await exportTts(ctx, { ...options, setIds: [first.setId], outputDir: dir, generateJson: false, previewMax: layout.perSheet })
  const face = res.files.find(f => /_face/.test(f))
  const back = res.files.find(f => /_backs?(_|\.)/.test(f))
  const pages = [{ part: 'sheet', ...await shown(readFileSync(join(dir, face))) }]
  if (back) pages.push({ part: 'back', ...await shown(readFileSync(join(dir, back)), 360) })
  return {
    kind: 'tts', pages,
    facts: { cards, decks: plan.length, set: db.prepare('SELECT name FROM sets WHERE id = ?').get(first.setId)?.name ?? '', cols: res.grid.cols, rows: rowsFor(layout, Math.min(first.copies, layout.perSheet)), cellWidth: res.grid.cellWidth, cellHeight: res.grid.cellHeight, scale: deckScale(size.mmW), shownCards: Math.min(first.copies, layout.perSheet) }
  }
}

async function previewPng(ctx, db, plan, cards, options, dir) {
  const individual = !!options.individualFiles
  const max = individual ? 1 : Math.min(PNG_MAX_CARDS, Math.max(options.cardsPerRow ?? 10, 1) * 3)
  const res = await exportPngSheet(ctx, { ...options, outputDir: dir, previewMax: max })
  const shownCards = res.cardCount
  const page = await shown(readFileSync(join(dir, res.files[0])))
  return { kind: 'png', pages: [{ part: individual ? 'card' : 'sheet', ...page }], facts: { cards: individual ? plan.reduce((n, p) => n + p.cards, 0) : cards, shownCards, individual } }
}

async function previewPdf(projectDir, db, plan, cards, options) {
  // the pages of each card size are laid out on their own; the first size with cards is shown
  const groups = cardSizeGroups(db, options.setIds, options)
  const cardsOf = group => plan.filter(p => group.setIds.includes(p.setId)).reduce((n, p) => n + p.copies, 0)
  const withCards = groups.filter(group => cardsOf(group) > 0)
  const setIds = withCards[0].setIds
  const g = pdfGeometry(db, setIds, options, withCards[0].size)
  const k = Math.min(1, 520 / g.pageW)                                   // pixels in the preview for each point of the page
  const px = pt => Math.max(1, Math.round(pt * k))
  const cardW = Math.max(40, Math.round(g.cardPtW * k * 2))
  const cardH = Math.max(40, Math.round(g.cardPtH * k * 2))
  const items = await renderAllCards(projectDir, db, setIds, cardW, cardH, { ...options, previewMax: g.perPage })
  const bleedColor = options.bleedColor ? parseHex(options.bleedColor) : null

  const drawPage = async (pageItems, mirror) => {
    const composites = []
    const lines = []
    for (let i = 0; i < pageItems.length; i++) {
      const col = mirror ? g.cols - 1 - (i % g.cols) : i % g.cols
      const row = Math.floor(i / g.cols)
      const x = g.leftPt + col * (g.cellPtW + g.gapPt) + g.bleedPt
      const y = g.pageH - g.marginPt - (row + 1) * g.cellPtH - row * g.gapPt + g.bleedPt   // from the bottom, as in the PDF
      const buffer = pageItems[i].buffer
      if (g.bleedMm > 0) {
        const c = bleedColor ?? await sampleEdgeColor(buffer, cardW)
        composites.push({ input: await sharp({ create: { width: px(g.cellPtW), height: px(g.cellPtH), channels: 3, background: c } }).png().toBuffer(), left: px(x - g.bleedPt), top: px(g.pageH - y - g.cardPtH - g.bleedPt) })
      }
      composites.push({ input: await sharp(buffer).resize(px(g.cardPtW), px(g.cardPtH), { fit: 'fill' }).png().toBuffer(), left: px(x), top: px(g.pageH - y - g.cardPtH) })
      if (g.cropMarks) lines.push(...cropMarkLines(x - g.bleedPt, y - g.bleedPt, g.cellPtW, g.cellPtH, g.cropMarkLen, g.cropMarkGap))
    }
    const W = px(g.pageW), H = px(g.pageH)
    const marks = lines.map(([x1, y1, x2, y2]) => `<line x1="${x1 * k}" y1="${(g.pageH - y1) * k}" x2="${x2 * k}" y2="${(g.pageH - y2) * k}" stroke="#000" stroke-width="0.6"/>`).join('')
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#9aa0a6"/>${marks}</svg>`
    composites.push({ input: Buffer.from(overlay), left: 0, top: 0 })
    const page = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(composites).png().toBuffer()
    return shown(page)
  }

  const pages = [{ part: 'front', ...await drawPage(items, false) }]
  if (g.cardBacks) {
    const cache = new Map()
    const backs = []
    for (const it of items) backs.push({ buffer: (await backOf(projectDir, db, it.card, cardW, cardH, options, cache)).buffer })
    pages.push({ part: 'back', ...await drawPage(backs, true) })
  }
  return {
    kind: 'pdf', pages,
    facts: { cards, cols: g.cols, rows: g.rows, perPage: g.perPage, marginMm: Math.round(g.marginMm * 10) / 10, gapMm: Math.round(g.gapMm * 10) / 10, tightened: g.tightened, sizes: withCards.length,
      pageCount: withCards.reduce((n, group) => { const geo = pdfGeometry(db, group.setIds, options, group.size); return n + Math.ceil(cardsOf(group) / geo.perPage) * (geo.cardBacks ? 2 : 1) }, 0), pageWidthMm: Math.round(g.pageW / PT_PER_MM), pageHeightMm: Math.round(g.pageH / PT_PER_MM), shownCards: items.length }
  }
}
