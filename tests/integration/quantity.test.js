import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, readdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { createTestProject, seedSet, invoke, mockDialog, writeText } from '../helpers/project.js'
import { parseCsv } from '../../src/main/csv.js'
import { openProjectDb, closeProjectDb } from '../../src/main/db.js'
import Database from 'better-sqlite3'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#336699"/><text x="20" y="80" font-size="48" fill="#fff">{{name}}</text></svg>`
const out = () => join(ctx.root, 'out')
async function deck(quantities) {
  return seedSet({
    fields: [{ name: 'Name', type: 'text' }],
    cards: quantities.map((q, i) => ({ name: `Card ${i + 1}`, fields: { name: `C${i + 1}` } })),
    template: { svg }
  }).then(async s => {
    for (let i = 0; i < quantities.length; i++) if (quantities[i] !== undefined) await invoke('cards:update', { id: s.cards[i].id, quantity: quantities[i] })
    return s
  })
}

describe('card quantity (PRD §6.5)', () => {
  it('defaults to 1, can be set, and is validated as a whole number from 0 to 999', async () => {
    const { set, cards } = await deck([undefined, undefined])
    expect(cards[0].quantity).toBe(1)
    expect((await invoke('cards:update', { id: cards[0].id, quantity: '3' })).quantity).toBe(3)
    expect((await invoke('cards:update', { id: cards[0].id, quantity: '' })).quantity).toBe(1)
    expect((await invoke('cards:update', { id: cards[0].id, quantity: 0 })).quantity).toBe(0)
    for (const bad of ['-1', '1.5', 'x', '1000']) await expect(invoke('cards:update', { id: cards[0].id, quantity: bad })).rejects.toThrow(/quantity/i)
    await invoke('cards:batch-update', { cardIds: cards.map(c => c.id), quantity: 4 })
    expect((await invoke('cards:list', set.id)).map(c => c.quantity)).toEqual([4, 4])
  })

  it('is kept when a card is duplicated and is part of undo/redo', async () => {
    const { set, cards } = await deck([5])
    const [copy] = await invoke('cards:duplicate', [cards[0].id])
    expect(copy.quantity).toBe(5)
    await invoke('cards:update', { id: cards[0].id, quantity: 2 })
    await invoke('history:undo')
    expect((await invoke('cards:list', set.id)).find(c => c.id === cards[0].id).quantity).toBe(5)
    await invoke('history:redo')
    expect((await invoke('cards:list', set.id)).find(c => c.id === cards[0].id).quantity).toBe(2)
  })

  it('upgrades a project made before quantities existed: every card keeps one copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-q-'))
    const raw = new Database(join(dir, 'project.db'))
    raw.exec("CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','4');" +
      "CREATE TABLE cards(id TEXT PRIMARY KEY, set_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', template_id TEXT, fields_json TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);" +
      "INSERT INTO cards VALUES ('c','s','Old',NULL,'{}',0,0,1,1);")
    raw.close()
    const d = openProjectDb(dir)
    expect(d.prepare("SELECT quantity FROM cards WHERE id = 'c'").get().quantity).toBe(1)
    closeProjectDb(dir)
  })

  it('TTS: each copy takes its own slot, and 0 leaves the card out', async () => {
    const { set } = await deck([3, 1, 0])
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: out() })
    expect(res.cardCount).toBe(4)
    const doc = JSON.parse(readFileSync(join(out(), 'base_set.json'), 'utf8'))
    expect(doc.ObjectStates[0].ContainedObjects.map(o => o.Nickname)).toEqual(['Card 1', 'Card 1', 'Card 1', 'Card 2'])
  })

  it('TTS: copies count towards the sheet limit', async () => {
    const { set } = await deck([70])
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: out() })
    expect(res).toMatchObject({ cardCount: 70, sheetCount: 2 })
  })

  it('PDF: copies are printed (one card per page makes the count visible)', async () => {
    const { set } = await deck([2, 3])
    const res = await invoke('export:pdf', { setIds: [set.id], outputDir: out(), dpi: 100, cardsPerRow: 1, cardsPerColumn: 1 })
    expect(res.cardCount).toBe(5)
    expect((await PDFDocument.load(readFileSync(join(out(), 'base_set.pdf')))).getPageCount()).toBe(5)
  })

  it('PNG sheet: copies fill the sheet, but individual files are one per card', async () => {
    const { set } = await deck([4, 2])
    await invoke('export:png-sheet', { setIds: [set.id], outputDir: out(), cardWidth: 50, cardHeight: 70, cardsPerRow: 3, paddingPx: 0 })
    expect(await sharp(join(out(), 'base_set_sheet.png')).metadata()).toMatchObject({ width: 150, height: 140 })   // 6 cards = 3 × 2
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: join(out(), 'single'), cardWidth: 50, cardHeight: 70, individualFiles: true })
    expect(res.cardCount).toBe(2)
    expect(readdirSync(join(out(), 'single'))).toHaveLength(2)
  })

  it('exports fail clearly when every card has quantity 0', async () => {
    const { set } = await deck([0])
    await expect(invoke('export:png-sheet', { setIds: [set.id], outputDir: out(), cardWidth: 50, cardHeight: 70 })).rejects.toThrow(/No renderable cards/)
  })

  it('a card filter can use quantity', async () => {
    const { set } = await deck([1, 3])
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: out(), cardWidth: 50, cardHeight: 70, filter: 'quantity > 1' })
    expect(res.cardCount).toBe(3)
  })
})

