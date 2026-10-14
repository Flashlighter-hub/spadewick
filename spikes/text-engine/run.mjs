// Spike A (PRD §24.3): can WebAssembly/JS shaping + font outlines + the current rasterizer (resvg) lay out and
// draw a card's text with icons, so that measured = drawn, within the 200 ms re-render target?
//
//   node spikes/text-engine/run.mjs            -> prints a report, writes out/*.png and out/results.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Resvg } from '@resvg/resvg-js'
import { createHbFont } from './shaper-hb.mjs'
// fontkit was dropped after the spike (REPORT.md); its adapter still runs when the package is installed again
let createFkFont = null
try { ({ createFkFont } = await import('./shaper-fk.mjs')) } catch { /* not installed */ }
import { FONTS, allFontFiles } from './fonts.mjs'
import { layoutParagraph, fitParagraph, createShapeCache } from './layout.mjs'
import { paragraphToSvg, svgDoc, rasterize, inkBox, diffRatio } from './render.mjs'
import { measureWidth as estimateWidth } from '../../src/main/dynamicText.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })

// Non-Latin sample text, written as escapes so no editor or console encoding can alter it
const AR = 'مرحبا بالعالم'            // "hello world"
const AR2 = 'قوة الماء'                                    // "power of water"
const HE = 'שלום עולם'                                      // "hello world"
const HE2 = 'כוח המים'                                           // "power of water"
const MIXED = `Hello ${HE.split(' ')[0]} world ${AR.split(' ')[0]} 123`
const CHAIN = ['lato', 'arabic', 'hebrew', 'liberation']
const FAMILIES = 'Lato, Noto Sans Arabic, Noto Sans Hebrew, Liberation Sans'

const results = { engines: {} }
const fails = []
const check = (engine, name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) fails.push(`${engine}: ${name} ${detail}`)
  return ok
}
const ms = n => Math.round(n * 10) / 10
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

function loadFonts(make) {
  const t0 = performance.now()
  const fonts = {}
  for (const [id, f] of Object.entries(FONTS)) fonts[id] = make(f.file)
  return { fonts, ms: performance.now() - t0 }
}

/** Where the engine says the ink of a laid-out paragraph is (from glyph extents), in card pixels. */
function predictedInk(para, fonts, ox, oy) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const line of para.lines) for (const it of line.items) {
    if (it.kind === 'icon') { x0 = Math.min(x0, ox + it.x); x1 = Math.max(x1, ox + it.x + it.w); y0 = Math.min(y0, oy + it.y); y1 = Math.max(y1, oy + it.y + it.h); continue }
    for (const g of it.glyphs) {
      const e = fonts[it.font].extents(g.gid)
      if (!e) continue
      const gx = ox + line.x + it.x + g.x * it.k
      x0 = Math.min(x0, gx + e.x0 * it.k); x1 = Math.max(x1, gx + e.x1 * it.k)
      y0 = Math.min(y0, oy + line.baseline - (e.y1 + g.y) * it.k); y1 = Math.max(y1, oy + line.baseline - (e.y0 + g.y) * it.k)
    }
  }
  return { x0, y0, x1, y1 }
}

