import { CARD_SIZE_BY_ID } from '../shared/cardSizes.js'

function meta(db, key) {
  return db.prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value ?? null
}

const POKER = CARD_SIZE_BY_ID.poker

/** Two sizes are the same when their physical dimensions match (PRD §10.6). */
export const sameCardSize = (a, b) => !!a && !!b && Math.abs(a.mmW - b.mmW) < 0.05 && Math.abs(a.mmH - b.mmH) < 0.05

/**
 * A size as `{ id, mmW, mmH }` from what the interface sends or what a row stores: a preset id, or 'custom' with
 * its millimetres. Anything missing or unreadable is Poker, the preselected size.
 */
export function normalizeCardSize({ cardSize, cardMmW, cardMmH } = {}) {
  const preset = CARD_SIZE_BY_ID[cardSize]
  if (preset) return { id: cardSize, mmW: preset.w, mmH: preset.h }
  if (cardSize === 'custom' && Number(cardMmW) > 0 && Number(cardMmH) > 0) return { id: 'custom', mmW: Number(cardMmW), mmH: Number(cardMmH) }
  return { id: 'poker', mmW: POKER.w, mmH: POKER.h }
}

/** The size stored on a set or template row. */
export const sizeOfRow = row => normalizeCardSize({ cardSize: row?.card_size, cardMmW: row?.card_mm_w, cardMmH: row?.card_mm_h })

/** The columns that store a size: [card_size, card_mm_w, card_mm_h]. */
export const sizeColumns = size => [size.id, size.id === 'custom' ? size.mmW : null, size.id === 'custom' ? size.mmH : null]

/** A size with its raster size. Width is the project's raster width; height follows the physical shape. */
export function withPixels(db, size) {
  const widthBase = Number(meta(db, 'card_width_px') ?? 500)
  return { ...size, widthPx: widthBase, heightPx: Math.round(widthBase * size.mmH / size.mmW) }
}

/** The card size of a set (PRD §10.6): every set has its own; a set that is not found is Poker. */
export function getCardSize(db, setId) {
  const set = setId ? db.prepare('SELECT card_size, card_mm_w, card_mm_h FROM sets WHERE id = ?').get(setId) : null
  return withPixels(db, sizeOfRow(set))
}

/** The templates of a project that can be used with `size`: those of the same size (PRD §10.6). */
export function templatesForSize(db, size) {
  return db.prepare('SELECT * FROM templates ORDER BY name').all().filter(t => sameCardSize(sizeOfRow(t), size))
}
