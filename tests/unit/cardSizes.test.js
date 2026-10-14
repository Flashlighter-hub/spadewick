import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { CARD_SIZES, CARD_SIZE_BY_ID, mmToPx } from '../../src/shared/cardSizes.js'
import { getCardSize } from '../../src/main/cardSize.js'

describe('card size presets (PRD §10.6)', () => {
  it('has unique ids and sane portrait dimensions', () => {
    expect(new Set(CARD_SIZES.map(s => s.id)).size).toBe(CARD_SIZES.length)
    for (const s of CARD_SIZES) { expect(s.w).toBeGreaterThan(20); expect(s.h).toBeGreaterThanOrEqual(s.w) }
  })
  it('includes the standard sizes named in the PRD', () => {
    expect(CARD_SIZE_BY_ID.poker).toMatchObject({ w: 63.5, h: 88.9 })
    expect(CARD_SIZE_BY_ID.bridge).toMatchObject({ w: 57.15, h: 88.9 })
    expect(CARD_SIZE_BY_ID.tarot).toMatchObject({ w: 70, h: 120 })
    for (const id of ['mini_us', 'mini_eu', 'japanese', 'jumbo', 'square', 'standard_eu', 'standard_us']) expect(CARD_SIZE_BY_ID[id]).toBeTruthy()
  })
  it('converts mm to pixels at a DPI', () => {
    expect(mmToPx(25.4, 300)).toBe(300)
    expect(mmToPx(63.5, 300)).toBe(750)
  })
})

describe('getCardSize resolution (PRD §10.6)', () => {
  function db(meta, sets = []) {
    const d = new Database(':memory:')
    d.exec('CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE sets(id TEXT, card_size TEXT, card_mm_w REAL, card_mm_h REAL)')
    for (const [k, v] of Object.entries(meta)) d.prepare('INSERT INTO project_meta VALUES (?,?)').run(k, String(v))
    for (const s of sets) d.prepare('INSERT INTO sets VALUES (?,?,?,?)').run(s.id, s.size ?? null, s.w ?? null, s.h ?? null)
    return d
  }
  it('is Poker for a set that is missing, at the project raster width', () => {
    expect(getCardSize(db({ card_width_px: 500 }), null)).toMatchObject({ widthPx: 500, heightPx: 700, id: 'poker' })
  })
  it('derives pixel height from the preset aspect ratio', () => {
    const r = getCardSize(db({ card_width_px: 500 }, [{ id: 'a', size: 'tarot' }]), 'a')
    expect(r.heightPx).toBe(Math.round(500 * 120 / 70))
  })
  it('gives every set its own size', () => {
    const d = db({ card_width_px: 500 }, [{ id: 'a', size: 'poker' }, { id: 'b', size: 'mini_us' }, { id: 'c', size: 'custom', w: 50, h: 100 }])
    expect(getCardSize(d, 'a').id).toBe('poker')
    expect(getCardSize(d, 'b').id).toBe('mini_us')
    expect(getCardSize(d, 'c')).toMatchObject({ id: 'custom', mmW: 50, mmH: 100, heightPx: 1000 })
  })
  it('does not read a project default: a set with no size is Poker', () => {
    const d = db({ card_size: 'tarot', card_width_px: 500 }, [{ id: 'a' }])
    expect(getCardSize(d, 'a').id).toBe('poker')
  })
  it('survives a bad custom size', () => {
    const d = db({ card_width_px: 500 }, [{ id: 'a', size: 'custom', w: 0, h: -5 }])
    expect(getCardSize(d, 'a').heightPx).toBeGreaterThan(0)
  })
})
