/**
 * The internal consistency check of a written production PDF (PRD §17.7, "Page boxes or output intent inconsistent"): the file is
 * read back and its boxes, output intent and colour spaces are checked against the settings it was made with. A finding here means
 * a defect of the writer, never of the person's work, so it is reported as an error with the page it was found on.
 */
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib'

const MM = 72 / 25.4
const close = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * MM

/** @returns {Promise<{ ok: boolean, pages: number, problems: { page: number, problem: string }[] }>} */
export async function verifyProductionPdf(bytes, s) {
  const problems = []
  const doc = await PDFDocument.load(bytes)
  const add = (page, problem) => problems.push({ page, problem })
  const intents = doc.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray)
  if (!intents || intents.size() < 1) add(0, 'noOutputIntent')
  else {
    const profile = intents.lookup(0, PDFDict).lookup(PDFName.of('DestOutputProfile'))
    if (!profile) add(0, 'noOutputProfile')
  }
  doc.getPages().forEach((p, i) => {
    const n = i + 1
    const box = key => p.node.lookupMaybe(PDFName.of(key), PDFArray)?.asArray().map(v => v.asNumber())
    const media = box('MediaBox'), bleed = box('BleedBox'), trim = box('TrimBox'), art = box('ArtBox')
    if (!media || !bleed || !trim || !art) { add(n, 'missingBox'); return }
    const inside = (a, b) => a[0] >= b[0] - 1e-6 && a[1] >= b[1] - 1e-6 && a[2] <= b[2] + 1e-6 && a[3] <= b[3] + 1e-6
    if (!(inside(art, trim) && inside(trim, bleed) && inside(bleed, media))) add(n, 'boxesNotNested')
    if (!close(trim[0] - bleed[0], s.bleedMm * MM) || !close(bleed[2] - trim[2], s.bleedMm * MM)) add(n, 'bleedWrong')
    if (!close(art[0] - trim[0], s.safeMm * MM) || !close(trim[2] - art[2], s.safeMm * MM)) add(n, 'safeWrong')
    const res = p.node.lookupMaybe(PDFName.of('Resources'), PDFDict)
    const img = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.lookup(PDFName.of('Img'))
    const cs = img?.dict?.lookup(PDFName.of('ColorSpace'))
    if (!img) add(n, 'noImage')
    else if (s.colour === 'cmyk' && !(cs instanceof PDFArray)) add(n, 'colourSpaceWrong')
    else if (s.colour === 'rgb' && !(cs instanceof PDFName && cs.decodeText() === 'DeviceRGB')) add(n, 'colourSpaceWrong')
  })
  return { ok: !problems.length, pages: doc.getPageCount(), problems }
}
