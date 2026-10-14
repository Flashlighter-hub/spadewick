import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke, mockDialog, makePng } from '../helpers/project.js'
import { openProjectDb } from '../../src/main/db.js'
import { listZip, extractZip, writeZip } from '../../src/main/zip.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { mockDialog.reset(); await ctx.cleanup() })

const FONT = join(process.cwd(), 'resources/fonts/LiberationMono-Regular.ttf')
const png = async buf => sharp(Buffer.from(buf, 'base64')).raw().toBuffer({ resolveWithObject: true })
const render = async (cardId, width = 100) => Buffer.from(await invoke('templates:render', { cardId, width }), 'base64')
const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#ffffff"/>${inner}</svg>`
const px = async (buf, x, y) => { const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]] }
const libraryRoot = () => join(ctx.root, 'library')
const origin = async id => JSON.parse(openProjectDb(ctx.dir).prepare('SELECT origin FROM templates WHERE id = ?').get(id).origin)
const tmp = () => mkdtempSync(join(tmpdir(), 'tl-test-'))

describe('the library (PRD §7.7.1)', () => {
  it('ships starter templates: a blank frame for every card size, and example designs, each with a picture', async () => {
    const { starters, mine } = await invoke('templatelib:list')
    expect(mine).toEqual([])
    const ids = starters.map(s => s.id)
    for (const size of ['poker', 'bridge', 'tarot', 'square', 'jumbo', 'mini_eu']) expect(ids).toContain(`blank-${size}`)
    expect(ids).toEqual(expect.arrayContaining(['example-creature', 'example-playing-card', 'example-tarot']))
    for (const s of starters) {
      const meta = await sharp(Buffer.from(s.thumbnail, 'base64')).metadata()
      expect(meta.format).toBe('png')
      expect(s.kind).toBe('starter')
    }
    expect(starters.find(s => s.id === 'blank-tarot').cardSize).toMatchObject({ id: 'tarot', mmW: 70, mmH: 120 })
  })

  it('a blank frame draws trim and safe guides that never reach an export', async () => {
    const { set } = await seedSet({ name: 'Base', cards: [{ name: 'a' }] })
    const used = await invoke('templatelib:use', { kind: 'starter', id: 'blank-poker', setId: set.id, makeDefault: true })
    const card = (await invoke('cards:list', set.id))[0]
    const buf = await render(card.id, 500)
    expect(await px(buf, 3, 300)).toEqual([255, 255, 255])    // trim guide would be pink at the very edge
    const t = await invoke('templates:get', used.templateId)
    expect(t.svg_source).toContain('id="guides"')
    expect(t.svg_source).toContain('data-spadewick-hide-if="1"')
  })
})