function runEngine(label, make) {
  console.log(`\n=== ${label} ===`)
  const R = results.engines[label] = {}
  const { fonts, ms: loadMs } = loadFonts(make)
  R.fontLoadMs = ms(loadMs)
  console.log(`  fonts loaded: ${R.fontLoadMs} ms`)
  const files = allFontFiles()

  // ---- 1. Shaping features ---------------------------------------------------------------------------------
  console.log(' 1. Shaping features')
  const lato = fonts.lato
  const w = (f, s, feats) => f.shape(s, false, feats).reduce((a, g) => a + g.ax, 0)
  const av = w(lato, 'AV'), nom = w(lato, 'A') + w(lato, 'V')
  check(label, 'kerning: "AV" is tighter than A+V', av < nom - 1, `AV=${av} A+V=${nom} units`)
  check(label, 'kerning off restores the plain advance', Math.abs(w(lato, 'AV', ['-kern']) - nom) < 1)
  const g = fonts.garamond
  const lig = g.shape('office', false), noLig = g.shape('office', false, ['-liga'])
  check(label, 'ligatures: "office" uses fewer glyphs than letters', lig.length < noLig.length, `${lig.length} vs ${noLig.length}`)
  const ar = fonts.arabic.shape(AR2.split(' ')[0], true)
  const nominalIds = [...AR2.split(' ')[0]].map(ch => fonts.arabic.shape(ch, true)[0].gid)
  const joined = ar.filter(gl => !nominalIds.includes(gl.gid)).length
  check(label, 'Arabic: letters take their joined (contextual) forms', joined >= 2, `${joined} of ${ar.length} glyphs differ from the isolated forms`)
  const he = fonts.hebrew.shape(HE.split(' ')[0], true)
  check(label, 'Hebrew: every letter has a glyph', he.length === 4 && he.every(x => x.gid !== 0))

  // ---- 2. Measured width vs the rasterizer's own text shaping ----------------------------------------------
  console.log(' 2. Measured vs drawn (single lines at 40 px; "<text>" = what the app draws today)')
  const cases = [
    { name: 'Latin kerning', text: 'AVATAR To Wa Yo', font: 'lato' },
    { name: 'Latin bold', text: 'Wavering Tower', font: 'latoBold' },
    { name: 'Ligatures (Garamond)', text: 'office affluent fifty flow', font: 'garamond' },
    { name: 'Arabic', text: AR, font: 'arabic' },
    { name: 'Hebrew', text: HE, font: 'hebrew' },
    { name: 'Mixed LTR/RTL + fallback', text: MIXED, font: 'lato',
      // resvg draws nothing at all for an Arabic <tspan> inside Latin text, so the independent picture is built
      // item by item: each word in its own font as a plain <text>, placed where the engine put it
      perItem: true }
  ]
  R.cases = []
  for (const c of cases) {
    const spans = [{ text: c.text, font: c.font, size: 40, color: '#000000' }]
    const para = layoutParagraph(spans, fonts, { chain: CHAIN, align: 'left' })
    const ox = 20, oy = 20
    const defs = new Map()
    const mine = rasterize(svgDoc(900, 90, defs, paragraphToSvg(para, fonts, ox, oy, defs)), files, 900)
    const f = FONTS[c.font]
    const family = c.font === 'lato' ? FAMILIES : `${f.family}, ${FAMILIES}`
    const tx = c.perItem
      ? para.lines[0].items.map(it => `<text x="${ox + para.lines[0].x + it.x}" y="${oy + para.lines[0].baseline}" font-family="${FONTS[it.font].family}" font-size="40" fill="#000">${it.text}</text>`).join('')
      : `<text x="${ox}" y="${oy + para.lines[0].baseline}" font-family="${family}" font-size="40" font-weight="${f.weight ?? 400}" fill="#000">${c.text}</text>`
    const theirs = rasterize(svgDoc(900, 90, new Map(), tx), files, 900)
    const a = inkBox(mine), b = inkBox(theirs), p = predictedInk(para, fonts, ox, oy)
    const selfErr = Math.max(Math.abs(p.x0 - a.x0), Math.abs(p.x1 - a.x1), Math.abs(p.y0 - a.y0), Math.abs(p.y1 - a.y1))
    const dW = (a.x1 - a.x0) - (b.x1 - b.x0), dx0 = a.x0 - b.x0
    const diff = diffRatio(mine, theirs)
    const est = estimateWidth(c.text, 40, c.font === 'latoBold')
    R.cases.push({ name: c.name, laidOutWidth: ms(para.width), inkWidth: a.x1 - a.x0, resvgTextInkWidth: b.x1 - b.x0, selfErr: ms(selfErr), dW, diff: Math.round(diff * 1000) / 1000, estimatorWidth: ms(est) })
    check(label, `${c.name}: laid-out ink box equals the drawn pixels (±1.5 px)`, selfErr <= 1.5, `max error ${ms(selfErr)} px`)
    check(label, `${c.name}: same ink width as the rasterizer's own text (±2 px)`, Math.abs(dW) <= 2 && Math.abs(dx0) <= 2, `dWidth=${dW}px dLeft=${dx0}px, differing pixels ${(diff * 100).toFixed(1)}%`)
    console.log(`        engine width ${ms(para.width)} px | old per-character estimate ${ms(est)} px (${ms((est / para.width - 1) * 100)}% off)`)
    if (c.name === 'Mixed LTR/RTL + fallback') check(label, 'no missing-glyph boxes after fallback', para.missing.length === 0, JSON.stringify(para.missing))
  }

  // ---- 3. Icons and wrapping invariants ---------------------------------------------------------------------
  console.log(' 3. Icons and line breaking')
  const iconSpans = size => [
    { text: 'Deal 3 damage ', font: 'lato', size, color: '#000' }, { icon: 'fire', size, color: '#c33' }, { text: '. Then tap ', font: 'lato', size, color: '#000' },
    { icon: 'tap', size, color: '#000' }, { text: ' and gain ', font: 'lato', size, color: '#000' }, { icon: 'star', size, scale: 1.4, color: '#c90' }, { text: ', draw two cards.', font: 'lato', size, color: '#000' }
  ]
  let badStart = 0, overflowLines = 0, iconsSplit = 0, layouts = 0
  for (let bw = 60; bw <= 400; bw++) {
    const p = layoutParagraph(iconSpans(20), fonts, { width: bw, chain: CHAIN })
    layouts++
    for (const line of p.lines) {
      const first = line.items[0]
      if (first?.kind === 'glyphs' && /^[.,;:!?]/.test(first.text)) badStart++ // punctuation left alone at a line start
      if (line.width > bw + 0.01 && line.items.length > 1) overflowLines++
    }
    const n = p.lines.reduce((s, l) => s + l.items.filter(i => i.kind === 'icon').length, 0)
    if (n !== 3) iconsSplit++
  }
  check(label, `punctuation never starts a line after an icon (${layouts} widths)`, badStart === 0, `${badStart} violations`)
  check(label, 'no line is wider than its box unless a single unbreakable word', overflowLines === 0, `${overflowLines} violations`)
  check(label, 'every icon is drawn exactly once at every width', iconsSplit === 0)
  const big = layoutParagraph(iconSpans(40), fonts, { width: 300, chain: CHAIN })
  const small = layoutParagraph(iconSpans(20), fonts, { width: 150, chain: CHAIN })
  const ic = p => p.lines.flatMap(l => l.items).filter(i => i.kind === 'icon')
  check(label, 'icon size follows the text size (and its own scale)', Math.abs(ic(big)[0].w - 40) < 1e-6 && Math.abs(ic(small)[0].w - 20) < 1e-6 && Math.abs(ic(big)[2].w - 56) < 1e-6, `${ic(big)[0].w}/${ic(small)[0].w}/${ic(big)[2].w}`)
  const fit = fitParagraph(iconSpans(30), fonts, { width: 220, chain: CHAIN }, { boxHeight: 90, max: 30, min: 8, step: 0.5 })
  check(label, 'shrink-to-fit: result fits, never below the minimum', fit.fits && fit.height <= 90 + 1e-6 && fit.size >= 8, `size ${fit.size}, height ${ms(fit.height)}`)
  check(label, 'shrink-to-fit: icons shrank with the text', Math.abs(ic(fit)[0].w - fit.size) < 1e-6, `icon ${ms(ic(fit)[0].w)} at text ${fit.size}`)
  const rtlP = layoutParagraph([{ text: AR2.split(' ')[0] + ' ', font: 'arabic', size: 30, color: '#000' }, { icon: 'star', size: 30, color: '#000' }, { text: ' ' + AR2.split(' ')[1], font: 'arabic', size: 30, color: '#000' }], fonts, { width: 400, rtl: true, chain: CHAIN })
  const items = rtlP.lines[0].items
  const iconAt = items.findIndex(i => i.kind === 'icon')
  check(label, 'RTL paragraph: aligned to the right, icon placed between the two words', Math.abs(rtlP.lines[0].x + rtlP.lines[0].width - 400) < 0.01 && iconAt === 1, `order ${items.map(i => i.kind === 'icon' ? 'icon' : 'text').join(',')}`)

  // ---- 4. The fixture card ---------------------------------------------------------------------------------
  console.log(' 4. Fixture card and re-render time')
  const W = 750, H = 1050
  const T = (text, font = 'lato', size = 30, color = '#1b1b1b') => ({ text, font, size, color })
  const I = (icon, size = 30, color = '#1b1b1b', scale) => ({ icon, size, color, scale })
  function buildCard(rulesTail, cache) {
    const opts = { chain: CHAIN, cache }
    const paras = []
    const add = (id, spans, ox, oy, o, fitO) => {
      const p = fitO ? fitParagraph(spans, fonts, { ...opts, ...o }, fitO) : layoutParagraph(spans, fonts, { ...opts, ...o })
      paras.push({ id, p, ox, oy }); return p
    }
    add('title', [T('AVATAR of the Wave', 'latoBold', 58, '#10243f')], 55, 55, { width: 640, align: 'left' }, { boxHeight: 70, max: 58, min: 30 })
    add('type', [T('Creature — Water Spirit', 'lato', 30, '#335')], 55, 640, { width: 640 })
    add('rules', [
      I('tap'), T(', '), I('fire', 30, '#c33'), T(': Draw a card. '), T('Flying', 'latoBold'), T(' (This creature can be blocked only by creatures with flying.)\nWhen it enters, an efficient officer gains '),
      I('shield', 30, '#2a6', 1.15), T(' and fifty cards affluent in water. '), T(rulesTail), I('star', 30, '#c90', 1.3), T('.')
    ], 55, 700, { width: 640, lineHeight: 1.25 }, { boxHeight: 250, max: 30, min: 14 })
    add('flavor', [T('“A difficult affluent officer, fifty fluffy ffi.” — Captain', 'garamond', 26, '#444')], 55, 925, { width: 470 })
    add('ar', [{ text: AR2, font: 'arabic', size: 34, color: '#1b1b1b' }], 55, 150, { width: 640, rtl: true })
    add('he', [{ text: HE2, font: 'hebrew', size: 34, color: '#1b1b1b' }], 55, 215, { width: 640, rtl: true })
    add('mixed', [T(`Power ${HE.split(' ')[0]} 5 ${AR.split(' ')[0]} `), I('star', 30, '#c90')], 55, 280, { width: 640 })
    add('stats', [T('3 / 7', 'latoBold', 44, '#10243f')], 520, 940, { width: 175, align: 'right' })
    return paras
  }
  function draw(paras) {
    const defs = new Map()
    let body = '<rect x="30" y="30" width="690" height="990" rx="28" fill="#f4ecd8" stroke="#10243f" stroke-width="6"/>'
    for (const q of paras) body += paragraphToSvg(q.p, fonts, q.ox, q.oy, defs)
    return svgDoc(W, H, defs, body, '#ffffff')
  }
  // Baseline: the same lines drawn as <text> elements (what the rasterizer does today), only for its render cost
  function drawAsText(paras) {
    let body = '<rect x="30" y="30" width="690" height="990" rx="28" fill="#f4ecd8" stroke="#10243f" stroke-width="6"/>'
    for (const q of paras) for (const line of q.p.lines) for (const it of line.items) {
      if (it.kind !== 'glyphs') continue
      const f = FONTS[it.font]
      body += `<text x="${q.ox + line.x + it.x}" y="${q.oy + line.baseline}" font-family="${f.family}" font-size="${it.size}" font-weight="${f.weight ?? 400}" fill="${it.color}">${it.text}</text>`
    }
    return svgDoc(W, H, new Map(), body, '#ffffff')
  }

  const tail = 'Then draw two cards. '
  // cold: first ever render for this engine (fonts already loaded above)
  let t0 = performance.now()
  const first = buildCard(tail, createShapeCache())
  const firstSvg = draw(first)
  const firstImg = rasterize(firstSvg, files, W)
  R.firstRenderMs = ms(performance.now() - t0)
  writeFileSync(join(outDir, `card-${label}.png`), firstImg.png)
  writeFileSync(join(outDir, `card-${label}.svg`), firstSvg)
  console.log(`  first render (cold): ${R.firstRenderMs} ms; SVG ${(firstSvg.length / 1024).toFixed(0)} KB, ${new Set(firstSvg.match(/id="[^"]+"/g)).size} distinct glyph shapes`)
  check(label, 'fixture card: no missing glyphs in any paragraph', first.every(q => q.p.missing.length === 0))
  const rules = first.find(q => q.id === 'rules').p
  check(label, 'fixture card: rules text fits its box after shrink', rules.height <= 250 + 1e-6, `${ms(rules.height)} of 250 px`)

  const N = 40
  const full = [], edit = [], parts = { layout: [], svg: [], render: [], png: [] }
  const cache = createShapeCache()
  buildCard(tail, cache) // warm cache for the "edit one field" scenario
  for (let i = 0; i < N; i++) {
    // (a) everything new: fresh shape cache
    let a = performance.now()
    const p1 = buildCard(tail + i, createShapeCache()); const s1 = draw(p1); rasterize(s1, files, W)
    full.push(performance.now() - a)
    // (b) the user edits the rules text: other paragraphs come from the shape cache; stages timed
    a = performance.now()
    const p2 = buildCard(tail + 'x'.repeat(1 + (i % 7)) + i, cache)
    let b = performance.now(); parts.layout.push(b - a)
    const s2 = draw(p2); a = performance.now(); parts.svg.push(a - b)
    const resvg = new Resvg(s2, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false, fontFiles: files } })
    const img = resvg.render(); b = performance.now(); parts.render.push(b - a)
    img.asPng(); a = performance.now(); parts.png.push(a - b)
    edit.push(parts.layout.at(-1) + parts.svg.at(-1) + parts.render.at(-1) + parts.png.at(-1))
  }
  const textSvg = drawAsText(first)
  const base = []
  for (let i = 0; i < N; i++) { const a = performance.now(); new Resvg(textSvg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false, fontFiles: files } }).render().asPng(); base.push(performance.now() - a) }
  R.timing = {
    editP50: ms(pct(edit, .5)), editP95: ms(pct(edit, .95)), fullP50: ms(pct(full, .5)), fullP95: ms(pct(full, .95)),
    layoutP50: ms(pct(parts.layout, .5)), svgP50: ms(pct(parts.svg, .5)), resvgP50: ms(pct(parts.render, .5)), pngP50: ms(pct(parts.png, .5)),
    textBaselineP50: ms(pct(base, .5))
  }
  const t = R.timing
  console.log(`  re-render after an edit (shape cache warm), ${N} runs: p50 ${t.editP50} ms, p95 ${t.editP95} ms`)
  console.log(`      of which layout ${t.layoutP50} | svg build ${t.svgP50} | resvg render ${t.resvgP50} | png encode ${t.pngP50}`)
  console.log(`  re-render with nothing cached, ${N} runs: p50 ${t.fullP50} ms, p95 ${t.fullP95} ms`)
  console.log(`  same card as <text> through resvg (today's route, rasterizing only): p50 ${t.textBaselineP50} ms`)
  check(label, 'single-card re-render < 200 ms (p95, after an edit)', t.editP95 < 200, `${t.editP95} ms`)
  check(label, 'single-card re-render < 200 ms (p95, nothing cached)', t.fullP95 < 200, `${t.fullP95} ms`)
  return fonts
}

