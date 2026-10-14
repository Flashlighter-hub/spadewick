/**
 * The print preflight (PRD §17.7): a fixture card for every kind of finding, each deliberately wrong and expected to give exactly
 * that finding (with the right card, template and element for "Show me"), and a clean card expected to give none.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let proj, out
beforeEach(async () => { proj = await createTestProject('Pre'); out = mkdtempSync(join(tmpdir(), 'pre-')) })
afterEach(async () => { await proj.cleanup() })

const doc = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350">${defs}<rect width="250" height="350" fill="#f4ebd0"/>${body}</svg>`
const NAME = (attrs = '', fill = '#222222') => `<text data-spadewick-id="title" data-spadewick-field="name" x="40" y="60" font-size="24" fill="${fill}" ${attrs}>{{name}}</text>`
const CLEAN = doc(NAME())

async function seed(svg, { fields = [], fieldValues = {}, cards = 1 } = {}) {
  const s = await seedSet({ name: 'Deck', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }, ...fields], template: { svg },
    cards: Array.from({ length: cards }, (_, i) => ({ name: `Card ${i + 1}`, fields: { name: `C${i}`, ...fieldValues } })) })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const check = (s, opts = {}) => invoke('preflight:run', { setIds: [s.set.id], cardBack: 'color', ...opts })
const find = (res, type, pred = () => true) => res.groups.find(g => g.type === type && pred(g))
const types = res => res.groups.map(g => g.type)
const png = async (name, w, h, color = '#336699') => { const p = join(out, name); await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(p); return p }
const importPng = async (name, w, h) => (await invoke('assets:import', [await png(name, w, h)]))[0]

describe('a clean card', () => {
  it('has no errors and no warnings', async () => {
    const res = await check(await seed(CLEAN))
    expect(res.counts).toMatchObject({ error: 0, warning: 0 })
    expect(res.checked).toBe(1)
    expect(res.minimums).toMatchObject({ textPt: 6, ppiWarn: 300, ppiError: 150 })
  })
})

describe('the export settings', () => {
  it('no bleed is an error', async () => {
    const res = await check(await seed(CLEAN), { bleedMm: 0 })
    expect(find(res, 'noBleed')).toMatchObject({ severity: 'error' })
  })

  it('marks that do not fit the margin and a safe area as big as the card are inconsistent settings', async () => {
    const s = await seed(CLEAN)
    expect(find(await check(s, { cropMarks: true, marksMarginMm: 4 }), 'settings').detail).toEqual({ problem: 'marksMargin' })
    expect(find(await check(s, { safeMm: 16 }), 'settings').detail).toEqual({ problem: 'safeLarge' })
  })

  it('a missing output profile is an error and the colour checks are skipped', async () => {
    const res = await check(await seed(CLEAN), { profileId: 'gone' })
    expect(find(res, 'profileMissing')).toMatchObject({ severity: 'error' })
    expect(types(res)).not.toContain('outOfGamut')
  })

  it('a die line the manufacturer requires and the settings leave out is a warning', async () => {
    const s = await seed(CLEAN)
    await invoke('preflight:set-minimums', { requireDieLine: true })
    expect(find(await check(s), 'dieLineMissing')).toMatchObject({ severity: 'warning' })
    expect(find(await check(s, { dieLine: 'spot' }), 'dieLineMissing')).toBeUndefined()
  })

  it('the card back: none is an error, a missing picture is an error, a picture of another shape is an error', async () => {
    const s = await seed(CLEAN)
    expect(find(await check(s, { cardBack: 'none' }), 'backMissing')).toMatchObject({ severity: 'error' })
    expect(find(await check(s, { cardBack: 'asset', cardBackAssetId: 'nope' }), 'backFile')).toMatchObject({ severity: 'error' })
    const square = await importPng('sq.png', 100, 100), right = await importPng('ok.png', 250, 350)
    expect(find(await check(s, { cardBack: 'asset', cardBackAssetId: square.id }), 'backShape')).toMatchObject({ severity: 'error', detail: { ratio: 1, want: 0.71 } })
    expect(types(await check(s, { cardBack: 'asset', cardBackAssetId: right.id }))).not.toContain('backShape')
  })

  it('a template with less bleed of its own than the export asks for is told so, as information', async () => {
    const s = await seed(CLEAN)
    await invoke('templates:update', { id: s.template.id, bleedMm: 1, bleedMode: 'included' })
    expect(find(await check(s, { bleedMm: 3 }), 'bleedCarried')).toMatchObject({ severity: 'info', detail: { have: 1, want: 3 }, template: { id: s.template.id } })
  })

  it('a very large file is information', async () => {
    const s = await seed(CLEAN)
    await invoke('cards:update', { id: s.cards[0].id, quantity: 300 })
    expect(find(await check(s, { repeatCopies: true }), 'fileSize')).toMatchObject({ severity: 'info' })
  })
})

describe('text', () => {
  it('text outside the safe area is a warning that names the card, template and element', async () => {
    const s = await seed(doc(NAME().replace('x="40"', 'x="3"')))
    const g = find(await check(s), 'safeArea')
    expect(g).toMatchObject({ severity: 'warning', element: { id: 'title', field: 'name' }, template: { id: s.template.id }, count: 1 })
    expect(g.cards[0]).toMatchObject({ id: s.cards[0].id, name: 'Card 1' })
    expect(types(await check(s, { safeMm: 0 }))).not.toContain('safeArea')
  })

  it('text under the minimum size is a warning, and reversed (light) text has its own minimum', async () => {
    const dark = await check(await seed(doc(NAME().replace('font-size="24"', 'font-size="6"'))))
    expect(find(dark, 'textSmall')).toMatchObject({ severity: 'warning', detail: { pt: 4.3, min: 6, reversed: false } })
    const reversed = await check(await seed(doc(NAME('', '#ffffff').replace('font-size="24"', 'font-size="9"'))))
    expect(find(reversed, 'textSmall')).toMatchObject({ detail: { pt: 6.5, min: 8, reversed: true } })
    const big = await check(await seed(doc(NAME().replace('font-size="24"', 'font-size="9"'))))
    expect(types(big)).not.toContain('textSmall')                                                    // 6.5 pt is over the 6 pt minimum
  })

  it('small pure black text is a warning, and information once a print colour makes it pure K', async () => {
    const s = await seed(doc(NAME('', '#000000').replace('font-size="24"', 'font-size="12"')))
    expect(find(await check(s), 'blackText')).toMatchObject({ severity: 'warning', detail: { printColor: false } })
    await invoke('printcolors:create', { name: 'Black', rgb: '#000000', cmyk: [0, 0, 0, 100] })
    expect(find(await check(s), 'blackText')).toMatchObject({ severity: 'info', detail: { printColor: true } })
    const largeBlack = await seed(doc(NAME('', '#000000').replace('font-size="24"', 'font-size="40"')))
    expect(types(await check(largeBlack))).not.toContain('blackText')
  })

  it('a missing icon, a missing character and text that does not fit are errors, from the text check', async () => {
    const s = await seedSet({ name: 'Rich', cardSize: 'poker', fields: [{ name: 'Body', type: 'rich_text' }], template: { svg: doc('<text data-spadewick-id="body" data-spadewick-field="body" x="40" y="60" width="170" height="30" font-size="20" font-family="Liberation Sans" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="18" fill="#222">{{body}}</text>') },
      cards: [{ name: 'A', fields: { body: 'x {nosuch} y' } }, { name: 'B', fields: { body: '中' } }, { name: 'C', fields: { body: 'word '.repeat(60) } }] })
    await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
    const res = await check(s)
    expect(find(res, 'missingIcon')).toMatchObject({ severity: 'error', detail: { name: 'nosuch' } })
    expect(find(res, 'missingGlyph')).toMatchObject({ severity: 'error' })
    expect(find(res, 'noFit')).toMatchObject({ severity: 'error' })
  })

  it('a font that forbids embedding is a warning, not an error', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync(join(process.cwd(), 'resources/fonts/LiberationMono-Regular.ttf'))
    for (let i = 0; i < src.readUInt16BE(4); i++) { const r = 12 + i * 16; if (src.toString('latin1', r, r + 4) === 'OS/2') src.writeUInt16BE(0x0002, src.readUInt32BE(r + 8) + 8) }
    const file = join(out, 'Restricted.ttf'); writeFileSync(file, src)
    await invoke('fonts:import', [file])
    const res = await check(await seed(doc(NAME('font-family="Liberation Mono"'))))
    expect(find(res, 'fontForbids')).toMatchObject({ severity: 'warning', detail: { family: 'Liberation Mono' } })
  })
})

describe('strokes, transparency and the edge', () => {
  it('a stroke thinner than the minimum is a warning', async () => {
    const s = await seed(doc(NAME() + '<rect data-spadewick-id="frame" x="40" y="100" width="100" height="80" fill="none" stroke="#333" stroke-width="0.1"/>'))
    expect(find(await check(s), 'strokeThin')).toMatchObject({ severity: 'warning', detail: { min: 0.25 }, element: { id: 'frame' } })
    const fine = await seed(doc(NAME() + '<rect x="40" y="100" width="100" height="80" fill="none" stroke="#333" stroke-width="2"/>'))
    expect(types(await check(fine))).not.toContain('strokeThin')
  })

  it('elements that need transparency are listed as information', async () => {
    const s = await seed(doc(NAME() + '<rect data-spadewick-id="glass" x="40" y="100" width="100" height="80" fill="#fff" opacity="0.5"/><g data-spadewick-hide-if="1"><rect id="guide" width="9" height="9" opacity="0.1"/></g>'))
    const res = await check(s)
    expect(res.groups.filter(g => g.type === 'transparency').map(g => [g.severity, g.element.id, g.detail.kind])).toEqual([['info', 'glass', 'opacity']])   // the hidden guide is not on the card
  })

  it('transparent rounded corners and a busy edge are warnings when the bleed is made from the edge, and not when the template has its own', async () => {
    const rounded = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" rx="30" fill="#f4ebd0"/></svg>'
    const s = await seed(rounded)
    expect(find(await check(s), 'edgeNotPlain').detail).toEqual({ reason: 'transparent' })
    const stripes = doc(Array.from({ length: 70 }, (_, i) => `<rect x="${i * 3.6}" y="0" width="1.8" height="350" fill="hsl(${i * 37 % 360} 70% 50%)"/>`).join(''))
    expect(find(await check(await seed(stripes)), 'edgeNotPlain').detail).toEqual({ reason: 'busy' })
    await invoke('templates:update', { id: s.template.id, bleedMode: 'fill', bleedColor: '#f4ebd0' })
    expect(types(await check(s))).not.toContain('edgeNotPlain')
    expect(types(await check(await seed(CLEAN)))).not.toContain('edgeNotPlain')
  })
})

describe('pictures', () => {
  const ART = doc(NAME() + '<image data-spadewick-id="art" x="25" y="100" width="100" height="100" href="{{art}}" preserveAspectRatio="xMidYMid slice"/>')
  const artField = [{ name: 'Art', type: 'image_ref' }]

  it('a picture below 150 ppi at its placed size is an error, between 150 and 300 a warning, and sharp enough passes', async () => {
    const low = await importPng('low.png', 40, 40), mid = await importPng('mid.png', 200, 200), good = await importPng('good.png', 500, 500)
    for (const [asset, severity, ppi] of [[low, 'error', 40], [mid, 'warning', 200], [good, null, null]]) {
      const s = await seed(ART, { fields: artField, fieldValues: { art: `asset:${asset.id}` } })
      const g = find(await check(s), 'imageLowRes')
      if (!severity) expect(g).toBeUndefined()
      else expect(g).toMatchObject({ severity, detail: { ppi }, element: { id: 'art' } })
    }
  })

  it('a picture that is gone is an error, an empty field is not', async () => {
    const a = await importPng('x.png', 400, 400)
    const s = await seed(ART, { fields: artField, fieldValues: { art: `asset:${a.id}` } })
    await invoke('assets:delete', [a.id])
    expect(find(await check(s), 'missingImage')).toMatchObject({ severity: 'error', detail: { name: 'art', where: 'card' } })
    expect(types(await check(await seed(ART, { fields: artField })))).not.toContain('missingImage')
  })

  it('a fixed picture of the template is checked too, wherever it is written', async () => {
    const a = await importPng('fixed.png', 30, 30)
    const s = await seed(doc(NAME() + `<image data-spadewick-id="logo" x="25" y="100" width="100" height="100" href="{{@asset.${a.id}}}"/>`))
    expect(find(await check(s), 'imageLowRes')).toMatchObject({ severity: 'error', element: { id: 'logo' } })
  })
})

describe('colour', () => {
  it('total ink above the limit is a warning with the highest value; no limit, no warning', async () => {
    const s = await seed(doc('<rect width="250" height="350" fill="#000000"/>'))
    const g = find(await check(s, { inkLimit: 200 }), 'inkLimit')
    expect(g).toMatchObject({ severity: 'warning', detail: { limit: 200 } })
    expect(g.max).toBeGreaterThan(200)
    expect(types(await check(s, { inkLimit: null }))).not.toContain('inkLimit')
  })

  it('colours the press cannot print are information with their share of the card', async () => {
    const s = await seed(doc('<rect width="250" height="350" fill="#00ffff"/>'))
    const g = find(await check(s), 'outOfGamut')
    expect(g).toMatchObject({ severity: 'info' })
    expect(g.max).toBeGreaterThan(90)
    expect(types(await check(await seed(CLEAN)))).not.toContain('outOfGamut')
  })
})

describe('grouping, selection and the minimums', () => {
  it('a problem many cards share is one line with the count and every card', async () => {
    const s = await seed(doc(NAME().replace('x="40"', 'x="3"')), { cards: 30 })
    const res = await check(s)
    const groups = res.groups.filter(g => g.type === 'safeArea')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 30 }); expect(groups[0].cards).toHaveLength(30)
  })

  it('checks only the cards chosen, and orders errors before warnings before information', async () => {
    const s = await seed(doc(NAME().replace('x="40"', 'x="3"') + '<rect width="250" height="350" fill="#00ffff" opacity="0.9"/>'), { cards: 2 })
    const one = await check(s, { cardIds: [s.cards[1].id] })
    expect(one.checked).toBe(1)
    expect(find(one, 'safeArea').cards.map(c => c.id)).toEqual([s.cards[1].id])
    const all = await check(s, { cardBack: 'none' })
    const order = all.groups.map(g => ['error', 'warning', 'info'].indexOf(g.severity))
    expect(order).toEqual([...order].sort())
    expect(all.counts.error).toBeGreaterThan(0)
  })

  it('keeps the minimums in the project, applies them, and refuses values out of range', async () => {
    const s = await seed(doc(NAME().replace('font-size="24"', 'font-size="6"')))
    expect(find(await check(s), 'textSmall')).toBeTruthy()
    const saved = await invoke('preflight:set-minimums', { textPt: 3, strokePt: 0.1 })
    expect(saved).toMatchObject({ textPt: 3, strokePt: 0.1, ppiWarn: 300 })
    expect(await invoke('preflight:get-minimums')).toMatchObject({ textPt: 3 })
    expect(types(await check(s))).not.toContain('textSmall')
    expect(find(await check(s, { minimums: { textPt: 8 } }), 'textSmall')).toBeTruthy()                 // for this run only
    expect((await invoke('preflight:default-minimums')).textPt).toBe(6)
    await expect(invoke('preflight:set-minimums', { textPt: 0 })).rejects.toThrow(/not valid/)
    await expect(invoke('preflight:set-minimums', { ppiWarn: 100, ppiError: 200 })).rejects.toThrow(/not valid/)
  })

  it('an empty selection is not an error: nothing to check', async () => {
    const s = await seed(CLEAN)
    const res = await check(s, { cardIds: ['none'] })
    expect(res.checked).toBe(0)
  })
})