describe('the clone rule (PRD §7.7.2)', () => {
  it('copies a library template into the project as an ordinary, editable template and records its origin', async () => {
    const { set } = await seedSet({ name: 'Base' })
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'blank-poker', setId: set.id })
    const t = await invoke('templates:get', out.templateId)
    expect(t.name).toBe('Blank poker')
    expect(await origin(out.templateId)).toMatchObject({ source: 'library', kind: 'starter', itemId: 'blank-poker', version: 1 })
    expect((await origin(out.templateId)).fingerprint).toMatch(/^[0-9a-f]{64}$/)
    const stored = (await invoke('templates:get', out.templateId)).svg_source
    await invoke('templates:update', { id: out.templateId, name: 'Mine now', svgSource: stored.replace('</svg>', '<rect width="9" height="9"/></svg>') })   // editable (its canvas is the card's and stays)
    expect((await invoke('templates:get', out.templateId)).name).toBe('Mine now')
    const again = await invoke('templatelib:use', { kind: 'starter', id: 'blank-poker', setId: set.id })
    expect((await invoke('templates:get', again.templateId)).name).toBe('Blank poker')
  })

  it('copies a template with its parent, fields and sample cards, in one undo step', async () => {
    const { set } = await seedSet({ name: 'Creatures' })
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-creature', setId: set.id, includeSampleCards: true, makeDefault: true })
    expect(out.parentId).toBeTruthy()
    const child = await invoke('templates:get', out.templateId)
    expect(child.parent_id).toBe(out.parentId)
    expect((await invoke('fields:list', set.id)).map(f => f.slug)).toEqual(['name', 'cost', 'type', 'rules', 'power', 'toughness'])
    const cards = await invoke('cards:list', set.id)
    expect(cards.map(c => c.display_name)).toEqual(['Ember Wolf', 'Moss Golem', 'Quick Sprite'])
    expect(cards.map(c => c.card_code)).toEqual(['CREA-0001', 'CREA-0002', 'CREA-0003'])
    expect(cards.map(c => c.quantity)).toEqual([2, 1, 3])
    expect((await invoke('sets:list'))[0].default_template_id).toBe(out.templateId)
    // it renders (child filled into the parent's slot)
    const buf = await render(cards[0].id, 250)
    expect(await px(buf, 5, 5)).toEqual([0, 0, 0].map((_, i) => [0x3b, 0x2f, 0x2f][i]))   // the frame colour, written into the template itself
    // one undo takes it all back
    await invoke('history:undo')
    expect(await invoke('templates:list')).toEqual([])
    expect(await invoke('fields:list', set.id)).toEqual([])
    expect(await invoke('cards:list', set.id)).toEqual([])
    await invoke('history:redo')
    expect((await invoke('templates:list')).length).toBe(2)
  })

  it('the Creature child is a complete SVG document that the canvas editor can open (Fixes F14)', async () => {
    const { set } = await seedSet({ name: 'Creatures' })
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-creature', setId: set.id, includeSampleCards: true, makeDefault: true })
    const child = await invoke('templates:get', out.templateId)
    const parent = await invoke('templates:get', out.parentId)
    expect(child.svg_source.trimStart().startsWith('<svg')).toBe(true)
    expect(child.svg_source.trimEnd().endsWith('</svg>')).toBe(true)
    expect(child.svg_source.match(/<svg[\s>]/g)).toHaveLength(1)                       // one root: no extra content at the end of the document
    expect(child.svg_source).toMatch(/width="500"[^>]*height="700"|height="700"[^>]*width="500"/)   // the size of its parent
    expect(child.svg_source).toContain('data-spadewick-id="title"')
    expect(parent.svg_source).toContain('spadewick:slot="body"')
    // drawn on its own (the editor sends the source it is editing), it is the whole card, not just the frame
    const cards = await invoke('cards:list', set.id)
    const whole = await invoke('templates:render', { cardId: cards[0].id, templateId: out.templateId, svgSource: child.svg_source, width: 250 })
    const stored = await render(cards[0].id, 250)
    expect(Buffer.from(whole, 'base64').equals(stored)).toBe(true)
  })

  it('a child that was saved as a bare fragment is opened as a document, and the card still renders the same (Fixes F14)', async () => {
    const { set } = await seedSet({ name: 'Creatures' })
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-creature', setId: set.id, includeSampleCards: true, makeDefault: true })
    const cards = await invoke('cards:list', set.id)
    const before = await render(cards[0].id, 250)
    const doc = (await invoke('templates:get', out.templateId)).svg_source
    const fragment = doc.replace(/^<svg[^>]*>\s*/, '').replace(/\s*<\/svg>\s*$/, '')   // how earlier versions stored it
    await invoke('templates:update', { id: out.templateId, svgSource: fragment })
    expect((await invoke('templates:get', out.templateId)).svg_source.trimStart().startsWith('<svg')).toBe(true)
    expect((await render(cards[0].id, 250)).equals(before)).toBe(true)
  })

  it('without a set, fields are not created and the template says so', async () => {
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-playing-card' })
    expect(out.notes.join(' ')).toMatch(/3 fields/)
    expect(out.createdFields).toEqual([])
  })

  it('"New set from a template" makes the set, gives it the template\'s card size and default template', async () => {
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-tarot', newSetName: 'Major Arcana', includeSampleCards: true })
    expect(out.newSet).toMatchObject({ name: 'Major Arcana', code: 'MAJO', card_size: 'tarot', default_template_id: out.templateId })
    expect((await invoke('cards:list', out.setId)).map(c => c.card_code)).toEqual(['MAJO-0001', 'MAJO-0002'])
    expect((await invoke('cardsize:get', out.setId)).id).toBe('tarot')
  })

  it('the project keeps working after the library is deleted', async () => {
    const { set } = await seedSet({ name: 'Base', cardSize: 'tarot' })
    const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-tarot', setId: set.id, includeSampleCards: true, makeDefault: true })
    expect(out.templateId).toBeTruthy()
    rmSync(libraryRoot(), { recursive: true, force: true })
    const card = (await invoke('cards:list', set.id))[0]
    await expect(render(card.id, 200)).resolves.toBeInstanceOf(Buffer)
    expect((await invoke('templates:get', out.templateId)).svg_source).toContain('{{@card.number}}')
  })

  describe('clashes: every row of the table', () => {
    const useCreature = (setId, resolutions) => invoke('templatelib:use', { kind: 'starter', id: 'example-creature', setId, resolutions })

    it('field with the same slug and another type: map to mine, rename the incoming one, or cancel', async () => {
      const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Cost', type: 'text' }] })
      const plan = await invoke('templatelib:plan', { kind: 'starter', id: 'example-creature', setId: set.id })
      expect(plan.clashes).toEqual([expect.objectContaining({ kind: 'field', key: 'cost', options: ['map', 'rename', 'cancel'], mine: { name: 'Cost', type: 'text' }, theirs: { name: 'Cost', type: 'number' } })])
      await expect(useCreature(set.id)).rejects.toThrow(/needs a decision/)
      await expect(useCreature(set.id, { fields: { cost: 'cancel' } })).rejects.toThrow(/Nothing was changed/)
      expect(await invoke('templates:list')).toEqual([])

      const mapped = await useCreature(set.id, { fields: { cost: 'map' } })
      expect((await invoke('fields:list', set.id)).find(f => f.slug === 'cost')).toMatchObject({ type: 'text', name: 'Cost' })   // mine kept
      expect((await invoke('templates:get', mapped.templateId)).svg_source).toContain('{{cost}}')
    })

    it('rename gives the incoming field a new slug and rewrites the copy', async () => {
      const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Cost', type: 'text' }] })
      const out = await useCreature(set.id, { fields: { cost: 'rename' } })
      const fields = await invoke('fields:list', set.id)
      expect(fields.map(f => f.slug)).toEqual(expect.arrayContaining(['cost', 'cost_2']))
      expect(fields.find(f => f.slug === 'cost_2')).toMatchObject({ name: 'Cost 2', type: 'number' })
      const text = (await invoke('templates:get', out.templateId)).svg_source
      expect(text).toContain('{{cost_2}}')
      expect(text).not.toContain('{{cost}}')
    })

    it('a field that is identical is simply shared, with no question', async () => {
      const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }] })
      const plan = await invoke('templatelib:plan', { kind: 'starter', id: 'example-creature', setId: set.id })
      expect(plan.clashes).toEqual([])
      const out = await useCreature(set.id)
      expect(out.createdFields).not.toContain('name')
      expect((await invoke('fields:list', set.id)).filter(f => f.slug === 'name')).toHaveLength(1)
    })

    it('the example templates carry their colours themselves: nothing about a palette can clash', async () => {
      const plan = await invoke('templatelib:plan', { kind: 'starter', id: 'example-creature' })
      expect(plan.clashes).toEqual([])
      const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-creature' })
      expect((await invoke('templates:get', out.parentId)).svg_source).not.toMatch(/@palette/)
    })

    it('a template of another card size cannot be used in a set: it is reported and refused (PRD §10.6)', async () => {
      const { set } = await seedSet({ name: 'Poker cards' })                              // Poker
      const plan = await invoke('templatelib:plan', { kind: 'starter', id: 'example-tarot', setId: set.id })
      expect(plan.sizeMismatch).toBe(true)
      expect(plan.notes.join(' ')).toMatch(/cannot be used in this set/)
      await expect(invoke('templatelib:use', { kind: 'starter', id: 'example-tarot', setId: set.id })).rejects.toThrow(/same card size/)
      expect((await invoke('templates:list')).length).toBe(0)                              // nothing half-made
      const fine = await invoke('templatelib:plan', { kind: 'starter', id: 'example-creature', setId: set.id })
      expect(fine.sizeMismatch).toBe(false)
    })

    it('a copy takes the card size of the library item, and the size cannot be changed afterwards', async () => {
      const out = await invoke('templatelib:use', { kind: 'starter', id: 'example-tarot' })   // no set: a template only
      expect(await invoke('templates:get', out.templateId)).toMatchObject({ card_size: 'tarot' })
      await expect(invoke('templates:update', { id: out.templateId, cardSize: 'poker' })).rejects.toThrow(/cannot be changed/)
    })

    it('a different file for a font the project already has: the project keeps its own, and is told', async () => {
      const { set } = await seedSet({ name: 'Base' })
      const dir = tmp()
      try {
        // a library item whose font file differs from the project's file of the same family and style
        await invoke('fonts:import', [FONT])
        const bytes = readFileSync(FONT); bytes[bytes.length - 1] ^= 0xff
        const other = join(dir, 'LiberationMono-Regular.ttf'); writeFileSync(other, bytes)
        const bundle = join(dir, 'item')
        mkdirSync(join(bundle, 'templates'), { recursive: true }); mkdirSync(join(bundle, 'fonts'), { recursive: true })
        writeFileSync(join(bundle, 'templates/main.svg'), svg('<text x="5" y="50" font-family="Liberation Mono">{{display_name}}</text>'))
        copyFileSync(other, join(bundle, 'fonts/mono.ttf'))
        writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ format: 1, name: 'Mono', templates: [{ file: 'templates/main.svg', name: 'Mono', role: 'main' }], fonts: [{ file: 'fonts/mono.ttf' }] }))
        const pkg = join(dir, 'm.spadewick-template')
        const { folderEntries } = await import('../../src/main/templateLibrary.js')
        writeZip(pkg, folderEntries(bundle))
        const opened = await invoke('templatepkg:open', { path: pkg })
        const plan = await invoke('templatepkg:plan', { token: opened.token, setId: set.id })
        expect(plan.notes.join(' ')).toMatch(/Liberation Mono Regular.*project's font/)
        await invoke('templatepkg:apply', { token: opened.token, target: 'project', setId: set.id })
        expect((await invoke('fonts:list')).filter(f => f.family_name === 'Liberation Mono')).toHaveLength(1)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  })
})