describe('card quantity in CSV and JSON (PRD §5.5)', () => {
  const importCsv = async (set, text, extra = {}) => {
    const path = join(ctx.root, 'in.csv'); writeText(path, text)
    mockDialog.open(path)
    const file = await invoke('dataio:read-file', { format: 'csv', setId: set.id })
    const res = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append', ...extra })
    return { file, res }
  }

  it('a "Quantity" column maps to the built-in quantity and blank means 1', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }] })
    const { file, res } = await importCsv(set, 'Name,Quantity\nOrc,3\nElf,\nGnome,0\n')
    expect(file.mapping.Quantity).toBe('__quantity')
    expect(res.created).toBe(3)
    expect((await invoke('cards:list', set.id)).map(c => c.quantity)).toEqual([3, 1, 0])
    expect(await invoke('fields:list', set.id)).toHaveLength(1)   // no stray "Quantity" field was created
  })

  it('rejects an invalid quantity row and reports it', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }] })
    const { res } = await importCsv(set, 'Name,Quantity\nOrc,two\nElf,2\n')
    expect(res.errors[0]).toMatchObject({ row: 2 })
    expect(res.created).toBe(1)
  })

  it('merge keeps the existing quantity when the file has none for that row', async () => {
    const { set, cards } = await seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'Orc' } }] })
    await invoke('cards:update', { id: cards[0].id, quantity: 7 })
    await importCsv(set, 'Name,Quantity\nOrc,\n', { mode: 'merge', keyField: 'name' })
    expect((await invoke('cards:list', set.id))[0].quantity).toBe(7)
    await importCsv(set, 'Name,Quantity\nOrc,2\n', { mode: 'merge', keyField: 'name' })
    expect((await invoke('cards:list', set.id))[0].quantity).toBe(2)
  })

  it('a field the user already named "Quantity" wins; it is just a field', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Quantity', type: 'number' }] })
    const { file } = await importCsv(set, 'Quantity\n4\n')
    expect(file.mapping.Quantity).toBe('quantity')
    expect((await invoke('cards:list', set.id))[0].quantity).toBe(1)
  })

  it('exports a quantity column, and a round trip keeps the numbers', async () => {
    const { set, cards } = await seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: [{ fields: { name: 'Orc' } }] })
    await invoke('cards:update', { id: cards[0].id, quantity: 6 })
    const path = join(ctx.root, 'cards.csv')
    mockDialog.save(path)
    await invoke('dataio:export', { setIds: [set.id], format: 'csv' })
    expect(parseCsv(readFileSync(path, 'utf8'))).toEqual([['card_id', 'name', 'quantity'], ['BASE-0001', 'Orc', '6']])
    const other = await seedSet({ name: 'Other', fields: [{ name: 'Name', type: 'text' }] })
    await importCsv(other.set, readFileSync(path, 'utf8'))
    expect((await invoke('cards:list', other.set.id))[0].quantity).toBe(6)
  })
})
