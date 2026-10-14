/**
 * The parts of the SVG import that need no project (PRD §19): the XML reader, style sheets, geometry, sizes and the
 * matching of names to fields.
 */
import { describe, it, expect } from 'vitest'
import { parseXml, serialize, SvgParseError, textOf, decodeEntities } from '../../src/main/svgImport/xml.js'
import { parseStyleSheet, appliedDeclarations, parseDeclarations } from '../../src/main/svgImport/css.js'
import { parseLength, lengthToMm, parseTransform, elementBox, multiply } from '../../src/main/svgImport/geometry.js'
import { readSize, proposeCardSize, viewBoxFor, generatorOf, rankCardSizes } from '../../src/main/svgImport/size.js'
import { matchField, nameKey, specialOf, sampleText } from '../../src/main/svgImport/bind.js'
import { decodeToolName, cleanTree } from '../../src/main/svgImport/clean.js'
import { dropOffCanvas } from '../../src/main/svgImport/canvas.js'
import { diffFingerprints } from '../../src/main/svgImport/analyze.js'

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`

describe('the XML reader', () => {
  it('reads elements, attributes (with entities) and text, and writes them back', () => {
    const { root } = parseXml(svg('<g id="a &amp; b"><text x="1">Hi &lt;you&gt;</text><rect width=\'5\'/></g>'))
    const g = root.children[0]
    expect(g.attrs.id).toBe('a & b')
    expect(textOf(g.children[0])).toBe('Hi <you>')
    expect(g.children[1].attrs.width).toBe('5')
    expect(serialize(root)).toContain('<g id="a &amp; b"><text x="1">Hi &lt;you&gt;</text><rect width="5"/></g>')
  })

  it('never expands an entity declared in the file and skips the DOCTYPE', () => {
    const { root } = parseXml(`<?xml version="1.0"?><!DOCTYPE svg [ <!ENTITY a "AAAA"> <!ENTITY b "&a;&a;&a;"> ]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text></svg>`)
    expect(serialize(root)).toContain('&b;')
    expect(serialize(root)).not.toContain('AAAA')
    expect(decodeEntities('&#65;&#x42;&bogus;&amp;')).toBe('AB&bogus;&')
  })

  it('keeps CDATA of a style as raw CSS and escapes it elsewhere', () => {
    const { root } = parseXml(svg('<style><![CDATA[.a > .b { fill: red }]]></style><text><![CDATA[1 < 2]]></text>'))
    expect(root.children[0].children[0]).toMatchObject({ text: '.a > .b { fill: red }', raw: true })
    expect(serialize(root.children[1])).toBe('<text>1 &lt; 2</text>')
  })

  it('rejects what is not an SVG file, or is broken, or too deep', () => {
    expect(() => parseXml('plain text')).toThrow(SvgParseError)
    expect(() => parseXml('<html></html>')).toThrow(/not an SVG/)
    expect(() => parseXml('<svg><g></svg>')).toThrow(SvgParseError)
    expect(() => parseXml('<svg>' + '<g>'.repeat(400) + '</g>'.repeat(400) + '</svg>')).toThrow(/deeply/)
    expect(() => parseXml('<svg><!-- never ends</svg>')).toThrow(SvgParseError)
  })

  it('reads the comments before the root (a generator announces itself there)', () => {
    expect(parseXml('<?xml version="1.0"?><!-- Generator: Adobe Illustrator 27 --><svg/>').comments[0]).toContain('Illustrator')
  })
})

describe('style sheets', () => {
  it('reads class, tag and id selectors with their specificity', () => {
    const sheet = parseStyleSheet('.a{fill:red} rect{fill:blue;stroke:#000} #x{fill:green} .a.b{fill:pink}')
    expect(sheet.complex).toBe(false)
    const el = (tag, attrs) => ({ tag, attrs, children: [] })
    expect(appliedDeclarations(sheet.rules, el('rect', { class: 'a' }))).toMatchObject({ fill: 'red', stroke: '#000' })   // class beats tag
    expect(appliedDeclarations(sheet.rules, el('rect', { class: 'a b' })).fill).toBe('pink')
    expect(appliedDeclarations(sheet.rules, el('rect', { class: 'a', id: 'x' })).fill).toBe('green')                      // id beats class
  })

  it('marks rules it cannot move onto elements, counts font faces and imports, and drops them', () => {
    const sheet = parseStyleSheet('@import url(http://e/x.css); @font-face{font-family:E;src:url(http://e/f)} .a .b{fill:red} a:hover{fill:blue} @media print{.c{fill:red}} .ok{fill:#fff}')
    expect(sheet).toMatchObject({ complex: true, fontFaces: 1, imports: 1 })
    expect(sheet.rules.map(r => r.selector.classes[0])).toEqual(['ok'])
    expect(parseDeclarations('fill:#fff; stroke : none !important;;bad')).toEqual({ fill: '#fff', stroke: 'none' })
  })

  it('moves a style sheet onto the elements of a design while cleaning it', () => {
    const { root } = parseXml(svg('<style>.st0{fill:#fff;font-size:12px}.st1{display:none}</style><rect class="st0" width="5" height="5" style="stroke:red"/><g class="st1"><rect id="gone" width="1" height="1"/></g>'))
    const { report } = cleanTree(root)
    const out = serialize(root)
    expect(out).toContain('fill="#fff"'); expect(out).toContain('stroke="red"')
    expect(out).not.toMatch(/<style|class=|gone/)
    expect(report.removed.hidden).toBe(1)
  })
})

describe('lengths, sizes and shapes', () => {
  it('reads units and converts them to millimetres', () => {
    expect(parseLength('12.5mm')).toEqual({ value: 12.5, unit: 'mm' })
    expect(parseLength('100%')).toEqual({ value: 100, unit: '%' })
    expect(parseLength('nonsense')).toBeNull()
    expect(lengthToMm(parseLength('1in'))).toBeCloseTo(25.4)
    expect(lengthToMm(parseLength('72pt'))).toBeCloseTo(25.4)
    expect(lengthToMm(parseLength('96px'))).toBeCloseTo(25.4)
    expect(lengthToMm(parseLength('5'))).toBeNull()
  })

  it('reads the size of a file as each tool writes it', () => {
    expect(readSize({ width: '63.5mm', height: '88.9mm', viewBox: '0 0 63.5 88.9' }, 'inkscape')).toMatchObject({ unit: 'mm', assumed: false, widthMm: 63.5 })
    const ai = readSize({ viewBox: '0 0 180 252' }, 'illustrator')
    expect(ai).toMatchObject({ unit: 'pt', assumed: true }); expect(ai.widthMm).toBeCloseTo(63.5, 1)
    expect(readSize({ width: '300px', height: '420px', viewBox: '0 0 300 420' }, 'sketch')).toMatchObject({ unit: 'px', assumed: true })
    expect(readSize({ width: '100%', height: '100%', viewBox: '0 0 744 1039' }, 'affinity')).toMatchObject({ viewBox: [0, 0, 744, 1039], assumed: true })
    expect(readSize({ width: '300', height: '420' }, 'unknown').viewBox).toEqual([0, 0, 300, 420])
    expect(readSize({}, 'unknown')).toBeNull()
    expect(readSize({ viewBox: '0 0 0 0' }, 'unknown')).toBeNull()
  })

  it('recognises the generator', () => {
    expect(generatorOf(['Generator: Adobe Illustrator 27'], {})).toBe('illustrator')
    expect(generatorOf([], { 'xmlns:inkscape': 'x' })).toBe('inkscape')
    expect(generatorOf(['Generator: Sketch 99'], {})).toBe('sketch')
    expect(generatorOf([], { 'xmlns:serif': 'x' })).toBe('affinity')
    expect(generatorOf([], {})).toBe('unknown')
  })

  it('proposes the closest card size by shape, and by size only when the size is real', () => {
    expect(proposeCardSize(196.85, 274.9, false)).toMatchObject({ cardSize: 'poker', preset: true })        // pixels at 96 dpi: only the shape counts
    expect(proposeCardSize(63.5, 88.9)).toMatchObject({ cardSize: 'poker' })
    expect(proposeCardSize(56, 87)).toMatchObject({ cardSize: 'standard_us' })
    expect(proposeCardSize(88.9, 63.5)).toMatchObject({ cardSize: 'poker', cardMmW: 88.9, cardMmH: 63.5 })  // landscape stays landscape
    expect(proposeCardSize(100, 40)).toMatchObject({ cardSize: 'custom', cardMmW: 100, cardMmH: 40, preset: false })
    expect(rankCardSizes(63.5, 88.9)[0].id).toBe('poker')
  })

  it('puts a design on a card by fit, keep or crop', () => {
    const size = { widthMm: 200 }
    const card = { mmW: 70, mmH: 70 }
    expect(viewBoxFor([0, 0, 200, 100], size, card, 'fit')).toEqual([0, -50, 200, 200])
    expect(viewBoxFor([0, 0, 200, 100], size, card, 'crop')).toEqual([50, 0, 100, 100])
    expect(viewBoxFor([0, 0, 100, 200], size, card, 'fit')).toEqual([-50, 0, 200, 200])
    expect(viewBoxFor([0, 0, 100, 200], size, card, 'crop')).toEqual([0, 50, 100, 100])
    expect(viewBoxFor([0, 0, 200, 100], { widthMm: 100 }, card, 'keep')).toEqual([30, -20, 140, 140])      // a 70 mm window at 0.5 mm per unit is 140 units, centred
    expect(viewBoxFor([0, 0, 100, 100], size, card, 'fit')).toEqual([0, 0, 100, 100])                       // same shape: unchanged
  })
})

describe('transforms and boxes', () => {
  it('reads transform lists', () => {
    expect(parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20])
    expect(parseTransform('matrix(1 0 0 1 12 28)')).toEqual([1, 0, 0, 1, 12, 28])
    expect(parseTransform('translate(5,5) scale(2)')).toEqual([2, 0, 0, 2, 5, 5])
    const r = parseTransform('rotate(90)')
    expect(r[0]).toBeCloseTo(0); expect(r[1]).toBeCloseTo(1)
    expect(multiply([1, 0, 0, 1, 1, 2], [1, 0, 0, 1, 3, 4])).toEqual([1, 0, 0, 1, 4, 6])
  })

  it('measures shapes, paths (relative commands, arcs) and groups with their transforms', () => {
    const el = x => parseXml(svg(x)).root.children[0]
    expect(elementBox(el('<rect x="10" y="20" width="30" height="40"/>'))).toEqual([10, 20, 40, 60])
    expect(elementBox(el('<circle cx="50" cy="50" r="10"/>'))).toEqual([40, 40, 60, 60])
    expect(elementBox(el('<path d="M10 10 h20 v10 h-20 z"/>'))).toEqual([10, 10, 30, 20])
    const arc = elementBox(el('<path d="M0 50 A50 50 0 0 1 100 50"/>'))
    expect(arc[1]).toBeLessThan(5)                                                                  // the arc rises to the top
    expect(elementBox(el('<g transform="translate(5 5)"><rect width="10" height="10"/></g>'))).toEqual([5, 5, 15, 15])
    expect(elementBox(el('<rect width="10" height="10" transform="scale(2)"/>'))).toEqual([0, 0, 20, 20])
    expect(elementBox(el('<text x="10" y="50" font-size="10"><tspan x="12" y="60">abcd</tspan></text>'))[0]).toBe(12)   // the first tspan holds the position
  })
})

describe('names and fields', () => {
  const fields = [
    { name: 'Name', slug: 'name', type: 'text' }, { name: 'Mana cost', slug: 'mana_cost', type: 'text' },
    { name: 'Art', slug: 'art', type: 'image_ref' }, { name: 'Rules text', slug: 'rules_text', type: 'text' }
  ]
  const any = () => true
  it('loose names', () => {
    expect(nameKey('Mana_Cost')).toBe('mana cost'); expect(nameKey('  MANA--cost ')).toBe('mana cost'); expect(nameKey('Café')).toBe('cafe')
    expect(decodeToolName('_x5F_Cost_x20_two')).toBe('_Cost two')
  })
  it('matches exactly, as a copy, by words and by spelling', () => {
    expect(matchField('mana cost', fields, any)).toMatchObject({ confidence: 'exact', field: { slug: 'mana_cost' } })
    expect(matchField('name 1', fields, any)).toMatchObject({ confidence: 'close', note: 'copy', field: { slug: 'name' } })
    expect(matchField('rules', fields, any)).toMatchObject({ confidence: 'close', note: 'words', field: { slug: 'rules_text' } })
    expect(matchField('card name', fields, any)).toMatchObject({ confidence: 'close', note: 'words', field: { slug: 'name' } })
    expect(matchField('nmae', fields, any)).toBeNull()                                             // two edits apart
    expect(matchField('namee', fields, any)).toMatchObject({ confidence: 'close', note: 'spelling' })
    expect(matchField('nothing', fields, any)).toBeNull()
    expect(matchField('art', fields, f => f.type === 'text')).toBeNull()                           // a picture field is not offered to a text
  })
  it('special layer names', () => {
    expect(specialOf('if:cost > 3')).toEqual({ type: 'show', value: 'cost > 3' })
    expect(specialOf('hide-if: x = 1')).toEqual({ type: 'hide', value: 'x = 1' })
    expect(specialOf('icon:fire')).toEqual({ type: 'icon', value: 'fire' })
    expect(specialOf('if cost')).toBeNull()
  })
  it('the text of a text layer: lines are tspans that start a new line', () => {
    const t = x => parseXml(svg(x)).root.children[0]
    expect(sampleText(t('<text><tspan x="1" y="1">One</tspan><tspan x="1" y="9">Two</tspan></text>'))).toBe('One\nTwo')
    expect(sampleText(t('<text><tspan y="1">One </tspan><tspan y="1">more</tspan></text>'))).toBe('One more')
    expect(sampleText(t('<text>Plain</text>'))).toBe('Plain')
  })
})

describe('off-canvas elements', () => {
  it('takes out layer elements that lie wholly outside the picture (the rasterizer cannot draw them) and keeps the rest', () => {
    const { root } = parseXml(svg('<rect id="out" x="500" y="500" width="10" height="10" opacity="0.5"/><rect id="plain" x="500" y="500" width="10" height="10"/><rect id="in" x="10" y="10" width="10" height="10" opacity="0.5"/><g id="half" opacity="0.5"><rect x="90" y="90" width="50" height="50"/></g><g opacity="0.2" transform="translate(-300 0)"><rect width="10" height="10"/></g>'))
    expect(dropOffCanvas(root, [0, 0, 100, 100])).toBe(2)
    const out = serialize(root)
    expect(out).toContain('id="plain"'); expect(out).toContain('id="in"'); expect(out).toContain('id="half"')
    expect(out).not.toContain('id="out"')
  })
})

describe('what changed between two versions of a design', () => {
  const f = (name, rect, hash, occurrence = 0) => ({ name, rect, hash, occurrence })
  it('lists added, removed, moved (or resized) and restyled names', () => {
    const before = [f('A', [0, 0, 10, 10], 'h1'), f('B', [0, 0, 10, 10], 'h2'), f('C', [0, 0, 10, 10], 'h3'), f('D', [0, 0, 10, 10], 'h4')]
    const after = [f('A', [0, 0, 10, 10], 'h1'), f('B', [20, 0, 10, 10], 'h2x'), f('C', [0, 0, 10, 10], 'h3x'), f('E', [0, 0, 1, 1], 'h5')]
    expect(diffFingerprints(before, after)).toEqual({ added: ['E'], removed: ['D'], moved: ['B'], restyled: ['C'] })
    expect(diffFingerprints(null, after).added).toHaveLength(4)
  })
})