async function projectWithDesign() {
  await invoke('fonts:import', [FONT])
  const [asset] = await invoke('assets:import', [await makePng(join(ctx.root, 'frame.png'), 60, 60, '#ff0000')])
  const template = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#0000ff"/><image href="{{@asset.${asset.id}}}" x="0" y="0" width="60" height="60"/><text x="70" y="40" font-family="Liberation Mono" font-size="20" fill="{{ink}}">{{name}}</text></svg>`
  const seeded = await seedSet({
    name: 'Heroes', fields: [{ name: 'Name', type: 'text' }, { name: 'Ink', type: 'color' }, { name: 'Unused', type: 'text' }],
    cards: [{ name: 'A', fields: { name: 'Ann', ink: '#ffffff' } }, { name: 'B', fields: { name: 'Bob', ink: '#ffffff' } }],
    template: { svg: template, name: 'Hero' }
  })
  await invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  return { ...seeded, asset }
}

describe('Save to library (PRD §7.7.3)', () => {
  it('bundles the fonts, images and fields the template uses, and a mockup with previews', async () => {
    const { set, template, cards } = await projectWithDesign()
    const saved = await invoke('templatelib:save', { templateId: template.id, setId: set.id, name: 'Hero frame', description: 'd', author: 'me', license: 'CC0', mockupCardIds: [cards[0].id] })
    expect(saved).toMatchObject({ name: 'Hero frame', version: 1 })
    const { mine } = await invoke('templatelib:list')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ name: 'Hero frame', fieldCount: 2, fontCount: 1, assetCount: 1, mockupCount: 1, license: 'CC0', kind: 'mine' })
    const dir = join(libraryRoot(), 'mine', saved.id)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.fields.map(f => f.slug)).toEqual(['name', 'ink'])    // 'unused' is not needed
    expect(manifest.palette).toBeUndefined()                              // colours live in the template itself
    expect(manifest.cardSize).toMatchObject({ id: 'poker' })              // the template's own size
    expect(readdirSync(join(dir, 'mockup')).sort()).toEqual(['cards.json', 'images', 'preview-1.png'])
    expect((await sharp(join(dir, 'mockup/preview-1.png')).metadata()).width).toBe(300)
    expect(JSON.parse(readFileSync(join(dir, 'mockup/cards.json'), 'utf8'))).toEqual([{ display_name: 'A', quantity: 1, fields: { name: 'Ann', ink: '#ffffff' } }])
  })

  it('limits the mockup to 12 cards', async () => {
    const { set, template } = await projectWithDesign()
    for (let i = 0; i < 20; i++) await invoke('cards:create', { setId: set.id, displayName: `c${i}`, fields: { name: `n${i}` } })
    const all = (await invoke('cards:list', set.id)).map(c => c.id)
    const saved = await invoke('templatelib:save', { templateId: template.id, setId: set.id, mockupCardIds: all })
    expect(saved.manifest.mockup.previews).toHaveLength(12)
  })

  it('saving again as the same item raises its version; "My templates" can be renamed and deleted', async () => {
    const { set, template } = await projectWithDesign()
    const first = await invoke('templatelib:save', { templateId: template.id, setId: set.id, name: 'One' })
    const second = await invoke('templatelib:save', { templateId: template.id, setId: set.id, name: 'One', itemId: first.id })
    expect([second.id, second.version]).toEqual([first.id, 2])
    await invoke('templatelib:rename-item', { id: first.id, name: 'Renamed' })
    expect((await invoke('templatelib:list')).mine[0].name).toBe('Renamed')
    await invoke('templatelib:delete-item', first.id)
    expect((await invoke('templatelib:list')).mine).toEqual([])
  })

  it('a saved template can be used in another project and looks the same, fixed image included', async () => {
    const { set, template, cards } = await projectWithDesign()
    const before = await render(cards[0].id, 200)
    const saved = await invoke('templatelib:save', { templateId: template.id, setId: set.id, name: 'Hero frame' })
    await invoke('projects:close')
    await invoke('projects:create', { name: 'Second', parentDir: ctx.root })
    const target = await seedSet({ name: 'Other', cards: [{ name: 'x' }] })
    const out = await invoke('templatelib:use', { kind: 'mine', id: saved.id, setId: target.set.id, makeDefault: true, includeSampleCards: true })
    expect((await invoke('assets:list', {})).length).toBe(1)
    expect((await invoke('fonts:list')).map(f => f.family_name)).toContain('Liberation Mono')
    const cards2 = await invoke('cards:list', target.set.id)
    const after = await render(cards2.find(c => c.display_name === 'A').id, 200)
    expect(await px(after, 10, 10)).toEqual(await px(before, 10, 10))      // the red fixed image
    expect(await px(after, 150, 200)).toEqual(await px(before, 150, 200))  // the blue background
    expect(out.createdFields).toEqual(['name', 'ink'])
  })
})

