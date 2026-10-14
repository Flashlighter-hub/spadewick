// Spike C: one production page written with pdf-lib: TrimBox, BleedBox, ArtBox, an output intent, a DeviceCMYK/ICC image,
// a spot colour (Separation) with a tint, a die line in its own overprinting spot, registration marks, and optional content layers.
// Run from the project folder: node spikes/pdf/build.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { PDFDocument, PDFName, PDFString, PDFNumber, PDFArray, PDFBool } from 'pdf-lib'
import { PATCHES, COMBOS, flatRgb, openLcms, toCmyk } from '../cmyk/common.mjs'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(here)
mkdirSync('out', { recursive: true })

const MM = 72 / 25.4
const TRIM_W = 63.5 * MM, TRIM_H = 88.9 * MM          // a poker card
const BLEED = 3 * MM, MARKS = 10 * MM                  // bleed and the room for marks outside it
const M = BLEED + MARKS
const PAGE_W = TRIM_W + 2 * M, PAGE_H = TRIM_H + 2 * M
const trim = [M, M, M + TRIM_W, M + TRIM_H]
const bleed = [M - BLEED, M - BLEED, M + TRIM_W + BLEED, M + TRIM_H + BLEED]
const art = [trim[0] + 3 * MM, trim[1] + 3 * MM, trim[2] - 3 * MM, trim[3] - 3 * MM]   // the safe area
const f = n => (Math.round(n * 1000) / 1000).toString()

// ---- the card image: 40 patches converted with the ISO Coated v2 profile (spike B) ----
const lcms = await openLcms()
const PROFILE = new URL('../cmyk/profiles/ISOcoated_v2_eci.icc', import.meta.url)
const cmyk = toCmyk(lcms, flatRgb(PATCHES), 'isocoated', COMBOS[3])
const COLS = 8, ROWS = 5, TILE = 30, IW = COLS * TILE, IH = ROWS * TILE
const image = new Uint8Array(IW * IH * 4)
for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) image.set(cmyk.subarray((Math.floor(y / TILE) * COLS + Math.floor(x / TILE)) * 4, (Math.floor(y / TILE) * COLS + Math.floor(x / TILE)) * 4 + 4), (y * IW + x) * 4)

const doc = await PDFDocument.create()
const c = doc.context
const N = PDFNumber.of
const nums = a => c.obj(a.map(n => N(n)))
const name = s => PDFName.of(s)

// ---- output intent ----
const profileRef = c.register(c.flateStream(new Uint8Array(readFileSync(PROFILE)), { N: N(4), Alternate: name('DeviceCMYK') }))
const intentRef = c.register(c.obj({
  Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of('FOGRA39'), Info: PDFString.of('ISO Coated v2 (ECI)'),
  RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: profileRef
}))
doc.catalog.set(name('OutputIntents'), c.obj([intentRef]))

// ---- spot colours: a Separation is [/Separation /Name /Alternate tintTransform] ----
const tint = (c0, c1) => c.register(c.obj({ FunctionType: N(2), Domain: nums([0, 1]), C0: nums(c0), C1: nums(c1), N: N(1) }))
const separation = (spot, alt) => c.obj([name('Separation'), name(spot), name('DeviceCMYK'), alt])
const csGold = c.register(separation('Spadewick Gold', tint([0, 0, 0, 0], [0.12, 0.3, 0.75, 0.08])))
const csDie = c.register(separation('DieCut', tint([0, 0, 0, 0], [0, 1, 0, 0])))
const csAll = c.register(separation('All', tint([0, 0, 0, 0], [1, 1, 1, 1])))      // registration colour: every plate

// ---- overprint: the die line and marks must not knock out the artwork ----
const gsOver = c.register(c.obj({ Type: 'ExtGState', OP: PDFBool.True, op: PDFBool.True, OPM: N(1) }))

// ---- image as ICCBased CMYK ----
const imgRef = c.register(c.flateStream(image, { Type: 'XObject', Subtype: 'Image', Width: N(IW), Height: N(IH), BitsPerComponent: N(8), ColorSpace: c.obj([name('ICCBased'), profileRef]), Intent: name('RelativeColorimetric') }))

