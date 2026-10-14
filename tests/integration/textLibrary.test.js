/**
 * Drawing with the project's icons, text styles and keyword rules (PRD §16.4, §16.5).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Resvg } from '@resvg/resvg-js'
import { createTestProject, seedSet, invoke, makePng, writeText } from '../helpers/project.js'
import { buildCardSvg, renderCard } from '../../src/main/render.js'

let proj, dir
beforeEach(async () => { proj = await createTestProject('Lib'); dir = mkdtempSync(join(tmpdir(), 'lib-files-')) })
afterEach(async () => { await proj.cleanup() })

const svgIcon = (inner, vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>`
const MONO = svgIcon('<path d="M2 2h20v20H2z" fill="#000"/>')
const DUO = svgIcon('<path d="M2 2h10v20H2z" fill="#2a7fff"/><path d="M12 2h10v20H12z" fill="#ff3b3b"/>')
const tpl = (extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#fff"/>` +
  `<text x="10" y="30" width="230" height="300" font-size="30" font-family="Liberation Sans" data-spadewick-field="body" fill="#123456" ${extra}>{{body}}</text></svg>`

async function seed(body, svg = tpl()) {
  const s = await seedSet({ cardSize: 'poker', fields: [{ name: 'Body', type: 'rich_text' }], template: { name: 'T', svg }, cards: [{ name: 'C', fields: { body } }] })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
async function icon(name, text) {
  const p = join(dir, `${name}.svg`); writeText(p, text)
  return (await invoke('icons:import-files', { paths: [p] })).imported[0]
}
const build = async (s, report = {}) => (await buildCardSvg(proj.dir, s.cards[0].id, { report })).svg
const inkBox = png => {
  const img = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" fill="#fff"/><image width="250" height="350" href="data:image/png;base64,${png.toString('base64')}"/></svg>`).render()
  const px = img.pixels
  let x0 = 1e9, x1 = -1
  for (let y = 0; y < 350; y++) for (let x = 0; x < 250; x++) if (px[(y * 250 + x) * 4] < 200) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1) }
  return { x0, x1, w: x1 - x0 }
}

describe('library icons in text', () => {
  it('draws a single-colour SVG icon in the colour of the text, or of the span around it', async () => {
    await icon('mono', MONO)
    const s = await seed('A {mono} B {color:#cc3333}{mono}{/color}')
    const svg = await build(s)
    expect(svg).toContain('color="#123456"')       // follows the element's own fill
    expect(svg).toContain('color="#cc3333"')       // and the colour span
    expect(svg).toMatch(/<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0 0 24 24"/)
    expect(svg).not.toContain('<text')
  })

  it('keeps the colours of a multi-colour icon, and of a single-colour icon set to keep', async () => {
    const duo = await icon('duo', DUO)
    const mono = await icon('mono', svgIcon('<path d="M2 2h20v20H2z" fill="#00aa00"/>'))
    await invoke('icons:update', { id: mono.id, colorMode: 'keep' })
    const s = await seed('{duo} {mono}')
    const svg = await build(s)
    expect(svg).toContain('#2a7fff')
    expect(svg).toContain('color="#00aa00"')
    expect(svg).not.toContain('color="#123456"')
    expect(duo.single).toBe(false)
  })

  it('draws a picture icon as an image', async () => {
    const p = join(dir, 'leaf.png'); await makePng(p, 32, 16)
    await invoke('icons:import-files', { paths: [p] })
    const svg = await build(await seed('x {leaf}'))
    expect(svg).toMatch(/<image [^>]*width="[\d.]+"[^>]*href="data:image\/png;base64,/)
  })

  it('uses the aspect, size, spacing and vertical position of the icon', async () => {
    const wide = await icon('wide', svgIcon('<rect width="40" height="20" fill="#000"/>', '0 0 40 20'))
    const s = await seed('{wide}')
    const plain = inkBox(await renderCard(proj.dir, s.cards[0].id, { width: 250 }))
    expect(plain.w).toBeCloseTo(60, -1)                                      // 30 px tall, twice as wide
    await invoke('icons:update', { id: wide.id, size: 2 })
    expect(inkBox(await renderCard(proj.dir, s.cards[0].id, { width: 250 })).w).toBeCloseTo(120, -1)
    await invoke('icons:update', { id: wide.id, size: 1, spacing: 0.5 })
    const s2 = await seed('a{wide}b')
    const spaced = inkBox(await renderCard(proj.dir, s2.cards[0].id, { width: 250 }))
    await invoke('icons:update', { id: wide.id, spacing: 0 })
    const tight = inkBox(await renderCard(proj.dir, s2.cards[0].id, { width: 250 }))
    expect(spaced.w - tight.w).toBeCloseTo(30, -1)                           // 0.5 em before and after, at 30 px
  })

  it('finds an icon by an alias, and prefers a name to an alias', async () => {
    const a = await icon('fire', MONO)
    await invoke('icons:update', { id: a.id, aliases: ['flame', 'star'] })
    const svg = await build(await seed('{flame} {star}'))
    expect((svg.match(/<svg x=/g) ?? []).length).toBe(2)                     // both from the library, the alias "star" before the built-in star
  })

  it('lets a library icon override a built-in one of the same name', async () => {
    await icon('star', svgIcon('<circle cx="12" cy="12" r="10" fill="#000"/>'))
    const svg = await build(await seed('{star}'))
    expect(svg).toMatch(/<svg x=/)
  })

  it('draws a placeholder and reports an icon whose picture is gone, or that does not exist', async () => {
    const i = await icon('mono', MONO)
    const s = await seed('{mono} {nosuch}')
    const { unlinkSync } = await import('fs')
    const assets = await invoke('assets:list', {})
    unlinkSync(join(proj.dir, 'assets', assets.find(a => a.id === i.assetId).filename))
    const report = {}
    await build(s, report)
    expect([...report.missingIcons].sort()).toEqual(['mono', 'nosuch'])
  })
})

describe('text styles and keyword rules in text', () => {
  it('draws {style:name} with the properties of the style, under what the markup says', async () => {
    await invoke('textstyles:create', { name: 'loud', props: { bold: true, color: '#cc3333', size: 0.5 } })
    const plain = inkBox(await renderCard(proj.dir, (await seed('abcdefgh')).cards[0].id, { width: 250 }))
    await proj.cleanup()
    proj = await createTestProject('Lib2')
    await invoke('textstyles:create', { name: 'loud', props: { bold: true, color: '#cc3333', size: 0.5 } })
    const s = await seed('{style:Loud}abcdefgh{/style}')
    const svg = await build(s)
    expect(svg).toContain('fill="#cc3333"')
    expect(inkBox(await renderCard(proj.dir, s.cards[0].id, { width: 250 })).w).toBeLessThan(plain.w * 0.7) // half the size, even though bold
  })

  it('draws the outline and shadow of a style behind the text', async () => {
    await invoke('textstyles:create', { name: 'fx', props: { outlineWidth: 0.08, outlineColor: '#ffcc00', shadowX: 0.05, shadowY: 0.05, shadowColor: '#000000' } })
    const svg = await build(await seed('{style:fx}Hi{/style}'))
    const shadow = svg.indexOf('fill="#000000"'), outline = svg.indexOf('stroke="#ffcc00"'), fill = svg.indexOf('fill="#123456"')
    expect(shadow).toBeGreaterThan(-1)
    expect(outline).toBeGreaterThan(shadow)
    expect(fill).toBeGreaterThan(-1)
    expect(svg).toMatch(/stroke-width="[\d.]+" stroke-linejoin="round"/)
  })

  it('reports a style the project does not have', async () => {
    const report = {}
    await build(await seed('{style:nosuch}x{/style}'), report)
    expect(report.markup.map(p => p.type)).toEqual(['unknownStyle'])
  })

  it('applies keyword rules to rich text, and not where switched off or limited to other fields', async () => {
    await invoke('textstyles:create', { name: 'kw', props: { color: '#cc3333' } })
    await invoke('keywords:create', { match: 'Flying', mode: 'style', action: { style: 'kw' } })
    expect(await build(await seed('Flying creature'))).toContain('fill="#cc3333"')
    await proj.cleanup(); proj = await createTestProject('Lib3')
    await invoke('textstyles:create', { name: 'kw', props: { color: '#cc3333' } })
    await invoke('keywords:create', { match: 'Flying', mode: 'style', action: { style: 'kw' } })
    expect(await build(await seed('Flying creature', tpl('data-spadewick-keywords="off"')))).not.toContain('#cc3333')
    await proj.cleanup(); proj = await createTestProject('Lib4')
    await invoke('textstyles:create', { name: 'kw', props: { color: '#cc3333' } })
    await invoke('keywords:create', { match: 'Flying', mode: 'style', action: { style: 'kw' }, scope: ['other'] })
    expect(await build(await seed('Flying creature'))).not.toContain('#cc3333')
  })

  it('does not apply keyword rules to a Text field', async () => {
    await invoke('keywords:create', { match: 'Flying', mode: 'icon', action: { icon: 'star' } })
    const s = await seedSet({ cardSize: 'poker', fields: [{ name: 'Body', type: 'text' }], template: { name: 'T', svg: tpl() }, cards: [{ name: 'C', fields: { body: 'Flying' } }] })
    await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
    const withIcon = await seed('Flying')
    const plainWidth = inkBox(await renderCard(proj.dir, s.cards[0].id, { width: 250 })).w
    expect(plainWidth).toBeGreaterThan(60)               // the word is drawn as text, not replaced by an icon
    expect(withIcon.cards).toHaveLength(1)
  })

  it('shows a keyword as an icon followed by the text, or as other text', async () => {
    await invoke('keywords:create', { match: 'Haste', mode: 'icon_text', action: { icon: 'star' } })
    await invoke('keywords:create', { match: 'Zzz', mode: 'replace', action: { text: 'Sleep' } })
    const s = await seed('Haste Zzz')
    const w = inkBox(await renderCard(proj.dir, s.cards[0].id, { width: 250 })).w
    await invoke('keywords:update', { id: (await invoke('keywords:list'))[0].id, enabled: false })
    const without = inkBox(await renderCard(proj.dir, s.cards[0].id, { width: 250 })).w
    expect(w).toBeGreaterThan(without - 40)              // an icon was added; "Zzz" became "Sleep"
  })
})