describe('template packages (PRD §7.7.4)', () => {
  it('exports a package and imports it into the library and the project', async () => {
    const { set, template, cards } = await projectWithDesign()
    const file = join(ctx.root, 'hero.spadewick-template')
    mockDialog.save(file)
    await expect(invoke('templatepkg:export', { templateId: template.id, setId: set.id })).rejects.toThrow(/right to distribute/)
    mockDialog.save(file)
    const res = await invoke('templatepkg:export', { templateId: template.id, setId: set.id, name: 'Hero', confirmRights: true })
    expect(res.path).toBe(file)
    const names = listZip(file).map(e => e.name).sort()
    expect(names).toEqual(expect.arrayContaining(['manifest.json', 'templates/main.svg']))
    expect(names.some(n => n.startsWith('fonts/'))).toBe(true)
    expect(names.some(n => n.startsWith('assets/'))).toBe(true)

    await invoke('projects:close')
    await invoke('projects:create', { name: 'Receiver', parentDir: ctx.root })
    const seeded = await seedSet({ name: 'Rx' })
    const opened = await invoke('templatepkg:open', { path: file })
    expect(opened).toMatchObject({ name: 'Hero', fieldCount: 3 - 1, assetCount: 1, fontCount: 1 })
    const applied = await invoke('templatepkg:apply', { token: opened.token, target: 'both', setId: seeded.set.id, includeSampleCards: true })
    expect(applied.library.name).toBe('Hero')
    expect((await invoke('templatelib:list')).mine.map(m => m.name)).toEqual(['Hero'])
    expect(JSON.parse((await invoke('templates:get', applied.project.templateId)).origin)).toMatchObject({ source: 'library', kind: 'mine' })
    const card = (await invoke('cards:list', seeded.set.id))[0]
    await expect(render(card.id)).resolves.toBeInstanceOf(Buffer)
    await expect(invoke('templatepkg:plan', { token: opened.token })).rejects.toThrow(/no longer open/)   // staged files are removed after applying
  })

  it('exports an item of the library, and "project" only imports without touching the library', async () => {
    const file = join(ctx.root, 'blank.spadewick-template')
    mockDialog.save(file)
    await invoke('templatepkg:export', { kind: 'starter', id: 'blank-poker' })
    const opened = await invoke('templatepkg:open', { path: file })
    await invoke('templatepkg:apply', { token: opened.token, target: 'project' })
    expect((await invoke('templatelib:list')).mine).toEqual([])
    expect((await invoke('templates:list')).map(t => t.name)).toEqual(['Blank poker'])
  })

  it('warns about fonts: one whose embedding flag forbids passing it on is left out', async () => {
    const bytes = readFileSync(FONT)
    // set the OS/2 fsType to "restricted licence embedding"
    const numTables = bytes.readUInt16BE(4)
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (bytes.toString('latin1', rec, rec + 4) === 'OS/2') bytes.writeUInt16BE(0x0002, bytes.readUInt32BE(rec + 8) + 8)
    }
    const restricted = join(ctx.root, 'Restricted.ttf'); writeFileSync(restricted, bytes)
    await invoke('fonts:import', [restricted])
    const { template, set } = await seedSet({ name: 'Base', template: { svg: svg('<text font-family="Liberation Mono">{{display_name}}</text>') } })
    const inspected = await invoke('templatepkg:inspect', { templateId: template.id, setId: set.id })
    expect(inspected.fonts).toEqual([expect.objectContaining({ family: 'Liberation Mono', restricted: true })])
    const saved = await invoke('templatelib:save', { templateId: template.id, setId: set.id, name: 'R' })
    expect(saved.skippedFonts).toEqual(['Liberation Mono Regular'])
    expect(saved.manifest.fonts).toEqual([])
  })

  describe('hostile and damaged packages are refused before anything is written', () => {
    const build = (files) => {
      const dir = tmp(), src = join(dir, 'src')
      const entries = []
      for (const [name, content] of Object.entries(files)) {
        const p = join(src, name); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, content); entries.push({ name, file: p })
      }
      const zip = join(dir, 'x.spadewick-template'); writeZip(zip, entries)
      return { zip, dir }
    }
    const manifest = extra => JSON.stringify({ format: 1, name: 'X', templates: [{ file: 'templates/main.svg', name: 'X', role: 'main' }], ...extra })
    const good = { 'manifest.json': manifest(), 'templates/main.svg': svg('') }
    const open = async files => { const { zip, dir } = build(files); try { return await invoke('templatepkg:open', { path: zip }) } finally { rmSync(dir, { recursive: true, force: true }) } }

    it('accepts a minimal good package', async () => {
      const opened = await open(good)
      expect(opened.name).toBe('X')
      await invoke('templatepkg:close', opened.token)
    })
    it('refuses files that are not in the allowed layout, and path tricks', async () => {
      await expect(open({ ...good, 'evil.exe': 'x' })).rejects.toThrow(/not an allowed file/)
      await expect(open({ ...good, '../escape.svg': 'x' })).rejects.toThrow(/not an allowed file/)
      await expect(open({ ...good, 'templates/sub/deep.svg': 'x' })).rejects.toThrow(/not an allowed file/)
    })
    it('refuses a manifest that lists files that are not there, or points outside', async () => {
      await expect(open({ 'manifest.json': manifest({ fonts: [{ file: 'fonts/none.ttf' }] }), 'templates/main.svg': svg('') })).rejects.toThrow(/missing/)
      await expect(open({ 'manifest.json': manifest({ assets: [{ id: 'a', file: '../../etc/passwd' }] }), 'templates/main.svg': svg('') })).rejects.toThrow(/not an allowed file/)
    })
    it('refuses malformed manifests', async () => {
      await expect(open({ 'manifest.json': '{nope', 'templates/main.svg': svg('') })).rejects.toThrow(/not valid JSON/)
      await expect(open({ 'manifest.json': JSON.stringify({ format: 1, name: '', templates: [] }), 'templates/main.svg': svg('') })).rejects.toThrow(/name is missing/)
      await expect(open({ 'manifest.json': manifest({ fields: [{ name: 'X', slug: 'card_id', type: 'text' }] }), 'templates/main.svg': svg('') })).rejects.toThrow(/field definition/)
      await expect(open({ 'manifest.json': manifest({ fields: [{ name: 'X', slug: 'a', type: 'weird' }] }), 'templates/main.svg': svg('') })).rejects.toThrow(/field definition/)
      await expect(open({ 'manifest.json': manifest({ palette: [{ name: 'a', value: 'red' }] }), 'templates/main.svg': svg('') })).rejects.toThrow(/palette/)
    })
    it('refuses a package from a newer format, with the numbers', async () => {
      await expect(open({ 'manifest.json': manifest({ format: 9 }), 'templates/main.svg': svg('') })).rejects.toThrow(/newer version of Spadewick \(package format 9/)
    })
    it('refuses a file that is not a ZIP', async () => {
      const dir = tmp(); const f = join(dir, 'x.spadewick-template'); writeFileSync(f, 'this is not a zip')
      await expect(invoke('templatepkg:open', { path: f })).rejects.toThrow(/Not a valid ZIP/)
      rmSync(dir, { recursive: true, force: true })
    })
    it('refuses an archive with too many files', async () => {
      const files = { ...good }
      for (let i = 0; i < 510; i++) files[`mockup/images/i${i}.png`] = 'x'
      await expect(open(files)).rejects.toThrow(/more than 500 files/)
    })
    it('cleans scripts, handlers and outside links out of the template, and out of its images', async () => {
      const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><image href="http://evil/x.png"/><rect width="1" height="1"/></svg>'
      const opened = await open({ 'manifest.json': manifest({ assets: [{ id: 'a', file: 'assets/a.svg' }] }), 'templates/main.svg': dirty, 'assets/a.svg': dirty })
      const applied = await invoke('templatepkg:apply', { token: opened.token, target: 'project' })
      const text = (await invoke('templates:get', applied.project.templateId)).svg_source
      expect(text).not.toMatch(/script|onload|evil/)
      const asset = (await invoke('assets:list', {}))[0]
      expect(readFileSync(join(ctx.dir, 'assets', asset.filename), 'utf8')).not.toMatch(/script|onload|evil/)
    })
    it('does not trust a size the archive declares: an entry that inflates beyond it is refused', async () => {
      const dir = tmp(); const src = join(dir, 'big.bin'); writeFileSync(src, Buffer.alloc(2 * 1024 * 1024))
      const zip = join(dir, 'bomb.zip'); writeZip(zip, [{ name: 'big.bin', file: src }])
      const bytes = readFileSync(zip)
      for (let i = 0; i < bytes.length - 4; i++) if (bytes.readUInt32LE(i) === 0x02014b50) bytes.writeUInt32LE(100, i + 24)   // claim 100 bytes
      writeFileSync(zip, bytes)
      expect(() => extractZip(zip, join(dir, 'out'))).toThrow(/Checksum mismatch/)
      expect(existsSync(join(dir, 'out', 'big.bin'))).toBe(false)
      rmSync(dir, { recursive: true, force: true })
    })
    it('refuses an archive that unpacks to more than the limit', async () => {
      const dir = tmp(); const src = join(dir, 'a.bin'); writeFileSync(src, Buffer.alloc(1000))
      const zip = join(dir, 'a.zip'); writeZip(zip, [{ name: 'a.bin', file: src }])
      expect(() => extractZip(zip, join(dir, 'out'), { maxTotalBytes: 500 })).toThrow(/larger than allowed/)
      expect(() => extractZip(zip, join(dir, 'out'), { maxEntries: 0 })).toThrow(/more than 0 files/)
      rmSync(dir, { recursive: true, force: true })
    })
  })
})

