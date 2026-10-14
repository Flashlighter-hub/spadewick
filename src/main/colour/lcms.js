/**
 * Colour conversion for production output (PRD §17.5, spike B): sRGB to a CMYK output profile with a chosen rendering intent and
 * black point compensation, the way back for the soft proof, and the measurements that go with them (total ink).
 * Little CMS is `lcms-wasm` (WebAssembly, loaded with import() like the text engine's shaper): the image library of the
 * application cannot choose an intent or black point compensation.
 */
import { createHash } from 'crypto'
import { tr } from '../../shared/i18n.js'

let loading = null

/** Load Little CMS (once). */
export function loadLcms() {
  return (loading ??= import('lcms-wasm').then(async m => ({ m, lcms: await m.instantiate() })))
}

export const INTENTS = ['perceptual', 'relative', 'saturation', 'absolute']
const INTENT_NUMBER = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 }
const FLAG_BPC = 0x2000
const CMYK = 0x434d594b // 'CMYK'

/** What a profile file is, from its header: { space, deviceClass, version, description } or null when it is not an ICC profile. */
export function profileHeader(bytes) {
  const b = Buffer.from(bytes)
  if (b.length < 132 || b.toString('latin1', 36, 40) !== 'acsp') return null
  return { space: b.toString('latin1', 16, 20), deviceClass: b.toString('latin1', 12, 16), pcs: b.toString('latin1', 20, 24), version: b[8], size: b.readUInt32BE(0) }
}

export const profileHash = bytes => createHash('sha256').update(bytes).digest('hex')

/**
 * An output profile ready to convert with.
 * @param {Uint8Array} bytes the .icc file
 * @param {{ intent?: string, blackPoint?: boolean }} [opts]
 */
export async function createConverter(bytes, { intent = 'relative', blackPoint = true } = {}) {
  const { m, lcms } = await loadLcms()
  const header = profileHeader(bytes)
  if (!header || header.space !== 'CMYK' || header.deviceClass !== 'prtr') throw new Error(tr('errors.profileInvalid'))
  const u8 = new Uint8Array(bytes)
  const profile = lcms.cmsOpenProfileFromMem(u8, u8.length)
  if (!profile) throw new Error(tr('errors.profileInvalid'))
  if (lcms.cmsGetColorSpace?.(profile) !== undefined && lcms.cmsGetColorSpace(profile) !== CMYK) { lcms.cmsCloseProfile(profile); throw new Error(tr('errors.profileInvalid')) }
  const srgb = lcms.cmsCreate_sRGBProfile()
  const flags = blackPoint ? FLAG_BPC : 0
  const number = INTENT_NUMBER[intent] ?? 1
  const make = (from, fmtIn, to, fmtOut) => {
    const t = lcms.cmsCreateTransform(from, fmtIn, to, fmtOut, number, flags)
    if (!t) throw new Error(tr('errors.profileInvalid'))
    return t
  }
  const toCmykT = make(srgb, m.TYPE_RGB_8, profile, m.TYPE_CMYK_8)
  let toRgbT = null
  const closed = { v: false }
  return {
    description: lcms.cmsGetProfileInfoASCII(profile, m.cmsInfoDescription ?? 0, 'en', 'US') || '',
    /** `rgb`: 3 bytes per pixel. Returns 4 bytes per pixel, 255 = full ink (DeviceCMYK as a PDF image wants it). */
    toCmyk(rgb, pixels) { return lcms.cmsDoTransform(toCmykT, rgb, pixels) },
    /** CMYK 8-bit back to sRGB 8-bit, for the soft proof. */
    toSrgb(cmyk, pixels) {
      toRgbT ??= make(profile, m.TYPE_CMYK_8, srgb, m.TYPE_RGB_8)
      return lcms.cmsDoTransform(toRgbT, cmyk, pixels)
    },
    close() {
      if (closed.v) return
      closed.v = true
      lcms.cmsDeleteTransform(toCmykT)
      if (toRgbT) lcms.cmsDeleteTransform(toRgbT)
      lcms.cmsCloseProfile(profile); lcms.cmsCloseProfile(srgb)
    }
  }
}

/** Convert a whole RGB image in strips of rows (the WebAssembly heap grows with what it is given). */
export function convertImage(converter, rgb, width, height, stripRows = 128) {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += stripRows) {
    const rows = Math.min(stripRows, height - y)
    const part = converter.toCmyk(rgb.subarray(y * width * 3, (y + rows) * width * 3), width * rows)
    out.set(part, y * width * 4)
  }
  return out
}

