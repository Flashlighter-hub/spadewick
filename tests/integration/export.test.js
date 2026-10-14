import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, existsSync, readdirSync } from 'fs'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { execFileSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { createTestProject, seedSet, invoke, makePng } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const template = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">
  <rect width="500" height="700" fill="#336699"/><text x="20" y="80" font-size="48" fill="#ffffff">{{name}}</text></svg>`

async function makeCards(n, setOpts = {}) {
  return seedSet({
    ...setOpts, fields: [{ name: 'Name', type: 'text' }, { name: 'Flavor', type: 'text' }],
    cards: Array.from({ length: n }, (_, i) => ({ name: `Card ${i + 1}`, fields: { name: `C${i + 1}`, flavor: `flavor ${i + 1}` } })),
    template: { svg: template }
  })
}
const outDir = () => join(ctx.root, 'out')

/** The file a Tabletop Simulator file link points at, on this computer (the reverse of the export's link). */
function linkToPath(link) {
  const m = /^file:(?:\/\/\/(?=[A-Za-z]:)|\/\/)(.*)$/.exec(link)
  expect(m, `not a file link: ${link}`).toBeTruthy()
  const path = m[1].replace(/%3F/g, '?').replace(/%23/g, '#').replace(/%25/g, '%')
  return process.platform === 'win32' ? path.replace(/\//g, '\\') : `/${path}`
}

describe('TTS image links (PRD §10.2.1)', () => {
  const deckOf = file => JSON.parse(readFileSync(join(outDir(), file), 'utf8')).ObjectStates[0]

  it('defaults to full local file links, and every link points at a file that exists', async () => {
    const { set } = await makeCards(3)
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: outDir() })
    expect(res.imageLinks).toBe('local')
    const deck = deckOf('base_set.json')
    for (const url of [deck.CustomDeck['1'].FaceURL, deck.CustomDeck['1'].BackURL]) {
      expect(url).toMatch(/^file:\/\/(\/[A-Za-z]:\/|\/)/)             // file:///C:/… on Windows, file:///… elsewhere
      expect(existsSync(linkToPath(url)), url).toBe(true)
    }
    expect(deck.CustomDeck['1'].FaceURL).not.toMatch(/\\/)             // forward slashes only
  })

  it('writes the same links into every contained card, and a link per sheet when there are several', async () => {
    const { set } = await makeCards(70)                                   // 47 cards per sheet at this size: two sheets
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir() })
    const deck = deckOf('base_set.json')
    expect(Object.keys(deck.CustomDeck)).toEqual(['1', '2'])
    const faces = Object.values(deck.CustomDeck).map(d => d.FaceURL)
    expect(new Set(faces).size).toBe(2)
    for (const url of faces) expect(existsSync(linkToPath(url)), url).toBe(true)
    for (const o of deck.ContainedObjects) {
      const n = Object.keys(o.CustomDeck)[0]
      expect(o.CustomDeck[n]).toEqual(deck.CustomDeck[n])                 // the card's description of its sheet is the deck's
    }
  })

  it('"file names only" writes the bare names, as before', async () => {
    const { set } = await makeCards(2)
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), imageLinks: 'names' })
    expect(res.imageLinks).toBe('names')
    expect(deckOf('base_set.json').CustomDeck['1']).toMatchObject({ FaceURL: 'base_set_face.png', BackURL: 'base_set_back.png' })
  })

  it('treats an unknown mode as local, and writes no links when there is no JSON', async () => {
    const { set } = await makeCards(2)
    expect((await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), imageLinks: 'hosted' })).imageLinks).toBe('local')
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: join(ctx.root, 'nojson'), generateJson: false })
    expect(res.imageLinks).toBeNull()
    expect(res.files.some(f => f.endsWith('.json'))).toBe(false)
  })

  it('links to the folder that was chosen, even when its path has spaces and accents', async () => {
    const { set } = await makeCards(2)
    const dir = join(ctx.root, 'Mój deck (v2)')
    await invoke('export:tts', { setIds: [set.id], outputDir: dir })
    const url = JSON.parse(readFileSync(join(dir, 'base_set.json'), 'utf8')).ObjectStates[0].CustomDeck['1'].FaceURL
    expect(url).toContain('Mój deck (v2)')                                // not encoded: TTS reads the link as a path
    expect(existsSync(linkToPath(url))).toBe(true)
  })

  it('writes absolute paths only into the exported JSON, never into the project (portability contract, PRD §4)', async () => {
    const { set } = await makeCards(2)
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir() })
    const dbFile = join(ctx.dir, 'project.db')
    for (const f of [dbFile, `${dbFile}-wal`]) {
      if (!existsSync(f)) continue
      const bytes = readFileSync(f)
      expect(bytes.includes(Buffer.from(outDir().replace(/\\/g, '/'))), f).toBe(false)
      expect(bytes.includes(Buffer.from(outDir())), f).toBe(false)
    }
  })
})

describe('TTS export (PRD §10.2)', () => {
  it('writes a face sheet in the 8-column grid of Dextrous, a back image and a valid saved-object JSON', async () => {
    const { set } = await makeCards(5)
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: outDir() })
    expect(res).toMatchObject({ cardCount: 5, sheetCount: 1 })
    const face = await sharp(join(outDir(), 'base_set_face.png')).metadata()
    expect(face).toMatchObject({ width: 4000, height: 700 }) // 8 × 500 wide, one row of 700: five cards and the back need no more
    expect(await sharp(join(outDir(), 'base_set_back.png')).metadata()).toMatchObject({ width: 500, height: 700 })
    const doc = JSON.parse(readFileSync(join(outDir(), 'base_set.json'), 'utf8'))
    for (const k of ['SaveName', 'GameMode', 'Date', 'VersionNumber', 'ObjectStates']) expect(doc).toHaveProperty(k)
    const deck = doc.ObjectStates[0]
    expect(deck.Name).toBe('Deck')
    expect(deck.DeckIDs).toEqual([100, 101, 102, 103, 104])
    expect(deck.CustomDeck['1']).toMatchObject({ NumWidth: 8, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 })
    expect(linkToPath(deck.CustomDeck['1'].FaceURL)).toBe(join(outDir(), 'base_set_face.png'))     // a link to the file, not a bare name (PRD §10.2.1)
    expect(linkToPath(deck.CustomDeck['1'].BackURL)).toBe(join(outDir(), 'base_set_back.png'))
    expect(deck.ContainedObjects.map(o => o.Nickname)).toEqual(['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5'])
    expect(deck.ContainedObjects.map(o => o.CardID)).toEqual(deck.DeckIDs)
  })

  it('places the card back in the last slot and cards in reading order', async () => {
    const { set } = await makeCards(2)
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), cardBackColor: '#ff0000' })
    const { data, info } = await sharp(join(outDir(), 'base_set_face.png')).raw().toBuffer({ resolveWithObject: true })
    const px = (x, y) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 1], data[(y * info.width + x) * info.channels + 2]]
    expect(px(7 * 500 + 250, 350)).toEqual([255, 0, 0])   // the last slot: the back
    expect(px(250, 350)).toEqual([0x33, 0x66, 0x99])                  // slot 0: first card
    expect(px(500 + 250, 350)).toEqual([0x33, 0x66, 0x99])            // slot 1
    expect(px(2 * 500 + 250, 350)).toEqual([0, 0, 0])                 // slot 2: empty
  })

  it('splits sets over the cards a sheet holds (55 at this size) into several sheets with correct ids', async () => {
    const { set } = await makeCards(70)
    const res = await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), cardWidth: 60, cardHeight: 84 })
    expect(res.sheetCount).toBe(2)
    expect(existsSync(join(outDir(), 'base_set_face_1.png')) && existsSync(join(outDir(), 'base_set_face_2.png'))).toBe(true)
    const deck = JSON.parse(readFileSync(join(outDir(), 'base_set.json'), 'utf8')).ObjectStates[0]
    expect(deck.DeckIDs).toHaveLength(70)
    expect(deck.DeckIDs[54]).toBe(154); expect(deck.DeckIDs[55]).toBe(200)
    expect(Object.keys(deck.CustomDeck)).toEqual(['1', '2'])
  })

  it('uses the configured name and description fields (PRD §10.2 settings)', async () => {
    const { set } = await makeCards(1)
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), displayNameField: 'flavor', descriptionField: 'flavor', cardWidth: 50, cardHeight: 70 })
    const obj = JSON.parse(readFileSync(join(outDir(), 'base_set.json'), 'utf8')).ObjectStates[0]   // one card: a card, not a deck
    expect(obj.Nickname).toBe('flavor 1')
    expect(obj.Description).toBe('flavor 1')
  })

  it('can skip the JSON file', async () => {
    const { set } = await makeCards(1)
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), generateJson: false, cardWidth: 50, cardHeight: 70 })
    expect(existsSync(join(outDir(), 'base_set.json'))).toBe(false)
  })

  it('uses an asset as the card back', async () => {
    const [asset] = await invoke('assets:import', [await makePng(join(ctx.root, 'back.png'), 100, 100, '#00ff00')])
    const { set } = await makeCards(1)
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), cardBackAssetId: asset.id, cardWidth: 50, cardHeight: 70 })
    const { data } = await sharp(join(outDir(), 'base_set_back.png')).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([0, 255, 0])
  })

  it('follows the set card size (tarot aspect)', async () => {
    const { set } = await makeCards(1, { cardSize: 'tarot' })
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir() })
    expect(await sharp(join(outDir(), 'base_set_back.png')).metadata()).toMatchObject({ width: 500, height: 857 })
  })

  it('refuses to export when no card has a template', async () => {
    const { set } = await seedSet({ cards: [{ name: 'a' }] })
    await expect(invoke('export:tts', { setIds: [set.id], outputDir: outDir() })).rejects.toThrow(/No renderable cards/)
  })

  it('exports 100 cards within the 30 s budget (PRD §14.1)', async () => {
    const { set } = await makeCards(100)
    const t = Date.now()
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir() })
    expect(Date.now() - t).toBeLessThan(30000)
  }, 60000)
})

describe('PNG sheet export (PRD §10.4)', () => {
  it('lays out cards in a padded grid', async () => {
    const { set } = await makeCards(5)
    await invoke('export:png-sheet', { setIds: [set.id], outputDir: outDir(), cardWidth: 100, cardHeight: 140, cardsPerRow: 3, paddingPx: 10, backgroundColor: '#ff00ff' })
    const meta = await sharp(join(outDir(), 'base_set_sheet.png')).metadata()
    expect(meta).toMatchObject({ width: 3 * 110 + 10, height: 2 * 150 + 10 })
    const { data, info } = await sharp(join(outDir(), 'base_set_sheet.png')).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 255]) // padding colour
    const i = (60 * info.width + 60) * info.channels
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([0x33, 0x66, 0x99]) // inside the first card
  })

  it('can write one numbered PNG per card', async () => {
    const { set } = await makeCards(3)
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: outDir(), cardWidth: 50, cardHeight: 70, individualFiles: true })
    expect(res.files).toHaveLength(3)
    expect(res.files[0]).toMatch(/_001_card_1\.png$/)
    expect(readdirSync(outDir())).toHaveLength(3)
  })

  it('exports across several sets in order', async () => {
    const a = await makeCards(2), b = await makeCards(2)
    const res = await invoke('export:png-sheet', { setIds: [a.set.id, b.set.id], outputDir: outDir(), cardWidth: 50, cardHeight: 70 })
    expect(res.cardCount).toBe(4)
  })
})

describe('PDF export (PRD §10.3)', () => {
  const pdf = async opts => {
    const { set } = await makeCards(opts.cards ?? 13)
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 150, ...opts })
    return PDFDocument.load(readFileSync(join(outDir(), 'base_set.pdf')))
  }

  it('fits cards per page from the page, card and margin sizes', async () => {
    const doc = await pdf({ marginMm: 5, gapMm: 3, fitMore: false })    // exactly as typed: letter 3 × 2 = 6 per page → 13 cards = 3 pages
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  })

  it('supports A4, landscape and custom card sizes', async () => {
    const a4 = await pdf({ pageSize: 'a4', cards: 1 })
    expect(a4.getPage(0).getSize()).toEqual({ width: 595, height: 842 })
    const land = await pdf({ pageSize: 'letter', landscape: true, cards: 1 })
    expect(land.getPage(0).getSize()).toEqual({ width: 792, height: 612 })
    const small = await pdf({ marginMm: 5, gapMm: 3, cardSize: 'mini_us', cards: 13 })  // many more fit on a page
    expect(small.getPageCount()).toBeLessThan(3)
    const custom = await pdf({ marginMm: 5, gapMm: 3, cardSize: 'custom', cardMmW: 30, cardMmH: 40, cards: 13 })
    expect(custom.getPageCount()).toBeLessThan(small.getPageCount() + 1)
  })

  it('defaults to the set card size', async () => {
    const big = await makeCards(8, { cardSize: 'jumbo' })
    const small = await makeCards(8, { name: 'Small Set', cardSize: 'mini_us' })
    await invoke('export:pdf', { setIds: [big.set.id], outputDir: outDir(), dpi: 100 })
    const jumbo = (await PDFDocument.load(readFileSync(join(outDir(), 'base_set.pdf')))).getPageCount()
    await invoke('export:pdf', { setIds: [small.set.id], outputDir: outDir(), dpi: 100 })
    const mini = (await PDFDocument.load(readFileSync(join(outDir(), 'small_set.pdf')))).getPageCount()
    expect(jumbo).toBeGreaterThan(mini)
  })

  it('interleaves a back page after every front page when card backs are on', async () => {
    const doc = await pdf({ cardBacks: true, marginMm: 5, fitMore: false, cards: 13 })
    expect(doc.getPageCount()).toBe(6)
  })

  it('never produces an empty document', async () => {
    const { set } = await seedSet({ cards: [{ name: 'a' }] })
    await expect(invoke('export:pdf', { setIds: [set.id], outputDir: outDir() })).rejects.toThrow(/No renderable cards/)
  })

  it('exports 100 cards at 300 DPI within the 60 s budget (PRD §14.1)', async () => {
    const { set } = await makeCards(100)
    const t = Date.now()
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 300 })
    expect(Date.now() - t).toBeLessThan(60000)
  }, 90000)

  // Rasterise page 1 with poppler so the test checks what a printer would actually receive
  const rasterise = (pdfPath, dpi = 72) => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfimg-'))
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', '1', pdfPath, join(dir, 'p')])
    return join(dir, readdirSync(dir)[0])
  }
  // Left edge of the centred card grid, mirroring the exporter's layout rule
  const leftOf = (cell, usable, gap) => {
    const cols = Math.floor((usable + gap) / (cell + gap))
    return (612 - (cols * cell + (cols - 1) * gap)) / 2
  }
  const rgbAt = async (png, x, y) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const i = (y * info.width + x) * info.channels
    return [data[i], data[i + 1], data[i + 2]]
  }

  it('paints the bleed area with the card edge colour (PRD §10.3)', async () => {
    const { set } = await makeCards(1)
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 150, marginMm: 10, bleedMm: 3, fitMore: false })
    const png = rasterise(join(outDir(), 'base_set.pdf'))
    const m = 10 * 72 / 25.4, b = 3 * 72 / 25.4
    const x0 = leftOf(180 + 2 * b, 612 - 2 * m, 3 * 72 / 25.4)   // the grid is centred on the page
    expect(await rgbAt(png, Math.round(x0 + b / 2), Math.round(m + b / 2))).toEqual([0x33, 0x66, 0x99]) // inside the bleed ring
    expect(await rgbAt(png, Math.round(m / 2), Math.round(m / 2))).toEqual([255, 255, 255])              // page margin stays white
  })

  it('uses a chosen bleed colour and leaves the page white when there is no bleed', async () => {
    const { set } = await makeCards(1)
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 150, marginMm: 10, bleedMm: 3, bleedColor: '#ff0000', fitMore: false })
    const m = 10 * 72 / 25.4, b = 3 * 72 / 25.4
    expect(await rgbAt(rasterise(join(outDir(), 'base_set.pdf')), Math.round(leftOf(180 + 2 * b, 612 - 2 * m, b) + b / 2), Math.round(m + b / 2))).toEqual([255, 0, 0])
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 150, marginMm: 10, bleedMm: 0, fitMore: false })
    expect(await rgbAt(rasterise(join(outDir(), 'base_set.pdf')), Math.round(leftOf(180, 612 - 2 * m, b) + 2), Math.round(m + 2))).toEqual([0x33, 0x66, 0x99])
  })

  it('draws crop marks outside the bleed only when asked', async () => {
    const { set } = await makeCards(1)
    const nonWhiteOutside = async cropMarks => {
      await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 150, marginMm: 15, cropMarks, bleedMm: 0, fitMore: false })
      const { data, info } = await sharp(rasterise(join(outDir(), 'base_set.pdf'), 150)).raw().toBuffer({ resolveWithObject: true })
      const m = Math.round(15 * 150 / 25.4); let dark = 0
      for (let y = 0; y < m - 4; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * info.channels] < 128) dark++
      return dark
    }
    expect(await nonWhiteOutside(false)).toBe(0)
    expect(await nonWhiteOutside(true)).toBeGreaterThan(0)
  })

  it('puts each back exactly behind its front on a partly filled duplex page', async () => {
    const { set } = await makeCards(2)
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 100, marginMm: 5, gapMm: 3, cardBacks: true, cardBackColor: '#ff0000', fitMore: false })
    const doc = await PDFDocument.load(readFileSync(join(outDir(), 'base_set.pdf')))
    expect(doc.getPageCount()).toBe(2)
    const dir = mkdtempSync(join(tmpdir(), 'pdfimg-'))
    execFileSync('pdftoppm', ['-png', '-r', '72', join(outDir(), 'base_set.pdf'), join(dir, 'p')])
    const [front, back] = readdirSync(dir).sort().map(f => join(dir, f))
    const colOf = async png => {
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
      const y = Math.round(100), cols = []
      for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * info.channels; cols.push(data[i] > 200 && data[i + 1] > 200 ? 'w' : 'c') }
      return cols.join('')
    }
    const f = await colOf(front), bk = await colOf(back)
    // columns that hold a card on the front must hold a back on the mirrored position
    const firstF = f.indexOf('c'), lastF = f.lastIndexOf('c'), firstB = bk.indexOf('c'), lastB = bk.lastIndexOf('c')
    expect(Math.abs(firstF - (f.length - 1 - lastB))).toBeLessThan(3)   // back spans mirror the front spans
    expect(Math.abs(lastF - (f.length - 1 - firstB))).toBeLessThan(3)
  })
})

describe('export selection and file names (PRD §10.1)', () => {
  it('exports only the selected cards', async () => {
    const { set, cards } = await makeCards(5)
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: outDir(), cardWidth: 50, cardHeight: 70, cardIds: [cards[1].id, cards[3].id], individualFiles: true })
    expect(res.cardCount).toBe(2)
    expect(res.files[0]).toMatch(/card_2/); expect(res.files[1]).toMatch(/card_4/)
  })

  it('exports cards matching a filter expression', async () => {
    const { set } = await seedSet({
      fields: [{ name: 'Name', type: 'text' }, { name: 'Faction', type: 'text' }, { name: 'Cost', type: 'number' }],
      cards: [{ name: 'a', fields: { faction: 'Red', cost: '1' } }, { name: 'b', fields: { faction: 'Blue', cost: '5' } }, { name: 'c', fields: { faction: 'Red', cost: '6' } }],
      template: { svg: template }
    })
    const by = filter => invoke('export:png-sheet', { setIds: [set.id], outputDir: outDir(), cardWidth: 50, cardHeight: 70, filter })
    expect((await by("faction == 'Red'")).cardCount).toBe(2)
    expect((await by("faction == 'Red' ")).cardCount).toBe(2)
    expect((await by('cost > 4')).cardCount).toBe(2)
    expect((await by('')).cardCount).toBe(3)
    await expect(by('concat(')).rejects.toThrow(/No renderable cards/)  // a malformed filter matches nothing, with a clear message
  })

  it('builds file names from a pattern', async () => {
    const { set } = await makeCards(1)
    await invoke('export:png-sheet', { setIds: [set.id], outputDir: outDir(), cardWidth: 50, cardHeight: 70, fileNameTemplate: '{{project_name}}__{{set_name}}/{{date}}' })
    const [file] = readdirSync(outDir())
    expect(file).toMatch(/^test_game__base_set_\d{4}-\d{2}-\d{2}_sheet\.png$/)
  })

  it('never produces an unsafe or empty file name', async () => {
    const { outputBaseName } = await import('../../src/main/core/export.js')
    const Database = (await import('better-sqlite3')).default
    const d = new Database(':memory:'); d.exec("CREATE TABLE sets(id TEXT, name TEXT); CREATE TABLE project_meta(key TEXT, value TEXT); INSERT INTO sets VALUES ('a','My/Set')")
    expect(outputBaseName(d, ['a'], '../../etc/{{set_name}}')).not.toMatch(/[\/\\]/)
    expect(outputBaseName(d, ['a'], '///')).toBe('export')
    expect(outputBaseName(d, ['a'], '')).toBe('my_set')
  })
})

describe('PDF layout options (PRD §10.3)', () => {
  const load = async () => PDFDocument.load(readFileSync(join(outDir(), 'base_set.pdf')))
  const run = async (n, opts) => { const { set } = await makeCards(n); await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 100, ...opts }); return load() }

  it('supports a custom page size in millimetres', async () => {
    const doc = await run(1, { pageSize: 'custom', pageMmW: 100, pageMmH: 150 })
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(100 * 72 / 25.4, 1); expect(height).toBeCloseTo(150 * 72 / 25.4, 1)
  })

  it('honours a manual grid: columns × rows per page', async () => {
    const doc = await run(10, { marginMm: 5, cardsPerRow: 2, cardsPerColumn: 2 })   // 4 per page
    expect(doc.getPageCount()).toBe(3)
  })

  it('never lets a manual grid overflow the page at true size', async () => {
    const doc = await run(12, { marginMm: 5, cardsPerRow: 9, cardsPerColumn: 9 })   // far more than fits: clamped to what fits
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('"fit to page" scales the cards so the chosen grid fills the page', async () => {
    const { set } = await makeCards(4)
    await invoke('export:pdf', { setIds: [set.id], outputDir: outDir(), dpi: 100, marginMm: 5, gapMm: 0, cardsPerRow: 2, cardsPerColumn: 2, scale: 'fit' })
    const png = (() => { const dir = mkdtempSync(join(tmpdir(), 'pdfimg-')); execFileSync('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', join(outDir(), 'base_set.pdf'), join(dir, 'p')]); return join(dir, readdirSync(dir)[0]) })()
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    // the 2×2 block now reaches the margins on at least one axis
    const m = Math.round(5 * 72 / 25.4)
    let minX = info.width, maxX = 0, minY = info.height, maxY = 0
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * info.channels; if (data[i] < 200) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) } }
    const fillsWidth = minX <= m + 3 && maxX >= info.width - m - 3
    const fillsHeight = minY <= m + 3 && maxY >= info.height - m - 3
    expect(fillsWidth || fillsHeight).toBe(true)     // the limiting axis reaches the margins
    expect(maxX - minX).toBeGreaterThan(info.width * 0.6)   // and it is much larger than a single true-size card
  })

  it('card back "None" gives a transparent back for TTS and omits PDF backs', async () => {
    const { set } = await makeCards(2)
    await invoke('export:tts', { setIds: [set.id], outputDir: outDir(), cardWidth: 50, cardHeight: 70, cardBack: 'none' })
    const { data, info } = await sharp(join(outDir(), 'base_set_back.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)           // alpha of the first pixel
    const doc = await run(2, { cardBacks: true, cardBack: 'none', marginMm: 5 })
    expect(doc.getPageCount()).toBe(1)
    expect(info.width).toBe(50)
  })
})
