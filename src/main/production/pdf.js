/**
 * The production PDF (PRD §17.3, spike C): one card per page, the page the size of the card plus its bleed (plus room for marks),
 * with TrimBox, BleedBox and ArtBox (the safe area), the output profile as output intent, the card as a CMYK image in the profile's
 * colour space, the die line as a named spot colour and/or a layer, and crop and registration marks in the registration colour.
 * Written with pdf-lib's object API; nothing else is needed (spike C).
 */
import { PDFDocument, PDFName, PDFString, PDFNumber, PDFBool, PDFRawStream } from 'pdf-lib'
import { encodeJpeg } from './jpeg.js'
import { standardLabel, hasMarks } from './settings.js'

export const PT_PER_MM = 72 / 25.4
const f = n => (Math.round(n * 1000) / 1000).toString()
/** PDF dates in the form of the specification, with an explicit offset (pdf-lib's own form is refused by strict validators). */
const pdfDate = d => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}+00'00'`

const KAPPA = 0.5522847498
function roundedRect(x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  if (r <= 0) return `${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re`
  const k = r * KAPPA
  return [
    `${f(x0 + r)} ${f(y0)} m`, `${f(x1 - r)} ${f(y0)} l`, `${f(x1 - r + k)} ${f(y0)} ${f(x1)} ${f(y0 + r - k)} ${f(x1)} ${f(y0 + r)} c`,
    `${f(x1)} ${f(y1 - r)} l`, `${f(x1)} ${f(y1 - r + k)} ${f(x1 - r + k)} ${f(y1)} ${f(x1 - r)} ${f(y1)} c`,
    `${f(x0 + r)} ${f(y1)} l`, `${f(x0 + r - k)} ${f(y1)} ${f(x0)} ${f(y1 - r + k)} ${f(x0)} ${f(y1 - r)} c`,
    `${f(x0)} ${f(y0 + r)} l`, `${f(x0)} ${f(y0 + r - k)} ${f(x0 + r - k)} ${f(y0)} ${f(x0 + r)} ${f(y0)} c`, 'h'
  ].join('\n')
}
function circle(cx, cy, r) {
  const k = r * KAPPA
  return [`${f(cx + r)} ${f(cy)} m`, `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c`, `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c`,
    `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c`, `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c`, 'h'].join('\n')
}

/**
 * @param {object} s production settings (normalized)
 * @param {{ profileBytes: Uint8Array, profileName: string, title?: string }} o
 */
export async function createProductionPdf(s, { profileBytes, profileName, title }) {
  const doc = await PDFDocument.create()
  const c = doc.context
  const N = PDFNumber.of
  const nums = a => c.obj(a.map(n => N(n)))
  const name = x => PDFName.of(x)
  const rgbMode = s.colour === 'rgb'

  // ---- shared objects ----
  const profileRef = c.register(c.flateStream(new Uint8Array(profileBytes), { N: N(4), Alternate: name('DeviceCMYK') }))
  const intentRef = c.register(c.obj({
    Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of(profileName), Info: PDFString.of(profileName),
    RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: profileRef
  }))
  doc.catalog.set(name('OutputIntents'), c.obj([intentRef]))
  const tint = (c0, c1) => c.register(c.obj({ FunctionType: N(2), Domain: nums([0, 1]), C0: nums(c0), C1: nums(c1), N: N(1) }))
  const csAll = c.register(c.obj([name('Separation'), name('All'), name('DeviceCMYK'), tint([0, 0, 0, 0], [1, 1, 1, 1])]))
  const wantsSpot = s.dieLine === 'spot' || s.dieLine === 'both'
  const wantsDie = s.dieLine !== 'none'
  const csDie = wantsSpot ? c.register(c.obj([name('Separation'), name(s.dieSpotName), name('DeviceCMYK'), tint([0, 0, 0, 0], [0, 1, 0, 0])])) : null
  const gsOver = c.register(c.obj({ Type: 'ExtGState', OP: PDFBool.True, op: PDFBool.True, OPM: N(1) }))

  // ---- layers ----
  const wantsMarks = hasMarks(s)
  const layers = []
  const ocg = (key, label, printState) => {
    const ref = c.register(c.obj({ Type: 'OCG', Name: PDFString.of(label), Intent: name('View'), Usage: c.obj({ View: c.obj({ ViewState: name('ON') }), Print: c.obj({ PrintState: name(printState) }) }) }))
    layers.push({ key, ref })
    return ref
  }
  const useLayers = wantsDie || wantsMarks
  const ocArt = useLayers ? ocg('LArt', 'Artwork', 'ON') : null
  const ocDie = wantsDie ? ocg('LDie', 'Die line', s.dieLine === 'layer' ? 'OFF' : 'ON') : null
  const ocMarks = wantsMarks ? ocg('LMarks', 'Print marks', 'ON') : null
  if (useLayers) {
    const refs = layers.map(l => l.ref)
    doc.catalog.set(name('OCProperties'), c.obj({ OCGs: refs, D: c.obj({ Order: refs, ON: refs, OFF: [], BaseState: name('ON') }) }))
  }

  let pages = 0
  const imageCache = new WeakMap()   // the same picture (a shared card back) is stored once
  return {
    get pageCount() { return pages },
    /**
     * One card as one page.
     * @param {{ data: Uint8Array, width: number, height: number, trimMmW: number, trimMmH: number }} card data: CMYK (4 per pixel) or RGB (3 per pixel)
     */
    addPage({ data, width, height, trimMmW, trimMmH }) {
      const B = s.bleedMm * PT_PER_MM
      const margin = wantsMarks ? s.marksMarginMm * PT_PER_MM : 0
      const M = margin + B
      const tw = trimMmW * PT_PER_MM, th = trimMmH * PT_PER_MM
      const pageW = tw + 2 * M, pageH = th + 2 * M
      const trim = [M, M, M + tw, M + th]
      const bleed = [M - B, M - B, M + tw + B, M + th + B]
      const safe = s.safeMm * PT_PER_MM
      const art = [trim[0] + safe, trim[1] + safe, trim[2] - safe, trim[3] - safe]
      let image = imageCache.get(data)
      if (!image) {
        const entries = {
          Type: 'XObject', Subtype: 'Image', Width: N(width), Height: N(height), BitsPerComponent: N(8),
          ColorSpace: rgbMode ? name('DeviceRGB') : c.obj([name('ICCBased'), profileRef]), Intent: name('RelativeColorimetric')
        }
        if (s.imageCompression === 'jpeg') {
          // Lossy: a JPEG at the chosen quality. RGB is stored as it is (no YCbCr), CMYK in Adobe's inverted form, which /Decode undoes (jpeg.js)
          const bytes = encodeJpeg(data, width, height, rgbMode ? 3 : 4, s.jpegQuality)
          const dict = c.obj({ ...entries, Filter: name('DCTDecode'), Length: N(bytes.length), ...(rgbMode ? { DecodeParms: c.obj({ ColorTransform: N(0) }) } : { Decode: nums([1, 0, 1, 0, 1, 0, 1, 0]) }) })
          image = c.register(PDFRawStream.of(dict, new Uint8Array(bytes)))
        } else image = c.register(c.flateStream(data, entries))
        imageCache.set(data, image)
      }
      let ops = ''
      if (useLayers) ops += '/OC /LArt BDC\n'
      ops += `q ${f(bleed[2] - bleed[0])} 0 0 ${f(bleed[3] - bleed[1])} ${f(bleed[0])} ${f(bleed[1])} cm /Img Do Q\n`
      if (useLayers) ops += 'EMC\n'
      if (wantsDie) {
        ops += '/OC /LDie BDC\nq 0.5 w\n'
        ops += wantsSpot ? '/GsOver gs /CsDie CS 1 SCN\n' : '0 1 0 0 K\n'
        ops += `${roundedRect(trim[0], trim[1], trim[2], trim[3], s.dieRadiusMm * PT_PER_MM)} S\nQ\nEMC\n`
      }
      if (wantsMarks) {
        const parts = []
        const off = B + 3 * PT_PER_MM, len = 6 * PT_PER_MM
        if (s.cropMarks) {
          for (const [x, y, dx, dy] of [[trim[0], trim[1], -1, -1], [trim[2], trim[1], 1, -1], [trim[0], trim[3], -1, 1], [trim[2], trim[3], 1, 1]]) {
            parts.push(`${f(x + dx * off)} ${f(y)} m ${f(x + dx * (off + len))} ${f(y)} l S`, `${f(x)} ${f(y + dy * off)} m ${f(x)} ${f(y + dy * (off + len))} l S`)
          }
        }
        if (s.registrationMarks) {
          const d = B + 5 * PT_PER_MM, r = 1.5 * PT_PER_MM, t = 3 * PT_PER_MM
          for (const [cx, cy] of [[(trim[0] + trim[2]) / 2, trim[3] + d], [(trim[0] + trim[2]) / 2, trim[1] - d], [trim[0] - d, (trim[1] + trim[3]) / 2], [trim[2] + d, (trim[1] + trim[3]) / 2]]) {
            parts.push(circle(cx, cy, r) + ' S', `${f(cx - t)} ${f(cy)} m ${f(cx + t)} ${f(cy)} l S`, `${f(cx)} ${f(cy - t)} m ${f(cx)} ${f(cy + t)} l S`)
          }
        }
        ops += `/OC /LMarks BDC\nq /GsOver gs /CsAll CS 1 SCN 0.25 w\n${parts.join('\n')}\nQ\nEMC\n`
      }
      const page = doc.addPage([pageW, pageH])
      const set = (key, b) => page.node.set(name(key), nums(b))
      set('CropBox', [0, 0, pageW, pageH]); set('BleedBox', bleed); set('TrimBox', trim); set('ArtBox', art)
      page.node.set(name('Contents'), c.register(c.flateStream(Buffer.from(ops, 'latin1'))))
      const res = { XObject: c.obj({ Img: image }), ExtGState: c.obj({ GsOver: gsOver }), ColorSpace: c.obj({ CsAll: csAll, ...(csDie ? { CsDie: csDie } : {}) }) }
      if (useLayers) res.Properties = c.obj(Object.fromEntries(layers.map(l => [l.key, l.ref])))
      page.node.set(name('Resources'), c.obj(res))
      pages++
    },
    async save() {
      const now = new Date()
      doc.setTitle(title ?? 'Spadewick production PDF')
      doc.setProducer('Spadewick')
      doc.setCreator('Spadewick')
      doc.setSubject(standardLabel(s.standard))
      doc.setKeywords([profileName, `${s.intent}${s.blackPoint ? ' with black point compensation' : ''}`])
      const info = doc.getInfoDict()
      for (const key of ['CreationDate', 'ModDate']) info.set(name(key), PDFString.of(pdfDate(now)))
      info.set(name('Trapped'), name('False'))
      return doc.save({ useObjectStreams: false })
    }
  }
}
