/**
 * The size of an imported design (PRD §19.2 step 2): read from its width, height and view box, with the unit the tool
 * wrote (points in Illustrator, pixels in Figma and Inkscape, millimetres or inches when stated), and matched to the
 * closest card size of §10.6.
 */
import { CARD_SIZES } from '../../shared/cardSizes.js'
import { parseLength, lengthToMm, num } from './geometry.js'

const PX_MM = 25.4 / 96
const PT_MM = 25.4 / 72

/** The tool that wrote the file, from the comments before the root element and the root's own attributes. */
export function generatorOf(comments, rootAttrs) {
  const text = comments.join(' ')
  if (/illustrator/i.test(text)) return 'illustrator'
  if (rootAttrs['xmlns:inkscape'] || /inkscape/i.test(text) || rootAttrs['inkscape:version']) return 'inkscape'
  if (/sketch/i.test(text) || rootAttrs['xmlns:sketch']) return 'sketch'
  if (/affinity|serif/i.test(text) || rootAttrs['xmlns:serif']) return 'affinity'
  if (/figma/i.test(text)) return 'figma'
  return 'unknown'
}

/**
 * @returns {{ viewBox: number[], widthMm: number, heightMm: number, unit: string, assumed: boolean, generator: string }}
 *   `unit` is what the file's size is written in; `assumed` is true when the file only has plain numbers, so the physical
 *   size is a guess (points for Illustrator, pixels otherwise).
 */
export function readSize(rootAttrs, generator) {
  const w = parseLength(rootAttrs.width), h = parseLength(rootAttrs.height)
  const vbParts = String(rootAttrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  let viewBox = vbParts.length === 4 && vbParts.every(Number.isFinite) && vbParts[2] > 0 && vbParts[3] > 0 ? vbParts : null
  const physical = l => l && l.unit !== '%' && l.unit !== 'em' && l.unit !== 'ex'
  if (!viewBox) {
    if (!physical(w) || !physical(h) || w.value <= 0 || h.value <= 0) return null
    viewBox = [0, 0, w.value, h.value]
  }
  const userMm = generator === 'illustrator' ? PT_MM : PX_MM
  let widthMm, heightMm, unit, assumed = false
  if (physical(w) && physical(h) && w.unit !== '' && h.unit !== '') {
    widthMm = lengthToMm(w); heightMm = lengthToMm(h); unit = w.unit
    assumed = unit === 'px'   // pixels are a size on a screen, not a size on paper
  } else if (physical(w) && physical(h)) {
    // plain numbers: points for Illustrator, pixels for everyone else
    widthMm = w.value * userMm; heightMm = h.value * userMm
    unit = generator === 'illustrator' ? 'pt' : 'px'; assumed = true
  } else {
    widthMm = viewBox[2] * userMm; heightMm = viewBox[3] * userMm
    unit = generator === 'illustrator' ? 'pt' : 'px'; assumed = true
  }
  return { viewBox, widthMm, heightMm, unit, assumed, generator }
}

/**
 * Card sizes in order of how well they fit a design: a portrait or landscape card of a preset size, by aspect ratio first
 * (5% apart or less is a fit) and then by size. The first entry is the proposal.
 * @returns {{ id: string, mmW: number, mmH: number, landscape: boolean, aspectDiff: number, sizeDiff: number, close: boolean }[]}
 */
export function rankCardSizes(widthMm, heightMm, useSize = true) {
  const landscape = widthMm > heightMm
  const ratio = Math.min(widthMm, heightMm) / Math.max(widthMm, heightMm)
  const longEdge = Math.max(widthMm, heightMm)
  return CARD_SIZES.map(s => {
    const r = Math.min(s.w, s.h) / Math.max(s.w, s.h)
    const aspectDiff = Math.abs(r - ratio) / r
    const sizeDiff = Math.abs(Math.max(s.w, s.h) - longEdge) / Math.max(s.w, s.h)
    return { id: s.id, mmW: landscape ? Math.max(s.w, s.h) : s.w, mmH: landscape ? Math.min(s.w, s.h) : s.h, landscape, aspectDiff, sizeDiff, close: aspectDiff < 0.05 }
  }).sort((a, b) => (a.aspectDiff + (useSize ? a.sizeDiff * 0.05 : 0)) - (b.aspectDiff + (useSize ? b.sizeDiff * 0.05 : 0)))
}

/** What to propose as the card size: a preset when one fits, otherwise the design's own size as a custom size. */
export function proposeCardSize(widthMm, heightMm, useSize = true) {
  const ranked = rankCardSizes(widthMm, heightMm, useSize)
  const best = ranked[0]
  if (best.close) return { cardSize: best.id, cardMmW: best.mmW, cardMmH: best.mmH, preset: true, alternatives: ranked.filter(r => r.close).slice(0, 5).map(r => r.id) }
  return { cardSize: 'custom', cardMmW: round(widthMm), cardMmH: round(heightMm), preset: false, alternatives: ranked.slice(0, 3).map(r => r.id) }
}

const round = n => Math.round(n * 100) / 100

/** Whether the design has the shape of the card (so no fitting is needed). */
export const sameShape = (vb, card) => Math.abs((vb[2] / vb[3]) - (card.mmW / card.mmH)) / (card.mmW / card.mmH) < 0.005

/**
 * The view box that shows a design on a card of `card` mm, by the chosen fit:
 *   fit  – the whole design, centred, the bars outside it transparent (the letterboxing rule of §10.6)
 *   keep – the design at its own physical size, centred (what does not fit is cut, what is left over is empty)
 *   crop – the card is filled, the design cut to its shape
 */
export function viewBoxFor(vb, size, card, fit) {
  const [x, y, w, h] = vb
  const cardRatio = card.mmW / card.mmH
  if (sameShape(vb, card)) return vb
  if (fit === 'keep') {
    const mmPerUnit = size.widthMm / w
    const cw = card.mmW / mmPerUnit, ch = card.mmH / mmPerUnit
    return [x + w / 2 - cw / 2, y + h / 2 - ch / 2, cw, ch].map(round6)
  }
  const wider = w / h > cardRatio       // the design is wider than the card
  const useWidth = fit === 'crop' ? !wider : wider
  const nw = useWidth ? w : h * cardRatio
  const nh = useWidth ? w / cardRatio : h
  return [x + w / 2 - nw / 2, y + h / 2 - nh / 2, nw, nh].map(round6)
}

const round6 = n => Math.round(n * 1e6) / 1e6
export { num }
