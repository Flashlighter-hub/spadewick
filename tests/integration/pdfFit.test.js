/** PRD §10.3.1: a print-and-play page takes as many cards as fit at true size, and each card size has pages of its own. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, readdirSync } from 'fs'
import { PDFDocument } from 'pdf-lib'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { tightenToFit, pdfGeometry } from '../../src/main/core/export.js'
import { openProjectDb } from '../../src/main/db.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const template = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#336699"/></svg>'
const out = () => join(ctx.root, 'out')
const make = (n, extra = {}) => seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: Array.from({ length: n }, (_, i) => ({ name: `C${i + 1}`, fields: { name: `C${i + 1}` } })), template: { svg: template }, ...extra })
const pagesOf = async (opts, file = 'base_set.pdf') => { await invoke('export:pdf', { outputDir: out(), dpi: 72, ...opts }); return (await PDFDocument.load(readFileSync(join(out(), file)))).getPageCount() }
const PT = 72 / 25.4
const letter = { pageW: 612, pageH: 792 }, a4 = { pageW: 595, pageH: 842 }
const poker = { cellW: 63.5 * PT, cellH: 88.9 * PT }

describe('fitting more cards on a page', () => {
  it('poker cards fit 3 × 3 on Letter and on A4 with the margin and gap the dialog starts with', () => {
    for (const page of [letter, a4]) {
      const t = tightenToFit({ ...page, ...poker, marginMm: 10, gapMm: 3 })
      expect(t.tightened).toBe(true)
      expect(t.marginMm).toBeGreaterThanOrEqual(5)
      expect(t.marginMm).toBeLessThanOrEqual(10)
      const w = page.pageW - 2 * t.marginMm * PT, h = page.pageH - 2 * t.marginMm * PT
      expect(3 * poker.cellW + 2 * t.gapMm * PT).toBeLessThanOrEqual(w + 1e-6)
      expect(3 * poker.cellH + 2 * t.gapMm * PT).toBeLessThanOrEqual(h + 1e-6)
    }
  })
  it('changes nothing when nothing more would fit, and keeps the gap as long as it can', () => {
    expect(tightenToFit({ ...letter, cellW: 30 * PT, cellH: 40 * PT, marginMm: 10, gapMm: 3 }).tightened).toBe(false)
    const t = tightenToFit({ ...letter, ...poker, marginMm: 5, gapMm: 3 })
    expect(t.marginMm).toBe(5)                // only the gap gives
    expect(t.gapMm).toBeLessThan(3)
    expect(t.gapMm).toBeGreaterThan(0)
  })
  it('keeps the room crop marks need', () => {
    const t = tightenToFit({ ...letter, ...poker, marginMm: 10, gapMm: 5, minGapMm: 9 / PT })
    expect(t.gapMm).toBeGreaterThanOrEqual(9 / PT - 1e-9)
  })
  it('puts 9 poker cards on a page by default, and keeps exactly what was typed when asked', async () => {
    const { set } = await make(20)
    expect(await pagesOf({ setIds: [set.id] })).toBe(3)                                         // 9 + 9 + 2
    expect(await pagesOf({ setIds: [set.id], pageSize: 'a4' })).toBe(3)
    expect(await pagesOf({ setIds: [set.id], fitMore: false })).toBe(5)                         // 2 × 2 on Letter with 10 mm and 3 mm
    const g = pdfGeometry(openProjectDb(ctx.dir), [set.id], { fitMore: false })
    expect(g.marginMm).toBe(10); expect(g.gapMm).toBeCloseTo(3, 6); expect(g.tightened).toBe(false)
  })
  it('does not touch a grid asked for by hand, or "fit to page"', async () => {
    const { set } = await make(20)
    expect(await pagesOf({ setIds: [set.id], cardsPerRow: 2, cardsPerColumn: 2 })).toBe(5)
    expect(await pagesOf({ setIds: [set.id], scale: 'fit', cardsPerRow: 3, cardsPerColumn: 3 })).toBe(3)
  })
})

describe('cards of different sizes', () => {
  it('each size has pages of its own in the PDF, and the page grid is the size\'s own', async () => {
    const small = await make(9)
    const tall = await make(3, { name: 'Tall', cardSize: 'tarot' })
    const pages = await pagesOf({ setIds: [tall.set.id, small.set.id] }, 'tall_base_set.pdf')
    expect(pages).toBe(2)                                                                          // 3 tarot cards on one page, 9 poker cards on one
    const doc = await PDFDocument.load(readFileSync(join(out(), 'tall_base_set.pdf')))
    expect(doc.getPage(0).getSize()).toEqual(doc.getPage(1).getSize())
  })
  it('a card size chosen in the dialog applies to every set', async () => {
    const small = await make(9)
    const tall = await make(3, { name: 'Tall', cardSize: 'tarot' })
    expect(await pagesOf({ setIds: [tall.set.id, small.set.id], cardSize: 'poker' }, 'tall_base_set.pdf')).toBe(2)   // 12 poker cards: 9 + 3
  })
  it('PNG sheets: one sheet for each size', async () => {
    const small = await make(4)
    const tall = await make(2, { name: 'Tall', cardSize: 'tarot' })
    const res = await invoke('export:png-sheet', { setIds: [tall.set.id, small.set.id], outputDir: out() })
    expect(res.files).toHaveLength(2)
    expect(readdirSync(out()).filter(f => f.endsWith('.png'))).toHaveLength(2)
    const one = await invoke('export:png-sheet', { setIds: [small.set.id], outputDir: join(out(), 'one') })
    expect(one.files).toHaveLength(1)
    expect(one.files[0]).toMatch(/_sheet\.png$/)
  })
})

