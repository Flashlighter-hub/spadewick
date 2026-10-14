/**
 * A baseline JPEG encoder for the pictures of a production PDF (PRD §17.3, "JPEG at a chosen quality as an option").
 *
 * The image library of the application cannot write a CMYK JPEG from CMYK values it is given (it would read them as RGB and convert),
 * so the encoder is written here: one, three or four 8-bit components, no subsampling, the standard Huffman tables of the JPEG
 * specification (Annex K). Three components are stored as given (a PDF says so with `/ColorTransform 0`). Four components are written
 * the way every PDF producer writes CMYK JPEGs: with Adobe's APP14 marker (no transform) and the values inverted, which the PDF
 * undoes with `/Decode [1 0 1 0 1 0 1 0]`. Image libraries and viewers that read a CMYK JPEG on its own assume the same inversion.
 */

import { tr } from '../../shared/i18n.js'

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
]

// The luminance quantisation table of the specification, in natural order
const BASE_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99
]

const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_VALS = (() => {
  const head = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a,
    0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a]
  const run = (hi, lo, count) => Array.from({ length: count }, (_, i) => hi * 16 + lo + i)
  return [...head, ...run(6, 3, 8), ...run(7, 3, 8), ...run(8, 3, 8), ...run(9, 2, 9), ...run(10, 2, 9), ...run(11, 2, 9), ...run(12, 2, 9), ...run(13, 2, 9), ...run(14, 1, 10), ...run(15, 1, 10)]
})()

/** Canonical Huffman codes from the BITS and VALS lists: value -> { code, size }. */
function huffmanTable(bits, vals) {
  const table = new Map()
  let code = 0, k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) table.set(vals[k++], { code: code++, size: len })
    code <<= 1
  }
  return table
}
const DC_TABLE = huffmanTable(DC_BITS, DC_VALS)
const AC_TABLE = huffmanTable(AC_BITS, AC_VALS)

// cos((2x + 1) u pi / 16) with the normalisation of the 2-D DCT folded into the rows
const COS = (() => {
  const m = new Float64Array(64)
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) m[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2
  return m
})()

class Bits {
  constructor() { this.chunks = []; this.buf = Buffer.alloc(65536); this.n = 0; this.acc = 0; this.count = 0 }
  put(code, size) {
    this.acc = (this.acc << size) | (code & ((1 << size) - 1))
    this.count += size
    while (this.count >= 8) {
      const byte = (this.acc >> (this.count - 8)) & 0xff
      this.count -= 8
      this.acc &= (1 << this.count) - 1
      this.byte(byte)
      if (byte === 0xff) this.byte(0)
    }
  }
  byte(b) { if (this.n === this.buf.length) { this.chunks.push(this.buf); this.buf = Buffer.alloc(65536); this.n = 0 } this.buf[this.n++] = b }
  finish() {
    if (this.count > 0) this.put(0x7f, 8 - this.count)   // pad the last byte with ones
    return Buffer.concat([...this.chunks, this.buf.subarray(0, this.n)])
  }
}

const category = v => { let a = Math.abs(v), c = 0; while (a) { c++; a >>= 1 } return c }

/**
 * @param {Uint8Array} data interleaved samples, `components` per pixel
 * @param {number} width
 * @param {number} height
 * @param {1 | 3 | 4} components
 * @param {number} quality 1 to 100
 * @returns {Buffer} the JPEG file
 */
export function encodeJpeg(data, width, height, components, quality = 90) {
  if (![1, 3, 4].includes(components)) throw new Error(tr('errors.jpegComponents'))
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  const scale = q < 50 ? 5000 / q : 200 - 2 * q
  const quant = BASE_QUANT.map(v => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))))

  // three components are named R, G and B, which is how a JPEG reader is told that they are not YCbCr
  const ids = components === 3 ? [0x52, 0x47, 0x42] : Array.from({ length: components }, (_, i) => i + 1)
  const header = []
  const adobe = components === 4
  const marker = (code, payload) => header.push(Buffer.from([0xff, code, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]))
  header.push(Buffer.from([0xff, 0xd8]))
  if (adobe) marker(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0, 0, 0, 0, 0])   // 'Adobe', version 100, flags 0, transform 0 (CMYK)
  marker(0xdb, [0, ...ZIGZAG.map(i => quant[i])])
  marker(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, components, ...ids.map(id => [id, 0x11, 0]).flat()])
  marker(0xc4, [0x00, ...DC_BITS, ...DC_VALS])
  marker(0xc4, [0x10, ...AC_BITS, ...AC_VALS])
  marker(0xda, [components, ...ids.map(id => [id, 0x00]).flat(), 0, 63, 0])

  const bits = new Bits()
  const pred = new Int32Array(components)
  const block = new Float64Array(64), tmp = new Float64Array(64), coef = new Int32Array(64)
  const blocksX = Math.ceil(width / 8), blocksY = Math.ceil(height / 8)

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      for (let comp = 0; comp < components; comp++) {
        // the 8 x 8 samples of this component, edges repeated, level shifted
        for (let y = 0; y < 8; y++) {
          const sy = Math.min(height - 1, by * 8 + y)
          for (let x = 0; x < 8; x++) block[y * 8 + x] = (adobe ? 255 - data[(sy * width + Math.min(width - 1, bx * 8 + x)) * components + comp] : data[(sy * width + Math.min(width - 1, bx * 8 + x)) * components + comp]) - 128
        }
        // rows, then columns
        for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let sum = 0; for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * COS[u * 8 + x]; tmp[y * 8 + u] = sum }
        for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let sum = 0; for (let y = 0; y < 8; y++) sum += tmp[y * 8 + u] * COS[v * 8 + y]; coef[v * 8 + u] = Math.round(sum / quant[v * 8 + u]) }

        // DC: the difference to the block before, then the AC coefficients in zigzag order
        const diff = coef[0] - pred[comp]
        pred[comp] = coef[0]
        const dcCat = category(diff)
        const dc = DC_TABLE.get(dcCat)
        bits.put(dc.code, dc.size)
        if (dcCat) bits.put(diff < 0 ? diff - 1 : diff, dcCat)
        let run = 0
        for (let k = 1; k < 64; k++) {
          const v = coef[ZIGZAG[k]]
          if (v === 0) { run++; continue }
          while (run > 15) { const zrl = AC_TABLE.get(0xf0); bits.put(zrl.code, zrl.size); run -= 16 }
          const cat = category(v)
          const ac = AC_TABLE.get(run * 16 + cat)
          bits.put(ac.code, ac.size)
          bits.put(v < 0 ? v - 1 : v, cat)
          run = 0
        }
        if (run > 0) { const eob = AC_TABLE.get(0x00); bits.put(eob.code, eob.size) }
      }
    }
  }
  return Buffer.concat([...header, bits.finish(), Buffer.from([0xff, 0xd9])])
}
