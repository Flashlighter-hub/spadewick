/**
 * The text engine's rich text features (PRD §16.2, §16.3): styled runs, underline and strikethrough, icons, soft
 * hyphens, no-break spaces, and synthesized bold and italic for fonts that have no such face.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { loadHarfBuzz } from '../../src/main/text/hb.js'
import { createFontSet } from '../../src/main/text/fonts.js'
import { layoutParagraph, layoutFit } from '../../src/main/text/layout.js'
import { layoutToSvg, ITALIC_SLANT } from '../../src/main/text/outline.js'
import { convertText, markRichTokens } from '../../src/main/text/svgText.js'
import { defaultFontFiles } from '../../src/main/fontFiles.js'
import { starterIconNames, starterIcon, PLACEHOLDER_ICON, iconPathData } from '../../src/shared/starterIcons.js'

let hb, fonts
const regular = { weight: 400, italic: false }
beforeAll(async () => { hb = await loadHarfBuzz(); fonts = createFontSet(hb) })

const sans = () => fonts.chain(['Liberation Sans'], regular)
const span = (text, o = {}) => ({ text, chain: sans(), size: 20, ...o })
const lineTexts = l => l.lines.map(x => l.text.slice(x.start, x.end))
const wrapSvg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#fff"/>${body}</svg>`
const render = svg => new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: defaultFontFiles() } }).render()
function ink(img) {
  const px = img.pixels, w = img.width, h = img.height
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4] < 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1) }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

describe('the starter icons', () => {
  it('has shapes in a 0..100 box for the suits, a star, a heart, a shield, fire, a circle and arrows', () => {
    const names = starterIconNames()
    for (const n of ['star', 'heart', 'shield', 'fire', 'diamond', 'club', 'spade', 'circle', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down']) expect(names).toContain(n)
    for (const n of names) {
      const cmds = starterIcon(n)
      expect(cmds[0][0], n).toBe('M')
      expect(cmds.at(-1)[0], n).toBe('Z')
      for (const [t, ...v] of cmds) { if (t !== 'Z') for (const x of v) { expect(x, n).toBeGreaterThanOrEqual(-1); expect(x, n).toBeLessThanOrEqual(101) } }
      expect(iconPathData(cmds)).toMatch(/^M/)
    }
    expect(starterIcon('nosuch')).toBeNull()
    expect(PLACEHOLDER_ICON.filter(c => c[0] === 'Z')).toHaveLength(2) // a frame: outer and inner square
  })
})

describe('runs and decorations', () => {
  it('gives every run its own colour, drawn as its own path', () => {
    const l = layoutParagraph([span('red', { fill: '#c00' }), span(' and '), span('blue', { fill: '#00c' })])
    const svg = layoutToSvg(l, 0, 0)
    expect(svg).toContain('fill="#c00"')
    expect(svg).toContain('fill="#00c"')
    expect(svg.match(/<path/g).length).toBe(3) // red, blue, and the default
  })

  it('draws underline and strikethrough as rules across the words and the spaces between them', () => {
    const l = layoutParagraph([span('two words', { underline: true }), span(' then '), span('gone', { strike: true })])
    const rules = l.lines[0].items.filter(i => i.kind === 'rule')
    expect(rules.map(r => r.type)).toEqual(['underline', 'strike'])
    const [under] = rules
    expect(under.x).toBeCloseTo(0)
    expect(under.width).toBeCloseTo(layoutParagraph([span('two words')]).width, 3) // one rule over both words and the space
  })

  it('draws a rule thin and positioned relative to the size', () => {
    const l = layoutParagraph([span('x', { underline: true, size: 100 })])
    const rule = l.lines[0].items.find(i => i.kind === 'rule')
    expect(rule.size).toBe(100)
    const svg = layoutToSvg(l, 0, 0)
    expect(svg).toContain('M0 97L') // the baseline is at 85, and the rule starts 12 below it
  })

  it('keeps one rule across runs of different weight when colour and size agree', () => {
    const l = layoutParagraph([span('a ', { underline: true }), span('b', { underline: true, chain: fonts.chain(['Liberation Sans'], { weight: 700, italic: false }) })])
    expect(l.lines[0].items.filter(i => i.kind === 'rule')).toHaveLength(1)
  })
})

describe('icons', () => {
  const icon = (name = 'star', o = {}) => ({ icon: name, size: 20, ...o })

  it('draws a starter icon as outlines, scaled with its size, and a placeholder for one that does not exist', () => {
    const missing = []
    const l = layoutParagraph([span('a'), icon('star'), icon('nosuch'), span('b')])
    const svg = layoutToSvg(l, 0, 0, { onMissingIcon: n => missing.push(n) })
    expect(missing).toEqual(['nosuch'])
    expect(svg).toMatch(/^<path/)
    const big = layoutParagraph([icon('star', { size: 40 })])
    const bigInk = ink(render(wrapSvg(layoutToSvg(big, 10, 60))))
    const small = layoutParagraph([icon('star', { size: 20 })])
    const smallInk = ink(render(wrapSvg(layoutToSvg(small, 10, 60))))
    expect(bigInk.w).toBeCloseTo(smallInk.w * 2, -1)
    expect(smallInk.w).toBeGreaterThan(15)
  })

  it('takes its colour from the run or follows the surrounding text', () => {
    const l = layoutParagraph([icon('heart', { fill: '#c00' }), icon('heart')])
    expect(layoutToSvg(l, 0, 0)).toContain('fill="#c00"')
  })

  it('lets a project icon library override the starter set by name', () => {
    const l = layoutParagraph([icon('star')])
    const square = [['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['L', 0, 100], ['Z']]
    const svg = layoutToSvg(l, 0, 0, { resolveIcon: n => (n === 'star' ? square : null) })
    expect(svg).toMatch(/M0 \d+(\.\d+)?L20 /)
  })
})

describe('soft hyphens and no-break spaces', () => {
  const word = 'in­ter­na­tion­al­iza­tion'

  it('draws a hyphen where a line breaks at a soft hyphen, and nothing where it does not', () => {
    const wide = layoutParagraph([span(word)], { width: 1000 })
    expect(wide.lines).toHaveLength(1)
    const narrow = layoutParagraph([span(word)], { width: 90 })
    expect(narrow.lines.length).toBeGreaterThan(1)
    const hyphen = sans()[0].shape('-')[0].gid
    // every line but the last ends in a hyphen; the last does not
    narrow.lines.forEach((line, i) => {
      const glyphs = line.items.at(-1).glyphs
      const lastIsHyphen = glyphs.at(-1).gid === hyphen
      expect(lastIsHyphen, `line ${i}`).toBe(i < narrow.lines.length - 1)
    })
    for (const line of narrow.lines) expect(line.width).toBeLessThanOrEqual(90 + 1e-6)
  })

  it('moves the last piece down when its hyphen would not fit', () => {
    for (let w = 40; w <= 200; w += 3) {
      const l = layoutParagraph([span(word)], { width: w })
      for (const line of l.lines) expect(line.width, `width ${w}`).toBeLessThanOrEqual(w + 1e-6)
    }
  })

  it('loses no letter of the word', () => {
    const l = layoutParagraph([span(word)], { width: 100 })
    expect(lineTexts(l).join('').replace(/­/g, '')).toBe(word.replace(/­/g, ''))
  })

  it('keeps no-break spaces together', () => {
    const l = layoutParagraph([span('one two three four')], { width: 80 })
    expect(lineTexts(l)[0]).toContain('one two')
  })
})

describe('bold and italic when the font has no such face', () => {
  const mono = (want) => fonts.chainInfo(['Liberation Mono'], want)

  it('says so for a font with one face, and not for a font with all four', () => {
    expect(mono({ weight: 700, italic: false })).toMatchObject({ synthBold: true, synthItalic: false })
    expect(mono({ weight: 400, italic: true })).toMatchObject({ synthBold: false, synthItalic: true })
    expect(mono({ weight: 400, italic: false })).toMatchObject({ synthBold: false, synthItalic: false })
    expect(fonts.chainInfo(['Liberation Sans'], { weight: 700, italic: true })).toMatchObject({ synthBold: false, synthItalic: false })
    // Liberation Serif has Bold and Italic but no Bold Italic: the nearest is Italic, and the bold is synthesized on it
    expect(fonts.chainInfo(['Liberation Serif'], { weight: 700, italic: true })).toMatchObject({ synthBold: true, synthItalic: false })
  })

  it('draws synthesized bold heavier and a little wider, and synthesized italic slanted', () => {
    const regularInk = ink(render(wrapSvg(layoutToSvg(layoutParagraph([span('MMMM', { chain: mono({ weight: 400, italic: false }).faces, size: 40 })]), 10, 80))))
    const boldInfo = mono({ weight: 700, italic: false })
    const boldLayout = layoutParagraph([span('MMMM', { chain: boldInfo.faces, size: 40, synthBold: true })])
    const boldInk = ink(render(wrapSvg(layoutToSvg(boldLayout, 10, 80))))
    expect(boldLayout.width).toBeGreaterThan(layoutParagraph([span('MMMM', { chain: boldInfo.faces, size: 40 })]).width)
    expect(boldInk.w).toBeGreaterThan(regularInk.w)

    const slanted = layoutParagraph([span('HHHH', { chain: mono({ weight: 400, italic: true }).faces, size: 60, synthItalic: true })])
    const upright = layoutParagraph([span('HHHH', { chain: mono({ weight: 400, italic: true }).faces, size: 60 })])
    const a = ink(render(wrapSvg(layoutToSvg(slanted, 10, 90)))), b = ink(render(wrapSvg(layoutToSvg(upright, 10, 90))))
    // the top of the letters leans right by about the height times tan 12 degrees
    expect(a.w - b.w).toBeGreaterThan(60 * 0.6 * ITALIC_SLANT * 0.7)
  })
})

describe('markup in the SVG pass', () => {
  const env = (extra = {}) => ({ fontSet: fonts, fields: {}, fieldTypes: {}, report: {}, overflow: new Map(), ...extra })
  const run = (body, kind, e) => convertText(wrapSvg(body), e, kind)

  it('reads markup in a bound element of a Rich text field, with problems in the report', () => {
    const e = env({ fields: { body: '**a** {color:#c00}b{/color} **oops' }, fieldTypes: { body: 'rich_text' } })
    const svg = run('<text x="10" y="40" width="300" height="100" font-size="20" data-spadewick-field="body" fill="#000">x</text>', 'bound', e)
    expect(svg).not.toContain('<text')
    expect(svg).toContain('fill="#c00"')
    expect(e.report.markup.map(p => p.type)).toEqual(['unmatched'])
  })

  it('does not read markup in a bound element of a Text field unless the element asks', () => {
    const plain = env({ fields: { body: '**a**' }, fieldTypes: { body: 'text' } })
    const asks = env({ fields: { body: '**a**' }, fieldTypes: { body: 'text' } })
    const w = (e, attr) => ink(render(run(`<text x="10" y="40" width="300" height="100" font-size="30" ${attr} data-spadewick-field="body" fill="#000">x</text>`, 'bound', e)))
    expect(w(plain, '').w).toBeGreaterThan(w(asks, 'data-spadewick-rich="true"').w + 8)
  })

  it('reads markup in a plain element that asks, keeping newlines as lines', () => {
    const e = env()
    const svg = run('<text x="10" y="40" font-size="20" data-spadewick-rich="true" fill="#000">**a**\nb</text>', 'plain', e)
    expect(svg).not.toContain('<text')
    const box = ink(render(svg))
    expect(box.h).toBeGreaterThan(20) // two lines
  })

  it('leaves a rich plain element with child tags to the rasterizer', () => {
    const e = env()
    expect(run('<text x="10" y="40" data-spadewick-rich="true"><tspan>a</tspan></text>', 'plain', e)).toContain('<text')
  })

  it('shrinks rich text with its icons and keeps them in proportion', () => {
    const e = env({ fields: { body: 'Draw {star} cards {heart} now and later and more words to wrap {shield}' }, fieldTypes: { body: 'rich_text' } })
    const svg = run('<text x="10" y="10" width="120" height="60" font-size="24" data-spadewick-field="body" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="24" data-spadewick-text-min-size="6" fill="#000">x</text>', 'bound', e)
    const box = ink(render(svg))
    expect(box.y1).toBeLessThanOrEqual(10 + 60 + 1)
    expect(box.x1).toBeLessThanOrEqual(10 + 120 + 1)
  })

  it('marks elements whose content is a token of a Rich text field before the tokens are filled in', () => {
    const svg = '<svg><text x="1" y="2">{{rich}}</text><text x="1">{{plain}}</text><text data-spadewick-field="rich">{{rich}}</text><text data-spadewick-rich="false">{{rich}}</text></svg>'
    const out = markRichTokens(svg, new Set(['rich']))
    expect(out).toContain('<text x="1" y="2" data-spadewick-rich="true">{{rich}}</text>')
    expect(out).toContain('<text x="1">{{plain}}</text>')
    expect(out).toContain('<text data-spadewick-field="rich">{{rich}}</text>')   // already bound: the field type decides
    expect(out).toContain('data-spadewick-rich="false"')                         // an explicit choice is kept
    expect(markRichTokens(svg, new Set())).toBe(svg)
  })
})
