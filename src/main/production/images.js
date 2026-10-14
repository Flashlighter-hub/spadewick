/**
 * Per-card images for a print service (PRD §18.2 "per-card images", §18.4): every card as a PNG or JPEG of the pixel size that
 * trim plus bleed makes at the resolution, with the bleed the template provides or made from its edge, and one shared card back.
 * The colours stay RGB: these services convert them themselves.
 */
import { join } from 'path'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import sharp from 'sharp'
import { dbOf, dirOf } from '../core/context.js'
import { outputBaseName } from '../core/export.js'
import { effectiveBackTemplateId } from '../render.js'
import { normalizeProduction } from './settings.js'
import { renderFront, renderBackFull } from './raster.js'
import { collect, backKey, Cancelled, progressStart, progressTick, progressEnd, isCancelled } from './engine.js'
import { tr } from '../../shared/i18n.js'

const safeName = s => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '')

async function encode(rgb, size, format, dpi, quality) {
  const img = sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length), { raw: { width: size.width, height: size.height, channels: 3 } }).withMetadata({ density: dpi })
  return format === 'jpeg' ? img.jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer() : img.png().toBuffer()
}

/**
 * @param {object} ctx
 * @param {object} opts production settings that apply (bleedMm, safeMm, dpi, cardBack*) plus `imageFormat` ('png' | 'jpeg'), `jpegQuality`,
 *   and the selection and file name pattern of every export
 * @returns {Promise<{ outputDir: string, files: string[], cardCount: number, pixels: { width: number, height: number } }>}
 */
export async function runImages(ctx, opts) {
  const s = normalizeProduction({ ...opts, colour: 'rgb', standard: 'plain' })
  const format = opts.imageFormat === 'jpeg' ? 'jpeg' : 'png'
  const quality = Math.min(100, Math.max(50, Number(opts.jpegQuality) || 92))
  const db = dbOf(ctx), projectDir = dirOf(ctx)
  const setIds = opts.setIds ?? []
  if (!setIds.length) throw new Error(tr('errors.noSetsSelected'))
  const cards = collect(db, setIds, { ...s, repeatCopies: false }, opts)
  if (!cards.length) throw new Error(tr('errors.noRenderableCards'))
  const outputDir = opts.outputDir ?? join(projectDir, 'exports')
  mkdirSync(outputDir, { recursive: true })
  const wantBack = s.cardBack !== 'none'
  // The backs: one picture for every back the cards share, and one for each card whose back shows its own data (PRD §7.8)
  const backs = []
  if (wantBack) {
    const seen = new Set()
    for (const item of cards) {
      const key = backKey(db, s, item)
      if (seen.has(key)) continue
      seen.add(key)
      const templateId = s.cardBack === 'template' ? effectiveBackTemplateId(db, item.card) : null
      const own = templateId && key.split(':').length > 2          // the key names the card when the back shows its data
      backs.push({ item, own, name: templateId ? (db.prepare('SELECT name FROM templates WHERE id = ?').get(templateId)?.name ?? '') : '' })
    }
  }
  progressStart(cards.length + backs.length)
  const written = []
  const ext = format === 'jpeg' ? 'jpg' : 'png'
  try {
    const used = new Set()
    let pixels = null
    for (const [i, item] of cards.entries()) {
      if (isCancelled()) throw new Cancelled(tr('errors.productionCancelled'))
      const r = await renderFront(projectDir, db, item.card, item.trim, s, item.template)
      pixels ??= { width: r.size.width, height: r.size.height }
      let name = safeName(outputBaseName(db, setIds, opts.fileNameTemplate || '{{card_id}}', { card_id: item.card.card_code || `card${i + 1}` })) || `card${i + 1}`
      if (used.has(name)) name = `${name}_${i + 1}`
      used.add(name)
      const file = `${name}.${ext}`
      writeFileSync(join(outputDir, file), await encode(r.rgb, r.size, format, s.dpi, quality))
      written.push(file)
      progressTick()
    }
    for (const [i, back] of backs.entries()) {
      if (isCancelled()) throw new Cancelled(tr('errors.productionCancelled'))
      const b = await renderBackFull(projectDir, db, back.item.trim, s, back.item.card)
      const deck = safeName(outputBaseName(db, setIds, '{{set_name}}')) || 'deck'
      let name = back.own ? `${safeName(back.item.card.card_code) || `card${i + 1}`}_back`
        : backs.length === 1 ? `${deck}_back` : `${deck}_back_${safeName(back.name) || i + 1}`
      while (used.has(name)) name += '_'
      used.add(name)
      const file = `${name}.${ext}`
      writeFileSync(join(outputDir, file), await encode(b.rgb, b.size, format, s.dpi, quality))
      written.push(file)
      progressTick()
    }
    return { outputDir, files: written, cardCount: cards.length, pixels, format, backWritten: wantBack, backCount: backs.length }
  } catch (err) {
    for (const f of written) rmSync(join(outputDir, f), { force: true })      // an export that stops leaves nothing half done
    throw err
  } finally {
    progressEnd()
  }
}

