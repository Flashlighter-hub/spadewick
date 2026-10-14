// Spike B, part 1: converting colours to a CMYK ICC profile. Run: node spikes/cmyk/run.mjs (from the project folder)
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import sharp from 'sharp'
import { PROFILES, COMBOS, PATCHES, flatRgb, openLcms, toCmyk, cmykToLab, deltaE2000, srgbToLabD50, stats } from './common.mjs'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(here)
mkdirSync('out', { recursive: true })
const ctx = await openLcms()
const rgb = flatRgb(PATCHES)
const results = { lcmsVersion: null, combos: {}, sharp: {}, timing: {}, sanity: {}, intents: {} }
const pct = v => Math.round(v / 255 * 1000) / 10

// ---- 1. The same conversion with a second engine ----
const ref = join('out', 'pillow.json')
writeFileSync(join('out', 'spec.json'), JSON.stringify({ rgb: [...rgb], profiles: Object.fromEntries(Object.entries(PROFILES).map(([k, v]) => [k, v.file])), combos: COMBOS.map(c => ({ id: c.id, intent: c.intent, bpc: c.bpc })) }))
execFileSync('python', ['ref.py', 'out/spec.json', ref], { stdio: 'inherit' })
const pillow = JSON.parse(readFileSync(ref, 'utf8'))
results.referenceEngine = pillow._versions

const converted = {}
for (const pid of Object.keys(PROFILES)) {
  for (const combo of COMBOS) {
    const key = `${pid}|${combo.id}`
    const mine = toCmyk(ctx, rgb, pid, combo)
    converted[key] = mine
    const theirs = Uint8Array.from(pillow[key])
    // Delta E 2000 between what the two results would print as, and the largest difference of any ink in 8-bit steps
    const labMine = cmykToLab(ctx, mine, pid, combo), labTheirs = cmykToLab(ctx, theirs, pid, combo)
    const de = labMine.map((l, i) => deltaE2000(l, labTheirs[i]))
    let maxStep = 0
    for (let i = 0; i < mine.length; i++) maxStep = Math.max(maxStep, Math.abs(mine[i] - theirs[i]))
    // Round trip against the colour computed here from sRGB (no library): how far the printed colour is from the wanted one
    const want = PATCHES.map(p => srgbToLabD50(p.rgb))
    const trip = labMine.map((l, i) => deltaE2000(l, want[i]))
    results.combos[key] = { engines: stats(de), maxInkStep: maxStep, roundTrip: stats(trip), roundTripByPatch: PATCHES.map((p, i) => [p.name, Math.round(trip[i] * 100) / 100]) }
  }
}

// ---- 2. Sanity of the numbers (relative colorimetric with black point compensation, the usual press choice) ----
for (const pid of Object.keys(PROFILES)) {
  const cm = converted[`${pid}|relative+bpc`]
  const at = name => { const i = PATCHES.findIndex(p => p.name === name); return [...cm.slice(i * 4, i * 4 + 4)].map(pct) }
  const tic = name => at(name).reduce((a, b) => a + b, 0)
  const all = PATCHES.map(p => tic(p.name))
  results.sanity[pid] = {
    white: at('white'), black: at('black'), grey50: at('grey 50%'), red: at('red'), yellow: at('yellow'),
    maxTotalInk: Math.max(...all), maxTotalInkPatch: PATCHES[all.indexOf(Math.max(...all))].name,
    greyRamp: ['grey 5%', 'grey 10%', 'grey 25%', 'grey 50%', 'grey 75%', 'grey 90%', 'black'].map(n => [n, at(n)])
  }
}

// ---- 3. Do the intent and the black point compensation do anything? (they must, and in the expected direction) ----
for (const pid of Object.keys(PROFILES)) {
  const diff = (a, b) => {
    const A = converted[`${pid}|${a}`], B = converted[`${pid}|${b}`]
    const lab = cmykToLab(ctx, A, pid, COMBOS[2]), lab2 = cmykToLab(ctx, B, pid, COMBOS[2])
    return stats(lab.map((l, i) => deltaE2000(l, lab2[i])))
  }
  const i = n => PATCHES.findIndex(p => p.name === n)
  const k = (combo, n) => converted[`${pid}|${combo}`][i(n) * 4 + 3]
  results.intents[pid] = {
    perceptualVsRelative: diff('perceptual', 'relative'), bpcOnVsOff_relative: diff('relative', 'relative+bpc'),
    blackK: { relative: pct(k('relative', 'black')), 'relative+bpc': pct(k('relative+bpc', 'black')), perceptual: pct(k('perceptual', 'black')) }
  }
}

// ---- 4. What sharp (libvips with Little CMS) can do with the same profiles ----
const png = await sharp(Buffer.from(rgb), { raw: { width: PATCHES.length, height: 1, channels: 3 } }).png().toBuffer()
for (const pid of Object.keys(PROFILES)) {
  const r = { };
  try {
    const { data, info } = await sharp(png).withIccProfile(PROFILES[pid].file, { attach: false }).toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true })
    r.channels = info.channels; r.space = info.space
    if (info.channels === 4) {
      const theirs = Uint8Array.from(data)
      const mine = converted[`${pid}|perceptual`]
      const lab1 = cmykToLab(ctx, mine, pid, COMBOS[0]), lab2 = cmykToLab(ctx, theirs, pid, COMBOS[0])
      r.vsLcmsPerceptual = stats(lab1.map((l, i) => deltaE2000(l, lab2[i])))
      const lab3 = cmykToLab(ctx, converted[`${pid}|relative`], pid, COMBOS[2]), lab4 = cmykToLab(ctx, theirs, pid, COMBOS[2])
      r.vsLcmsRelative = stats(lab3.map((l, i) => deltaE2000(l, lab4[i])))
    }
  } catch (err) { r.error = String(err.message).slice(0, 200) }
  results.sharp[pid] = r
}
const src = readFileSync(join('..', '..', 'node_modules', 'sharp', 'dist', 'output.cjs'), 'utf8')
results.sharp.optionsSeenInSource = { renderingIntentOption: /renderingIntent|intent/i.test(src.slice(src.indexOf('function withIccProfile'), src.indexOf('function withIccProfile') + 1800)), blackPointOption: /black.?point/i.test(src.slice(src.indexOf('function withIccProfile'), src.indexOf('function withIccProfile') + 1800)) }

// ---- 5. Speed of converting a card image (the preview, the export at 300 dpi, a large one at 600 dpi) ----
for (const [label, w, h] of [['poker 300 dpi 750x1050', 750, 1050], ['poker 600 dpi 1500x2100', 1500, 2100]]) {
  const px = new Uint8Array(w * h * 3)
  for (let i = 0; i < px.length; i++) px[i] = (i * 7 + (i >> 8)) & 255
  const t0 = performance.now()
  const out = toCmyk(ctx, px, 'isocoated', COMBOS[3])
  results.timing[label] = { ms: Math.round(performance.now() - t0), megapixels: Math.round(w * h / 1e5) / 10, outBytes: out.length }
}

writeFileSync(join('out', 'results.json'), JSON.stringify(results, null, 1))
console.log(JSON.stringify({ ...results, combos: Object.fromEntries(Object.entries(results.combos).map(([k, v]) => [k, { engines: v.engines, maxInkStep: v.maxInkStep, roundTrip: v.roundTrip }])) }, null, 1))