export function proofImage(converter, cmyk, width, height, stripRows = 128) {
  const out = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += stripRows) {
    const rows = Math.min(stripRows, height - y)
    out.set(converter.toSrgb(cmyk.subarray(y * width * 4, (y + rows) * width * 4), width * rows), y * width * 3)
  }
  return out
}

// ---------------------------------------------------------------------------
// Measurements and corrections on CMYK pixels (255 = 100 %)
// ---------------------------------------------------------------------------

/** The highest total ink in the image, in percent (the sum of the four plates), and how many pixels are above `limitPct`. */
export function inkStats(cmyk, limitPct = Infinity) {
  let max = 0, over = 0
  const limit = limitPct / 100 * 255
  for (let i = 0; i < cmyk.length; i += 4) {
    const s = cmyk[i] + cmyk[i + 1] + cmyk[i + 2] + cmyk[i + 3]
    if (s > max) max = s
    if (s > limit) over++
  }
  return { maxPct: Math.round(max / 255 * 1000) / 10, over, pixels: cmyk.length / 4 }
}

/**
 * Bring every pixel down to the ink limit: the cyan, magenta and yellow plates are scaled together and the black plate is kept
 * (it carries the detail); a black above the limit by itself is cut to it. Changes `cmyk` in place; returns how many pixels changed.
 */
export function limitInk(cmyk, limitPct) {
  const limit = Math.round(limitPct / 100 * 255)
  let changed = 0
  for (let i = 0; i < cmyk.length; i += 4) {
    const c = cmyk[i], m = cmyk[i + 1], y = cmyk[i + 2], k = cmyk[i + 3]
    const sum = c + m + y + k
    if (sum <= limit) continue
    changed++
    if (k >= limit) { cmyk[i] = 0; cmyk[i + 1] = 0; cmyk[i + 2] = 0; cmyk[i + 3] = limit; continue }
    const f = (limit - k) / (c + m + y)
    cmyk[i] = Math.floor(c * f); cmyk[i + 1] = Math.floor(m * f); cmyk[i + 2] = Math.floor(y * f)
  }
  return changed
}

/**
 * Exact ink values for colours the person fixed (print colours, PRD §17.5): every pixel whose screen colour equals one of them is
 * set to its CMYK. Flat areas get exactly the wanted ink; anti-aliased edges keep the profile's conversion.
 * @param {Uint8Array} rgb the source pixels (3 per pixel)
 * @param {Uint8Array} cmyk converted pixels, changed in place
 * @param {{ rgb: number[], cmyk: number[] }[]} colors cmyk in percent
 * @returns {number} pixels set
 */
export function applyPrintColors(rgb, cmyk, colors) {
  if (!colors.length) return 0
  const map = new Map(colors.map(c => [(c.rgb[0] << 16) | (c.rgb[1] << 8) | c.rgb[2], c.cmyk.map(v => Math.round(Math.min(100, Math.max(0, v)) * 2.55))]))
  let n = 0
  for (let p = 0, q = 0; p < rgb.length; p += 3, q += 4) {
    const hit = map.get((rgb[p] << 16) | (rgb[p + 1] << 8) | rgb[p + 2])
    if (hit) { cmyk[q] = hit[0]; cmyk[q + 1] = hit[1]; cmyk[q + 2] = hit[2]; cmyk[q + 3] = hit[3]; n++ }
  }
  return n
}

/**
 * Pixels the press cannot reproduce: the converted colour, shown again in sRGB, is far from the wanted one. A guide for the
 * soft proof, not a calibrated measurement.
 * @returns {{ count: number, mask: Uint8Array }} mask: 1 per pixel that is out of range
 */
export function outOfGamut(rgb, proof, threshold = 28) {
  const mask = new Uint8Array(rgb.length / 3)
  let count = 0
  for (let p = 0, q = 0; p < rgb.length; p += 3, q++) {
    const d = Math.max(Math.abs(rgb[p] - proof[p]), Math.abs(rgb[p + 1] - proof[p + 1]), Math.abs(rgb[p + 2] - proof[p + 2]))
    if (d > threshold) { mask[q] = 1; count++ }
  }
  return { count, mask }
}

/** How many pixels have exactly this screen colour. */
export function countColor(rgb, [r, g, b]) {
  let n = 0
  for (let p = 0; p < rgb.length; p += 3) if (rgb[p] === r && rgb[p + 1] === g && rgb[p + 2] === b) n++
  return n
}
