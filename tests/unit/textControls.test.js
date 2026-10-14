/**
 * The text controls (PRD §16.6): justify, indents and bullets, paragraph spacing, line height, word spacing, auto-fit with
 * step, tightening and a line limit, balanced lines, transforms and effects.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { loadHarfBuzz } from '../../src/main/text/hb.js'
import { createFontSet } from '../../src/main/text/fonts.js'
import { layoutParagraph, layoutFit, ASCENT } from '../../src/main/text/layout.js'
import { readControls, finishSpans, bulletize, transformText, BULLET_MARK } from '../../src/main/text/controls.js'
import { convertText } from '../../src/main/text/svgText.js'
import { defaultFontFiles } from '../../src/main/fontFiles.js'

let hb, fonts
beforeAll(async () => { hb = await loadHarfBuzz(); fonts = createFontSet(hb) })

const serif = () => fonts.chain(['Liberation Serif'], { weight: 400, italic: false })
const span = (text, o = {}) => ({ text, chain: serif(), size: 20, ...o })
const LONG = 'The quick brown fox jumps over the lazy dog and keeps running through the forest until nightfall.'
const texts = l => l.lines.map(x => l.text.slice(x.start, x.end).trim())
const attrsOf = o => new Map(Object.entries(o).map(([k, v]) => [`data-spadewick-${k}`, String(v)]))

describe('justify', () => {
  it('stretches every line but the last of a paragraph to the box width', () => {
    const l = layoutParagraph([span(LONG)], { width: 260, align: 'justify' })
    expect(l.lines.length).toBeGreaterThan(2)
    l.lines.slice(0, -1).forEach(line => expect(line.width).toBeCloseTo(260, 3))
    expect(l.lines.at(-1).width).toBeLessThan(260)
    expect(l.lines.at(-1).x).toBe(0)
  })

  it('leaves the last line of each paragraph, and lines of one word, alone', () => {
    const l = layoutParagraph([span('One two three four five six seven\nShort\nA B')], { width: 130, align: 'justify' })
    const byText = Object.fromEntries(texts(l).map((t, i) => [t, l.lines[i].width]))
    expect(byText.Short).toBeLessThan(130)
    expect(byText['A B']).toBeLessThan(130)
  })

  it('never makes a line wider than the box', () => {
    for (let w = 120; w <= 400; w += 17) for (const line of layoutParagraph([span(LONG)], { width: w, align: 'justify' }).lines) expect(line.width).toBeLessThanOrEqual(w + 1e-6)
  })
})

describe('indent, bullets and paragraph spacing', () => {
  it('indents the first line of each paragraph, and wraps inside the narrower room', () => {
    const l = layoutParagraph([span(`${LONG}\n${LONG}`)], { width: 260, indent: 30 })
    const firsts = l.lines.filter((_, i) => i === 0 || l.text[l.lines[i].start - 1] === '\n')
    expect(firsts).toHaveLength(2)
    for (const f of firsts) expect(f.x).toBe(30)
    for (const line of l.lines) { expect(line.x + line.width).toBeLessThanOrEqual(260 + 1e-6); if (!firsts.includes(line)) expect(line.x).toBe(0) }
  })

  it('hangs the lines after a bullet under the text, not under the bullet', () => {
    const bullet = { ...span('•'), marker: true, afterSpace: 8 }
    const l = layoutParagraph([bullet, span('A point that is long enough to wrap onto a second and a third line'), span('\n'), bullet, span('Short')], { width: 150 })
    const [first, second] = l.lines
    const markerWidth = first.items[0].glyphs.length ? first.items[1].x : 0
    expect(first.x).toBe(0)
    expect(second.x).toBeCloseTo(markerWidth, 3)
    expect(second.x).toBeGreaterThan(8)
    const lastShort = l.lines.at(-1)
    expect(lastShort.x).toBe(0)                                   // the next bullet starts at the left again
  })

  it('turns "- " at the start of a line into a bullet mark, and the mark into a bullet span with a gap', () => {
    expect(bulletize('- one\ntext - not\n- two')).toBe(`${BULLET_MARK}one\ntext - not\n${BULLET_MARK}two`)
    const spans = finishSpans([span(`${BULLET_MARK}point`)], { bullets: true, wordSpacing: 0 }, null)
    expect(spans.map(s => s.text)).toEqual(['•', 'point'])
    expect(spans[0]).toMatchObject({ marker: true, afterSpace: 8 })
    expect(finishSpans([span(`${BULLET_MARK}x`)], { bullets: true, bulletChar: '▸', wordSpacing: 0 }, null)[0].text).toBe('▸')
    const icon = finishSpans([span(`${BULLET_MARK}x`)], { bullets: true, bulletIcon: 'star', wordSpacing: 0 }, null)[0]
    expect(icon).toMatchObject({ icon: 'star', marker: true })
  })

  it('replaces blank lines by a gap, once, however many there are', () => {
    const plain = layoutParagraph([span('One\n\nTwo\n\n\n\nThree')], { width: 300 })
    expect(plain.lines).toHaveLength(7)
    const spaced = layoutParagraph([span('One\n\nTwo\n\n\n\nThree')], { width: 300, paragraphSpacing: 0.5 })
    expect(spaced.lines).toHaveLength(3)
    expect(spaced.lines[1].top - spaced.lines[0].top).toBeCloseTo(24 + 10)                  // a line, then half an em
    expect(spaced.lines[2].top - spaced.lines[1].top).toBeCloseTo(24 + 10)                  // four blank lines are still one gap
    expect(texts(spaced)).toEqual(['One', 'Two', 'Three'])
  })
})

describe('line height and word spacing', () => {
  it('uses an exact line height in pixels when given, with the baseline where it always is', () => {
    const l = layoutParagraph([span('a\nb\nc')], { width: 100, lineExact: 40 })
    expect(l.lines.map(x => x.top)).toEqual([0, 40, 80])
    expect(l.lines[0].baseline).toBeCloseTo(20 * ASCENT)
    expect(l.height).toBe(120)
    expect(layoutParagraph([span('a\nb')], { width: 100, lineHeight: 2 }).lines[1].top).toBe(40)
  })

  it('adds word spacing at every space and nowhere else', () => {
    const base = layoutParagraph([span('a b c')]).width
    expect(layoutParagraph([span('a b c', { wordSpacing: 5 })]).width).toBeCloseTo(base + 10)
    expect(layoutParagraph([span('abc', { wordSpacing: 5 })]).width).toBeCloseTo(layoutParagraph([span('abc')]).width)
  })
})

describe('auto-fit', () => {
  const make = (size, tracking = 0) => [span(LONG, { size, letterSpacing: tracking * size })]
  const base = { fit: 'shrink', width: 200, height: 100, size: 24, maxSize: 24, minSize: 6 }

  it('goes down by the step it is given, so a finer step keeps the text larger', () => {
    const coarse = layoutFit(make, { ...base, step: 1 }), fine = layoutFit(make, { ...base, step: 0.25 })
    expect(Number.isInteger(coarse.size)).toBe(true)
    expect((coarse.size - 6) % 1).toBeCloseTo(0)
    expect(fine.size).toBeGreaterThanOrEqual(coarse.size)
    expect(fine.size - coarse.size).toBeLessThan(1)
    expect(fine.fits && coarse.fits).toBe(true)
  })

  it('tightens the letter spacing before it gives up a size, down to its limit', () => {
    const without = layoutFit(make, { ...base, height: 120 })
    const tight = layoutFit(make, { ...base, height: 120, tighten: 0.03 })
    expect(tight.size).toBeGreaterThanOrEqual(without.size)
    expect(tight.tracking).toBeLessThanOrEqual(0)
    expect(tight.tracking).toBeGreaterThanOrEqual(-0.03 - 1e-9)
    const impossible = layoutFit(make, { ...base, height: 10, tighten: 0.03, minSize: 10 })
    expect(impossible.fits).toBe(false)
    expect(impossible.size).toBe(10)
  })

  it('does not tighten when the text already fits', () => {
    const r = layoutFit(size => [span('Hi', { size })], { ...base, tighten: 0.05 })
    expect(r.tracking).toBe(0)
    expect(r.size).toBe(24)
  })

  it('limits the number of lines, with or without a box height', () => {
    const r = layoutFit(make, { fit: 'shrink', width: 200, size: 24, maxSize: 24, minSize: 6, maxLines: 3 })
    expect(r.lines.length).toBeLessThanOrEqual(3)
    expect(r.fits).toBe(true)
    expect(r.size).toBeLessThan(24)
    const cut = layoutFit(make, { fit: 'truncate', width: 200, height: 1000, size: 20, maxLines: 2 })
    expect(cut.lines).toHaveLength(2)
    expect(cut.truncated).toBe(true)
    const over = layoutFit(make, { fit: 'overflow', width: 200, height: 1000, size: 20, maxLines: 2 })
    expect(over.lines).toHaveLength(2)
    expect(over.overflowText.length).toBeGreaterThan(10)
  })

  it('says when even the limits cannot make it fit', () => {
    const r = layoutFit(make, { fit: 'shrink', width: 200, size: 24, maxSize: 24, minSize: 20, maxLines: 1 })
    expect(r.fits).toBe(false)
  })
})

describe('balanced lines and last lines', () => {
  const widthSpread = l => Math.max(...l.lines.map(x => x.width)) - Math.min(...l.lines.map(x => x.width))

  it('evens out the lines without adding one', () => {
    const make = () => [span('A title that wraps over two lines nicely', { size: 30 })]
    const plain = layoutFit(make, { fit: 'wrap', width: 360, size: 30 })
    const balanced = layoutFit(make, { fit: 'wrap', width: 360, size: 30, balance: true })
    expect(balanced.lines).toHaveLength(plain.lines.length)
    expect(widthSpread(balanced)).toBeLessThan(widthSpread(plain))
    for (const l of balanced.lines) expect(l.width).toBeLessThanOrEqual(360)
  })

  it('places a balanced block in the box as its alignment says', () => {
    const make = () => [span('A title that wraps over two lines nicely', { size: 30 })]
    const left = layoutFit(make, { fit: 'wrap', width: 360, size: 30, balance: true, align: 'left' })
    const centre = layoutFit(make, { fit: 'wrap', width: 360, size: 30, balance: true, align: 'center' })
    expect(centre.lines[0].x).toBeGreaterThan(left.lines[0].x)
    expect(Math.max(...centre.lines.map(l => l.x + l.width))).toBeLessThanOrEqual(360 + 1e-6)
  })

  it('moves a word down to avoid a last line of one word, never adding a line', () => {
    const make = () => [span('We went home and slept soundly all through yesterday afternoon', { size: 20 })]
    const words = l => l.text.slice(l.lines.at(-1).start, l.lines.at(-1).end).trim().split(/\s+/).length
    let fixedSome = 0
    for (let w = 140; w <= 400; w += 3) {
      const plain = layoutFit(make, { fit: 'wrap', width: w, size: 20 })
      const fixed = layoutFit(make, { fit: 'wrap', width: w, size: 20, avoidOrphans: true })
      expect(fixed.lines.length, `width ${w}`).toBe(plain.lines.length)                 // it never adds a line
      for (const l of fixed.lines) expect(l.width).toBeLessThanOrEqual(w + 1e-6)
      if (plain.lines.length > 1 && words(plain) === 1 && words(fixed) >= 2) fixedSome++
      if (plain.lines.length === 1 || words(plain) > 1) expect(texts(fixed)).toEqual(texts(plain)) // text without an orphan is left as it was
    }
    expect(fixedSome).toBeGreaterThan(0)                                                // and it does fix real cases
  })

  it('leaves single-line text and text with no orphan alone', () => {
    const make = () => [span('Short', { size: 20 })]
    const r = layoutFit(make, { fit: 'wrap', width: 300, size: 20, balance: true, avoidOrphans: true })
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].x).toBe(0)
  })
})

describe('reading the attributes', () => {
  it('reads each control, clamped to what is sensible', () => {
    const ctl = readControls(attrsOf({ 'line-height': '1.5', 'paragraph-spacing': '0.5', indent: '2', tighten: '3', 'text-step': '0.5', 'text-max-lines': '4', 'text-align': 'justify', valign: 'middle', bullets: 'true', bullet: 'icon:star', 'text-transform': 'title', balance: 'true', 'avoid-orphans': 'true', 'icon-scale': 'fixed' }), { size: 20 })
    expect(ctl).toMatchObject({ lineHeight: 1.5, paragraphSpacing: 0.5, indent: 40, tighten: 0.03, step: 0.5, maxLines: 4, justify: true, valign: 'middle', bullets: true, bulletIcon: 'star', transform: 'title', balance: true, avoidOrphans: true, iconsFixed: true })
  })

  it('reads an exact line height from a length, and ignores values it cannot use', () => {
    expect(readControls(attrsOf({ 'line-height': '18pt' }), { size: 20 })).toMatchObject({ lineExact: 24 })
    expect(readControls(attrsOf({ 'line-height': '30px' }), { size: 20 }).lineExact).toBe(30)
    const bad = readControls(attrsOf({ 'line-height': 'tall', 'text-step': '9', tighten: '-1', valign: 'sideways', 'text-transform': 'shouting', 'text-max-lines': '0', outline: '1', shadow: '1 2' }), { size: 20 })
    expect(bad).toEqual({ wordSpacing: 0, justify: false, bullets: false, balance: false, avoidOrphans: false, iconsFixed: false, step: 1 })
  })

  it('reads an outline and a shadow, with hex colours only', () => {
    const ctl = readControls(attrsOf({ outline: '2 #cc3333', shadow: '1.5 2 #00000066' }), { size: 20 })
    expect(ctl.outline).toEqual({ width: 2, color: '#cc3333' })
    expect(ctl.shadow).toEqual({ dx: 1.5, dy: 2, color: '#00000066' })
    expect(readControls(attrsOf({ outline: '2 red', shadow: '1 1 url(#x)' }), { size: 20 })).not.toHaveProperty('outline')
    expect(readControls(attrsOf({ outline: '2 red', shadow: '1 1 url(#x)' }), { size: 20 })).not.toHaveProperty('shadow')
  })

  it('takes word spacing from the element', () => {
    expect(readControls(attrsOf({}), { size: 20, wordSpacing: 6 }).wordSpacing).toBe(6)
  })
})

describe('transforms', () => {
  it('changes case, and title case capitalises each word', () => {
    expect(transformText('Hello wOrld', 'uppercase')).toBe('HELLO WORLD')
    expect(transformText('Hello wOrld', 'lowercase')).toBe('hello world')
    expect(transformText('the lord of the rings (part one)', 'title')).toBe('The Lord Of The Rings (Part One)')
    expect(transformText('straße', 'uppercase')).toBe('STRASSE')
    expect(transformText('abc', 'small-caps')).toBe('abc')
  })

  it('synthesizes small capitals for a font that has none: lower case as capitals at 0.8 of the size', () => {
    const spans = finishSpans([span('Ab cd', { size: 20 })], { transform: 'small-caps', wordSpacing: 0 }, null)
    expect(spans.map(s => [s.text, s.size])).toEqual([['A', 20], ['B', 16], [' ', 20], ['CD', 16]])
  })

  it('uses the real small capitals of a font that has them', () => {
    const face = { ...serif()[0], hasFeature: tag => tag === 'smcp' }
    const spans = finishSpans([{ text: 'Ab', chain: [face], size: 20 }], { transform: 'small-caps', wordSpacing: 0 }, null)
    expect(spans).toHaveLength(1)
    expect(spans[0].features).toEqual(['smcp'])
  })
})

describe('in the SVG pass', () => {
  const run = (attrs, value = LONG, fields = { b: value }) => convertText(
    `<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="10" width="200" height="120" font-size="14" font-family="Liberation Serif" data-spadewick-field="b" fill="#222" ${attrs}>x</text></svg>`,
    { fontSet: fonts, fields, fieldTypes: {}, report: {}, overflow: new Map() }, 'bound')
  const ink = svg => {
    const img = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="300"><rect width="260" height="300" fill="#fff"/>${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`, { font: { loadSystemFonts: false, fontFiles: defaultFontFiles() } }).render()
    const px = img.pixels, w = img.width
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
    for (let i = 0; i < px.length; i += 4) if (px[i] < 128) { const p = i / 4, x = p % w, y = (p - x) / w; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1) }
    return { x0, y0, x1, y1, h: y1 - y0, w: x1 - x0 }
  }

  it('draws every control as outlines, with none of its attributes left in the picture', () => {
    const svg = run('data-spadewick-text-align="justify" data-spadewick-indent="1" data-spadewick-balance="true" data-spadewick-valign="middle" data-spadewick-text-transform="title" word-spacing="2" data-spadewick-line-height="20px"')
    expect(svg).not.toContain('<text')
    expect(svg).not.toMatch(/data-spadewick|word-spacing/)
  })

  it('places text at the middle or bottom of a taller box', () => {
    const at = v => ink(run(`data-spadewick-valign="${v}"`, 'Hello'))
    const top = at('top'), middle = at('middle'), bottom = at('bottom')
    expect(top.y0).toBeLessThan(25)
    expect(middle.y0).toBeGreaterThan(top.y0 + 30)
    expect(bottom.y0).toBeGreaterThan(middle.y0 + 30)
    expect(bottom.y1).toBeLessThanOrEqual(10 + 120 + 1)
    expect(bottom.y1).toBeGreaterThan(10 + 120 - 25)
  })

  it('uses an exact line height', () => {
    const two = h => ink(run(`data-spadewick-line-height="${h}"`, 'Hi\nHi'))
    expect(two('40px').h - two('20px').h).toBeCloseTo(20, 0)
  })

  it('draws the outline behind the text, and a shadow behind both', () => {
    const svg = run('data-spadewick-outline="1 #ffcc00" data-spadewick-shadow="2 2 #000000"', 'Hi')
    const shadow = svg.indexOf('<path fill="#000000"'), outline = svg.indexOf('stroke="#ffcc00"'), text = svg.lastIndexOf('<path d=')
    expect(shadow).toBeGreaterThan(-1)
    expect(outline).toBeGreaterThan(shadow)
    expect(text).toBeGreaterThan(outline)                                  // the text itself, in the colour of the element, is drawn last
    expect(svg).toContain('stroke-width="2"')
  })

  it('widens text with word spacing and tracking, and is no longer left to the rasterizer', () => {
    const w = a => ink(run(a, 'a b c d')).w
    expect(w('word-spacing="10"')).toBeGreaterThan(w('') + 25)
    expect(w('letter-spacing="0.1em"')).toBeGreaterThan(w('') + 5)
    expect(run('word-spacing="10"')).not.toContain('<text')
  })

  it('applies a text transform to the text', () => {
    const w = a => ink(run(a, 'hello world')).w
    expect(w('data-spadewick-text-transform="uppercase"')).toBeGreaterThan(w('') + 10)
  })

  it('records whether the text fitted, for the properties panel', () => {
    const env = { fontSet: fonts, fields: { b: 'word '.repeat(100) }, fieldTypes: {}, report: {}, overflow: new Map() }
    convertText('<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1" width="100" height="30" font-size="20" data-spadewick-id="t" data-spadewick-field="b" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="12">x</text></svg>', env, 'bound')
    expect(env.report.fits).toEqual([{ where: { id: 't', field: 'b' }, fit: 'shrink', size: 12, tracking: 0, lines: expect.any(Number), fits: false, extent: expect.any(Array), fill: null, rotated: false }])
    expect(env.report.fits[0].extent).toHaveLength(4)                     // left, top, right, bottom: where the text is drawn, for the print preflight
    expect(env.report.items.some(i => i.type === 'noFit')).toBe(true)
  })
})
