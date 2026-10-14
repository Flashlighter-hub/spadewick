/**
 * The production export (PRD §17.3, §17.6 phase 1): every selected card is rendered at the chosen resolution, converted to the output
 * profile, and written as a page of a PDF with its boxes, output intent, marks and die line; the card back is laid out as chosen.
 * Also the proof (soft proof) of one card with its out-of-range colours.
 */
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import sharp from 'sharp'
import { dbOf, dirOf } from '../core/context.js'
import { cardSelector, outputBaseName, drawsTheSameOnEveryCard } from '../core/export.js'
import * as profiles from '../core/profiles.js'
import * as printColors from '../core/printColors.js'
import { effectiveTemplateId, effectiveBackTemplateId } from '../render.js'
import { getCardSize } from '../cardSize.js'
import { createConverter, proofImage, outOfGamut } from '../colour/lcms.js'
import { normalizeProduction } from './settings.js'
import { renderFront, renderBackFull, toInk, pixelBox } from './raster.js'
import { createProductionPdf } from './pdf.js'
import { verifyProductionPdf } from './verify.js'
import { tr } from '../../shared/i18n.js'

// ---------------------------------------------------------------------------
// Progress and cancel (one production export runs at a time)
// ---------------------------------------------------------------------------

const progress = { running: false, done: 0, total: 0, cancelled: false }
export const status = () => ({ ...progress })
export function cancel() { if (progress.running) progress.cancelled = true; return progress.running }

class Cancelled extends Error {}
export { Cancelled }

/** Progress for the other production exports (per-card images) that share the one running slot and the cancel button. */
export const progressStart = total => {
  if (progress.running) throw new Error(tr('errors.productionBusy'))
  Object.assign(progress, { running: true, done: 0, total, cancelled: false })
}
export const progressTick = () => { progress.done++ }
export const progressEnd = () => { progress.running = false }
export const isCancelled = () => progress.cancelled

// ---------------------------------------------------------------------------

/** The cards of an export: selected as in every export, with a template, once each unless copies are asked for. */
export function collect(db, setIds, s, opts) {
  const selected = cardSelector(db, opts)
  const out = []
  for (const setId of setIds) {
    for (const card of db.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(setId)) {
      if (!selected(card)) continue
      const copies = s.repeatCopies ? (card.quantity ?? 1) : Math.min(card.quantity ?? 1, 1)
      if (copies < 1) continue
      const templateId = effectiveTemplateId(db, card)
      if (!templateId) continue
      const size = getCardSize(db, card.set_id)
      out.push({ card, copies, template: db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId), trim: { w: size.mmW, h: size.mmH } })
    }
  }
  return out
}

/**
 * What decides whether two cards' backs are the same picture: the trim size, and the back template (with the card, when the template
 * shows its data). With no card back the plain colour is the back.
 */
export function backKey(db, s, item) {
  const trim = `${item.trim.w}x${item.trim.h}`
  const id = s.cardBack === 'template' ? effectiveBackTemplateId(db, item.card) : null
  if (!id) return `plain:${trim}`
  return drawsTheSameOnEveryCard(db, id) ? `${id}:${trim}` : `${id}:${item.card.id}:${trim}`
}

export function printColorList(ctx, s) {
  if (!s.usePrintColors) return []
  return printColors.list(ctx).filter(c => c.cmyk || c.spotName).map(c => ({
    name: c.name, rgb: [1, 3, 5].map(i => parseInt(c.rgb.slice(i, i + 2), 16)), cmyk: c.cmyk, spot: c.spotName
  }))
}

export async function openConverter(ctx, s) {
  const { bytes, name } = profiles.profileBytes(ctx, s.profileId)
  const converter = await createConverter(bytes, { intent: s.intent, blackPoint: s.blackPoint })
  return { converter, bytes, name }
}

/**
 * Write the production PDF(s).
 * @param {object} ctx
 * @param {object} opts the production settings plus the selection (`setIds`, `cardIds`, `filter`, `outputDir`, `fileNameTemplate`)
 * @returns {Promise<{ outputDir: string, files: string[], cardCount: number, pageCount: number, report: object }>}
 */
