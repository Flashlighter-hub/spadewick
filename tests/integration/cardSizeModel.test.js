/**
 * PRD §10.6, §7.5, §28 (F6–F9): every set and every template has its own card size; a set only uses templates
 * of its size; the project default size and the project palette are gone; older projects are upgraded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import Database from 'better-sqlite3'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { openProjectDb, closeProjectDb, takeUpgradeInfo, CURRENT_SCHEMA_VERSION } from '../../src/main/db.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const svgOf = (w, h, inner = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${inner}</svg>`

describe('a card size for every set', () => {
  it('is chosen when the set is made, and is Poker when nothing else is chosen', async () => {
    expect(await invoke('sets:create', { name: 'A' })).toMatchObject({ card_size: 'poker' })
    expect(await invoke('sets:create', { name: 'B', cardSize: 'tarot' })).toMatchObject({ card_size: 'tarot', card_mm_w: null })
    expect(await invoke('sets:create', { name: 'C', cardSize: 'custom', cardMmW: 50, cardMmH: 80 })).toMatchObject({ card_size: 'custom', card_mm_w: 50, card_mm_h: 80 })
  })

  it('is never empty: a set cannot be given no size', async () => {
    const set = await invoke('sets:create', { name: 'A', cardSize: 'tarot' })
    const updated = await invoke('sets:update', { id: set.id, cardSize: null })   // "inherit" no longer exists: it means Poker
    expect(updated.card_size).toBe('poker')
  })

  it('draws cards at the set size', async () => {
    const set = await invoke('sets:create', { name: 'A', cardSize: 'tarot' })
    expect(await invoke('cardsize:get', set.id)).toMatchObject({ id: 'tarot', widthPx: 500, heightPx: 857 })
  })
})

describe('a card size for every template, fixed when it is made', () => {
  it('stores the size, and refuses to change it', async () => {
    const t = await invoke('templates:create', { name: 'Tall', svgSource: svgOf(500, 857), cardSize: 'tarot' })
    expect(t).toMatchObject({ card_size: 'tarot' })
    await expect(invoke('templates:update', { id: t.id, cardSize: 'poker' })).rejects.toThrow(/cannot be changed/)
    expect((await invoke('templates:update', { id: t.id, name: 'Taller', cardSize: 'tarot' })).name).toBe('Taller')   // the same size is not a change
  })

  it('a child template takes the size of its parent', async () => {
    const parent = await invoke('templates:create', { name: 'Frame', svgSource: svgOf(500, 857), cardSize: 'tarot' })
    const child = await invoke('templates:create', { name: 'Creature', parentId: parent.id, svgSource: svgOf(500, 857), cardSize: 'poker' })
    expect(child.card_size).toBe('tarot')
  })

  it('a duplicate keeps the size', async () => {
    const t = await invoke('templates:create', { name: 'Tall', svgSource: svgOf(500, 857), cardSize: 'tarot' })
    const copy = await invoke('templates:duplicate', t.id)
    expect(copy).toMatchObject({ card_size: 'tarot' })
  })

  it('is listed for a set only when it matches the set (PRD §10.6)', async () => {
    const poker = await invoke('templates:create', { name: 'P', svgSource: svgOf(500, 700) })
    const tarot = await invoke('templates:create', { name: 'T', svgSource: svgOf(500, 857), cardSize: 'tarot' })
    const tarotSet = await invoke('sets:create', { name: 'Tarot set', cardSize: 'tarot' })
    const pokerSet = await invoke('sets:create', { name: 'Poker set' })
    expect((await invoke('templates:list')).map(t => t.name)).toEqual(['P', 'T'])
    expect((await invoke('templates:list', { setId: tarotSet.id })).map(t => t.name)).toEqual(['T'])
    expect((await invoke('templates:list', { setId: pokerSet.id })).map(t => t.name)).toEqual(['P'])
    expect(poker.id).not.toBe(tarot.id)
  })

  it('a set refuses a default template, and a card refuses a template, of another size', async () => {
    const tarot = await invoke('templates:create', { name: 'T', svgSource: svgOf(500, 857), cardSize: 'tarot' })
    const { set, cards } = await seedSet({ name: 'Poker set', cards: [{ name: 'a' }] })
    await expect(invoke('sets:update', { id: set.id, defaultTemplateId: tarot.id })).rejects.toThrow(/different card size/)
    await expect(invoke('cards:update', { id: cards[0].id, templateId: tarot.id })).rejects.toThrow(/different card size/)
    await expect(invoke('cards:batch-update', { cardIds: [cards[0].id], templateId: tarot.id })).rejects.toThrow(/different card size/)
    await expect(invoke('cards:create', { setId: set.id, displayName: 'b', templateId: tarot.id })).rejects.toThrow(/different card size/)
  })
})

describe('changing the size of a set that already has templates (with a warning)', () => {
  it('says what would be undone, then undoes exactly that', async () => {
    const { set, cards, template } = await seedSet({ name: 'S', cards: [{ name: 'a' }, { name: 'b' }], template: { svg: svgOf(500, 700), name: 'Poker frame' } })
    await invoke('sets:update', { id: set.id, defaultTemplateId: template.id })
    await invoke('cards:update', { id: cards[0].id, templateId: template.id })
    const tarot = await invoke('templates:create', { name: 'Tarot frame', svgSource: svgOf(500, 857), cardSize: 'tarot' })

    expect(await invoke('sets:size-impact', { id: set.id, cardSize: 'poker' })).toMatchObject({ same: true, defaultTemplate: null, cards: 0 })
    expect(await invoke('sets:size-impact', { id: set.id, cardSize: 'tarot' })).toMatchObject({ same: false, defaultTemplate: 'Poker frame', cards: 2, matchingTemplates: 1 })

    await invoke('sets:update', { id: set.id, cardSize: 'tarot' })
    const after = (await invoke('sets:list'))[0]
    expect(after).toMatchObject({ card_size: 'tarot', default_template_id: null })
    expect((await invoke('cards:list', set.id)).map(c => c.template_id)).toEqual([null, null])   // the cards themselves are untouched
    expect((await invoke('cards:list', set.id)).length).toBe(2)
    await invoke('sets:update', { id: set.id, defaultTemplateId: tarot.id })                      // and a template that fits can be chosen
  })

  it('keeps a template that already fits the new size', async () => {
    const { set } = await seedSet({ name: 'S' })
    const tarot = await invoke('templates:create', { name: 'Tarot frame', svgSource: svgOf(500, 857), cardSize: 'tarot' })
    await invoke('cards:create', { setId: set.id, displayName: 'x' })
    await invoke('sets:update', { id: set.id, cardSize: 'tarot' })
    await invoke('sets:update', { id: set.id, defaultTemplateId: tarot.id })
    await invoke('sets:update', { id: set.id, cardSize: 'tarot' })   // no change
    expect((await invoke('sets:list'))[0].default_template_id).toBe(tarot.id)
  })
})

describe('upgrading a project from before card sizes belonged to sets and templates (schema 7)', () => {
  /** Turn the project in `ctx` into what version 6 wrote: no template sizes, a project default size, a palette. */
  async function makeLegacy({ projectSize = 'tarot', paletteUse = true } = {}) {
    const poker = await seedSet({ name: 'Heroes', cards: [{ name: 'a' }], template: { svg: svgOf(500, 700, paletteUse ? '<rect fill="{{@palette.brand}}" data-spadewick-id="r"/><g data-spadewick-show-if="eq(tint, palette(\'brand\'))"/>' : ''), name: 'Hero' } })
    await invoke('sets:update', { id: poker.set.id, defaultTemplateId: poker.template.id })
    const loose = await invoke('templates:create', { name: 'Loose tarot-shaped', svgSource: svgOf(500, 857) })        // used by no set
    const child = await invoke('templates:create', { name: 'Child', parentId: poker.template.id, svgSource: '<!-- spadewick:parent="Hero" -->' })
    const other = await invoke('sets:create', { name: 'No size yet' })
    await invoke('fields:create', { setId: other.id, name: 'Shade', type: 'formula', formula: 'palette("brand")' })
    await invoke('projects:close')
    const raw = new Database(join(ctx.dir, 'project.db'))
    raw.exec("ALTER TABLE templates DROP COLUMN card_size; ALTER TABLE templates DROP COLUMN card_mm_w; ALTER TABLE templates DROP COLUMN card_mm_h;" +
      "CREATE TABLE palette (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, label TEXT NOT NULL, value TEXT NOT NULL); INSERT INTO palette VALUES ('p1','brand','Brand','#336699');")
    raw.prepare("UPDATE sets SET card_size = NULL, card_mm_w = NULL, card_mm_h = NULL WHERE id = ?").run(other.id)
    raw.prepare("UPDATE sets SET card_size = NULL WHERE id = ?").run(poker.set.id)      // inherits the project default, as in version 6
    raw.prepare("INSERT OR REPLACE INTO project_meta (key, value) VALUES ('card_size', ?), ('schema_version', '6')").run(projectSize)
    raw.close()
    return { poker, loose, child, other }
  }
  const reopen = () => { const d = openProjectDb(ctx.dir); return d }

  it('gives every set the size the project had, and every template a size from its set or its shape', async () => {
    const { poker, loose, child } = await makeLegacy({ projectSize: 'poker' })
    const d = reopen()
    const sets = Object.fromEntries(d.prepare('SELECT name, card_size FROM sets').all().map(s => [s.name, s.card_size]))
    expect(sets).toEqual({ Heroes: 'poker', 'No size yet': 'poker' })
    const t = Object.fromEntries(d.prepare('SELECT id, card_size FROM templates').all().map(r => [r.id, r.card_size]))
    expect(t[poker.template.id]).toBe('poker')     // used by a Poker set, and its shape agrees
    expect(t[loose.id]).toBe('tarot')              // used by no set: the nearest preset to 500 × 857
    expect(t[child.id]).toBe('poker')              // a child has its parent's size
    expect(d.prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe(String(CURRENT_SCHEMA_VERSION))
    const info = takeUpgradeInfo(ctx.dir)
    expect(info.snapshot).toBeTruthy()             // a snapshot was taken first
    expect(info.notices.join(' ')).toMatch(/2 sets/)
    closeProjectDb(ctx.dir)
  })

  it('uses the project default for sets and loose templates when nothing else says', async () => {
    const { loose, other } = await makeLegacy({ projectSize: 'mini_us' })
    const d = reopen()
    expect(d.prepare('SELECT card_size FROM sets WHERE id = ?').get(other.id).card_size).toBe('mini_us')
    expect(d.prepare('SELECT card_size FROM templates WHERE id = ?').get(loose.id).card_size).toBe('tarot')   // its shape is clearly not mini; the nearest preset wins
    closeProjectDb(ctx.dir)
  })

  it('replaces palette colours in templates and formulas by the colours themselves', async () => {
    const { poker, other } = await makeLegacy()
    const d = reopen()
    const svg = d.prepare('SELECT svg_source FROM templates WHERE id = ?').get(poker.template.id).svg_source
    expect(svg).toContain('fill="#336699"')
    expect(svg).toContain('"#336699"')
    expect(svg).not.toMatch(/palette/)
    expect(d.prepare("SELECT formula FROM fields WHERE set_id = ? AND slug = 'shade'").get(other.id).formula).toBe('"#336699"')
    expect(takeUpgradeInfo(ctx.dir).notices.join(' ')).toMatch(/palette is gone/)
    closeProjectDb(ctx.dir)
  })

  it('leaves a new project without a palette table or a project card size', async () => {
    const d = openProjectDb(ctx.dir)
    expect(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'palette'").get()).toBeUndefined()
    expect(d.prepare("SELECT 1 FROM project_meta WHERE key = 'card_size'").get()).toBeUndefined()
  })
})
