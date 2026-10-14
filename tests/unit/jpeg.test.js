import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { encodeJpeg } from '../../src/main/production/jpeg.js'

/** A smooth test picture: each component is a different gradient, so a swapped or inverted component shows. */
function picture(w, h, n) {
  const d = new Uint8Array(w * h * n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < n; c++) d[(y * w + x) * n + c] = Math.round(30 + 190 * (c === 0 ? x / (w - 1) : c === 1 ? y / (h - 1) : c === 2 ? 0.5 : (x + y) / (w + h - 2)))
  return d
}
const meanError = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length }

describe('the JPEG encoder of the production PDF (PRD §17.3)', () => {
  it('writes an RGB JPEG that a standard decoder reads back within the loss of the quality', async () => {
    const w = 37, h = 29   // not multiples of 8: the edge blocks are padded
    const src = picture(w, h, 3)
    const jpeg = encodeJpeg(src, w, h, 3, 92)
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8])
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9])
    const out = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
    expect([out.info.width, out.info.height, out.info.channels]).toEqual([w, h, 3])
    expect(meanError(src, out.data)).toBeLessThan(2)
  })

  it('writes a CMYK JPEG the way PDF producers do: four components, Adobe marker without a transform, values inverted', async () => {
    const w = 40, h = 24
    const src = picture(w, h, 4)
    const jpeg = encodeJpeg(src, w, h, 4, 92)
    expect(jpeg.includes(Buffer.from('Adobe'))).toBe(true)
    const meta = await sharp(jpeg).metadata()
    expect(meta.channels).toBe(4)
    expect(meta.space).toBe('cmyk')
    // A flat picture of one colour comes back as that colour in the decoder of the image library, which expects the Adobe inversion
    const flat = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) flat.set([0, 0, 0, 255], i * 4)          // pure black: K 100 %
    const rgb = await sharp(encodeJpeg(flat, w, h, 4, 95)).raw().toBuffer()
    expect(Math.max(...rgb)).toBeLessThan(40)                                // dark, not white: the inversion is the one a reader assumes
    const white = new Uint8Array(w * h * 4)                                  // no ink at all
    expect(Math.min(...await sharp(encodeJpeg(white, w, h, 4, 95)).raw().toBuffer())).toBeGreaterThan(215)
  })

  it('a lower quality makes a smaller file and a larger error; one component also works', async () => {
    const w = 64, h = 64
    const src = picture(w, h, 1)
    const high = encodeJpeg(src, w, h, 1, 95), low = encodeJpeg(src, w, h, 1, 30)
    expect(low.length).toBeLessThan(high.length)
    const dec = async j => sharp(j).toColourspace('b-w').raw().toBuffer()
    expect(meanError(src, await dec(low))).toBeGreaterThanOrEqual(meanError(src, await dec(high)))
    expect(() => encodeJpeg(src, w, h, 2)).toThrow()
  })

  it('handles flat colour (long runs and a lone DC) and hard edges without breaking the stream', async () => {
    const w = 33, h = 17
    const flat = new Uint8Array(w * h * 4).fill(255)
    expect((await sharp(encodeJpeg(flat, w, h, 4, 90)).metadata()).channels).toBe(4)
    const stripes = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) stripes.fill(i % 2 ? 0 : 255, i * 3, i * 3 + 3)
    const dec = await sharp(encodeJpeg(stripes, w, h, 3, 95)).raw().toBuffer()
    expect(dec.length).toBe(w * h * 3)
  })
})
