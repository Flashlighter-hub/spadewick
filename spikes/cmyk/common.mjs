// Shared pieces of spike B: the colour patches, Delta E 2000, and a small wrapper around lcms-wasm.
import { readFileSync } from 'fs'
import { instantiate, TYPE_RGB_8, TYPE_CMYK_8, TYPE_Lab_16, INTENT_PERCEPTUAL, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION } from 'lcms-wasm'

export const PROFILES = {
  isocoated: { file: 'profiles/ISOcoated_v2_eci.icc', name: 'ISO Coated v2 (ECI), FOGRA39' },
  crpc1: { file: 'profiles/CGATS21_CRPC1.icc', name: 'CGATS21_CRPC1 (US sheet-fed, SWOP/GRACoL class)' }
}

export const COMBOS = [
  { id: 'perceptual', intent: INTENT_PERCEPTUAL, bpc: false },
  { id: 'perceptual+bpc', intent: INTENT_PERCEPTUAL, bpc: true },
  { id: 'relative', intent: INTENT_RELATIVE_COLORIMETRIC, bpc: false },
  { id: 'relative+bpc', intent: INTENT_RELATIVE_COLORIMETRIC, bpc: true }
]

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

/** Known colours: neutrals, primaries and secondaries, skin tones, pastels, dark and saturated colours (some outside any press gamut). */
export const PATCHES = [
  ['white', '#ffffff'], ['grey 5%', '#f2f2f2'], ['grey 10%', '#e6e6e6'], ['grey 25%', '#bfbfbf'], ['grey 50%', '#808080'], ['grey 75%', '#404040'], ['grey 90%', '#1a1a1a'], ['black', '#000000'],
  ['red', '#ff0000'], ['green', '#00ff00'], ['blue', '#0000ff'], ['cyan', '#00ffff'], ['magenta', '#ff00ff'], ['yellow', '#ffff00'],
  ['dark red', '#800000'], ['dark green', '#006400'], ['navy', '#000080'], ['teal', '#008080'], ['purple', '#800080'], ['olive', '#808000'],
  ['orange', '#ff8000'], ['pink', '#ffc0cb'], ['light blue', '#add8e6'], ['sky', '#87ceeb'], ['lime', '#a0d830'], ['brown', '#8b4513'],
  ['skin light', '#f1c27d'], ['skin mid', '#c68642'], ['skin dark', '#8d5524'], ['paper cream', '#f4ebd0'], ['parchment', '#e8d9b0'],
  ['card blue', '#223355'], ['card red', '#cc3333'], ['gold', '#d4af37'], ['forest', '#2e5e3e'], ['wine', '#5e1a2c'], ['steel', '#4682b4'],
  ['rgb 10,20,30', '#0a141e'], ['rgb 240,250,255', '#f0faff'], ['rgb 255,128,0', '#ff8000']
].map(([name, h]) => ({ name, rgb: hex(h) }))

// ---- Delta E 2000 ----
const rad = d => d * Math.PI / 180
export function deltaE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2)
  const hp = (b, a) => { if (!b && !a) return 0; const h = Math.atan2(b, a) * 180 / Math.PI; return h < 0 ? h + 360 : h }
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2)
  const dLp = L2 - L1, dCp = Cp2 - Cp1
  let dhp = 0
  if (Cp1 * Cp2) { dhp = hp2 - hp1; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360 }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dhp / 2))
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2
  let hpm = hp1 + hp2
  if (Cp1 * Cp2) { hpm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2 } else hpm = hp1 + hp2
  const T = 1 - 0.17 * Math.cos(rad(hpm - 30)) + 0.24 * Math.cos(rad(2 * hpm)) + 0.32 * Math.cos(rad(3 * hpm + 6)) - 0.2 * Math.cos(rad(4 * hpm - 63))
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
  const Sl = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2)
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

// ---- sRGB to Lab (D50), computed here and not by any colour library: the reference for "what colour should this be" ----
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]]
const BRADFORD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]]
const mul = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
const D65 = [0.95047, 1, 1.08883], D50 = [0.96422, 1, 0.82521]
export function srgbToLabD50([r, g, b]) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const xyz = [0.4124564 * R + 0.3575761 * G + 0.1804375 * B, 0.2126729 * R + 0.7151522 * G + 0.072175 * B, 0.0193339 * R + 0.119192 * G + 0.9503041 * B]
  const s = mul(BRADFORD, D65), d = mul(BRADFORD, D50)
  const adapted = mul(BRADFORD_INV, mul(BRADFORD, xyz).map((v, i) => v * d[i] / s[i]))
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const [fx, fy, fz] = adapted.map((v, i) => f(v / D50[i]))
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

// ---- lcms-wasm ----
export async function openLcms() {
  const lcms = await instantiate()
  const profiles = {}
  const open = path => {
    const buf = new Uint8Array(readFileSync(path))
    const h = lcms.cmsOpenProfileFromMem(buf, buf.length)
    if (!h) throw new Error(`cannot open ${path}`)
    return h
  }
  const srgb = lcms.cmsCreate_sRGBProfile()
  const lab = lcms.cmsCreateLab4Profile()
  for (const [id, p] of Object.entries(PROFILES)) profiles[id] = open(new URL(p.file, import.meta.url))
  return { lcms, srgb, lab, profiles, open }
}

/** RGB (flat array, 3 per pixel) to CMYK 8-bit with a profile, intent and black point compensation. */
export function toCmyk(ctx, rgb, profileId, combo) {
  const { lcms } = ctx
  const t = lcms.cmsCreateTransform(ctx.srgb, TYPE_RGB_8, ctx.profiles[profileId], TYPE_CMYK_8, combo.intent, combo.bpc ? cmsFLAGS_BLACKPOINTCOMPENSATION : 0)
  if (!t) throw new Error('no transform')
  try { return lcms.cmsDoTransform(t, rgb, rgb.length / 3) } finally { lcms.cmsDeleteTransform(t) }
}

/** CMYK 8-bit back to Lab (what the printed colour would be) with the same intent and BPC, as floats. */
export function cmykToLab(ctx, cmyk, profileId, combo) {
  const { lcms } = ctx
  const t = lcms.cmsCreateTransform(ctx.profiles[profileId], TYPE_CMYK_8, ctx.lab, TYPE_Lab_16, combo.intent, combo.bpc ? cmsFLAGS_BLACKPOINTCOMPENSATION : 0)
  if (!t) throw new Error('no proof transform')
  try {
    const out = lcms.cmsDoTransform(t, cmyk, cmyk.length / 4)
    const labs = []
    for (let i = 0; i < out.length; i += 3) labs.push([out[i] / 65535 * 100, out[i + 1] / 65535 * 255 - 128, out[i + 2] / 65535 * 255 - 128])
    return labs
  } finally { lcms.cmsDeleteTransform(t) }
}

export const flatRgb = patches => Uint8Array.from(patches.flatMap(p => p.rgb))
export const stats = xs => ({ max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length })
