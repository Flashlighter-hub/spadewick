/** PRD §10.7: the live preview of an export is made by the export itself, from the first sheet or page. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdirSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const template = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#336699"/><text x="20" y="80" font-size="48" fill="#ffffff">{{name}}</text></svg>'
const make = (n, extra = {}) => seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: Array.from({ length: n }, (_, i) => ({ name: `C${i + 1}`, fields: { name: `C${i + 1}` } })), template: { svg: template }, ...extra })
const png = async url => sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
const leftovers = () => readdirSync(tmpdir()).filter(f => f.startsWith('spadewick-preview-'))

describe('export preview', () => {
  it('TTS: shows the first sheet and the back, and says how many cards and decks there are', async () => {
    const a = await make(60), b = await make(5, { name: 'Other' })
    const r = await invoke('export:preview', { kind: 'tts', options: { setIds: [a.set.id, b.set.id] } })
    expect(r.error).toBeUndefined()
    expect(r.pages.map(p => p.part)).toEqual(['sheet', 'back'])
    expect(r.facts).toMatchObject({ cards: 65, decks: 2, cols: 8, rows: 6, shownCards: 47 })
    const sheet = await png(r.pages[0].dataUrl)
    expect(sheet.width).toBeLessThanOrEqual(900)
    expect(sheet.width / sheet.height).toBeCloseTo(8 * 500 / (6 * 700), 1)    // the grid of the real sheet
  })

  it('PNG sheet: shows the sheet with the chosen cards per row, and says when it shows only the first cards', async () => {
    const a = await make(30)
    const r = await invoke('export:preview', { kind: 'png', options: { setIds: [a.set.id], cardsPerRow: 5, paddingPx: 4, backgroundColor: '#ff0000' } })
    expect(r.facts).toMatchObject({ cards: 30, shownCards: 15, individual: false })
    const m = await png(r.pages[0].dataUrl)
    expect(m.width / m.height).toBeCloseTo((5 * 504 + 4) / (3 * 704 + 4), 1)
  })

  it('PNG, one file per card: shows the first card', async () => {
    const a = await make(3)
    const r = await invoke('export:preview', { kind: 'png', options: { setIds: [a.set.id], individualFiles: true } })
    expect(r.pages[0].part).toBe('card')
    expect(r.facts).toMatchObject({ shownCards: 1, individual: true })
  })

  it('PDF: draws a page of the layout the PDF will have, with a back page for duplex', async () => {
    const a = await make(20)
    const opts = { setIds: [a.set.id], pageSize: 'a4', cardsPerRow: 3, cardsPerColumn: 3, marginMm: 5, gapMm: 3 }
    const r = await invoke('export:preview', { kind: 'pdf', options: opts })
    expect(r.error).toBeUndefined()
    expect(r.pages.map(p => p.part)).toEqual(['front'])
    expect(r.facts).toMatchObject({ cards: 20, cols: 3, rows: 3, perPage: 9, pageCount: 3, shownCards: 9, pageWidthMm: 210, pageHeightMm: 297 })
    const m = await png(r.pages[0].dataUrl)
    expect(m.width / m.height).toBeCloseTo(210 / 297, 2)
    const duplex = await invoke('export:preview', { kind: 'pdf', options: { ...opts, cardBacks: true } })
    expect(duplex.pages.map(p => p.part)).toEqual(['front', 'back'])
    expect(duplex.facts.pageCount).toBe(6)
  })

  it('says so when there is nothing to draw, and leaves no files behind', async () => {
    const a = await make(2)
    expect((await invoke('export:preview', { kind: 'tts', options: { setIds: [] } })).empty).toBe(true)
    expect((await invoke('export:preview', { kind: 'png', options: { setIds: [a.set.id], filter: "1 == 2" } })).empty).toBe(true)   // a filter that keeps no card
    await invoke('export:preview', { kind: 'tts', options: { setIds: [a.set.id] } })
    expect(leftovers()).toEqual([])
  })
})
