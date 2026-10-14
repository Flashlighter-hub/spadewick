/** The colour helpers and settings of the production export (PRD §17.3, §17.5) that need no project. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createConverter, convertImage, proofImage, inkStats, limitInk, applyPrintColors, countColor, outOfGamut, profileHeader, profileHash } from '../../src/main/colour/lcms.js'
import { normalizeProduction, standardLabel, hasMarks, DEFAULTS } from '../../src/main/production/settings.js'
import { pixelBox } from '../../src/main/production/raster.js'

const PROFILE = readFileSync(join(process.cwd(), 'resources/profiles/CGATS21_CRPC1.icc'))
const rgb = (...c) => Uint8Array.from(c.flat())

describe('profiles', () => {
  it('reads the header: space, class and version, and refuses what is not a profile', () => {
    expect(profileHeader(PROFILE)).toMatchObject({ space: 'CMYK', deviceClass: 'prtr', pcs: 'Lab ', version: 4 })
    expect(profileHeader(Buffer.from('not a profile at all, just text, long enough to have a header but no acsp mark in it'.repeat(3)))).toBeNull()
    expect(profileHeader(Buffer.alloc(10))).toBeNull()
    expect(profileHash(PROFILE)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a profile that is not CMYK output', async () => {
    const b = Buffer.alloc(200); b.write('mntr', 12, 'latin1'); b.write('RGB ', 16, 'latin1'); b.write('acsp', 36, 'latin1')
    await expect(createConverter(b)).rejects.toThrow(/not a CMYK output profile/)
  })
})

describe('converting', () => {
  it('white has no ink, black is mostly black ink, and a conversion round-trips through the proof', async () => {
    const c = await createConverter(PROFILE, { intent: 'relative', blackPoint: true })
    try {
      const out = convertImage(c, rgb([255, 255, 255], [0, 0, 0], [128, 128, 128]), 3, 1)
      expect([...out.subarray(0, 4)]).toEqual([0, 0, 0, 0])
      expect(out[7]).toBeGreaterThan(230)                                   // the black plate
      const back = proofImage(c, out, 3, 1)
      expect(back[0]).toBeGreaterThan(250)                                  // paper white
      expect(Math.abs(back[6] - 128)).toBeLessThan(12)                      // a mid grey comes back close
    } finally { c.close() }
  })

  it('converts a large image in strips with the same result as in one piece', async () => {
    const c = await createConverter(PROFILE)
    try {
      const w = 37, h = 301
      const px = new Uint8Array(w * h * 3).map((_, i) => (i * 31 + (i >> 5)) & 255)
      const whole = c.toCmyk(px, w * h)
      expect(Buffer.from(convertImage(c, px, w, h, 64)).equals(Buffer.from(whole))).toBe(true)
    } finally { c.close() }
  })

  it('closing twice is harmless', async () => { const c = await createConverter(PROFILE); c.close(); c.close() })
})

describe('ink', () => {
  it('measures the highest total and how many pixels are over a limit', () => {
    const cmyk = Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 0, 128, 128, 128, 0])
    expect(inkStats(cmyk)).toEqual({ maxPct: 400, over: 0, pixels: 3 })
    expect(inkStats(cmyk, 300)).toMatchObject({ over: 1 })
    expect(inkStats(cmyk, 150).over).toBe(2)
  })

  it('brings every pixel to the limit, scaling C, M and Y together and keeping K', () => {
    const cmyk = Uint8Array.from([200, 100, 100, 200, 10, 10, 10, 10, 0, 0, 0, 255])
    const changed = limitInk(cmyk, 200)                                     // 510 of 1020
    expect(changed).toBe(1)
    expect([...cmyk.subarray(0, 4)].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(510)
    expect(cmyk[3]).toBe(200)                                               // the black plate is kept
    expect(cmyk[0] / cmyk[1]).toBeCloseTo(2, 0)                             // the colour balance is kept
    expect([...cmyk.subarray(4, 8)]).toEqual([10, 10, 10, 10])              // under the limit: untouched
    limitInk(cmyk, 80)                                                      // a black above the limit by itself is cut to it
    expect([...cmyk.subarray(8, 12)]).toEqual([0, 0, 0, 204])
  })
})

describe('print colours', () => {
  it('sets the wanted inks where the screen colour is exactly the colour, and nowhere else', () => {
    const px = rgb([255, 0, 0], [254, 0, 0], [255, 0, 0])
    const cmyk = new Uint8Array(12).fill(7)
    expect(applyPrintColors(px, cmyk, [{ rgb: [255, 0, 0], cmyk: [0, 100, 100, 0] }])).toBe(2)
    expect([...cmyk]).toEqual([0, 255, 255, 0, 7, 7, 7, 7, 0, 255, 255, 0])
    expect(applyPrintColors(px, cmyk, [])).toBe(0)
    expect(countColor(px, [255, 0, 0])).toBe(2)
    const c2 = new Uint8Array(4)
    applyPrintColors(rgb([1, 2, 3]), c2, [{ rgb: [1, 2, 3], cmyk: [150, -5, 50, 12.5] }])           // values are clamped to 0 to 100
    expect([...c2]).toEqual([255, 0, 127, 32])
  })

  it('finds the colours the press cannot show', () => {
    const src = rgb([0, 255, 255], [128, 128, 128])
    const shown = rgb([40, 190, 220], [126, 128, 130])
    const r = outOfGamut(src, shown)
    expect(r.count).toBe(1); expect([...r.mask]).toEqual([1, 0])
  })
})

describe('settings', () => {
  it('fills in the defaults and checks every value', () => {
    expect(normalizeProduction({})).toMatchObject({ standard: 'x4', colour: 'cmyk', dpi: 300, bleedMm: 3, inkLimit: 300, backLayout: 'separate' })
    expect(normalizeProduction({ inkLimit: null }).inkLimit).toBeNull()
    expect(normalizeProduction({ inkLimit: 0 }).inkLimit).toBeNull()
    expect(normalizeProduction({ dpi: 299.6 }).dpi).toBe(300)
    expect(normalizeProduction({ cardBackColor: 'nonsense' }).cardBackColor).toBe(DEFAULTS.cardBackColor)
    for (const bad of [{ dpi: 71 }, { dpi: 1201 }, { bleedMm: 21 }, { safeMm: -1 }, { standard: 'x3' }, { dieLine: 'x' }, { dieSpotName: '' }, { dieSpotName: 'a\\b' }, { dieRadiusMm: 16 }, { marksMarginMm: 1 }, { inkLimit: 99 }, { backLayout: 'x' }]) {
      expect(() => normalizeProduction(bad)).toThrow(/not valid|only possible/)
    }
    expect(() => normalizeProduction({ colour: 'rgb', standard: 'x1a' })).toThrow(/PDF\/X-4/)
    expect(() => normalizeProduction({ colour: 'rgb', standard: 'plain' })).not.toThrow()
  })

  it('describes the standard without claiming conformance, and knows when there are marks', () => {
    expect(standardLabel('x4')).toBe('PDF/X-4-style, unvalidated')
    expect(standardLabel('x1a')).toBe('PDF/X-1a-style, unvalidated')
    expect(standardLabel('plain')).toMatch(/no standard claimed/)
    expect(hasMarks({ cropMarks: true })).toBe(true); expect(hasMarks({ cropMarks: false, registrationMarks: false })).toBe(false)
  })

  it('works out pixel sizes from millimetres and the resolution', () => {
    // the whole is what the millimetres make (an odd pixel goes to the right and the bottom), so it is the number a manufacturer states
    expect(pixelBox(63.5, 88.9, 3, 300)).toEqual({ trimW: 750, trimH: 1050, bleed: 35, bleedL: 35, bleedR: 36, bleedT: 35, bleedB: 36, width: 821, height: 1121 })
    expect(pixelBox(63.5, 88.9, 3.175, 300)).toMatchObject({ width: 825, height: 1125 })
    expect(pixelBox(63.5, 88.9, 0, 300)).toMatchObject({ width: 750, height: 1050 })
  })
})