export async function run(ctx, opts) {
  if (progress.running) throw new Error(tr('errors.productionBusy'))
  const s = normalizeProduction(opts)
  const db = dbOf(ctx), projectDir = dirOf(ctx)
  const setIds = opts.setIds ?? []
  if (!setIds.length) throw new Error(tr('errors.noSetsSelected'))
  const cards = collect(db, setIds, s, opts)
  if (!cards.length) throw new Error(tr('errors.noRenderableCards'))
  const outputDir = opts.outputDir ?? join(projectDir, 'exports')
  mkdirSync(outputDir, { recursive: true })

  const total = cards.reduce((n, c) => n + c.copies, 0)
  Object.assign(progress, { running: true, done: 0, total, cancelled: false })
  let converter = null
  try {
    const opened = await openConverter(ctx, s)
    converter = opened.converter
    const { bytes, name: profileName } = opened
    const colors = s.colour === 'cmyk' ? printColorList(ctx, s) : []
    const toPdfData = (rgb, w, h) => (s.colour === 'rgb' ? { data: rgb, stats: { printColorPixels: 0, spotPixels: {}, inkLimited: 0, maxInkBefore: 0, maxInkAfter: 0 } } : (() => { const r = toInk(rgb, w, h, { converter, colors, limit: s.inkLimit }); return { data: r.cmyk, stats: r.stats } })())
    const title = opts.title ?? db.prepare("SELECT value FROM project_meta WHERE key = 'name'").get()?.value ?? 'Spadewick'
    const wantBacks = s.cardBack !== 'none'
    const separate = wantBacks && s.backLayout === 'separate'
    const fronts = await createProductionPdf(s, { profileBytes: bytes, profileName, title })
    const backs = separate ? await createProductionPdf(s, { profileBytes: bytes, profileName, title: tr('production.backsTitle', { title }) }) : null
    const backCache = new Map()
    // Cards that share a back share its picture; a back that shows a card's own data is drawn for each (PRD §7.8)
    const backKeyOf = item => backKey(db, s, item)
    const backFor = async item => {
      const key = backKeyOf(item)
      if (!backCache.has(key)) {
        const r = await renderBackFull(projectDir, db, item.trim, s, item.card)
        backCache.set(key, { ...toPdfData(r.rgb, r.size.width, r.size.height), width: r.size.width, height: r.size.height })
      }
      return backCache.get(key)
    }
    const report = { maxInkPct: 0, inkLimitedPixels: 0, printColorPixels: 0, spotPixels: {}, cardsOverInk: 0 }
    const absorb = st => {
      report.maxInkPct = Math.max(report.maxInkPct, st.maxInkBefore)
      report.inkLimitedPixels += st.inkLimited
      if (st.inkLimited) report.cardsOverInk++
      report.printColorPixels += st.printColorPixels
      for (const [k, v] of Object.entries(st.spotPixels)) report.spotPixels[k] = (report.spotPixels[k] ?? 0) + v
    }

    const addBack = async (doc, item) => {
      const b = await backFor(item)
      doc.addPage({ data: b.data, width: b.width, height: b.height, trimMmW: item.trim.w, trimMmH: item.trim.h })
    }
    const afterFronts = []                       // for the layouts that put backs after all fronts
    for (const item of cards) {
      if (progress.cancelled) throw new Cancelled(tr('errors.productionCancelled'))
      const r = await renderFront(projectDir, db, item.card, item.trim, s, item.template)
      const { data, stats } = toPdfData(r.rgb, r.size.width, r.size.height)
      absorb(stats)
      for (let i = 0; i < item.copies; i++) {
        fronts.addPage({ data, width: r.size.width, height: r.size.height, trimMmW: item.trim.w, trimMmH: item.trim.h })
        if (wantBacks && s.backLayout === 'interleaved') await addBack(fronts, item)
        else if (wantBacks && s.backLayout !== 'once') afterFronts.push(item)
        progress.done++
      }
    }
    if (progress.cancelled) throw new Cancelled(tr('errors.productionCancelled'))
    if (wantBacks) {
      if (s.backLayout === 'once') {
        const seen = new Set()                     // one of each different back (a single back unless the cards have more)
        for (const item of cards) { const key = backKeyOf(item); if (!seen.has(key)) { seen.add(key); await addBack(fronts, item) } }
      }
      else if (s.backLayout === 'after') for (const item of afterFronts) await addBack(fronts, item)
      else if (s.backLayout === 'separate') for (const item of afterFronts) await addBack(backs, item)
    }
    const base = outputBaseName(db, setIds, opts.fileNameTemplate)
    const files = []
    const verified = { ok: true, problems: [] }
    const write = async (doc, file) => {
      const bytes = await doc.save()
      writeFileSync(join(outputDir, file), bytes)
      files.push(file)
      const v = await verifyProductionPdf(bytes, s)
      if (!v.ok) { verified.ok = false; verified.problems.push(...v.problems.map(p => ({ ...p, file }))) }
    }
    if (separate) { await write(fronts, `${base}_fronts.pdf`); await write(backs, `${base}_backs.pdf`) }
    else await write(fronts, `${base}.pdf`)
    report.profile = profileName
    report.verified = verified
    report.standard = s.standard
    return { outputDir, files, cardCount: total, pageCount: fronts.pageCount + (backs?.pageCount ?? 0), report }
  } finally {
    converter?.close()
    progress.running = false
  }
}

