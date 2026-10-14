/**
 * One card (or the back) as pixels ready for a production PDF (PRD §17.3, §17.4): rendered at the chosen resolution with the bleed
 * the template provides or the bleed made from its edge, flattened onto paper (print has no transparency in phase 1), converted to
 * the output profile, with the print colours set exactly and the ink limit kept.
 */
import sharp from 'sharp'
import { renderCard, effectiveBackTemplateId } from '../render.js'
import { fitToCardSize, renderBack, parseHex } from '../core/export.js'
import { convertImage, applyPrintColors, countColor, limitInk, inkStats } from '../colour/lcms.js'

const mmToPx = (mm, dpi) => Math.round(mm / 25.4 * dpi)

/**
 * The pixel sizes of a card at a resolution: the trim, the bleed on each side, and the whole. The whole is what trim plus twice the bleed
 * makes in millimetres (the number a manufacturer states, §18.3), so an odd pixel goes to the right and bottom side.
 */
export function pixelBox(trimMmW, trimMmH, bleedMm, dpi) {
  const trimW = mmToPx(trimMmW, dpi), trimH = mmToPx(trimMmH, dpi)
  const width = mmToPx(trimMmW + 2 * bleedMm, dpi), height = mmToPx(trimMmH + 2 * bleedMm, dpi)
  const extraW = width - trimW, extraH = height - trimH
  const left = Math.floor(extraW / 2), top = Math.floor(extraH / 2)
  return { trimW, trimH, bleed: left, bleedL: left, bleedR: extraW - left, bleedT: top, bleedB: extraH - top, width, height }
}

const bg = hex => { const c = parseHex(hex, { r: 255, g: 255, b: 255 }); return { r: c.r, g: c.g, b: c.b, alpha: 1 } }

/**
 * The bleed of a rendered card: the template includes it (cut or carried further to the wanted size), or it is made from the edge
 * (mirrored) or filled with a colour (PRD §17.4).
 * @param {Buffer} png the rendered card
 * @param {{ bleed_mm: number, bleed_mode: string, bleed_color: string|null }} template
 */
async function withBleed(png, template, size, dpi, bleedMm) {
  const mode = template?.bleed_mode ?? 'extend'
  const includes = mode === 'included' && Number(template.bleed_mm) > 0
  const nativePx = includes ? mmToPx(Number(template.bleed_mm), dpi) : 0
  const fill = mode === 'fill' ? (template.bleed_color ?? '#ffffff') : '#ffffff'
  // the rendered picture is the trim plus the template's own bleed; its pixels are made exactly that size
  let img = sharp(png).flatten({ background: fill }).resize(size.trimW + 2 * nativePx, size.trimH + 2 * nativePx, { fit: 'fill' })
  let buffer = await img.png().toBuffer()
  // cut what is more than wanted, then carry the edge outward for what is less
  const d = { left: size.bleedL - nativePx, right: size.bleedR - nativePx, top: size.bleedT - nativePx, bottom: size.bleedB - nativePx }
  const cut = { left: Math.max(0, -d.left), right: Math.max(0, -d.right), top: Math.max(0, -d.top), bottom: Math.max(0, -d.bottom) }
  if (cut.left || cut.right || cut.top || cut.bottom) {
    const m = await sharp(buffer).metadata()
    buffer = await sharp(buffer).extract({ left: cut.left, top: cut.top, width: m.width - cut.left - cut.right, height: m.height - cut.top - cut.bottom }).png().toBuffer()
  }
  const extend = { left: Math.max(0, d.left), right: Math.max(0, d.right), top: Math.max(0, d.top), bottom: Math.max(0, d.bottom) }
  if (extend.left || extend.right || extend.top || extend.bottom) {
    buffer = await sharp(buffer).extend(mode === 'fill' ? { ...extend, extendWith: 'background', background: bg(fill) } : { ...extend, extendWith: includes ? 'copy' : 'mirror' }).png().toBuffer()
  }
  return buffer
}

async function toRgb(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { rgb: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

/** The card's pixels at the full size of trim plus bleed: RGB. */
export async function renderFront(projectDir, db, card, trimMm, s, template, onRendered, templateId) {
  const size = pixelBox(trimMm.w, trimMm.h, s.bleedMm, s.dpi)
  const nativePx = template?.bleed_mode === 'included' ? mmToPx(Number(template.bleed_mm) || 0, s.dpi) : 0
  const renderW = size.trimW + 2 * nativePx
  const rendered = await renderCard(projectDir, card.id, { width: renderW, templateId })
  if (onRendered) await onRendered(rendered, nativePx)
  // a template whose shape is not the card's is letterboxed, as in every export (PRD §10.6)
  const fitted = nativePx ? rendered : await fitToCardSize(rendered, size.trimW, size.trimH)
  const png = await withBleed(fitted, template, size, s.dpi, s.bleedMm)
  return { ...(await toRgb(png)), size }
}

/**
 * The card back at the full size of trim plus bleed: RGB. With the set's card back (`s.cardBack === 'template'`) it is that template drawn
 * with the card's data, with its own bleed treatment, as a front is; otherwise a colour, or a picture covered to the trim with its edge
 * carried into the bleed.
 */
export async function renderBackFull(projectDir, db, trimMm, s, card = null) {
  const size = pixelBox(trimMm.w, trimMm.h, s.bleedMm, s.dpi)
  const backId = s.cardBack === 'template' && card ? effectiveBackTemplateId(db, card) : null
  if (backId) {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(backId)
    return renderFront(projectDir, db, card, trimMm, s, template, null, backId)
  }
  if (s.cardBack === 'color' || !s.cardBackAssetId) {
    const { r, g, b } = parseHex(s.cardBackColor, { r: 26, g: 26, b: 46 })
    const png = await sharp({ create: { width: size.width, height: size.height, channels: 3, background: { r, g, b } } }).png().toBuffer()
    return { ...(await toRgb(png)), size }
  }
  const trim = await renderBack(projectDir, db, size.trimW, size.trimH, s)
  const png = await withBleed(trim, { bleed_mode: 'extend' }, size, s.dpi, s.bleedMm)
  return { ...(await toRgb(png)), size }
}

/**
 * RGB pixels to the printed ink: converted through the profile, the print colours set, the ink limit kept.
 * @param {object} ctx { converter, colors: [{ rgb, cmyk, name, spot }], limit }
 */
export function toInk(rgb, width, height, ctx) {
  const cmyk = convertImage(ctx.converter, rgb, width, height)
  const stats = { printColorPixels: 0, spotPixels: {}, inkLimited: 0, maxInkBefore: 0, maxInkAfter: 0 }
  if (ctx.colors?.length) {
    for (const c of ctx.colors) {
      // count per colour, then set them all
      const hit = c.cmyk ? applyPrintColors(rgb, cmyk, [c]) : (c.spot ? countColor(rgb, c.rgb) : 0)
      if (hit) { stats.printColorPixels += hit; if (c.spot) stats.spotPixels[c.spot] = (stats.spotPixels[c.spot] ?? 0) + hit }
    }
  }
  stats.maxInkBefore = inkStats(cmyk).maxPct
  if (ctx.limit) stats.inkLimited = limitInk(cmyk, ctx.limit)
  stats.maxInkAfter = stats.inkLimited ? inkStats(cmyk).maxPct : stats.maxInkBefore
  return { cmyk, stats }
}