describe('Update from library and Reset to original (PRD §7.7.3)', () => {
  async function savedAndUsed() {
    const { set, template } = await projectWithDesign()
    const saved = await invoke('templatelib:save', { templateId: template.id, setId: set.id, name: 'Hero frame' })
    const used = await invoke('templatelib:use', { kind: 'mine', id: saved.id, setId: set.id })
    return { set, saved, used }
  }

  it('shows nothing to update until the library item has a newer version, then what changed', async () => {
    const { set, template, saved, used } = await (async () => { const a = await savedAndUsed(); return { ...a, template: null } })()
    expect(await invoke('templatelib:origin-status', used.templateId)).toMatchObject({ hasOrigin: true, itemAvailable: true, updateAvailable: false })
    // the designer improves the template and saves it again as a new version of the same item
    const designTemplate = (await invoke('templates:list')).find(t => t.name === 'Hero')
    await invoke('templates:update', { id: designTemplate.id, svgSource: svg('<rect width="50" height="50" fill="#00ff00"/>') })
    await invoke('templatelib:save', { templateId: designTemplate.id, setId: set.id, name: 'Hero frame', itemId: saved.id })
    const status = await invoke('templatelib:origin-status', used.templateId)
    expect(status).toMatchObject({ updateAvailable: true, itemVersion: 2, itemName: 'Hero frame' })
    expect(status.changes.added).toBeGreaterThan(0)
  })

  it('replace overwrites the copy (name kept), keep-both adds another; nothing happens by itself', async () => {
    const { set, saved, used } = await savedAndUsed()
    const hero = (await invoke('templates:list')).find(t => t.name === 'Hero')
    await invoke('templates:update', { id: hero.id, svgSource: svg('<rect width="50" height="50" fill="#00ff00"/>') })
    await invoke('templatelib:save', { templateId: hero.id, setId: set.id, itemId: saved.id })
    const untouched = (await invoke('templates:get', used.templateId)).svg_source
    expect(untouched).toContain('Liberation Mono')   // still the first version

    await invoke('templates:update', { id: used.templateId, name: 'My copy' })
    await invoke('templatelib:update', { templateId: used.templateId, mode: 'replace' })
    const replaced = await invoke('templates:get', used.templateId)
    expect(replaced.name).toBe('My copy')
    expect(replaced.svg_source).toContain('#00ff00')
    expect((await origin(used.templateId)).version).toBe(2)

    const before = (await invoke('templates:list')).length
    await invoke('templatelib:update', { templateId: used.templateId, mode: 'keep-both' })
    expect((await invoke('templates:list')).length).toBe(before + 1)
  })

  it('reset puts the library version back, in one undo step', async () => {
    const { used } = await savedAndUsed()
    const original = (await invoke('templates:get', used.templateId)).svg_source
    await invoke('templates:update', { id: used.templateId, svgSource: svg('<rect width="9" height="9"/>') })
    expect((await invoke('templatelib:project-templates')).find(t => t.id === used.templateId).modified).toBe(true)
    await invoke('templatelib:reset', { templateId: used.templateId })
    expect((await invoke('templates:get', used.templateId)).svg_source).toBe(original)
    expect((await invoke('templatelib:project-templates')).find(t => t.id === used.templateId).modified).toBe(false)
    await invoke('history:undo')
    expect((await invoke('templates:get', used.templateId)).svg_source).toContain('width="9"')
  })

  it('says so when the library item is gone, and when the template never came from the library', async () => {
    const { saved, used } = await savedAndUsed()
    await invoke('templatelib:delete-item', saved.id)
    expect(await invoke('templatelib:origin-status', used.templateId)).toMatchObject({ hasOrigin: true, itemAvailable: false, updateAvailable: false })
    await expect(invoke('templatelib:reset', { templateId: used.templateId })).rejects.toThrow(/no longer in the library/)
    const plain = await invoke('templates:create', { name: 'Plain', svgSource: svg('') })
    expect(await invoke('templatelib:origin-status', plain.id)).toMatchObject({ hasOrigin: false })
    await expect(invoke('templatelib:reset', { templateId: plain.id })).rejects.toThrow(/nothing to compare/)
  })
})

