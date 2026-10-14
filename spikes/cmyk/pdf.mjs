// Spike B, part 2: a PDF with converted CMYK images and the profile as output intent (written with pdf-lib, the library the app uses).
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { PDFDocument, PDFName, PDFString, PDFNumber, PDFArray, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib'
import { PROFILES, COMBOS, PATCHES, flatRgb, openLcms, toCmyk } from './common.mjs'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(here)
mkdirSync('out', { recursive: true })
const ctx = await openLcms()
const COLS = 8, ROWS = Math.ceil(PATCHES.length / COLS), TILE = 30
const W = COLS * TILE, H = ROWS * TILE

for (const pid of Object.keys(PROFILES)) {
  const combo = COMBOS[3]                                                // relative colorimetric with black point compensation
  const cmyk = toCmyk(ctx, flatRgb(PATCHES), pid, combo)
  const image = new Uint8Array(W * H * 4)                                // DeviceCMYK, 8 bits, 255 = full ink
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = Math.floor(y / TILE) * COLS + Math.floor(x / TILE)
    const o = (y * W + x) * 4
    if (i < PATCHES.length) image.set(cmyk.subarray(i * 4, i * 4 + 4), o)  // beyond the last patch: no ink (paper)
  }
  const profileBytes = new Uint8Array(readFileSync(PROFILES[pid].file))

  const doc = await PDFDocument.create()
  const c = doc.context
  const profileRef = c.register(c.flateStream(profileBytes, { N: PDFNumber.of(4), Alternate: PDFName.of('DeviceCMYK') }))
  const intent = c.obj({
    Type: 'OutputIntent', S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(PROFILES[pid].name), Info: PDFString.of(PROFILES[pid].name),
    RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: profileRef
  })
  doc.catalog.set(PDFName.of('OutputIntents'), c.obj([c.register(intent)]))

  const mkImage = space => c.register(c.flateStream(image, {
    Type: 'XObject', Subtype: 'Image', Width: PDFNumber.of(W), Height: PDFNumber.of(H), BitsPerComponent: PDFNumber.of(8), ColorSpace: space
  }))
  const deviceImage = mkImage(PDFName.of('DeviceCMYK'))
  const iccImage = mkImage(c.obj([PDFName.of('ICCBased'), profileRef]))

  for (const ref of [deviceImage, iccImage]) {
    const page = doc.addPage([W + 40, H + 40])
    const name = page.node.newXObject('Im', ref)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(W, 0, 0, H, 20, 20), drawObject(name), popGraphicsState())
  }
  doc.setTitle(`Spike B: ${PROFILES[pid].name}`)
  const bytes = await doc.save({ useObjectStreams: false })
  writeFileSync(join('out', `b-${pid}.pdf`), bytes)
  writeFileSync(join('out', `b-${pid}.cmyk.bin`), image)
  console.log(pid, 'written', bytes.length, 'bytes')
}