/**
 * The soft proof of one card (PRD §17.5): how it will print (converted to the profile and back to the screen), the colours the press
 * cannot reproduce, and what the export would do to it (ink limit, exact colours).
 * @returns {Promise<{ proof: string, gamut: string, width: number, height: number, box: object, stats: object }>} base64 PNGs
 */
export async function proof(ctx, opts) {
  const s = normalizeProduction(opts)
  const db = dbOf(ctx), projectDir = dirOf(ctx)
  const setIds = opts.setIds ?? []
  const cards = opts.cardId ? collect(db, [db.prepare('SELECT set_id FROM cards WHERE id = ?').get(opts.cardId)?.set_id].filter(Boolean), s, { cardIds: [opts.cardId] }) : collect(db, setIds, s, opts)
  if (!cards.length) throw new Error(tr('errors.noRenderableCards'))
  const item = cards[0]
  const { converter } = await openConverter(ctx, s)
  try {
    const r = await renderFront(projectDir, db, item.card, item.trim, s, item.template)
    const colors = s.colour === 'cmyk' ? printColorList(ctx, s) : []
    const { cmyk, stats } = toInk(r.rgb, r.size.width, r.size.height, { converter, colors, limit: s.inkLimit })
    const shown = proofImage(converter, cmyk, r.size.width, r.size.height)
    const gamut = outOfGamut(r.rgb, shown)
    const maxW = 640
    const k = Math.min(1, maxW / r.size.width)
    const w = Math.max(1, Math.round(r.size.width * k)), h = Math.max(1, Math.round(r.size.height * k))
    const png = await sharp(Buffer.from(shown), { raw: { width: r.size.width, height: r.size.height, channels: 3 } }).resize(w, h).png().toBuffer()
    const overlay = Buffer.alloc(r.size.width * r.size.height * 4)
    for (let i = 0; i < gamut.mask.length; i++) if (gamut.mask[i]) { overlay[i * 4] = 230; overlay[i * 4 + 1] = 0; overlay[i * 4 + 2] = 120; overlay[i * 4 + 3] = 150 }
    const over = await sharp(overlay, { raw: { width: r.size.width, height: r.size.height, channels: 4 } }).resize(w, h, { kernel: 'nearest' }).png().toBuffer()
    const px = pixelBox(item.trim.w, item.trim.h, s.bleedMm, s.dpi)
    const safePx = Math.round(s.safeMm / 25.4 * s.dpi)
    return {
      proof: png.toString('base64'), gamut: over.toString('base64'), width: w, height: h,
      box: { trim: [px.bleed / r.size.width, px.bleed / r.size.height, px.trimW / r.size.width, px.trimH / r.size.height], safe: [(px.bleed + safePx) / r.size.width, (px.bleed + safePx) / r.size.height, (px.trimW - 2 * safePx) / r.size.width, (px.trimH - 2 * safePx) / r.size.height] },
      stats: {
        maxInkPct: stats.maxInkBefore, inkLimit: s.inkLimit, inkLimitedPixels: stats.inkLimited, printColorPixels: stats.printColorPixels, spotPixels: stats.spotPixels,
        outOfRangePct: Math.round(gamut.count / gamut.mask.length * 1000) / 10, card: item.card.display_name || item.card.card_code || item.card.id
      }
    }
  } finally { converter.close() }
}