describe('the template manager\'s project list', () => {
  it('lists templates with origin, use and a picture; duplicate keeps the origin', async () => {
    const { set } = await seedSet({ name: 'Base', cards: [{ name: 'a' }] })
    const used = await invoke('templatelib:use', { kind: 'starter', id: 'example-playing-card', setId: set.id, makeDefault: true, includeSampleCards: true })
    const list = await invoke('templatelib:project-templates')
    expect(list).toEqual([expect.objectContaining({ id: used.templateId, name: 'Playing card', defaultOfSets: 1, modified: false, origin: expect.objectContaining({ itemId: 'example-playing-card' }) })])
    const thumb = await invoke('templatelib:project-thumbnail', used.templateId)
    expect((await sharp(Buffer.from(thumb, 'base64')).metadata()).format).toBe('png')
  })

  it('a shared frame (parent) is not reported as edited, and cannot be updated on its own', async () => {
    const { set } = await seedSet({ name: 'Base' })
    const used = await invoke('templatelib:use', { kind: 'starter', id: 'example-creature', setId: set.id })
    const list = await invoke('templatelib:project-templates')
    expect(list.map(t => [t.name, t.modified, t.origin.role])).toEqual(expect.arrayContaining([['Creature', false, 'main'], ['Creature frame', false, 'parent']]))
    await expect(invoke('templatelib:reset', { templateId: used.parentId })).rejects.toThrow(/shared frame/)
    await invoke('templatelib:reset', { templateId: used.templateId })   // resetting the child refreshes its frame too
  })

  it('names the blank frames after their card size', async () => {
    const { starters } = await invoke('templatelib:list')
    expect(starters.find(s => s.id === 'blank-tarot').name).toBe('Blank frame — Tarot (70 × 120 mm)')
  })

  it('duplicates keep the origin', async () => {
    const { set } = await seedSet({ name: 'Base', cards: [{ name: 'a' }] })
    const used = await invoke('templatelib:use', { kind: 'starter', id: 'example-playing-card', setId: set.id, makeDefault: true, includeSampleCards: true })
    const thumb = await invoke('templatelib:project-thumbnail', used.templateId)
    expect((await sharp(Buffer.from(thumb, 'base64')).metadata()).format).toBe('png')
    const copy = await invoke('templates:duplicate', used.templateId)
    expect(copy.name).toBe('Playing card copy')
    expect(JSON.parse(copy.origin).itemId).toBe('example-playing-card')
  })
})

describe('planning for a new set', () => {
  it('does not warn that fields or the card size will be skipped, because the new set gets both', async () => {
    const forNew = await invoke('templatelib:plan', { kind: 'starter', id: 'example-tarot', newSet: true })
    expect(forNew.notes).toEqual([])
    const forNone = await invoke('templatelib:plan', { kind: 'starter', id: 'example-tarot' })
    expect(forNone.notes.join(' ')).toMatch(/fields/)
  })
})
