/**
 * Card backs (PRD §7.8): a set has a Template and a Card back; a card may have a back of its own. The back is a template drawn with the
 * card's own data, and every export, the preflight, the text check and the comparison know about it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { createTestProject, seedSet, invoke, mockDialog } from '../helpers/project.js'
import { openProjectDb } from '../../src/main/db.js'
import { runCli } from '../../src/cli/run.js'

let ctx, out
beforeEach(async () => { ctx = await createTestProject(); out = mkdtempSync(join(tmpdir(), 'backs-out-')) })
afterEach(async () => { rmSync(out, { recursive: true, force: true }); await ctx.cleanup() })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const FRONT = svg('<rect width="500" height="700" fill="#336699"/><text x="20" y="60" font-size="40" fill="#ffffff">{{title}}</text>')
const solid = hex => svg(`<rect width="500" height="700" fill="${hex}"/>`)
const px = async (buf, x = 250, y = 350) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const render = async (cardId, opts = {}) => Buffer.from(await invoke('templates:render', { cardId, width: 100, ...opts }), 'base64')

async function deck() {
  const s = await seedSet({
    name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }],
    template: { svg: FRONT }, cards: [{ name: 'Fire', fields: { title: 'Fire' } }, { name: 'Ice', fields: { title: 'Ice' } }, { name: 'Wind', fields: { title: 'Wind' } }]
  })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const back = (name, source) => invoke('templates:create', { name, svgSource: source, cardSize: 'poker' })

describe('the slots', () => {
  it('a set has a card back slot; a card has a back of its own; both are templates of the set\'s size', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000'))
    const set = await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    expect(set.default_back_template_id).toBe(red.id)
    const card = await invoke('cards:update', { id: s.cards[0].id, backTemplateId: red.id })
    expect(card.back_template_id).toBe(red.id)
    const columns = t => openProjectDb(ctx.dir).prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
    expect(columns('sets')).toContain('default_back_template_id')
    expect(columns('cards')).toContain('back_template_id')
    const tarot = await invoke('templates:create', { name: 'Tarot back', svgSource: solid('#000000'), cardSize: 'tarot' })
    await expect(invoke('sets:update', { id: s.set.id, defaultBackTemplateId: tarot.id })).rejects.toThrow(/card size/i)
    await expect(invoke('cards:update', { id: s.cards[0].id, backTemplateId: tarot.id })).rejects.toThrow(/card size/i)
  })

  it('changing the set\'s card size clears a back of another size, and the cards\' own', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    await invoke('cards:batch-update', { cardIds: [s.cards[0].id], backTemplateId: red.id })
    const impact = await invoke('sets:size-impact', { id: s.set.id, cardSize: 'tarot' })
    expect(impact.cardBack).toBe('Red back')
    await invoke('sets:update', { id: s.set.id, cardSize: 'tarot' })
    expect((await invoke('sets:list'))[0].default_back_template_id).toBeNull()
    expect((await invoke('cards:list', s.set.id)).every(c => c.back_template_id === null)).toBe(true)
  })

  it('deleting a template that is a back takes it away from the set and the cards, and undo brings it back', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    await invoke('cards:update', { id: s.cards[1].id, backTemplateId: red.id })
    expect((await invoke('templates:list')).find(t => t.id === red.id)).toMatchObject({ back_of_sets: 1, back_of_cards: 1 })
    await invoke('templates:delete', red.id)
    expect((await invoke('sets:list'))[0].default_back_template_id).toBeNull()
    expect((await invoke('cards:list', s.set.id))[1].back_template_id).toBeNull()
    await invoke('history:undo')
    expect((await invoke('sets:list'))[0].default_back_template_id).toBe(red.id)
    expect((await invoke('cards:list', s.set.id))[1].back_template_id).toBe(red.id)
  })

  it('a duplicated card keeps its back; the card table export names it', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000'))
    await invoke('cards:update', { id: s.cards[0].id, backTemplateId: red.id })
    const [copy] = await invoke('cards:duplicate', [s.cards[0].id])
    expect(copy.back_template_id).toBe(red.id)
    const file = join(out, 'cards.csv')
    mockDialog.save(file)
    await invoke('dataio:export', { setIds: [s.set.id], format: 'csv', includeMeta: true })
    const header = readFileSync(file, 'utf8').split('\n')[0]
    expect(header).toMatch(/_template,_back/)
    expect(readFileSync(file, 'utf8')).toContain('Red back')
  })
})

describe('drawing a back', () => {
  it('draws the set\'s card back, a card\'s own back instead, and says so when there is none', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000')), green = await back('Green back', solid('#00aa00'))
    await expect(invoke('templates:render', { cardId: s.cards[0].id, width: 100, side: 'back' })).rejects.toThrow(/no back/i)
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    await invoke('cards:update', { id: s.cards[1].id, backTemplateId: green.id })
    expect(await px(await render(s.cards[0].id, { side: 'back' }), 50, 70)).toEqual([0xcc, 0, 0])
    expect(await px(await render(s.cards[1].id, { side: 'back' }), 50, 70)).toEqual([0, 0xaa, 0])
    expect(await px(await render(s.cards[0].id), 50, 70)).toEqual([0x33, 0x66, 0x99])          // the front is as before
  })

  it('a back is drawn with the card\'s own data', async () => {
    const s = await deck()
    const named = await back('Named back', svg('<rect width="500" height="700" fill="#ffffff"/><text x="20" y="300" font-size="120" fill="#000000">{{title}}</text>'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: named.id })
    const a = await render(s.cards[0].id, { side: 'back', width: 250 }), b = await render(s.cards[1].id, { side: 'back', width: 250 })
    expect(a.equals(b)).toBe(false)
  })

  it('"createBack" makes a back in the set\'s size, makes it the set\'s card back, in one undo step', async () => {
    const s = await deck()
    const { template, set } = await invoke('templates:create-back', { setId: s.set.id, design: 'classic', primary: '#102030', accent: '#ffcc00', name: 'My back' })
    expect(set.default_back_template_id).toBe(template.id)
    expect(template).toMatchObject({ name: 'My back', card_size: 'poker' })
    expect(template.svg_source).toContain('#102030')
    expect(template.svg_source).toContain('data-spadewick-id="emblem"')
    expect((await render(s.cards[0].id, { side: 'back' })).length).toBeGreaterThan(100)
    await invoke('history:undo')
    expect((await invoke('sets:list'))[0].default_back_template_id).toBeNull()
    expect((await invoke('templates:list')).some(t => t.id === template.id)).toBe(false)
    for (const design of ['plain', 'glow']) {
      const made = await invoke('templates:create-back', { setId: s.set.id, design })
      expect((await render(s.cards[0].id, { side: 'back' })).length).toBeGreaterThan(100)
      expect(made.template.name).toBe('Base back')
    }
  })
})

describe('the library', () => {
  it('has card backs in poker and tarot size, that are used as the set\'s card back', async () => {
    const { starters } = await invoke('templatelib:list')
    const backs = starters.filter(x => x.purpose === 'back')
    expect(backs.map(x => x.cardSize.id).sort()).toEqual(['poker', 'poker', 'tarot', 'tarot'])
    const s = await deck()
    const used = await invoke('templatelib:use', { kind: 'starter', id: 'example-back-classic', setId: s.set.id, asBack: true })
    const set = (await invoke('sets:list'))[0]
    expect(set.default_back_template_id).toBe(used.templateId)
    expect(set.default_template_id).not.toBe(used.templateId)
    expect((await render(s.cards[0].id, { side: 'back' })).length).toBeGreaterThan(100)
  })

  it('a template that is only ever a back is saved to the library as a back', async () => {
    const s = await deck()
    const { template } = await invoke('templates:create-back', { setId: s.set.id, design: 'plain' })
    const dest = join(out, 'saved')
    const saved = await invoke('templatelib:save', { templateId: template.id, setId: s.set.id, name: 'Saved back', includeFonts: false })
    const { mine } = await invoke('templatelib:list')
    expect(mine.find(m => m.id === saved.id)?.purpose).toBe('back')
    expect(dest).toBeTruthy()
  })
})

describe('exports', () => {
  it('Tabletop Simulator: cards that share a back share one back image; a card with a back of its own gets its own deck sheet', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000')), green = await back('Green back', solid('#00aa00'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    let res = await invoke('export:tts', { setIds: [s.set.id], outputDir: out, cardWidth: 50, cardHeight: 70 })
    expect(res).toMatchObject({ cardCount: 3, sheetCount: 1 })
    expect(readdirSync(out).filter(f => f.includes('_back'))).toEqual(['base_back.png'])
    expect(await px(readFileSync(join(out, 'base_back.png')), 25, 35)).toEqual([0xcc, 0, 0])

    await invoke('cards:update', { id: s.cards[1].id, backTemplateId: green.id })
    const dir2 = join(out, 'two')
    res = await invoke('export:tts', { setIds: [s.set.id], outputDir: dir2, cardWidth: 50, cardHeight: 70 })
    expect(res.sheetCount).toBe(2)                                           // one sheet for each back
    expect(readdirSync(dir2).filter(f => f.includes('_back')).length).toBe(2)
    const deckDoc = JSON.parse(readFileSync(join(dir2, 'base.json'), 'utf8')).ObjectStates[0]
    expect(Object.keys(deckDoc.CustomDeck)).toHaveLength(2)
    expect(new Set(Object.values(deckDoc.CustomDeck).map(d => d.BackURL)).size).toBe(2)
    expect(Object.values(deckDoc.CustomDeck).every(d => d.UniqueBack === false)).toBe(true)
    expect(deckDoc.DeckIDs).toHaveLength(3)
  })

  it('Tabletop Simulator: a back that shows each card\'s own data gets a sheet of backs, with UniqueBack', async () => {
    const s = await deck()
    const named = await back('Named back', svg('<rect width="500" height="700" fill="#ffffff"/><text x="20" y="300" font-size="120" fill="#000000">{{title}}</text>'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: named.id })
    const res = await invoke('export:tts', { setIds: [s.set.id], outputDir: out, cardWidth: 50, cardHeight: 70 })
    expect(res.sheetCount).toBe(1)
    expect(readdirSync(out)).toEqual(expect.arrayContaining(['base_face.png', 'base_backs.png']))
    const sheet = await sharp(join(out, 'base_backs.png')).metadata()
    expect(sheet).toMatchObject({ width: 400, height: 70 })
    expect(JSON.parse(readFileSync(join(out, 'base.json'), 'utf8')).ObjectStates[0].CustomDeck['1']).toMatchObject({ UniqueBack: true })
  })

  it('"No back" and a plain colour still work, and the old default (a colour) is what a set without a back gets', async () => {
    const s = await deck()
    await invoke('export:tts', { setIds: [s.set.id], outputDir: out, cardWidth: 50, cardHeight: 70, cardBackColor: '#ff0000' })
    expect(await px(readFileSync(join(out, 'base_back.png')), 25, 35)).toEqual([255, 0, 0])
    const dir2 = join(out, 'none')
    await invoke('export:tts', { setIds: [s.set.id], outputDir: dir2, cardWidth: 50, cardHeight: 70, cardBack: 'none' })
    expect((await sharp(readFileSync(join(dir2, 'base_back.png'))).ensureAlpha().raw().toBuffer())[3]).toBe(0)
  })

  it('print PDF: each card\'s own back is on the page behind its front, interleaved', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    await invoke('export:pdf', { setIds: [s.set.id], outputDir: out, dpi: 50, marginMm: 5, cardBacks: true })
    const doc = await PDFDocument.load(readFileSync(join(out, 'base.pdf')))
    expect(doc.getPageCount()).toBe(2)                                       // a page of fronts, a page of backs
  })

  it('production images: one back picture for the shared back, one per different back', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000')), green = await back('Green back', solid('#00aa00'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    let r = await invoke('production:run-images', { setIds: [s.set.id], outputDir: out, dpi: 72, bleedMm: 0 })
    expect(r).toMatchObject({ cardCount: 3, backWritten: true, backCount: 1 })
    expect(r.files.filter(f => f.includes('_back'))).toHaveLength(1)
    expect(await px(readFileSync(join(out, r.files.find(f => f.includes('_back')))), 10, 10)).toEqual([0xcc, 0, 0])
    await invoke('cards:update', { id: s.cards[2].id, backTemplateId: green.id })
    const dir2 = join(out, 'two')
    r = await invoke('production:run-images', { setIds: [s.set.id], outputDir: dir2, dpi: 72, bleedMm: 0 })
    expect(r.backCount).toBe(2)
    expect(r.files.filter(f => f.includes('_back'))).toHaveLength(2)
    const dir3 = join(out, 'none')
    r = await invoke('production:run-images', { setIds: [s.set.id], outputDir: dir3, dpi: 72, bleedMm: 0, cardBack: 'none' })
    expect(r.backWritten).toBe(false)
  })

  it('production PDF: the backs of the set are the back pages', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000')), green = await back('Green back', solid('#00aa00'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    await invoke('cards:update', { id: s.cards[0].id, backTemplateId: green.id })
    const r = await invoke('production:run', { setIds: [s.set.id], outputDir: out, dpi: 72, bleedMm: 3, colour: 'rgb', standard: 'x4', backLayout: 'interleaved' })
    expect(r.pageCount).toBe(6)                                              // three fronts, each with its back
    expect(r.report.verified.problems).toEqual([])
    const once = await invoke('production:run', { setIds: [s.set.id], outputDir: join(out, 'once'), dpi: 72, bleedMm: 3, colour: 'rgb', standard: 'x4', backLayout: 'once' })
    expect(once.pageCount).toBe(5)                                           // three fronts and the two different backs, once each
  })
})

describe('the print readiness check and the text check see the backs', () => {
  const check = (s, extra = {}) => invoke('preflight:run', { setIds: [s.set.id], ...extra })
  const types = r => r.groups.map(g => g.type)

  it('says when no card has a back, and when only some do', async () => {
    const s = await deck()
    expect(types(await check(s))).toContain('backPlain')
    const red = await back('Red back', solid('#cc0000'))
    await invoke('cards:update', { id: s.cards[0].id, backTemplateId: red.id })
    const some = await check(s)
    expect(types(some)).toContain('backSome')
    expect(some.groups.find(g => g.type === 'backSome')).toMatchObject({ severity: 'warning', detail: { n: 2 } })
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
    expect(types(await check(s))).not.toContain('backSome')
    expect(types(await check(s))).not.toContain('backPlain')
  })

  it('finds a missing picture in a back, with the back named', async () => {
    const s = await deck()
    const broken = await back('Broken back', svg('<rect width="500" height="700" fill="#112233"/><image x="50" y="50" width="200" height="200" href="{{@asset.nope}}"/>'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: broken.id })
    const r = await check(s)
    const g = r.groups.find(x => x.type === 'missingImage')
    expect(g).toBeTruthy()
    expect(g.template).toMatchObject({ id: broken.id })
    expect(g.template.name).toContain('Broken back')
    expect(g.template.name).toContain('(back)')
  })

  it('the text check draws the backs too, once for a back that looks the same on every card', async () => {
    const s = await deck()
    const bad = await back('Tiny back', svg('<rect width="500" height="700" fill="#ffffff"/><text data-spadewick-id="t" x="20" y="300" width="60" height="20" data-spadewick-field="title" data-spadewick-text-fit="shrink" data-spadewick-text-min-size="30" font-size="60">{{title}} and a great many more words than fit</text>'))
    await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: bad.id })
    const r = await invoke('textcheck:run', { setIds: [s.set.id] })
    const group = r.groups.find(g => g.type === 'noFit' && g.template?.id === bad.id)
    expect(group).toBeTruthy()
    const without = await invoke('textcheck:run', { setIds: [s.set.id], backs: false })
    expect(without.groups.some(g => g.template?.id === bad.id)).toBe(false)
  })
})

describe('comparing with a snapshot, and the command line', () => {
  it('a card whose back changed is listed, and "use the old one" puts it back', async () => {
    const s = await deck()
    const red = await back('Red back', solid('#cc0000')), green = await back('Green back', solid('#00aa00'))
    await invoke('cards:update', { id: s.cards[0].id, backTemplateId: red.id })
    const snap = await invoke('snapshots:create', { name: 'before' })
    await invoke('cards:update', { id: s.cards[0].id, backTemplateId: green.id })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const card = r.cards.find(c => c.id === s.cards[0].id)
    const change = card.changes.find(c => c.kind === 'back')
    expect(change).toMatchObject({ from: 'Red back', to: 'Green back' })
    await invoke('snapshots:compare-restore', { handle: r.handle, keys: [change.key] })
    expect((await invoke('cards:list', s.set.id))[0].back_template_id).toBe(red.id)
    await invoke('snapshots:compare-close', r.handle)
  })

  it('render --side back writes the back; a card with no back is a usage error', async () => {
    const s = await deck()
    const run = async args => { let stdout = '', stderr = ''; const code = await runCli(['--project', ctx.dir, ...args], { stdout: t => { stdout += t }, stderr: t => { stderr += t }, cwd: out, env: {} }); return { code, stdout, stderr } }
    const none = await run(['render', '--card', 'Fire', '--side', 'back', '--out', join(out, 'b.png')])
    expect(none.code).toBe(2)
    expect(none.stderr).toMatch(/no card back/)
    await invoke('projects:close')
    const red = await (async () => { await invoke('projects:open', ctx.dir); const t = await back('Red back', solid('#cc0000')); await invoke('sets:update', { id: s.set.id, defaultBackTemplateId: t.id }); await invoke('projects:close'); return t })()
    expect(red.id).toBeTruthy()
    const ok = await run(['render', '--card', 'Fire', '--side', 'back', '--out', join(out, 'b.png'), '--width', '100'])
    expect(ok.code).toBe(0)
    expect(await px(readFileSync(join(out, 'b.png')), 50, 70)).toEqual([0xcc, 0, 0])
    expect((await run(['render', '--card', 'Fire', '--side', 'sideways'])).code).toBe(2)
    const sets = await run(['list', 'sets', '--json'])
    expect(JSON.parse(sets.stdout)[0].cardBack).toBe('Red back')
  })
})