const hbT0 = performance.now()
const hbFonts = runEngine('harfbuzzjs', createHbFont)
const fkFonts = createFkFont ? runEngine('fontkit', createFkFont) : null

// ---- 5. Do the two shapers agree? ---------------------------------------------------------------------------
if (fkFonts) console.log('\n=== harfbuzzjs vs fontkit: advance widths of the same strings (font units, 1000/em) ===')
let worst = 0
for (const [font, text] of (fkFonts ? [['lato', 'AVATAR To Wa Yo'], ['garamond', 'office affluent fifty flow'], ['arabic', AR], ['hebrew', HE], ['latoBold', 'Wavering Tower']] : [])) {
  const a = hbFonts[font].shape(text, font === 'arabic' || font === 'hebrew').reduce((s, g) => s + g.ax, 0)
  const b = fkFonts[font].shape(text, font === 'arabic' || font === 'hebrew').reduce((s, g) => s + g.ax, 0)
  const ga = hbFonts[font].shape(text, font === 'arabic' || font === 'hebrew').length, gb = fkFonts[font].shape(text, font === 'arabic' || font === 'hebrew').length
  worst = Math.max(worst, Math.abs(a - b) / a)
  console.log(`  ${font.padEnd(9)} hb ${a} (${ga} glyphs)   fk ${b} (${gb} glyphs)   diff ${((b - a) / a * 100).toFixed(2)}%`)
  results.engines.agreement = (results.engines.agreement ?? []).concat({ font, hb: a, fk: b, hbGlyphs: ga, fkGlyphs: gb })
}
if (fkFonts) console.log(`  worst difference ${(worst * 100).toFixed(2)}%`)

writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
console.log(`\n${fails.length ? 'FAILED CHECKS (' + fails.length + '):\n  ' + fails.join('\n  ') : 'All checks passed.'}`)
process.exit(fails.length ? 1 : 0)
