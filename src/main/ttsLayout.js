/**
 * How a Tabletop Simulator deck is laid out (PRD §10.2.2): the card sheets, the size of the deck in the game and where
 * decks are put on the table. The numbers follow the saved decks Dextrous writes (and Tabletop Simulator loads happily):
 * 8 × 6 sheets of 512 px cards for poker-shaped cards, 7 × 4 sheets of about 585 px cards for tall ones, a deck scale
 * of 1.13636 for a poker card and about 1.534 for a tarot card.
 */

/** Widest sheet, in pixels. Tabletop Simulator shrinks anything much bigger when it loads the image. */
export const TTS_SHEET_MAX_W = 4096
/** Tallest sheet, in pixels (an 8 × 6 sheet of poker cards is 4096 × 4302). */
export const TTS_SHEET_MAX_H = 4400
/** Most rows Tabletop Simulator's deck sheets have. */
export const TTS_MAX_ROWS = 7
/**
 * Height of a card at deck scale 1, in millimetres (3.08 inches): an 88.9 mm poker card is scale 1.13636 and a 120 mm tarot
 * card about 1.534 (the scales of Dextrous' saved decks). The game fixes the card's height and lets its width follow the
 * shape of the sheet cell, so the scale must come from the height: from the width, a tall card comes out too short.
 */
export const TTS_UNIT_MM = 78.232
/** Height of a card at deck scale 1, in table units. */
const UNIT_H = 3.08

/**
 * The sheet grid for cards of `cardW` × `cardH` pixels: 8 columns for cards about as wide as poker cards (or wider), 7 for
 * taller ones; the cell is the card scaled down to fit the width (never scaled up); as many rows as stay under the height.
 * One slot is kept for the card back, so a sheet holds `perSheet` cards.
 */
export function sheetLayout(cardW, cardH) {
  const aspect = cardW / cardH
  const cols = aspect >= 0.7 ? 8 : 7
  const cellW = Math.max(1, Math.min(Math.round(cardW), Math.floor(TTS_SHEET_MAX_W / cols)))
  const cellH = Math.max(1, Math.round(cellW / aspect))
  const rows = Math.max(1, Math.min(TTS_MAX_ROWS, Math.floor(TTS_SHEET_MAX_H / cellH)))
  return { cols, rows, cellW, cellH, perSheet: cols * rows - 1 }
}

/** The rows a sheet needs for `count` cards and the back (the back is the last slot, so the grid is never fuller than needed). */
export const rowsFor = (layout, count) => Math.max(1, Math.min(layout.rows, Math.ceil((count + 1) / layout.cols)))

/** The scale that makes a deck as tall as the physical card: 88.9 mm → 1.13636363636, 120 mm → 1.53388. */
export const deckScale = mmH => Number((mmH / TTS_UNIT_MM).toFixed(11))

/**
 * Table positions for decks laid out in rows, so they do not land on top of each other. `sizes` is `[{ scale, aspect }]`
 * (aspect = card width ÷ height); the result is `[{ x, z }]` in the same order.
 */
export function placeDecks(sizes, { gap = 0.6, rowWidth = 24 } = {}) {
  const out = []
  let x = 0, z = 0, rowDepth = 0
  for (const { scale, aspect } of sizes) {
    const d = UNIT_H * scale
    const w = d * aspect
    if (x > 0 && x + w > rowWidth) { x = 0; z -= rowDepth / 2 + gap + d / 2; rowDepth = 0 }
    out.push({ x: round2(x + w / 2), z: round2(z) })
    x += w + gap
    rowDepth = Math.max(rowDepth, d)
  }
  return out
}

const round2 = n => Math.round(n * 100) / 100
