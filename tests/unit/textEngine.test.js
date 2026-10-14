/**
 * The text engine (PRD §16.2): fonts, layout, fit modes, and the SVG pass. Runs on the bundled fonts only.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Resvg } from '@resvg/resvg-js'
import { loadHarfBuzz, openFace } from '../../src/main/text/hb.js'
import { createFontSet, parseFamilyList, parseWeight, weightOfStyle, isItalicStyle } from '../../src/main/text/fonts.js'
import { layoutParagraph, layoutFit, sliceSpans, ASCENT } from '../../src/main/text/layout.js'
import { layoutToSvg } from '../../src/main/text/outline.js'
import { convertText, applyOverflow, decodeEntities } from '../../src/main/text/svgText.js'
import { defaultFontFiles } from '../../src/main/fontFiles.js'

const AR = 'مرحبا', AR2 = 'قوة الماء', HE = 'שלום', CJK = '中'

let hb, fonts
const regular = { weight: 400, italic: false }
const chainOf = (families = ['Liberation Sans'], want = regular) => fonts.chain(families, want)
const span = (text, o = {}) => ({ text, chain: chainOf(), size: 20, ...o })
const textOf = l => l.text.slice(0)
const lineTexts = l => l.lines.map(x => l.text.slice(x.start, x.end))

beforeAll(async () => {
  hb = await loadHarfBuzz()
  fonts = createFontSet(hb)
})

describe('choosing fonts', () => {
  it('reads family lists, weights and styles', () => {
    expect(parseFamilyList(`'Cinzel', "Times New Roman", serif`)).toEqual(['Cinzel', 'Times New Roman', 'serif'])
    expect(parseWeight('bold')).toBe(700)
    expect(parseWeight('600')).toBe(600)
    expect(parseWeight('normal')).toBe(400)
    expect(parseWeight('nonsense')).toBe(400)
    expect(weightOfStyle('Bold Italic')).toBe(700)
    expect(weightOfStyle('Regular')).toBe(400)
    expect(isItalicStyle('Bold Italic')).toBe(true)
    expect(isItalicStyle('Regular')).toBe(false)
  })

  it('picks the bold and italic faces, and maps generic families to the bundled ones', () => {
    const file = c => c[0].file.replace(/\\/g, '/').split('/').pop()
    expect(file(chainOf(['Liberation Sans']))).toBe('LiberationSans-Regular.ttf')
    expect(file(chainOf(['Liberation Sans'], { weight: 700, italic: false }))).toBe('LiberationSans-Bold.ttf')
    expect(file(chainOf(['Liberation Sans'], { weight: 700, italic: true }))).toBe('LiberationSans-BoldItalic.ttf')
    expect(file(chainOf(['serif']))).toBe('LiberationSerif-Regular.ttf')
    expect(file(chainOf(['monospace']))).toBe('LiberationMono-Regular.ttf')
    expect(file(chainOf(['No Such Family']))).toBe('LiberationSans-Regular.ttf') // unknown: the default, so text is never invisible
  })

  it('ends every chain with fallbacks for Arabic and Hebrew', () => {
    const files = chainOf(['Liberation Serif']).map(f => f.file.replace(/\\/g, '/').split('/').pop())
    expect(files).toContain('NotoSansArabic-Regular.ttf')
    expect(files).toContain('NotoSansHebrew-Regular.ttf')
  })

  it('ships the fallback fonts to the rasterizer too', () => {
    const names = defaultFontFiles().map(f => f.replace(/\\/g, '/').split('/').pop())
    expect(names).toEqual(expect.arrayContaining(['NotoSansArabic-Regular.ttf', 'NotoSansHebrew-Regular.ttf']))
  })

  it('prefers a project font over a bundled one with the same family, and finds it by its family', () => {
    const db = { prepare: () => ({ all: () => [{ family_name: 'Test Family', style: 'Regular', filename: 'x.ttf' }] }) }
    const set = createFontSet(hb, { projectDir: process.cwd(), db })
    expect(set.hasFamily('Test Family')).toBe(false) // the file is not there: a missing file never becomes a face
    expect(set.hasFamily('Liberation Sans')).toBe(true)
  })
})

describe('shaping', () => {
  it('kerns pairs', () => {
    const f = chainOf()[0]
    const w = (t, feats = []) => f.shape(t, false, feats).reduce((a, g) => a + g.ax, 0)
    expect(w('AV')).toBeLessThan(w('A') + w('V') - 50)
    expect(w('AV', ['-kern'])).toBe(w('A') + w('V'))
  })

  it('applies ligatures when a font has them, and not with letter-spacing', () => {
    const file = 'spikes/text-engine/fonts/EBGaramond-Variable.ttf' // a development fixture, not shipped
    if (!existsSync(file)) return
    const f = openFace(hb, file)
    expect(f.shape('office', false).length).toBeLessThan(f.shape('office', false, ['-liga']).length)
    const lig = layoutParagraph([{ text: 'office', chain: [f], size: 40 }]).width
    const spaced = layoutParagraph([{ text: 'office', chain: [f], size: 40, letterSpacing: 0.001 }]).width
    expect(spaced).toBeGreaterThan(lig)
  })

  it('mirrors brackets in right-to-left text', () => {
    const f = chainOf()[0]
    expect(f.shape('(', true)[0].gid).toBe(f.shape(')', false)[0].gid)
  })

  it('gives every glyph the cluster of its first character', () => {
    const f = chainOf()[0]
    expect(f.shape('abc', false).map(g => g.cluster)).toEqual([0, 1, 2])
  })
})

describe('laying out text', () => {
  it('measures with the font: widths follow the glyphs, not a per-character guess', () => {
    const iii = layoutParagraph([span('iiii')]).width, www = layoutParagraph([span('wwww')]).width
    expect(www).toBeGreaterThan(iii * 2)
    const half = layoutParagraph([span('abc', { size: 10 })]).width, full = layoutParagraph([span('abc', { size: 20 })]).width
    expect(full).toBeCloseTo(half * 2, 5)
  })

  it('shapes whole runs, so kerning across a space counts', () => {
    const f = chainOf()[0]
    const w = t => f.shape(t, false).reduce((a, g) => a + g.ax, 0)
    expect(w('AVATAR To')).toBeLessThan(w('AVATAR') + w(' ') + w('To')) // the pair "space + T" kerns; shaping word by word would lose it
    // and the layout uses the whole-run width: a line of that text is as wide as the run shaped in one piece
    expect(layoutParagraph([span('AVATAR To', { size: 1000 })]).width).toBeCloseTo(w('AVATAR To') * 1000 / f.upem, 3)
  })

  it('never lets a line exceed the box, at any width', () => {
    const spans = [span('The quick brown fox jumps over the lazy dog, and supercalifragilisticexpialidocious goes on and on.')]
    for (let w = 40; w <= 400; w += 7) {
      const l = layoutParagraph(spans, { width: w })
      for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(w + 1e-6)
    }
  })

  it('breaks a word wider than the box by characters, losing none', () => {
    const word = 'Supercalifragilisticexpialidocious'
    const l = layoutParagraph([span(word)], { width: 90 })
    expect(l.lines.length).toBeGreaterThan(1)
    expect(lineTexts(l).join('')).toBe(word)
    for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(90 + 1e-6)
  })

  it('breaks at spaces and newlines, and keeps blank lines', () => {
    const l = layoutParagraph([span('one two\n\nthree')], { width: 1000 })
    expect(lineTexts(l).map(s => s.trim())).toEqual(['one two', '', 'three'])
    expect(l.lines.map(x => x.top)).toEqual([0, 24, 48])
  })

  it('keeps the vertical model: baseline 0.85 below the line top, lines size x lineHeight apart', () => {
    const l = layoutParagraph([span('a\nb', { size: 10 })], { lineHeight: 1.5 })
    expect(l.lines[0].baseline).toBeCloseTo(10 * ASCENT)
    expect(l.lines[1].top).toBeCloseTo(15)
    expect(l.height).toBeCloseTo(30)
  })

  it('does not split no-break spaces', () => {
    const l = layoutParagraph([span('aaaa bbbb cc')], { width: 105 })
    expect(lineTexts(l).map(t => t.trim())).toEqual(['aaaa bbbb', 'cc'])
  })

  it('aligns lines in the box', () => {
    const left = layoutParagraph([span('hi')], { width: 100, align: 'left' }).lines[0].x
    const centre = layoutParagraph([span('hi')], { width: 100, align: 'center' })
    const right = layoutParagraph([span('hi')], { width: 100, align: 'right' })
    expect(left).toBe(0)
    expect(centre.lines[0].x).toBeCloseTo((100 - centre.lines[0].width) / 2)
    expect(right.lines[0].x).toBeCloseTo(100 - right.lines[0].width)
  })

  it('draws the second line of a mixed-size paragraph by its tallest span', () => {
    const l = layoutParagraph([span('small ', { size: 10 }), span('BIG', { size: 30 })])
    expect(l.lines[0].size).toBe(30)
  })
})

describe('right-to-left and mixed scripts', () => {
  const sequence = l => l.lines[0].items.map(i => i.kind)

  it('puts the first word of a right-to-left line on the right', () => {
    const l = layoutParagraph([span(AR2)], { width: 400, align: 'right' })
    const first = l.lines[0].items // visual order: left to right
    expect(first).toHaveLength(2)
    expect(first[0].x).toBeLessThan(first[1].x)
    // the item drawn on the left is the logically second word
    expect(l.lines[0].width).toBeGreaterThan(0)
  })

  it('draws Arabic and Hebrew from the bundled fallback fonts, with no missing glyphs', () => {
    const l = layoutParagraph([span(`Hello ${HE} world ${AR} 123`)], { width: 1000 })
    expect(l.missing).toEqual([])
    const faces = new Set(l.lines[0].items.map(i => i.face.file.replace(/\\/g, '/').split('/').pop()))
    // Liberation has Hebrew itself, so Hebrew is drawn from the requested font; Arabic comes from the bundled fallback
    expect([...faces]).toEqual(expect.arrayContaining(['LiberationSans-Regular.ttf', 'NotoSansArabic-Regular.ttf']))
    expect(sequence(l)).not.toContain('icon')
  })

  it('reorders a mixed line visually: the embedded Arabic word sits between the Latin ones', () => {
    const l = layoutParagraph([span(`one ${AR} two`)], { width: 1000 })
    const items = l.lines[0].items
    const names = items.map(i => i.face.file.replace(/\\/g, '/').split('/').pop().slice(0, 8))
    expect(names).toEqual(['Liberati', 'NotoSans', 'Liberati'])
  })

  it('reports a character that no font has, and keeps going', () => {
    const l = layoutParagraph([span(`a${CJK}b`)])
    expect(l.missing).toEqual([CJK])
  })

  it('takes the paragraph direction from the text, or from the caller', () => {
    const auto = layoutParagraph([span(AR)], { width: 300 })
    const forced = layoutParagraph([span(AR)], { width: 300, rtl: false })
    expect(auto.width).toBeCloseTo(forced.width, 5) // the same glyphs either way for a single run
  })
})

describe('icons', () => {
  const icon = (size = 20, scale) => ({ icon: 'fire', size, scale })

  it('is an unbreakable box of its own size that scales with the text', () => {
    const l = layoutParagraph([span('go '), icon(20, 1.4), span('.')], { width: 1000 })
    const box = l.lines[0].items.find(i => i.kind === 'icon')
    expect(box.size).toBeCloseTo(28)
  })

  it('stays on the line with the punctuation that follows it, at every width', () => {
    for (let w = 50; w <= 200; w++) { // from the width of the longest word: below it a word is broken by characters, which may leave a mark alone
      const l = layoutParagraph([span('Deal three damage '), icon(), span('. Then draw.')], { width: w })
      for (const line of l.lines) expect(lineTexts(l)[l.lines.indexOf(line)]?.trimStart().startsWith('.')).toBe(false)
    }
  })
})

describe('fit modes (PRD §7.4)', () => {
  const long = 'AVATAR Tower of the Wave, with a long text that needs wrapping over several lines and then some more words to fill it.'
  const make = size => [span(long, { size })]

  it('wrap shows everything and clip is the same', () => {
    const wrap = layoutFit(make, { fit: 'wrap', width: 150, height: 40, size: 20 })
    const clip = layoutFit(make, { fit: 'clip', width: 150, height: 40, size: 20 })
    expect(wrap.lines.length).toBeGreaterThan(2)
    expect(clip.lines.length).toBe(wrap.lines.length)
    expect(wrap.overflowText).toBe('')
  })

  it('shrink reduces the size until the text fits, and never below the minimum', () => {
    const r = layoutFit(make, { fit: 'shrink', width: 150, height: 100, size: 20, maxSize: 20, minSize: 6 })
    expect(r.fits).toBe(true)
    expect(r.height).toBeLessThanOrEqual(100 + 1e-6)
    expect(r.size).toBeLessThan(20)
    expect(r.size).toBeGreaterThanOrEqual(6)
    const tiny = layoutFit(make, { fit: 'shrink', width: 150, height: 10, size: 20, maxSize: 20, minSize: 8 })
    expect(tiny.size).toBe(8)
    expect(tiny.fits).toBe(false) // hit the minimum and still does not fit
  })

  it('shrink keeps the maximum size when the text already fits, and does nothing without a box height', () => {
    expect(layoutFit(make, { fit: 'shrink', width: 2000, height: 100, size: 20, maxSize: 20, minSize: 6 }).size).toBe(20)
    expect(layoutFit(make, { fit: 'shrink', width: 100, size: 20, maxSize: 20, minSize: 6 }).size).toBe(20)
  })

  it('shrink makes icons smaller with the text', () => {
    const withIcon = size => [span('Draw two cards ', { size }), { icon: 'star', size }, span(' now and again later on', { size })]
    const r = layoutFit(withIcon, { fit: 'shrink', width: 120, height: 50, size: 24, maxSize: 24, minSize: 6 })
    const box = r.lines.flatMap(l => l.items).find(i => i.kind === 'icon')
    expect(box.size).toBeCloseTo(r.size)
  })

  it('overflow shows what fits and hands the rest on as text', () => {
    const r = layoutFit(make, { fit: 'overflow', width: 150, height: 48, size: 20 })
    expect(r.lines).toHaveLength(2)
    expect(r.overflowText.length).toBeGreaterThan(10)
    expect(long.replace(/\s+/g, ' ')).toContain(r.overflowText)
    expect(lineTexts(r).join(' ').replace(/\s+/g, ' ') + ' ' + r.overflowText).toBe(long)
  })

  it('truncate ends the last visible line with an ellipsis that fits', () => {
    const r = layoutFit(make, { fit: 'truncate', width: 150, height: 48, size: 20 })
    expect(r.truncated).toBe(true)
    expect(r.lines).toHaveLength(2)
    for (const l of r.lines) expect(l.width).toBeLessThanOrEqual(150 + 1e-6)
    const f = chainOf()[0], k = 20 / f.upem
    const dots = f.shape('…')
    const lastItems = r.lines[1].items.at(-1)
    expect(lastItems.glyphs.at(-1).gid).toBe(dots[0].gid)
    expect(k).toBeGreaterThan(0)
  })

  it('truncate and overflow leave text that fits untouched', () => {
    for (const fit of ['truncate', 'overflow']) {
      const r = layoutFit(size => [span('short', { size })], { fit, width: 150, height: 48, size: 20 })
      expect(r.truncated).toBe(false)
      expect(r.overflowText).toBe('')
    }
  })

  it('slices spans by character range', () => {
    const parts = sliceSpans([span('hello '), span('world')], 3, 8)
    expect(parts.map(p => p.text)).toEqual(['lo ', 'wo'])
  })
})

describe('drawing outlines', () => {
  it('writes one path per fill, with absolute coordinates', () => {
    const l = layoutParagraph([span('ab', { fill: '#f00' }), span('cd', { fill: '#00f' }), span('ef', { fill: '#f00' })])
    const svg = layoutToSvg(l, 10, 20)
    expect(svg.match(/<path/g)).toHaveLength(2)
    expect(svg).toContain('fill="#f00"')
    expect(svg).toContain('fill="#00f"')
    expect(svg).not.toMatch(/NaN|undefined/)
  })
})

// ---------------------------------------------------------------------------
// The SVG pass
// ---------------------------------------------------------------------------

const files = () => defaultFontFiles()
const wrapSvg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#fff"/>${body}</svg>`
const render = svg => new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: files(), defaultFontFamily: 'Liberation Sans' } }).render()
function ink(img) {
  const { pixels, width, height } = img
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (pixels[i] < 128 || pixels[i + 1] < 128 || pixels[i + 2] < 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1) }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}
const diff = (a, b) => {
  const pa = a.pixels, pb = b.pixels // read once: resvg's `pixels` copies the whole image on every access
  let inked = 0, differing = 0
  for (let i = 0; i < pa.length; i += 4) {
    const da = 255 - pa[i], db = 255 - pb[i]
    if (da > 32 || db > 32) { inked++; if (Math.abs(da - db) > 96) differing++ }
  }
  return inked ? differing / inked : 0
}
const run = (body, fields = {}, kind = 'plain', extra = {}) => {
  const env = { fontSet: fonts, fields, report: {}, overflow: new Map(), ...extra }
  const svg = convertText(wrapSvg(body), env, kind)
  return { svg, env }
}

describe('replacing <text> by outlines', () => {
  it('draws plain text exactly as the rasterizer would shape it', () => {
    for (const [body, label] of [
      ['<text x="20" y="60" font-size="40" fill="#000">AVATAR To Wa Yo</text>', 'kerning'],
      ['<text x="20" y="60" font-size="40" font-weight="bold" fill="#000">Wavering Tower</text>', 'bold'],
      ['<text x="20" y="60" font-size="36" font-family="Liberation Serif" font-style="italic" fill="#000">Quick Brown</text>', 'serif italic'],
      [`<text x="20" y="60" font-size="40" font-family="Noto Sans Arabic" fill="#000">${AR}</text>`, 'arabic'],
      [`<text x="20" y="60" font-size="40" font-family="Noto Sans Hebrew" fill="#000">${HE}</text>`, 'hebrew']
    ]) {
      const { svg } = run(body)
      expect(svg, label).not.toContain('<text')
      const mine = render(svg), theirs = render(wrapSvg(body))
      const a = ink(mine), b = ink(theirs)
      expect(Math.abs((a.x1 - a.x0) - (b.x1 - b.x0)), `${label} width`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.x0 - b.x0), `${label} left`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.y0 - b.y0), `${label} top`).toBeLessThanOrEqual(1)
      expect(diff(mine, theirs), `${label} pixels`).toBeLessThan(0.03)
    }
  })

  it('anchors text at its start, middle and end', () => {
    const at = anchor => ink(render(run(`<text x="200" y="100" font-size="30" text-anchor="${anchor}" fill="#000">Hello there</text>`).svg))
    const start = at('start'), middle = at('middle'), end = at('end')
    expect(start.x0).toBeCloseTo(200, -1)
    expect((middle.x0 + middle.x1) / 2).toBeCloseTo(200, -1)
    expect(end.x1).toBeCloseTo(200, -1)
  })

  it('inherits font properties from groups and the root, and reads units and style attributes', () => {
    const { svg } = run('<g font-family="Liberation Serif" font-size="2em"><g font-weight="bold"><text x="10" y="80" fill="#000" style="letter-spacing:2px">Nested</text></g></g>')
    expect(svg).not.toContain('<text')
    const mine = ink(render(svg)), theirs = ink(render(wrapSvg('<g font-family="Liberation Serif" font-size="2em"><g font-weight="bold"><text x="10" y="80" fill="#000" style="letter-spacing:2px">Nested</text></g></g>')))
    expect(Math.abs((mine.x1 - mine.x0) - (theirs.x1 - theirs.x0))).toBeLessThanOrEqual(1)
  })

  it('draws tspans with their own weight and colour, and decodes entities', () => {
    const { svg } = run('<text x="10" y="50" font-size="30" fill="#000">a &amp; b <tspan font-weight="bold" fill="#c00">bold</tspan> &#65;&lt;</text>')
    expect(svg).not.toContain('<text')
    expect(svg).toContain('fill="#c00"')
    expect(decodeEntities('&amp;&lt;&#65;&#x42;')).toBe('&<AB')
    const mine = render(svg), theirs = render(wrapSvg('<text x="10" y="50" font-size="30" fill="#000">a &amp; b <tspan font-weight="bold" fill="#c00">bold</tspan> &#65;&lt;</text>'))
    expect(diff(mine, theirs)).toBeLessThan(0.03)
  })

  it('keeps the element\'s other attributes on the group that replaces it', () => {
    const { svg } = run('<text id="t1" x="10" y="50" font-size="20" fill="#123" opacity="0.5" transform="rotate(5)">Hi</text>')
    expect(svg).toMatch(/<g id="t1" fill="#123" opacity="0.5" transform="rotate\(5\)">/)
    expect(svg).not.toContain('font-size')
  })

  it('uses the rasterizer\'s default size of 12 for unstyled text', () => {
    const { svg } = run('<text x="10" y="50" fill="#000">Default size</text>')
    const mine = ink(render(svg)), theirs = ink(render(wrapSvg('<text x="10" y="50" fill="#000">Default size</text>')))
    expect(Math.abs((mine.x1 - mine.x0) - (theirs.x1 - theirs.x0))).toBeLessThanOrEqual(1)
  })

  it('leaves what it does not do to the rasterizer, and says so', () => {
    const cases = [
      '<text x="10" y="50" rotate="10">spin</text>',
      '<text x="10" y="50" text-decoration="underline">under</text>',
      '<text x="10 20 30" y="50">list</text>',
      '<text x="10" y="50"><tspan x="10" y="80">moved</tspan></text>',
      '<text x="10" y="50"><textPath href="#p">path</textPath></text>',
      '<text x="10" y="50" textLength="100">stretch</text>'
    ]
    for (const body of cases) {
      const { svg, env } = run(body)
      expect(svg, body).toContain('<text')
      expect(env.report.native, body).toHaveLength(1)
    }
    // CSS classes from a <style> block cannot be read
    const styled = convertText(wrapSvg('<style>.a{font-size:30px}</style><text class="a" x="10" y="50">styled</text>'), { fontSet: fonts, fields: {}, report: {} }, 'plain')
    expect(styled).toContain('<text')
  })

  it('skips hidden elements and anything inside a clip path', () => {
    expect(run('<g style="display:none"><text x="10" y="50">hidden</text></g>').svg).toContain('<text')
    expect(run('<text x="10" y="50" style="display:none">hidden</text>').svg).toContain('<text')
    expect(run('<clipPath id="c"><text x="10" y="50">clip</text></clipPath>').svg).toContain('<text')
  })

  it('reports characters no font has', () => {
    const { env } = run(`<text x="10" y="50" font-size="20">a${CJK}b</text>`)
    expect([...env.report.missing]).toEqual([CJK])
  })

  it('leaves bound text alone in the plain pass, and plain text in the bound pass', () => {
    const body = '<text x="10" y="40" data-spadewick-field="a">x</text><text x="10" y="80">y</text>'
    expect(run(body, { a: 'hello' }, 'plain').svg).toContain('data-spadewick-field')
    const onlyBound = run(body, { a: 'hello' }, 'bound').svg
    expect(onlyBound).not.toContain('data-spadewick-field')
    expect(onlyBound).toContain('>y</text>')
  })
})

describe('bound text (data-spadewick-field)', () => {
  const bound = (attrs, fields, extra) => run(`<text x="20" y="20" width="200" height="100" font-size="20" data-spadewick-field="body" fill="#000" ${attrs}>{{body}}</text>`, fields, 'bound', extra)

  it('fills from the field, wraps in the box from its top-left corner, and drops the data attributes', () => {
    const { svg } = bound('', { body: 'AVATAR Tower of the Wave, with a long text that needs wrapping over several lines.' })
    expect(svg).not.toContain('data-spadewick')
    expect(svg).not.toContain('<text')
    const box = ink(render(svg))
    expect(box.x0).toBeGreaterThanOrEqual(20)
    expect(box.x1).toBeLessThanOrEqual(20 + 200 + 1)
    expect(box.y0).toBeGreaterThanOrEqual(20)
    const firstBaseline = 20 + 20 * ASCENT
    expect(box.y0).toBeLessThanOrEqual(firstBaseline)
  })

  it('shrinks to fit the box height, and reports nothing missing', () => {
    const text = 'word '.repeat(60)
    const { svg, env } = bound('data-spadewick-text-fit="shrink" data-spadewick-text-max-size="30" data-spadewick-text-min-size="6"', { body: text })
    const box = ink(render(svg))
    expect(box.y1).toBeLessThanOrEqual(20 + 100 + 1)
    expect(env.report.missing).toBeUndefined()
  })

  it('anchors lines to the left, middle or right edge of the box', () => {
    const at = a => ink(render(bound(`text-anchor="${a}"`, { body: 'Hi' }).svg))
    expect(at('start').x0).toBeLessThan(40)
    expect(Math.round((at('middle').x0 + at('middle').x1) / 2)).toBeCloseTo(120, -1)
    expect(at('end').x1).toBeCloseTo(220, -1)
  })

  it('without a box, y is the first baseline and the lines hang from x', () => {
    const { svg } = run('<text x="50" y="100" font-size="30" data-spadewick-field="a" fill="#000">{{a}}</text>', { a: 'one\ntwo' }, 'bound')
    const box = ink(render(svg))
    expect(box.y1).toBeGreaterThan(100) // the second line is below the first baseline
    expect(box.y0).toBeLessThan(100)
    expect(box.x0).toBeGreaterThanOrEqual(50)
  })

  it('hands overflowing text to the target element', () => {
    const body = '<text x="20" y="20" width="200" height="30" font-size="20" data-spadewick-field="body" data-spadewick-text-fit="overflow" data-spadewick-overflow-target="more" fill="#000">x</text><text id="more" x="20" y="150"></text>'
    const { svg, env } = run(body, { body: 'a long text that needs more than one line in this small box for sure yes' }, 'bound')
    expect(env.overflow.get('more').length).toBeGreaterThan(5)
    const filled = applyOverflow(svg, env.overflow)
    expect(filled).toMatch(/<text id="more" x="20" y="150">[^<]+<\/text>/)
  })

  it('compares itself with the old estimate when asked, counting cards that would look different', () => {
    const report = { compare: true }
    bound('data-spadewick-text-fit="shrink" data-spadewick-text-max-size="30"', { body: 'word '.repeat(40) }, { report })
    expect(report.bound).toBe(1)
    expect(report.changed).toBe(1) // the estimate over-measures, so it shrinks further than the real fonts need
    const same = { compare: true }
    bound('', { body: 'Hi' }, { report: same })
    expect(same.bound).toBe(1)
    expect(same.changed ?? 0).toBe(0)
  })

  it('draws Arabic and Hebrew bound text without missing-glyph boxes', () => {
    const { env } = bound('', { body: `${AR2} ${HE}` })
    expect(env.report.missing).toBeUndefined()
  })
})

describe('a text always has a face to be drawn in', () => {
  it('picks a face even when the weight asked for is not a number', async () => {
    const fonts = createFontSet(await loadHarfBuzz())
    expect(fonts.chain(['Liberation Sans'], { weight: NaN, italic: false }).length).toBeGreaterThan(0)
    expect(fonts.chain(['Liberation Sans'], { weight: undefined, italic: false }).length).toBeGreaterThan(0)
    expect(fonts.chain(['No Such Family'], { weight: 400, italic: false }).length).toBeGreaterThan(0)      // the usual face stands in
  })

  it('says what is wrong, with the folder it looked in, when the fonts that come with the application are not there', async () => {
    const fonts = createFontSet(await loadHarfBuzz(), { bundledDir: join(tmpdir(), 'spadewick-no-fonts-here') })
    expect(() => fonts.chain(['Liberation Sans'], { weight: 400, italic: false })).toThrow(/No font could be found.*spadewick-no-fonts-here/)
  })
})
