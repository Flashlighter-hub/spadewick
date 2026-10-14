/**
 * The production PDF (PRD §17): the file read back with a small purpose-built reader (pdf-lib to parse, zlib to inflate the images),
 * the bleed of each template mode, the colour conversion, print colours, ink limit, the layouts of fronts and backs, profiles,
 * saved settings, the schema upgrade, and the proof.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { inflateSync } from 'zlib'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { PDFDocument, PDFName, PDFArray, PDFRawStream, PDFDict } from 'pdf-lib'
import { createTestProject, seedSet, invoke, writeText } from '../helpers/project.js'
import { CURRENT_SCHEMA_VERSION, openProjectDb } from '../../src/main/db.js'
import { createConverter } from '../../src/main/colour/lcms.js'

const MM = 72 / 25.4
const PROFILE = readFileSync(join(process.cwd(), 'resources/profiles/CGATS21_CRPC1.icc'))
let proj, out
beforeEach(async () => { proj = await createTestProject('Prod'); out = mkdtempSync(join(tmpdir(), 'prod-out-')) })
afterEach(async () => { await proj.cleanup() })

const card = (w, h, body, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${attrs}>${body}</svg>`
const SOLID = fill => card(250, 350, `<rect width="250" height="350" fill="${fill}"/>`)

async function seed(svgs, extra = {}) {
  const s = await seedSet({ name: 'Deck', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], template: { svg: svgs[0] }, cards: svgs.map((_, i) => ({ name: `Card ${i + 1}`, fields: { name: `C${i}` } })) })
  const set = s.set
  const templates = [s.template]
  for (let i = 1; i < svgs.length; i++) {
    const t = await invoke('templates:create', { name: `T${i}`, svgSource: svgs[i], cardSize: 'poker' })
    await invoke('cards:update', { id: s.cards[i].id, templateId: t.id })
    templates.push(t)
  }
  await invoke('sets:update', { id: set.id, defaultTemplateId: s.template.id })
  return { ...s, templates, ...extra }
}
const run = (s, opts = {}) => invoke('production:run', { setIds: [s.set.id], outputDir: out, dpi: 100, ...opts })

// ---- a small reader for what was written ----
async function read(file) {
  const doc = await PDFDocument.load(readFileSync(join(out, file)))
  const ctx = doc.context
  const pages = doc.getPages().map(p => {
    const arr = key => p.node.lookup(PDFName.of(key), PDFArray)?.asArray().map(n => n.asNumber())
    const res = p.node.lookup(PDFName.of('Resources'), PDFDict)
    const xo = res.lookup(PDFName.of('XObject'), PDFDict)
    const img = xo.lookup(PDFName.of('Img'))
    const dict = img.dict
    const num = k => dict.lookup(PDFName.of(k)).asNumber()
    const cs = dict.lookup(PDFName.of('ColorSpace'))
    const content = inflateSync(Buffer.from(ctx.lookup(p.node.get(PDFName.of('Contents')), PDFRawStream).contents)).toString('latin1')
    return {
      media: arr('MediaBox'), trim: arr('TrimBox'), bleed: arr('BleedBox'), art: arr('ArtBox'), content, resources: res,
      width: num('Width'), height: num('Height'), colourSpace: cs instanceof PDFName ? cs.decodeText() : 'ICCBased',
      pixels: inflateSync(Buffer.from(img.contents))
    }
  })
  return { doc, pages, ctx }
}
const px = (page, x, y, channels = 4) => { x = Math.floor(x); y = Math.floor(y); return [...page.pixels.subarray((y * page.width + x) * channels, (y * page.width + x) * channels + channels)] }
const close = (a, b, tol = 0.01) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('the page and its boxes', () => {
  it('writes one page per card: trim plus bleed, TrimBox, BleedBox and ArtBox, a CMYK image and the profile as output intent', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc'), SOLID('#33aa33')])
    const r = await run(s, { bleedMm: 3, safeMm: 4, cardBack: 'none' })
    expect(r.files).toEqual(['deck.pdf'])
    expect(r).toMatchObject({ cardCount: 3, pageCount: 3 })
    const { doc, pages } = await read(r.files[0])
    expect(pages).toHaveLength(3)
    const p = pages[0]
    expect(p.media[2] / MM).toBeCloseTo(63.5 + 6, 2); expect(p.media[3] / MM).toBeCloseTo(88.9 + 6, 2)   // no marks: the page is the bleed box
    expect(p.trim.map(v => v / MM)).toEqual([3, 3, 66.5, 91.9].map(v => expect.closeTo(v, 2)))
    expect(p.bleed.map(v => v / MM)).toEqual([0, 0, 69.5, 94.9].map(v => expect.closeTo(v, 2)))
    expect(p.art.map(v => v / MM)).toEqual([7, 7, 62.5, 87.9].map(v => expect.closeTo(v, 2)))
    expect([p.width, p.height]).toEqual([Math.round(69.5 / 25.4 * 100), Math.round(94.9 / 25.4 * 100)])
    expect(p.colourSpace).toBe('ICCBased')
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray)
    expect(intents.size()).toBe(1)
    const intent = intents.lookup(0, PDFDict)
    const prof = intent.lookup(PDFName.of('DestOutputProfile'))
    expect(Buffer.from(inflateSync(Buffer.from(prof.contents))).equals(PROFILE)).toBe(true)          // the profile, byte for byte
    expect(intent.lookup(PDFName.of('S')).decodeText()).toBe('GTS_PDFX')
    // no RGB anywhere on the page
    expect(p.content).not.toMatch(/\b(rg|RG)\b/); expect(p.content).not.toMatch(/DeviceRGB/)
  })

  it('does not claim a standard it was not checked against, and writes dates in the form of the specification', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { cardBack: 'none', standard: 'x4' })
    const { doc } = await read(r.files[0])
    expect(doc.getSubject()).toBe('PDF/X-4-style, unvalidated')
    expect(doc.getInfoDict().lookup(PDFName.of('GTS_PDFXVersion'))).toBeUndefined()
    expect(doc.getInfoDict().lookup(PDFName.of('CreationDate')).decodeText()).toMatch(/^D:\d{14}\+00'00'$/)
    const x1 = await run(s, { cardBack: 'none', standard: 'x1a', fileNameTemplate: 'x1' })
    expect((await read(x1.files[0])).doc.getSubject()).toBe('PDF/X-1a-style, unvalidated')
    const plain = await run(s, { cardBack: 'none', standard: 'plain', fileNameTemplate: 'plain' })
    expect((await read(plain.files[0])).doc.getSubject()).toBe('CMYK PDF, no standard claimed')
  })
})

describe('colour', () => {
  it('converts through the chosen profile, intent and black point compensation', async () => {
    const s = await seed([SOLID('#cc3333')])
    const want = async (intent, blackPoint) => {
      const conv = await createConverter(PROFILE, { intent, blackPoint })
      try { return [...conv.toCmyk(Uint8Array.from([0xcc, 0x33, 0x33]), 1)] } finally { conv.close() }
    }
    for (const [intent, bpc] of [['relative', true], ['perceptual', false], ['relative', false]]) {
      const r = await run(s, { cardBack: 'none', intent, blackPoint: bpc, fileNameTemplate: `${intent}${bpc}`, inkLimit: null })
      const { pages } = await read(r.files[0])
      expect(px(pages[0], 30, 30)).toEqual(await want(intent, bpc))
    }
  })

  it('keeps RGB when asked (PDF/X-4 or plain only) and writes no CMYK', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { cardBack: 'none', colour: 'rgb' })
    const { pages } = await read(r.files[0])
    expect(pages[0].colourSpace).toBe('DeviceRGB')
    expect(px(pages[0], 30, 30, 3)).toEqual([0xcc, 0x33, 0x33])
    await expect(run(s, { cardBack: 'none', colour: 'rgb', standard: 'x1a' })).rejects.toThrow(/only possible with PDF\/X-4/)
  })

  it('sets print colours exactly, reports spot colours that raster output prints as ink, and keeps the ink limit', async () => {
    const s = await seed([card(250, 350, '<rect width="250" height="350" fill="#ff0000"/><rect y="175" width="250" height="175" fill="#000000"/><rect x="100" y="100" width="50" height="50" fill="#0000ff"/>')])
    await invoke('printcolors:create', { name: 'Brand red', rgb: '#ff0000', cmyk: [0, 100, 100, 0] })
    await invoke('printcolors:create', { name: 'Gold', rgb: '#0000ff', spotName: 'Spot Gold' })           // a spot with no ink values: only reported
    const r = await run(s, { cardBack: 'none', inkLimit: 200 })
    const { pages } = await read(r.files[0])
    expect(px(pages[0], 10, 10)).toEqual([0, 255, 255, 0])                                              // exactly C0 M100 Y100 K0
    const black = px(pages[0], 10, pages[0].height - 10)
    expect(black.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(Math.round(2 * 255))                    // black kept within 200 % total ink
    expect(r.report.spotPixels['Spot Gold']).toBeGreaterThan(0)
    expect(r.report.printColorPixels).toBeGreaterThan(1000)
    expect(r.report.inkLimitedPixels).toBeGreaterThan(0)
    expect(r.report.maxInkPct).toBeGreaterThan(200)                                                     // the maximum before the limit is reported
    const off = await run(s, { cardBack: 'none', usePrintColors: false, fileNameTemplate: 'off' })
    expect(px((await read(off.files[0])).pages[0], 10, 10)).not.toEqual([0, 255, 255, 0])
  })
})

describe('bleed', () => {
  const BORDER = (w, h, inner, bleedAttr = '') => card(w, h, `<rect width="${w}" height="${h}" fill="#ffffff"/><rect x="${inner}" y="${inner}" width="${w - 2 * inner}" height="${h - 2 * inner}" fill="#cc3333"/>`)
  const dim = async (s, opts) => { const r = await run(s, { cardBack: 'none', inkLimit: null, ...opts }); return (await read(r.files[0])).pages[0] }

  it('extend (the default): the edge is mirrored into the bleed, so the picture runs to the page edge', async () => {
    const s = await seed([card(250, 350, '<rect width="250" height="350" fill="#ffffff"/><rect x="0" y="0" width="250" height="20" fill="#cc3333"/>')])
    const p = await dim(s, { bleedMm: 3, dpi: 200 })
    const white = px(p, p.width / 2, p.height / 2)
    expect(px(p, p.width / 2, 2)).not.toEqual(white)                                                    // the red strip continues up into the bleed
    expect(px(p, p.width / 2, 2)).toEqual(px(p, p.width / 2, 40))
  })

  it('fill: the bleed is painted with the template colour', async () => {
    const s = await seed([SOLID('#ffffff')])
    await invoke('templates:update', { id: s.template.id, bleedMode: 'fill', bleedColor: '#00ff00' })
    const p = await dim(s, { bleedMm: 3, dpi: 200 })
    const conv = await createConverter(PROFILE, {})
    const green = [...conv.toCmyk(Uint8Array.from([0, 255, 0]), 1)]; conv.close()
    expect(px(p, 2, 2)).toEqual(green)
    expect(px(p, p.width / 2, p.height / 2)).not.toEqual(green)
  })

  it('included: the template canvas is trim plus bleed; it is cut to a smaller bleed and carried further for a larger one', async () => {
    // 1 mm of bleed at 250 units / 63.5 mm = 3.937 units per mm; the canvas is (63.5 + 2) x (88.9 + 2) mm
    const u = 250 / 63.5
    const wU = 250 + 2 * u, hU = 350 + 2 * u
    const svg = card(wU, hU, `<rect width="${wU}" height="${hU}" fill="#0000ff"/><rect x="${u}" y="${u}" width="250" height="350" fill="#ffffff"/>`)
    const s = await seed([svg])
    await invoke('templates:update', { id: s.template.id, bleedMm: 1, bleedMode: 'included' })
    const toCmyk = async rgb => { const c = await createConverter(PROFILE, {}); const v = [...c.toCmyk(Uint8Array.from(rgb), 1)]; c.close(); return v }
    const blue = await toCmyk([0, 0, 255]), white = await toCmyk([255, 255, 255])
    const same = await dim(s, { bleedMm: 1, dpi: 254 })                                                  // 10 pixels per mm: bleed 10 px
    expect(px(same, 3, 3)).toEqual(blue); expect(px(same, 12, 12)).toEqual(white)
    const less = await dim(s, { bleedMm: 0, dpi: 254, fileNameTemplate: 'less' })
    expect([less.width, less.height]).toEqual([635, 889])
    expect(px(less, 0, 0)).toEqual(white)                                                                // the blue bleed was cut away
    const more = await dim(s, { bleedMm: 3, dpi: 254, fileNameTemplate: 'more' })
    expect(px(more, 3, 3)).toEqual(blue)                                                                 // the extra bleed continues the template's own
    expect(px(more, 27, 27)).toEqual(blue); expect(px(more, 40, 40)).toEqual(white)
  })

  it('addBleedToCanvas widens the canvas and keeps the content in place; undo restores it', async () => {
    const s = await seed([SOLID('#cc3333')])
    const before = (await invoke('templates:get', s.template.id)).svg_source
    const t = await invoke('templates:add-bleed', { id: s.template.id, bleedMm: 3 })
    expect(t).toMatchObject({ bleed_mm: 3, bleed_mode: 'included' })
    expect(t.svg_source).toMatch(/viewBox="0 0 273\.622 373\.622"/)
    expect(t.svg_source).toContain('translate(11.811 11.811)')
    await expect(invoke('templates:add-bleed', { id: s.template.id, bleedMm: 3 })).rejects.toThrow(/already includes bleed/)
    await invoke('history:undo')
    expect((await invoke('templates:get', s.template.id)).svg_source).toBe(before)
    expect((await invoke('templates:get', s.template.id)).bleed_mode).toBe('extend')
    await expect(invoke('templates:update', { id: s.template.id, bleedMode: 'nonsense' })).rejects.toThrow(/bleed/i)
  })
})

describe('marks, die line and layers', () => {
  it('draws crop and registration marks in the registration colour on a larger page, in their own layer', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { cardBack: 'none', cropMarks: true, registrationMarks: true, marksMarginMm: 10, bleedMm: 3 })
    const { pages, doc } = await read(r.files[0])
    const p = pages[0]
    expect(p.media[2] / MM).toBeCloseTo(63.5 + 2 * 13, 2)
    expect(p.trim[0] / MM).toBeCloseTo(13, 2)
    expect(p.content).toContain('/OC /LMarks BDC')
    expect(p.content).toMatch(/\/CsAll CS 1 SCN/)
    expect((p.content.match(/ S\n/g) ?? []).length).toBeGreaterThan(14)                                // 8 crop strokes, 4 targets of circle + cross
    const layers = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray)
    expect(layers.asArray().map((_, i) => layers.lookup(i, PDFDict).lookup(PDFName.of('Name')).decodeText())).toEqual(['Artwork', 'Print marks'])
  })

  it('writes the die line as a named spot colour on its own layer, overprinting, with the chosen corner radius', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { cardBack: 'none', dieLine: 'spot', dieSpotName: 'Cut line', dieRadiusMm: 3.175 })
    const { pages, doc } = await read(r.files[0])
    const p = pages[0]
    expect(p.content).toMatch(/\/GsOver gs \/CsDie CS 1 SCN/)
    expect(p.content).toMatch(/ c\n/)                                                                   // rounded corners are curves
    const cs = p.resources.lookup(PDFName.of('ColorSpace'), PDFDict).lookup(PDFName.of('CsDie'), PDFArray)
    expect(cs.lookup(0, PDFName).decodeText()).toBe('Separation'); expect(cs.lookup(1, PDFName).decodeText()).toBe('Cut line')
    const names = (() => { const l = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray); return l.asArray().map((_, i) => l.lookup(i, PDFDict).lookup(PDFName.of('Name')).decodeText()) })()
    expect(names).toEqual(['Artwork', 'Die line'])
  })

  it('a die line as a layer only is not printed and has no spot colour', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { cardBack: 'none', dieLine: 'layer' })
    const { pages, doc } = await read(r.files[0])
    expect(pages[0].resources.lookup(PDFName.of('ColorSpace'), PDFDict).has(PDFName.of('CsDie'))).toBe(false)
    const l = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray)
    const die = l.lookup(1, PDFDict)
    expect(die.lookup(PDFName.of('Usage'), PDFDict).lookup(PDFName.of('Print'), PDFDict).lookup(PDFName.of('PrintState')).decodeText()).toBe('OFF')
  })

  it('has no layers and no marks when none are asked for', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { cardBack: 'none' })
    const { doc, pages } = await read(r.files[0])
    expect(doc.catalog.has(PDFName.of('OCProperties'))).toBe(false)
    expect(pages[0].content).not.toContain('BDC')
  })
})

describe('fronts and backs', () => {
  const tint = async (s, opts) => {
    const r = await run(s, { cardBack: 'color', cardBackColor: '#00ff00', inkLimit: null, ...opts })
    const files = {}
    for (const f of r.files) files[f] = (await read(f)).pages.map(p => px(p, 5, 5).join(','))
    return { r, files }
  }
  const conv = async rgb => { const c = await createConverter(PROFILE, {}); const v = c.toCmyk(Uint8Array.from(rgb), 1).join(','); c.close(); return v }

  it('separate: fronts and backs in two files, one back per card', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc')])
    const { r, files } = await tint(s, { backLayout: 'separate' })
    expect(r.files).toEqual(['deck_fronts.pdf', 'deck_backs.pdf'])
    expect(files['deck_fronts.pdf']).toEqual([await conv([0xcc, 0x33, 0x33]), await conv([0x33, 0x66, 0xcc])])
    expect(files['deck_backs.pdf']).toEqual([await conv([0, 255, 0]), await conv([0, 255, 0])])
  })

  it('after: one file, every front and then every back', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc')])
    const { files } = await tint(s, { backLayout: 'after' })
    const back = await conv([0, 255, 0])
    expect(files['deck.pdf']).toEqual([await conv([0xcc, 0x33, 0x33]), await conv([0x33, 0x66, 0xcc]), back, back])
  })

  it('interleaved: each back right after its front', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc')])
    const { files } = await tint(s, { backLayout: 'interleaved' })
    const back = await conv([0, 255, 0])
    expect(files['deck.pdf']).toEqual([await conv([0xcc, 0x33, 0x33]), back, await conv([0x33, 0x66, 0xcc]), back])
  })

  it('once: the fronts and a single shared back at the end; the back is stored once', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc'), SOLID('#33aa33')])
    const { files, r } = await tint(s, { backLayout: 'once' })
    expect(files['deck.pdf']).toHaveLength(4)
    expect(files['deck.pdf'][3]).toBe(await conv([0, 255, 0]))
    expect(r.pageCount).toBe(4)
  })

  it('a card back from a picture is covered to the trim and its edge carried into the bleed; none writes no backs', async () => {
    const s = await seed([SOLID('#cc3333')])
    const pic = join(out, 'back.png')
    await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ff00ff' } }).png().toFile(pic)
    const [asset] = await invoke('assets:import', [pic])
    const assetId = asset.id
    const r = await run(s, { cardBack: 'asset', cardBackAssetId: assetId, backLayout: 'once', inkLimit: null })
    const { pages } = await read(r.files[0])
    expect(pages).toHaveLength(2)
    const c = await createConverter(PROFILE, {}); const magenta = [...c.toCmyk(Uint8Array.from([255, 0, 255]), 1)]; c.close()
    expect(px(pages[1], 1, 1)).toEqual(magenta); expect(px(pages[1], pages[1].width / 2, pages[1].height / 2)).toEqual(magenta)
    const none = await run(s, { cardBack: 'none', fileNameTemplate: 'none' })
    expect((await read(none.files[0])).pages).toHaveLength(1)
  })

  it('quantity: one page per distinct card by default, every copy with repeat copies', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc')])
    await invoke('cards:update', { id: s.cards[0].id, quantity: 3 })
    expect((await run(s, { cardBack: 'none' })).pageCount).toBe(2)
    expect((await run(s, { cardBack: 'none', repeatCopies: true, fileNameTemplate: 'rep' })).pageCount).toBe(4)
  })

  it('selects cards by id or by filter as every export does, and refuses an empty selection', async () => {
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc')])
    expect((await run(s, { cardBack: 'none', cardIds: [s.cards[1].id] })).pageCount).toBe(1)
    expect((await run(s, { cardBack: 'none', filter: "name == 'C0'", fileNameTemplate: 'f' })).cardCount).toBe(1)
    await expect(run(s, { cardBack: 'none', filter: "name == 'nobody'" })).rejects.toThrow(/No renderable cards/i)
    await expect(invoke('production:run', { setIds: [], outputDir: out })).rejects.toThrow()
  })
})

describe('picture compression (PRD §17.3)', () => {
  // A busy picture (pseudo-random coloured blocks, so a lossless compressor has little to find): JPEG is meant for pictures like this
  const GRADIENT = (() => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const blocks = Array.from({ length: 900 }, () => `<rect x="${Math.floor(rnd() * 240)}" y="${Math.floor(rnd() * 340)}" width="${4 + Math.floor(rnd() * 20)}" height="${4 + Math.floor(rnd() * 20)}" fill="rgb(${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)})" opacity="0.8"/>`).join('')
    return card(250, 350, `<rect width="250" height="350" fill="#778899"/>${blocks}`)
  })()
  const imageOf = async file => {
    const doc = await PDFDocument.load(readFileSync(join(out, file)))
    const page = doc.getPages()[0]
    const res = page.node.lookup(PDFName.of('Resources'), PDFDict)
    return res.lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('Img'))
  }

  it('lossless is the default; JPEG writes a DCT stream that is smaller, with the decode array of Adobe CMYK', async () => {
    const s = await seed([GRADIENT])
    const lossless = await run(s, { bleedMm: 3, cardBack: 'none', dpi: 150, outputDir: join(out, 'a') })
    const jpeg = await run(s, { bleedMm: 3, cardBack: 'none', dpi: 150, imageCompression: 'jpeg', jpegQuality: 80, outputDir: join(out, 'b') })
    const stream = async (dir, file) => (await PDFDocument.load(readFileSync(join(out, dir, file)))).getPages()[0].node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('Img'))
    const flate = await stream('a', lossless.files[0]), dct = await stream('b', jpeg.files[0])
    expect(flate.dict.lookup(PDFName.of('Filter')).decodeText()).toBe('FlateDecode')
    expect(dct.dict.lookup(PDFName.of('Filter')).decodeText()).toBe('DCTDecode')
    expect(dct.dict.lookup(PDFName.of('Decode')).asArray().map(n => n.asNumber())).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
    // the quality setting does what it says
    const low = await run(s, { bleedMm: 3, cardBack: 'none', dpi: 150, imageCompression: 'jpeg', jpegQuality: 50, outputDir: join(out, 'c') })
    expect((await stream('c', low.files[0])).contents.length).toBeLessThan(dct.contents.length)
    const meta = await sharp(Buffer.from(dct.contents)).metadata()
    expect([meta.format, meta.channels, meta.space]).toEqual(['jpeg', 4, 'cmyk'])
    expect([meta.width, meta.height]).toEqual([Number(dct.dict.lookup(PDFName.of('Width')).asNumber()), Number(dct.dict.lookup(PDFName.of('Height')).asNumber())])
  })

  it('RGB with JPEG says that the components are not YCbCr, and decodes to the colours of the card', async () => {
    const s = await seed([SOLID('#cc3333')])
    const r = await run(s, { colour: 'rgb', standard: 'plain', bleedMm: 0, cardBack: 'none', dpi: 100, imageCompression: 'jpeg', jpegQuality: 95 })
    const doc = await PDFDocument.load(readFileSync(join(out, r.files[0])))
    const img = doc.getPages()[0].node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('Img'))
    expect(img.dict.lookup(PDFName.of('DecodeParms'), PDFDict).lookup(PDFName.of('ColorTransform')).asNumber()).toBe(0)
    const { data, info } = await sharp(Buffer.from(img.contents)).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(3)
    expect(close([...data.subarray(0, 3)], [0xcc, 0x33, 0x33], 6)).toBe(true)
  })

  it('checks the settings', async () => {
    const s = await seed([SOLID('#cc3333')])
    await expect(run(s, { imageCompression: 'gif' })).rejects.toThrow(/image compression/)
    await expect(run(s, { imageCompression: 'jpeg', jpegQuality: 10 })).rejects.toThrow(/JPEG quality/)
  })
})

describe('settings are checked', () => {
  it('names the setting that is wrong', async () => {
    const s = await seed([SOLID('#cc3333')])
    for (const [bad, what] of [[{ dpi: 5 }, 'dpi'], [{ bleedMm: -1 }, 'bleed'], [{ intent: 'x' }, 'intent'], [{ backLayout: 'x' }, 'fronts and backs'], [{ dieLine: 'x' }, 'die line'], [{ inkLimit: 20 }, 'ink limit'], [{ dieSpotName: 'a(b' }, 'die line name']]) {
      await expect(run(s, bad)).rejects.toThrow(new RegExp(what))
    }
  })
})

describe('the proof', () => {
  it('shows how the card will print, what is out of range and what the export does to it', async () => {
    const s = await seed([card(250, 350, '<rect width="250" height="350" fill="#00ffff"/><rect width="250" height="60" fill="#000000"/>')])
    const r = await invoke('production:proof', { setIds: [s.set.id], dpi: 100, inkLimit: 200 })
    const meta = await sharp(Buffer.from(r.proof, 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([r.width, r.height])
    expect(r.stats.outOfRangePct).toBeGreaterThan(50)                                                    // screen cyan is outside any press
    expect(r.stats.inkLimitedPixels).toBeGreaterThan(0)
    expect(r.box.trim[0]).toBeGreaterThan(0)
    const overlay = await sharp(Buffer.from(r.gamut, 'base64')).raw().toBuffer({ resolveWithObject: true })
    expect(overlay.info.channels).toBe(4)
    expect(overlay.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true)
    const one = await invoke('production:proof', { cardId: s.cards[0].id, dpi: 100 })
    expect(one.stats.card).toBe('Card 1')
  })
})

describe('progress and cancel', () => {
  it('reports no running export when idle, and cancel does nothing then', async () => {
    expect(await invoke('production:status')).toMatchObject({ running: false })
    expect(await invoke('production:cancel')).toBe(false)
  })

  it('cancel stops a running export and leaves no file', async () => {
    const s = await seed(Array.from({ length: 40 }, () => SOLID('#cc3333')))
    const done = run(s, { cardBack: 'none', dpi: 200 }).then(() => 'finished', e => e.message)
    for (let i = 0; i < 200; i++) { if ((await invoke('production:status')).running) break; await new Promise(r => setTimeout(r, 5)) }
    expect(await invoke('production:cancel')).toBe(true)
    const result = await done
    expect(result).toMatch(/ancel/)
    expect(readdirSync(out)).toEqual([])
    expect((await invoke('production:status')).running).toBe(false)
  })
})

describe('output profiles', () => {
  const fake = (space, cls) => {
    const b = Buffer.alloc(200); b.writeUInt32BE(200, 0); b.write(cls, 12, 'latin1'); b.write(space, 16, 'latin1'); b.write('acsp', 36, 'latin1'); return b
  }

  it('lists the bundled profile, imports a CMYK output profile by its own name, uses it, and undoes the import', async () => {
    const list = await invoke('profiles:list')
    expect(list.bundled.map(p => p.id)).toEqual(['bundled:crpc1']); expect(list.imported).toEqual([])
    const src = join(out, 'mine.icc'); writeFileSync(src, PROFILE)
    const r = await invoke('profiles:import', { paths: [src], licenceNote: 'free' })
    expect(r.skipped).toEqual([])
    expect(r.imported[0].name).toMatch(/CGATS21_CRPC1/)
    expect((await invoke('profiles:list')).imported[0]).toMatchObject({ licenceNote: 'free', bundled: false })
    expect((await invoke('assets:list', {})).some(a => a.mime_type === 'application/vnd.iccprofile')).toBe(false)   // not a picture: never in the library
    await invoke('history:undo')
    expect((await invoke('profiles:list')).imported).toEqual([])
    await invoke('history:redo')
    expect((await invoke('profiles:list')).imported).toHaveLength(1)
    const s = await seed([SOLID('#cc3333')])
    const used = await run(s, { cardBack: 'none', profileId: r.imported[0].id })
    expect((await read(used.files[0])).doc.getKeywords()).toContain('CGATS21_CRPC1')
    const renamed = await invoke('profiles:update', { id: r.imported[0].id, name: 'Press A' })
    expect(renamed.name).toBe('Press A')
    await invoke('profiles:remove', r.imported[0].id)
    expect((await invoke('profiles:list')).imported).toEqual([])
    await expect(run(s, { cardBack: 'none', profileId: r.imported[0].id })).rejects.toThrow(/cannot be found/)
  })

  it('refuses files that are not CMYK output profiles', async () => {
    const files = { 'text.icc': Buffer.from('hello'), 'rgb.icc': fake('RGB ', 'mntr'), 'cmykdisplay.icc': fake('CMYK', 'mntr'), 'empty.icc': Buffer.alloc(0) }
    const paths = Object.entries(files).map(([n, b]) => { const p = join(out, n); writeFileSync(p, b); return p })
    const r = await invoke('profiles:import', { paths: [...paths, join(out, 'missing.icc')] })
    expect(r.imported).toEqual([])
    expect(r.skipped.map(x => x.reason).sort()).toEqual(['notCmykOutput', 'notCmykOutput', 'notProfile', 'notProfile', 'unreadable'])
  })

  it('names a second copy of the same profile with a number', async () => {
    const src = join(out, 'a.icc'); writeFileSync(src, PROFILE)
    const a = await invoke('profiles:import', { paths: [src] }), b = await invoke('profiles:import', { paths: [src] })
    expect(b.imported[0].name).toBe(`${a.imported[0].name} (2)`)
  })
})

describe('print colours and saved settings', () => {
  it('checks print colours, keeps them in order, and undoes', async () => {
    const a = await invoke('printcolors:create', { name: 'Red', rgb: '#F00', cmyk: [0, 100, 100, 0], spotName: 'Spot red' })
    expect(a).toMatchObject({ rgb: '#ff0000', cmyk: [0, 100, 100, 0], spotName: 'Spot red' })
    await expect(invoke('printcolors:create', { name: 'Red', rgb: '#00f' })).rejects.toThrow(/already a print colour/)
    await expect(invoke('printcolors:create', { name: 'X', rgb: 'red' })).rejects.toThrow(/hex colour/)
    await expect(invoke('printcolors:create', { name: 'X', rgb: '#00f', cmyk: [0, 0, 0, 101] })).rejects.toThrow(/0 to 100/)
    await expect(invoke('printcolors:create', { name: 'X', rgb: '#00f', spotName: 'a(b' })).rejects.toThrow(/brackets/)
    const b = await invoke('printcolors:create', { name: 'Blue', rgb: '#0000ff' })
    expect(b.cmyk).toBeNull()
    expect((await invoke('printcolors:list')).map(c => c.name)).toEqual(['Red', 'Blue'])
    await invoke('printcolors:update', { id: b.id, cmyk: [100, 100, 0, 0] })
    expect((await invoke('printcolors:list'))[1].cmyk).toEqual([100, 100, 0, 0])
    await invoke('history:undo')
    expect((await invoke('printcolors:list'))[1].cmyk).toBeNull()
    await invoke('printcolors:remove', a.id)
    expect((await invoke('printcolors:list')).map(c => c.name)).toEqual(['Blue'])
  })

  it('saves export settings under a name, overwrites the same name, lists and removes', async () => {
    const one = await invoke('exportprofiles:save', { name: 'Press A', options: { dpi: 300, bleedMm: 3 } })
    const two = await invoke('exportprofiles:save', { name: 'Press A', options: { dpi: 600 } })
    expect(two.id).toBe(one.id)
    expect((await invoke('exportprofiles:list', {})).map(p => [p.name, p.options.dpi])).toEqual([['Press A', 600]])
    await invoke('exportprofiles:save', { name: 'Press B', options: {} })
    expect(await invoke('exportprofiles:list', {})).toHaveLength(2)
    await expect(invoke('exportprofiles:save', { name: '  ', options: {} })).rejects.toThrow()
    await invoke('exportprofiles:remove', one.id)
    expect((await invoke('exportprofiles:list', {})).map(p => p.name)).toEqual(['Press B'])
  })
})

describe('the schema', () => {
  it('is version 14 and a version 9 project is upgraded: the bleed and card back columns appear, every template keeps its data', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(15)
    const s = await seed([SOLID('#cc3333')])
    await invoke('projects:close')
    const raw = new Database(join(proj.dir, 'project.db'))
    raw.exec('ALTER TABLE templates DROP COLUMN bleed_mm; ALTER TABLE templates DROP COLUMN bleed_mode; ALTER TABLE templates DROP COLUMN bleed_color; DROP TABLE icc_profiles; DROP TABLE print_colors; DROP TABLE export_profiles;')
    raw.exec("UPDATE project_meta SET value = '9' WHERE key = 'schema_version'")
    raw.close()
    const state = await invoke('projects:open', proj.dir)
    expect(state.upgrade).toMatchObject({ from: 9, to: 15 })
    const t = await invoke('templates:get', s.template.id)
    expect(t).toMatchObject({ bleed_mm: 0, bleed_mode: 'extend', bleed_color: null })
    expect(t.svg_source).toContain('#cc3333')
    expect(await invoke('printcolors:list')).toEqual([])
    expect(openProjectDb(proj.dir).prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe('15')
    expect(openProjectDb(proj.dir).prepare('PRAGMA table_info(cards)').all().map(c => c.name)).toContain('back_template_id')
    expect(openProjectDb(proj.dir).prepare('PRAGMA table_info(sets)').all().map(c => c.name)).toContain('default_back_template_id')
  })
})

describe('the written file is checked against its settings', () => {
  it('reports a clean file as consistent, and a tampered one with the page and the problem', async () => {
    const { verifyProductionPdf } = await import('../../src/main/production/verify.js')
    const s = await seed([SOLID('#cc3333'), SOLID('#3366cc')])
    const r = await run(s, { cardBack: 'none', bleedMm: 3, safeMm: 3 })
    expect(r.report.verified.problems).toEqual([])
    const bytes = readFileSync(join(out, r.files[0]))
    expect(await verifyProductionPdf(bytes, { bleedMm: 3, safeMm: 3, colour: 'cmyk' })).toMatchObject({ ok: true, pages: 2 })
    const wrong = await verifyProductionPdf(bytes, { bleedMm: 2, safeMm: 5, colour: 'rgb' })
    expect(wrong.problems.map(p => p.problem)).toEqual(expect.arrayContaining(['bleedWrong', 'safeWrong', 'colourSpaceWrong']))
    expect(wrong.problems[0].page).toBe(1)
    // a file whose intent was removed
    const doc = await PDFDocument.load(bytes)
    doc.catalog.delete(PDFName.of('OutputIntents'))
    expect((await verifyProductionPdf(await doc.save(), { bleedMm: 3, safeMm: 3, colour: 'cmyk' })).problems.map(p => p.problem)).toContain('noOutputIntent')
  })
})