// ---- optional content (layers) ----
const ocg = (label, view, print) => c.register(c.obj({ Type: 'OCG', Name: PDFString.of(label), Intent: name('View'), Usage: c.obj({ View: c.obj({ ViewState: name(view) }), Print: c.obj({ PrintState: name(print) }) }) }))
const ocArt = ocg('Artwork', 'ON', 'ON'), ocDie = ocg('Die line', 'ON', 'ON'), ocMarks = ocg('Print marks', 'ON', 'ON'), ocGuides = ocg('Guides (screen only)', 'ON', 'OFF')
doc.catalog.set(name('OCProperties'), c.obj({
  OCGs: [ocArt, ocDie, ocMarks, ocGuides],
  D: c.obj({ Order: [ocArt, ocDie, ocMarks, ocGuides], ON: [ocArt, ocDie, ocMarks, ocGuides], OFF: [], BaseState: name('ON'),
    AS: [c.obj({ Event: name('Print'), Category: [name('Print')], OCGs: [ocArt, ocDie, ocMarks, ocGuides] }), c.obj({ Event: name('View'), Category: [name('View')], OCGs: [ocArt, ocDie, ocMarks, ocGuides] })] })
}))

// ---- the page content ----
const rect = ([x0, y0, x1, y1]) => `${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re`
let ops = ''
ops += '/OC /LArt BDC\n'
ops += `0.04 0.02 0 0 k\n${rect(bleed)} f\n`                                                   // the paper tint runs into the bleed
ops += `q ${f(art[2] - art[0])} 0 0 ${f((art[2] - art[0]) * IH / IW)} ${f(art[0])} ${f(art[1] + 30 * MM)} cm /Img Do Q\n`
ops += `/CsGold cs 1 scn\n${rect([art[0], art[1], art[0] + 20 * MM, art[1] + 20 * MM])} f\n`      // 100 % of the spot colour
ops += `/CsGold cs 0.5 scn\n${rect([art[0] + 25 * MM, art[1], art[0] + 45 * MM, art[1] + 20 * MM])} f\n`  // a 50 % tint
ops += '0 0 0 1 k\n' + rect([trim[0] - BLEED, trim[1] - BLEED, trim[0] - BLEED + 4, trim[1] - BLEED + 4]) + ' f\n' // a black mark in the bleed corner
ops += 'EMC\n'
ops += '/OC /LDie BDC\nq /GsOver gs /CsDie CS 1 SCN 0.5 w\n' + rect(trim) + ' S\nQ\nEMC\n'
// crop marks: 3 mm outside the bleed, 6 mm long, drawn in the registration colour on every plate
const marks = []
const off = BLEED + 3 * MM, len = 6 * MM
for (const [x, y, dx, dy] of [[trim[0], trim[1], -1, -1], [trim[2], trim[1], 1, -1], [trim[0], trim[3], -1, 1], [trim[2], trim[3], 1, 1]]) {
  marks.push(`${f(x + dx * off)} ${f(y)} m ${f(x + dx * (off + len))} ${f(y)} l S`)
  marks.push(`${f(x)} ${f(y + dy * off)} m ${f(x)} ${f(y + dy * (off + len))} l S`)
}
ops += `/OC /LMarks BDC\nq /GsOver gs /CsAll CS 1 SCN 0.25 w\n${marks.join('\n')}\nQ\nEMC\n`
ops += `/OC /LGuides BDC\nq 0 1 1 0 K 0.5 w [3 2] 0 d\n${rect(art)} S\nQ\nEMC\n`          // the safe line, on screen only

const page = doc.addPage([PAGE_W, PAGE_H])
const box = (key, b) => page.node.set(name(key), nums(b))
box('TrimBox', trim); box('BleedBox', bleed); box('ArtBox', art); box('CropBox', [0, 0, PAGE_W, PAGE_H])
page.node.set(name('Contents'), c.register(c.flateStream(Buffer.from(ops, 'latin1'))))
page.node.set(name('Resources'), c.obj({
  ColorSpace: c.obj({ CsGold: csGold, CsDie: csDie, CsAll: csAll }), ExtGState: c.obj({ GsOver: gsOver }), XObject: c.obj({ Img: imgRef }),
  Properties: c.obj({ LArt: ocArt, LDie: ocDie, LMarks: ocMarks, LGuides: ocGuides })
}))
doc.setTitle('Spike C: production page')
doc.setProducer('Spadewick spike C')
// pdf-lib writes dates as D:YYYYMMDDHHmmssZ, which a strict validator (pdfcpu) rejects; the form the PDF specification gives is +00'00'
const stamp = `D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}+00'00'`
for (const key of ['CreationDate', 'ModDate']) doc.getInfoDict().set(name(key), PDFString.of(stamp))
writeFileSync(join('out', 'c.pdf'), await doc.save({ useObjectStreams: false }))
writeFileSync(join('out', 'expected.json'), JSON.stringify({ pageMm: [PAGE_W / MM, PAGE_H / MM], trim, bleed, art, page: [PAGE_W, PAGE_H], MM, M, BLEED, goldRect: [art[0], art[1], art[0] + 20 * MM, art[1] + 20 * MM], tintRect: [art[0] + 25 * MM, art[1], art[0] + 45 * MM, art[1] + 20 * MM] }, null, 1))
console.log('written out/c.pdf')
