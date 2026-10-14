/**
 * SVG import and automatic binding (PRD §19): fixtures written to resemble what each design tool produces, the clean-up report,
 * the proposed bindings, the template that is made and how a card renders with it, re-import, and hostile files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

const FIX = join(process.cwd(), 'tests/fixtures/svgImport')
const fix = name => join(FIX, `${name}.svg`)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGNgGAWjYBSMglEwCkbBKAAAAwAAB8gABf9UwQAAAABJRU5ErkJggg==', 'base64')

let proj, s
beforeEach(async () => {
  proj = await createTestProject('Imp')
  s = await seedSet({
    name: 'Cards', cardSize: 'poker',
    fields: [
      { name: 'Name', type: 'text' }, { name: 'Mana cost', type: 'text' }, { name: 'Cost', type: 'number' },
      { name: 'Rules', type: 'rich_text' }, { name: 'Art', type: 'image_ref' }, { name: 'Accent colour', type: 'color' }
    ]
  })
})
afterEach(async () => { await proj.cleanup() })

const analyze = (name, extra = {}) => invoke('svgimport:analyze', { path: fix(name), setId: s.set.id, ...extra })
const rowOf = (a, name) => a.rows.find(r => r.name === name)
const exact = a => a.rows.filter(r => r.checked).map(r => ({ key: r.key, action: r.proposal.action === 'token' ? 'token' : r.proposal.action, slug: r.proposal.slug, expr: r.proposal.expr, icon: r.proposal.icon }))
const png = async (cardId, width = 250) => Buffer.from(await invoke('templates:render', { cardId, width }), 'base64')

describe('size and tool detection', () => {
  it('reads Figma pixels, Illustrator points, Inkscape millimetres and a percent-sized Affinity file', async () => {
    const figma = await analyze('figma')
    expect(figma.size).toMatchObject({ unit: 'px', assumed: true, generator: 'unknown' })
    expect(figma.proposal).toMatchObject({ cardSize: 'poker', preset: true })
    const ai = await analyze('illustrator')
    expect(ai.size).toMatchObject({ unit: 'pt', generator: 'illustrator' })
    expect(ai.size.widthMm).toBeCloseTo(63.5, 1)
    expect(ai.proposal.cardSize).toBe('poker')
    const ink = await analyze('inkscape')
    expect(ink.size).toMatchObject({ unit: 'mm', assumed: false, generator: 'inkscape', widthMm: 63.5, heightMm: 88.9 })
    const aff = await analyze('affinity')
    expect(aff.size.viewBox).toEqual([0, 0, 744, 1039])
    expect(aff.size.generator).toBe('affinity')
    const sk = await analyze('sketch')
    expect(sk.size.generator).toBe('sketch')
    expect(sk.proposal.cardSize).toBe('poker')
  })

  it('proposes a custom size when no preset has the shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const p = join(dir, 'wide.svg')
    writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><rect width="100" height="40"/></svg>')
    const a = await invoke('svgimport:analyze', { path: p, setId: s.set.id })
    expect(a.proposal).toMatchObject({ cardSize: 'custom', cardMmW: 100, cardMmH: 40, preset: false })
  })

  it('refuses a file that is not an SVG, is too large or is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const bad = join(dir, 'x.svg'); writeFileSync(bad, 'this is not xml')
    await expect(invoke('svgimport:analyze', { path: bad, setId: s.set.id })).rejects.toThrow(/not an SVG/i)
    const big = join(dir, 'big.svg'); writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 32))
    await expect(invoke('svgimport:analyze', { path: big, setId: s.set.id })).rejects.toThrow(/20 MB/)
    await expect(invoke('svgimport:analyze', { path: join(dir, 'nope.svg'), setId: s.set.id })).rejects.toThrow(/cannot be read/)
    const pdf = join(dir, 'a.svg'); writeFileSync(pdf, '%PDF-1.4 binary')
    await expect(invoke('svgimport:analyze', { path: pdf, setId: s.set.id })).rejects.toThrow()
  })
})

describe('the clean-up report', () => {
  it('lists what a hostile file had and keeps none of it', async () => {
    const a = await analyze('hostile')
    expect(a.report.removed).toMatchObject({ scripts: 1, foreignObjects: 1, animations: 1, styleImports: 1, fontFaces: 1 })
    expect(a.report.removed.handlers).toBeGreaterThanOrEqual(3)
    expect(a.report.removed.externalRefs).toBeGreaterThanOrEqual(2)
    expect(a.report.images.linked.map(l => l.found)).toEqual([false, false, false])
  })

  it('never stores anything unsafe, whatever is decided', async () => {
    const a = await analyze('hostile')
    const r = await invoke('svgimport:apply', { path: fix('hostile'), setId: s.set.id, name: 'Hostile', size: { cardSize: 'poker' }, decisions: exact(a) })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).not.toMatch(/<script|foreignObject|<animate|onload|onclick|onmouseover|javascript:|evil\.example|@import|@font-face|file:|C:\/Windows|secret\.png/i)
    expect(svg).not.toMatch(/<!DOCTYPE|<!ENTITY/)
    expect(svg).not.toMatch(/(?:xlink:)?href="(?!#|\{\{|data:image)/)
  })

  it('removes hidden layers and editor metadata (Inkscape) and reports the counts', async () => {
    const a = await analyze('inkscape')
    expect(a.report.removed.hidden).toBe(1)
    expect(a.report.removed.metadata).toBeGreaterThan(0)
    const r = await invoke('svgimport:apply', { path: fix('inkscape'), setId: s.set.id, name: 'Ink', size: { cardSize: 'poker' }, decisions: exact(a) })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).not.toMatch(/Remember to fix|inkscape|sodipodi|metadata/i)
  })

  it('lists every font with available or missing, and maps a missing one', async () => {
    const a = await analyze('figma')
    expect(a.report.fonts).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'Inter', status: 'missing' }), expect.objectContaining({ family: 'Liberation Serif', status: 'available' })
    ]))
    const r = await invoke('svgimport:apply', { path: fix('figma'), setId: s.set.id, name: 'F', size: { cardSize: 'poker' }, decisions: exact(a), fontMap: { Inter: 'Liberation Sans' } })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).not.toContain('Inter')
    expect(svg).toContain('Liberation Sans')
  })

  it('lists unsupported or print-unsafe features and text that is already outlines', async () => {
    expect((await analyze('figma')).report.unsupported).toMatchObject({ pattern: 1 })
    const ai = await analyze('illustrator')
    expect(ai.outlined).toEqual([expect.objectContaining({ name: 'Title_outlined' })])
  })

  it('extracts embedded pictures to the asset library once, and finds linked ones next to the design', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    mkdirSync(join(dir, 'img'))
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#00ff00' } }).png().toFile(join(dir, 'img', 'a.png'))
    const p = join(dir, 'linked.svg')
    writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="180" height="252" viewBox="0 0 180 252">
      <image id="One" x="0" y="0" width="50" height="50" xlink:href="img/a.png"/><image id="Two" x="60" y="0" width="50" height="50" xlink:href="img/a.png"/>
      <image id="Gone" x="0" y="60" width="50" height="50" xlink:href="img/missing.png"/><image id="Up" x="0" y="120" width="50" height="50" href="../a.png"/></svg>`)
    const a = await invoke('svgimport:analyze', { path: p, setId: s.set.id })
    expect(a.report.images.linked.map(l => [l.href, l.found])).toEqual([['img/a.png', true], ['img/a.png', true], ['img/missing.png', false], ['../a.png', false]])
    const r = await invoke('svgimport:apply', { path: p, setId: s.set.id, name: 'L', size: { cardSize: 'poker' }, decisions: [] })
    expect(r.pictures).toBe(1)                                       // identical pictures are stored once
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect((svg.match(/\{\{@asset\./g) ?? []).length).toBe(2)
    expect(svg).toContain('fill="#cccccc"')                           // the missing ones are grey boxes
    expect((await invoke('assets:list')).length).toBe(1)
  })

  it('looks for linked pictures that are not next to the design only in the folders the person pointed at, by name', async () => {
    // a design that keeps its textures in a folder of its own beside the folder of the design, as the Pelt & Plunder templates do
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    mkdirSync(join(dir, 'cards')); mkdirSync(join(dir, 'textures'))
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#112233' } }).png().toFile(join(dir, 'textures', 'grain.png'))
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#223344' } }).png().toFile(join(dir, 'textures', 'mist.png'))
    const p = join(dir, 'cards', 'back.svg')
    writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" width="63.5mm" height="88.9mm" viewBox="0 0 750 1050">
      <image id="G" x="0" y="0" width="750" height="1050" href="../textures/grain.png"/><image id="M" x="0" y="0" width="750" height="1050" href="../textures/mist.png"/></svg>`)
    const none = await invoke('svgimport:analyze', { path: p, setId: s.set.id })
    expect(none.report.images.linked.map(l => l.found)).toEqual([false, false])        // never by itself: a design cannot read other folders
    const wrong = await invoke('svgimport:analyze', { path: p, setId: s.set.id, searchDirs: [join(dir, 'cards')] })
    expect(wrong.report.images.linked.map(l => l.found)).toEqual([false, false])
    const found = await invoke('svgimport:analyze', { path: p, setId: s.set.id, searchDirs: [join(dir, 'textures')] })
    expect(found.report.images.linked.map(l => l.found)).toEqual([true, true])         // one folder, both pictures
    const bad = await invoke('svgimport:analyze', { path: p, setId: s.set.id, searchDirs: [42, null, '', join(dir, 'textures')] })
    expect(bad.report.images.linked.map(l => l.found)).toEqual([true, true])           // nonsense entries are ignored
    const r = await invoke('svgimport:apply', { path: p, setId: s.set.id, name: 'Back', bleedMm: 0, size: { cardSize: 'poker' }, searchDirs: [join(dir, 'textures')], decisions: [] })
    expect(r.pictures).toBe(2)
    expect((await invoke('templates:get', r.template.id)).svg_source).not.toContain('fill="#cccccc"')   // no grey box is left
  })
})

describe('previews', () => {
  it('draws the design and a thumbnail of each candidate, whatever lies outside the picture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const p = join(dir, 'beside.svg')
    // content beside the artboard with transparency: the rasterizer stops the program on such a layer if it is drawn as it is
    writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="252" viewBox="0 0 180 252"><rect width="180" height="252" fill="#eee"/>
      <rect id="Beside" x="900" y="900" width="50" height="50" opacity="0.5" fill="red"/><g opacity="0.3"><text id="Name" x="10" y="30" font-size="20">Hi</text></g>
      <g opacity="0.3" transform="translate(-500 0)"><rect width="20" height="20"/></g></svg>`)
    const a = await invoke('svgimport:analyze', { path: p, setId: s.set.id })
    const meta = await sharp(Buffer.from(a.preview, 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([420, 588])
    const name = rowOf(a, 'Name')
    expect(name.thumb).toEqual(expect.any(String))
    expect((await sharp(Buffer.from(name.thumb, 'base64')).metadata()).width).toBe(40)
    const r = await invoke('svgimport:apply', { path: p, setId: s.set.id, name: 'Beside', size: { cardSize: 'poker' }, decisions: exact(a) })
    expect(r.warnings).toContain('offCanvas')
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).not.toContain('Beside')
    expect(r.card).toBeTruthy()
    expect((await sharp(await png(r.card.id)).metadata()).width).toBe(250)       // and a card is drawn without trouble
  })
})

describe('proposed bindings', () => {
  it('Figma: exact, close and special names with their confidence', async () => {
    const a = await analyze('figma')
    expect(rowOf(a, 'Name')).toMatchObject({ confidence: 'exact', checked: true, proposal: { action: 'field', slug: 'name' } })
    expect(rowOf(a, 'Mana cost')).toMatchObject({ confidence: 'exact', proposal: { slug: 'mana_cost' } })
    expect(rowOf(a, 'Rules')).toMatchObject({ confidence: 'exact', proposal: { slug: 'rules' } })
    expect(rowOf(a, 'Name_1')).toMatchObject({ confidence: 'close', checked: false, note: 'copy', proposal: { slug: 'name' } })   // id collision: name, name_1
    expect(rowOf(a, 'Art')).toMatchObject({ kind: 'shape', proposal: { action: 'image', slug: 'art' } })
    expect(rowOf(a, 'Accent')).toMatchObject({ proposal: { action: 'color', slug: 'accent_colour' }, confidence: 'close', checked: false, note: 'words' })   // close: waits for the person
    expect(rowOf(a, 'Rules_box')).toMatchObject({ proposal: { action: 'box' }, checked: true })
    expect(rowOf(a, 'hide-if:cost > 5')).toMatchObject({ proposal: { action: 'hide', expr: 'cost > 5' } })
    expect(a.rows.find(r => r.name === 'Rectangle 12')).toBeUndefined()      // a tool's default name is not a name
  })

  it('Illustrator: layer groups give their name to the object, ids with _x5F_ are decoded', async () => {
    const a = await analyze('illustrator')
    expect(rowOf(a, 'Name')).toMatchObject({ kind: 'text', checked: true, proposal: { slug: 'name' } })
    expect(rowOf(a, '_Cost')).toMatchObject({ proposal: { slug: 'cost' } })
    expect(rowOf(a, 'art')).toMatchObject({ kind: 'image', proposal: { action: 'image', slug: 'art' } })
    expect(rowOf(a, 'icon:fire')).toMatchObject({ proposal: { action: 'icon', icon: 'fire' } })
    expect(rowOf(a, 'if:cost>3')).toMatchObject({ proposal: { action: 'show', expr: 'cost>3' } })
  })

  it('keeps a token that is already in the text, and proposes the field when it does not exist yet', async () => {
    const a = await analyze('inkscape')
    expect(a.rows.find(r => r.proposal.action === 'token')).toMatchObject({ confidence: 'token', checked: true, proposal: { slug: 'rules' } })
    const fewer = await invoke('svgimport:analyze', { path: fix('inkscape'), setId: (await invoke('sets:create', { name: 'Empty', cardSize: 'poker' })).id })
    expect(fewer.rows.find(r => r.confidence === 'token')).toMatchObject({ proposal: { action: 'new', slug: 'rules', fromToken: true }, note: 'tokenNew' })
  })

  it('treats case, spaces, hyphens and underscores alike and offers close matches unchecked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const p = join(dir, 'names.svg')
    writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="252" viewBox="0 0 180 252">
      <text id="MANA-COST" x="1" y="10">1</text><text id="mana_cost_2" x="1" y="20">2</text><text id="Cost" x="1" y="30">3</text><text id="Costt" x="1" y="40">4</text><text id="Cardname" x="1" y="50">5</text></svg>`)
    const a = await invoke('svgimport:analyze', { path: p, setId: s.set.id })
    expect(rowOf(a, 'MANA-COST')).toMatchObject({ confidence: 'exact', proposal: { slug: 'mana_cost' } })
    expect(rowOf(a, 'mana_cost_2')).toMatchObject({ confidence: 'close', note: 'copy' })
    expect(rowOf(a, 'Cost')).toMatchObject({ confidence: 'exact', proposal: { slug: 'cost' } })
    expect(rowOf(a, 'Costt')).toMatchObject({ confidence: 'close', note: 'spelling', proposal: { slug: 'cost' } })
  })
})

describe('the template that is made', () => {
  it('Figma: binds, boxes, hides, makes fields and renders a card', async () => {
    const a = await analyze('figma')
    const decisions = exact(a)
    const r = await invoke('svgimport:apply', { path: fix('figma'), setId: s.set.id, name: 'Figma card', size: { cardSize: 'poker' }, decisions })
    expect(r.template.origin).toContain('svg-import')
    const t = await invoke('templates:get', r.template.id)
    expect(t.card_size).toBe('poker')
    const svg = t.svg_source
    expect(svg).toMatch(/<svg [^>]*width="500" height="700" viewBox="0 0 744 1039"/)
    expect(svg).toContain('data-spadewick-field="name"')
    expect(svg).toContain('{{name}}')
    expect(svg).toContain('{{mana_cost}}')
    // the rules text has its box from Rules_box: wraps and shrinks, the original size is the maximum
    expect(svg).toMatch(/<text[^>]*data-spadewick-field="rules"[^>]*>/)
    const rules = /<text[^>]*data-spadewick-field="rules"[^>]*>/.exec(svg)[0]
    expect(rules).toMatch(/width="624"/); expect(rules).toMatch(/height="320"/)
    expect(rules).toContain('data-spadewick-text-fit="shrink"'); expect(rules).toContain('data-spadewick-text-max-size="36"')
    expect(svg).not.toContain('id="Rules_box"')                        // an invisible box was only a guide
    expect(svg).toContain('data-spadewick-hide-if="cost &gt; 5"')
    expect(svg).toMatch(/<image[^>]*href="\{\{art\}\}"/)               // the art rectangle became a picture slot
    expect(svg).toContain('<clipPath')                                  // with its rounded corners
    expect(svg).not.toContain('Old layer')
    expect(r.newFields).toEqual([])
    // the set had no card: one is made from the design's own texts, using the new template
    const cf = JSON.parse(r.card.fields_json)
    expect(cf).toMatchObject({ name: 'Fireball', mana_cost: '3R' })
    expect(cf.rules).toBe('Deal 4 damage to any target.\nBurn it all.')
    expect(r.card.template_id).toBe(r.template.id)
    expect((await invoke('sets:list')).find(x => x.id === s.set.id).default_template_id).toBe(r.template.id)
    const img = await png(r.card.id)
    const meta = await sharp(img).metadata()
    expect([meta.width, meta.height]).toEqual([250, 350])
    // the sample name is drawn where the design had it: dark pixels near the title baseline, left side
    const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true })
    let dark = 0
    for (let y = 20; y < 55; y++) for (let x = 25; x < 120; x++) { const i = (y * info.width + x) * info.channels; if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++ }
    expect(dark).toBeGreaterThan(40)
  })

  it('Illustrator: pictures to assets, an icon placeholder, a condition, a colour, new fields', async () => {
    const a = await analyze('illustrator')
    const decisions = exact(a)
    const r = await invoke('svgimport:apply', { path: fix('illustrator'), setId: s.set.id, name: 'AI', size: { cardSize: 'poker' }, decisions })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).toContain('{{name}}'); expect(svg).toContain('{{cost}}'); expect(svg).toContain('{{rules}}')
    expect(svg).toMatch(/<image[^>]*href="\{\{art\}\}"/)
    expect(svg).toMatch(/<text[^>]*data-spadewick-rich="true"[^>]*>\{icon:fire\}<\/text>/)
    expect(svg).toContain('data-spadewick-show-if="cost&gt;3"')
    expect(svg).not.toContain('class=')                                 // style sheet rules were moved onto the elements
    expect(svg).not.toContain('<style')
    expect(r.pictures).toBe(1)
    expect(JSON.parse(r.card.fields_json).art).toMatch(/^asset:/)
    expect((await invoke('assets:list')).length).toBe(1)
    const img = await png(r.card.id)
    expect((await sharp(img).metadata()).width).toBe(250)
  })

  it('creates the fields the person asks for, with the design text as the card sample', async () => {
    const a = await analyze('sketch')
    const effect = a.rows.find(r => r.name === 'Effect')
    const decisions = [...exact(a), { key: effect.key, action: 'new', newName: 'Effect text', newType: 'text' }]
    const r = await invoke('svgimport:apply', { path: fix('sketch'), setId: s.set.id, name: 'Sk', size: { cardSize: 'poker' }, decisions })
    expect(r.newFields).toEqual(['effect_text'])
    const fields = await invoke('fields:list', s.set.id)
    expect(fields.find(f => f.slug === 'effect_text')).toMatchObject({ name: 'Effect text', type: 'text' })
    expect(JSON.parse(r.card.fields_json)).toMatchObject({ name: 'Fireball', effect_text: 'Deal damage.\nDraw a card.' })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).toContain('{{effect_text}}')
    expect(svg).toMatch(/<text[^>]*data-spadewick-field="name"[^>]*width="200"/)  // Name_box is the frame of the name
  })

  it('keeps typed free text on a text layer instead of binding it to a field', async () => {
    const a = await analyze('sketch')
    const effect = a.rows.find(r => r.name === 'Effect')
    const r = await invoke('svgimport:apply', { path: fix('sketch'), setId: s.set.id, name: 'Free', size: { cardSize: 'poker' }, decisions: [{ key: effect.key, action: 'free', text: 'Draw <2> & win' + String.fromCharCode(10) + 'Twice' }] })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).toContain('Draw &lt;2&gt; &amp; win')
    expect(svg).toMatch(/<tspan[^>]*dy="/)
    expect(svg).not.toContain('Deal damage')
    expect(r.newFields).toEqual([])
    expect(JSON.parse(r.template.origin).bindings).toEqual([expect.objectContaining({ action: 'free', text: 'Draw <2> & win' + String.fromCharCode(10) + 'Twice' })])
  })

  it('uses a different slug when the new field name is taken', async () => {
    const a = await analyze('sketch')
    const effect = a.rows.find(r => r.name === 'Effect')
    const r = await invoke('svgimport:apply', { path: fix('sketch'), setId: s.set.id, name: 'Sk', size: { cardSize: 'poker' }, decisions: [{ key: effect.key, action: 'new', newName: 'Name', newType: 'text' }] })
    expect(r.newFields).toEqual(['name_2'])
  })

  it('fit, keep and crop put the design on a card of another shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const p = join(dir, 'wide.svg')
    writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#f00"/></svg>')
    const vbOf = async fit => {
      const r = await invoke('svgimport:apply', { path: p, setId: s.set.id, name: fit, size: { cardSize: 'square' }, fit, decisions: [] })
      return /viewBox="([^"]*)"/.exec((await invoke('templates:get', r.template.id)).svg_source)[1].split(' ').map(Number)
    }
    expect(await vbOf('fit')).toEqual([0, -50, 200, 200])               // the whole design, centred, bars above and below
    expect(await vbOf('crop')).toEqual([50, 0, 100, 100])               // the card filled, the sides cut
    const keep = await vbOf('keep')
    expect(keep[2] / keep[3]).toBeCloseTo(1, 5)
  })

  it('bleed in the file is cut off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const p = join(dir, 'bleed.svg')
    writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg" width="69.5mm" height="94.9mm" viewBox="0 0 69.5 94.9"><rect width="69.5" height="94.9"/></svg>')
    const a = await invoke('svgimport:analyze', { path: p, setId: s.set.id, bleedMm: 3 })
    expect(a.size.widthMm).toBeCloseTo(63.5, 1)
    expect(a.proposal.cardSize).toBe('poker')
    const r = await invoke('svgimport:apply', { path: p, setId: s.set.id, name: 'B', size: { cardSize: 'poker' }, bleedMm: 3, decisions: [] })
    const vb = /viewBox="([^"]*)"/.exec((await invoke('templates:get', r.template.id)).svg_source)[1].split(' ').map(Number)
    expect(vb[0]).toBeCloseTo(3, 3); expect(vb[2]).toBeCloseTo(63.5, 3)
  })

  it('is one undo step for fields, pictures and the template', async () => {
    const a = await analyze('illustrator')
    const sketch = await analyze('sketch')
    const before = { fields: (await invoke('fields:list', s.set.id)).length, templates: (await invoke('templates:list')).length, assets: (await invoke('assets:list')).length }
    const r = await invoke('svgimport:apply', { path: fix('illustrator'), setId: s.set.id, name: 'U', size: { cardSize: 'poker' }, sampleCard: false, decisions: [...exact(a), { key: a.rows.find(x => x.name === 'Name').key, action: 'none' }, { key: sketch.rows[0].key, action: 'none' }] })
    expect((await invoke('assets:list')).length).toBe(before.assets + 1)
    await invoke('history:undo')
    expect((await invoke('templates:list')).length).toBe(before.templates)
    expect((await invoke('assets:list')).length).toBe(before.assets)
    await invoke('history:redo')
    expect((await invoke('templates:list')).length).toBe(before.templates + 1)
    expect((await invoke('assets:list')).length).toBe(before.assets + 1)
    expect(existsSync(join(proj.dir, 'assets', (await invoke('assets:list'))[0].filename))).toBe(true)
    expect(r.template.name).toBe('U')
  })
})

describe('re-import', () => {
  it('keeps the bindings by name, reviews only the new names, and says what changed', async () => {
    const a = await analyze('figma')
    const first = await invoke('svgimport:apply', { path: fix('figma'), setId: s.set.id, name: 'Fig', size: { cardSize: 'poker' }, decisions: exact(a) })
    // a newer design: the title moved, a new "Cost" text arrived, the hide layer is gone
    const dir = mkdtempSync(join(tmpdir(), 'svg-'))
    const next = join(dir, 'figma2.svg')
    let src = readFileSync(fix('figma'), 'utf8')
    src = src.replace('<tspan x="60" y="104.8">Fireball', '<tspan x="80" y="120">Fireball').replace('<text id="Name"', '<text id="Name" x="80" y="120"')
    src = src.replace('<g id="hide-if:cost &gt; 5"><circle cx="700" cy="40" r="20" fill="#FFD400"/></g>', '<text id="Cost" fill="#000" font-family="Liberation Serif" font-size="30"><tspan x="10" y="30">7</tspan></text>')
    writeFileSync(next, src)
    const r = await invoke('svgimport:analyze', { path: next, setId: s.set.id, templateId: first.template.id })
    expect(r.proposal.cardSize).toBe('fixed')
    expect(r.reimport.changes.added).toContain('Cost')
    expect(r.reimport.changes.removed).toContain('hide-if:cost > 5')
    expect(r.reimport.changes.moved).toContain('Name')
    expect(r.reimport.removed.map(x => x.name)).toContain('hide-if:cost > 5')
    expect(rowOf(r, 'Name')).toMatchObject({ confidence: 'kept', checked: true, proposal: { action: 'field', slug: 'name' } })
    expect(rowOf(r, 'Rules')).toMatchObject({ confidence: 'kept' })
    expect(rowOf(r, 'Cost')).toMatchObject({ confidence: 'exact', proposal: { slug: 'cost' } })   // new: goes through the review
    const decisions = r.rows.filter(x => x.checked).map(x => ({ key: x.key, action: x.proposal.action, slug: x.proposal.slug, expr: x.proposal.expr, icon: x.proposal.icon }))
    const keepId = r.reimport.removed.find(x => x.name === 'hide-if:cost > 5').id
    const done = await invoke('svgimport:apply', { path: next, setId: s.set.id, templateId: first.template.id, decisions, keepRemoved: [keepId] })
    expect(done.template.id).toBe(first.template.id)
    const svg = (await invoke('templates:get', first.template.id)).svg_source
    expect(svg).toContain('{{name}}'); expect(svg).toContain('{{cost}}')
    expect(svg).toContain('data-spadewick-hide-if="cost &gt; 5"')            // the removed layer was kept on request
    expect((await invoke('templates:list')).filter(t => t.name === 'Fig')).toHaveLength(1)
    await invoke('history:undo')                                           // the previous version comes back
    expect((await invoke('templates:get', first.template.id)).svg_source).not.toContain('{{cost}}')
  })

  it('refuses a template that was not made by an import', async () => {
    const t = await invoke('templates:create', { name: 'Plain', svgSource: '<svg xmlns="http://www.w3.org/2000/svg"/>', cardSize: 'poker' })
    await expect(invoke('svgimport:analyze', { path: fix('figma'), setId: s.set.id, templateId: t.id })).rejects.toThrow(/not made by an SVG import/)
  })
})

describe('real exports of the tools', () => {
  it('Affinity and Sketch bind through their names and styles', async () => {
    const aff = await analyze('affinity')
    expect(aff.rows.map(r => [r.name, r.proposal.slug])).toEqual([['Name', 'name'], ['Cost', 'cost']])
    const r = await invoke('svgimport:apply', { path: fix('affinity'), setId: s.set.id, name: 'Aff', size: { cardSize: 'poker' }, decisions: exact(aff) })
    const svg = (await invoke('templates:get', r.template.id)).svg_source
    expect(svg).toContain('font-size="56px"')                            // the style moved onto the element where the engine reads it
    expect(svg).toContain('{{cost}}')
    expect(svg).not.toContain('serif:')
    const sk = await analyze('sketch')
    const done = await invoke('svgimport:apply', { path: fix('sketch'), setId: s.set.id, name: 'Sk', size: { cardSize: 'poker' }, decisions: exact(sk) })
    expect((await invoke('templates:get', done.template.id)).svg_source).toContain('data-spadewick-field="name"')
  })
})

describe('every element of the design is a layer of its own', () => {
  const NESTED = `<svg xmlns="http://www.w3.org/2000/svg" width="63.5mm" height="88.9mm" viewBox="0 0 750 1050">
    <defs><linearGradient id="gold"><stop offset="0" stop-color="#d2b98a"/><stop offset="1" stop-color="#8a7a58"/></linearGradient><clipPath id="c"><rect width="750" height="1050"/></clipPath></defs>
    <rect id="bg" width="750" height="1050" fill="#141211"/>
    <g id="trim" transform="translate(0 0)"><path id="path1234" d="M20 20H730V1030H20Z" fill="none" stroke="#8a7a58" stroke-width="3"/>
      <g id="Sigil"><circle cx="100" cy="100" r="40" fill="url(#gold)"/><path d="M60 60L140 140" stroke="#fff"/></g>
      <text id="name" x="375" y="98" font-size="38" fill="#ebe7df" text-anchor="middle">{{name}}</text>
      <text x="40" y="900" font-size="20" fill="#fff"><tspan x="40">Fixed words</tspan></text></g></svg>`
  const run = async (svg, extra = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-')); const p = join(dir, 'nested.svg'); writeFileSync(p, svg)
    const a = await invoke('svgimport:analyze', { path: p, setId: s.set.id, ...extra })
    const out = await invoke('svgimport:apply', { path: p, setId: s.set.id, name: 'N', size: { cardSize: 'poker' }, decisions: a.rows.filter(r => r.checked).map(r => ({ key: r.key, action: r.proposal.action, slug: r.proposal.slug })), ...extra })
    return { out, svg: (await invoke('templates:get', out.template.id)).svg_source }
  }
  const idOf = (svg, re) => new RegExp(`<${re}[^>]*data-spadewick-id="([^"]+)"`).exec(svg)?.[1]

  it('gives the elements inside groups ids as well, named after what they are called, and leaves definitions and the pieces of a text alone', async () => {
    const { svg } = await run(NESTED)
    const ids = [...svg.matchAll(/data-spadewick-id="([^"]+)"/g)].map(m => m[1])
    expect(ids).toEqual(expect.arrayContaining(['bg', 'trim', 'sigil', 'name']))              // the groups and what is in them
    expect(ids.filter(i => /^path/.test(i)).length).toBe(2)                                     // both paths, the one with a tool's own name and the one with none
    expect(ids.filter(i => /^circle/.test(i)).length).toBe(1)
    expect(new Set(ids).size).toBe(ids.length)                                                 // every one different
    expect(idOf(svg, 'linearGradient')).toBeUndefined()
    expect(idOf(svg, 'stop')).toBeUndefined()
    expect(idOf(svg, 'clipPath')).toBeUndefined()
    expect(idOf(svg, 'tspan')).toBeUndefined()
    expect(ids.length).toBe(8)                                                                 // bg, trim, path, Sigil, circle, path, name, the fixed text
  })

  it('keeps the first 2,000 layers of a very large design, and says so', async () => {
    const many = `<svg xmlns="http://www.w3.org/2000/svg" width="63.5mm" height="88.9mm" viewBox="0 0 750 1050"><g id="all">${'<path d="M0 0L5 5"/>'.repeat(2100)}</g></svg>`
    const { out, svg } = await run(many)
    expect((svg.match(/data-spadewick-id=/g) ?? []).length).toBe(2000)
    expect(out.warnings).toContain('layersLimit')
  }, 60000)
})
