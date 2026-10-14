/**
 * Rich text in the project (PRD §16.7): the Rich text field type and its schema, drawing a field with markup, the places
 * that must read it as plain text, find and replace, import, and the preview before a field changes type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { createTestProject, seedSet, invoke, mockDialog } from '../helpers/project.js'
import { openProjectDb, closeProjectDb, CURRENT_SCHEMA_VERSION, takeUpgradeInfo } from '../../src/main/db.js'
import { buildCardSvg, renderCard } from '../../src/main/render.js'
import { richSlugsOf, plainValues } from '../../src/main/richFields.js'
import { Resvg } from '@resvg/resvg-js'

let proj
beforeEach(async () => { proj = await createTestProject('Rich') })
afterEach(async () => { await proj.cleanup() })

const boxed = (attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#fff"/>` +
  `<text x="20" y="40" width="210" height="120" font-size="24" font-family="Liberation Sans" data-spadewick-field="body" fill="#000" ${attrs}>{{body}}</text></svg>`

async function seed(bodyType, bodies, svg = boxed()) {
  const s = await seedSet({ cardSize: 'poker', fields: [{ name: 'Body', type: bodyType }], template: { name: 'T', svg }, cards: bodies.map(b => ({ name: 'C', fields: { body: b } })) })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}

const inkWidth = png => {
  const img = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" fill="#fff"/><image width="250" height="350" href="data:image/png;base64,${png.toString('base64')}"/></svg>`).render()
  const px = img.pixels
  let x0 = 1e9, x1 = -1
  for (let y = 0; y < 350; y++) for (let x = 0; x < 250; x++) if (px[(y * 250 + x) * 4] < 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1) }
  return x1 - x0
}

describe('the schema for the Rich text type', () => {
  it('is version 8, and a new project accepts the type', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(15)
    const s = await seed('rich_text', ['x'])
    expect((await invoke('fields:list', s.set.id))[0].type).toBe('rich_text')
    await expect(invoke('fields:create', { setId: s.set.id, name: 'Bad', type: 'nonsense' })).rejects.toThrow()
  })

  it('upgrades a version 7 project by rebuilding the fields table, keeping every row, and takes a snapshot first', async () => {
    const s = await seed('text', ['hello'])
    await invoke('fields:create', { setId: s.set.id, name: 'Cost', type: 'number', defaultValue: '3' })
    await invoke('fields:set-width', { id: (await invoke('fields:list', s.set.id))[0].id, widthPx: 222 })
    const before = await invoke('fields:list', s.set.id)
    await invoke('projects:close')
    // Make the project look like version 7: the field types are limited to the old list
    const raw = new Database(join(proj.dir, 'project.db'))
    raw.exec(`
      ALTER TABLE fields RENAME TO tmp_fields;
      CREATE TABLE fields (id TEXT PRIMARY KEY, set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text','number','boolean','image_ref','color','formula')), default_value TEXT, formula TEXT, validation TEXT,
        display_order INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, width_px INTEGER, created_at INTEGER NOT NULL, UNIQUE(set_id, slug));
      INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, width_px, created_at)
        SELECT id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, width_px, created_at FROM tmp_fields;
      DROP TABLE tmp_fields;
      UPDATE project_meta SET value = '7' WHERE key = 'schema_version';`)
    expect(() => raw.prepare("INSERT INTO fields VALUES ('x','nope','n','s','rich_text',NULL,NULL,NULL,0,0,NULL,1)").run()).toThrow(/CHECK|constraint/i)
    raw.close()

    const state = await invoke('projects:open', proj.dir)
    expect(state.upgrade).toMatchObject({ from: 7, to: CURRENT_SCHEMA_VERSION })
    expect(state.upgrade.snapshot).toMatch(/^pre_upgrade_v7_/)
    // every row as it was (the set also gains the text field that takes over its old built-in Name column, UPDATES U10)
    expect((await invoke('fields:list', s.set.id)).filter(f => f.slug !== 'name')).toEqual(before)
    const made = await invoke('fields:create', { setId: s.set.id, name: 'Rules', type: 'rich_text' })
    expect(made.type).toBe('rich_text')
    const d = openProjectDb(proj.dir)
    expect(d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_fields_set_id'").get()).toBeTruthy()
    expect(d.prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe(String(CURRENT_SCHEMA_VERSION))
    expect(d.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tmp_fields%' OR name LIKE '%fields_v7%'").all()).toEqual([])
  })

  it('undoes and redoes creating and changing a Rich text field', async () => {
    const s = await seed('text', ['a'])
    const f = (await invoke('fields:list', s.set.id))[0]
    await invoke('fields:update', { id: f.id, type: 'rich_text' })
    expect((await invoke('fields:list', s.set.id))[0].type).toBe('rich_text')
    await invoke('history:undo')
    expect((await invoke('fields:list', s.set.id))[0].type).toBe('text')
    await invoke('history:redo')
    expect((await invoke('fields:list', s.set.id))[0].type).toBe('rich_text')
  })
})

describe('drawing a field with markup', () => {
  it('draws a Rich text field in a bound element with its markup read, no asterisks drawn', async () => {
    const s = await seed('rich_text', ['**Wide**'])
    const { svg } = await buildCardSvg(proj.dir, s.cards[0].id)
    expect(svg).not.toContain('<text')
    const rich = inkWidth(await renderCard(proj.dir, s.cards[0].id, { width: 250 }))
    // The same word, bold, drawn natively: the markup must have given exactly that
    const native = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" fill="#fff"/><text x="20" y="40" font-size="24" font-family="Liberation Sans" font-weight="bold" fill="#000">Wide</text></svg>',
      { font: { loadSystemFonts: false, fontFiles: [join(process.cwd(), 'resources/fonts/LiberationSans-Bold.ttf')] } }).render()
    const px = native.pixels
    let x0 = 1e9, x1 = -1
    for (let y = 0; y < 350; y++) for (let x = 0; x < 250; x++) if (px[(y * 250 + x) * 4] < 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1) }
    expect(Math.abs(rich - (x1 - x0))).toBeLessThanOrEqual(1)
  })

  it('draws the same text in a Text field as written, asterisks included', async () => {
    const plain = await seed('text', ['**Wide**'])
    const plainWidth = inkWidth(await renderCard(proj.dir, plain.cards[0].id, { width: 250 }))
    await invoke('projects:close')
    proj.cleanup = async () => {}
    const other = await createTestProject('Rich2')
    const rich = await seedSet({ cardSize: 'poker', fields: [{ name: 'Body', type: 'rich_text' }], template: { name: 'T', svg: boxed() }, cards: [{ name: 'C', fields: { body: '**Wide**' } }] })
    await invoke('sets:update', { id: rich.set.id, defaultTemplateId: rich.template.id })
    const richWidth = inkWidth(await renderCard(other.dir, rich.cards[0].id, { width: 250 }))
    expect(plainWidth).toBeGreaterThan(richWidth + 5)
    await other.cleanup()
  })

  it('reads markup in an element whose content is a token of a Rich text field, with no field binding', async () => {
    const s = await seed('rich_text', ['*x*'], '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><text x="10" y="50" font-size="30" fill="#000">{{body}}</text></svg>')
    const report = {}
    const { svg } = await buildCardSvg(proj.dir, s.cards[0].id, { report })
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('data-spadewick-rich') // the switch is not left in the picture
  })

  it('reads markup in any text element that asks for it, and not in one that does not', async () => {
    const tpl = rich => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#fff"/><text x="10" y="60" font-size="30" ${rich} data-spadewick-field="body" fill="#000">{{body}}</text></svg>`
    const asked = await seed('text', ['**ab**'], tpl('data-spadewick-rich="true"'))
    const w1 = inkWidth(await renderCard(proj.dir, asked.cards[0].id, { width: 250 }))
    await invoke('sets:update', { id: asked.set.id, cardSize: 'poker' })
    await invoke('templates:update', { id: asked.template.id, svgSource: tpl('') })
    const w2 = inkWidth(await renderCard(proj.dir, asked.cards[0].id, { width: 250 }))
    expect(w2).toBeGreaterThan(w1 + 8) // the asterisks are drawn when markup is not asked for
  })

  it('draws an icon, and reports one that does not exist', async () => {
    const s = await seed('rich_text', ['Go {star} {nosuch}'])
    const report = {}
    const { svg } = await buildCardSvg(proj.dir, s.cards[0].id, { report })
    expect(svg).not.toContain('<text')
    expect([...report.missingIcons]).toEqual(['nosuch'])
  })

  it('keeps a project on the earlier estimate showing a Rich text field without its markup', async () => {
    const s = await seed('rich_text', ['**Hello** {star}'])
    await invoke('projects:set-text-engine', 'estimate')
    const { svg } = await buildCardSvg(proj.dir, s.cards[0].id)
    expect(svg).toContain('Hello star')
    expect(svg).not.toContain('**')
  })
})

describe('where a Rich text field is read as plain text (PRD §16.7)', () => {
  it('has helpers that strip only the Rich text fields', () => {
    const defs = [{ slug: 'a', type: 'rich_text' }, { slug: 'b', type: 'text' }]
    const slugs = richSlugsOf(defs)
    expect([...slugs]).toEqual(['a'])
    expect(plainValues({ a: '**x** {fire}', b: '**y**', c: 'z' }, slugs)).toEqual({ a: 'x fire', b: '**y**', c: 'z' })
    const same = { a: '*k*' }
    expect(plainValues(same, new Set())).toBe(same)
  })

  it('writes the Tabletop Simulator description without markup', async () => {
    const s = await seed('rich_text', ['**Flying** {star}'])
    const out = mkdtempSync(join(tmpdir(), 'rich-tts-'))
    await invoke('export:tts', { setIds: [s.set.id], outputDir: out, descriptionField: 'body', displayNameField: 'body' })
    const deck = JSON.parse(readFileSync(join(out, readFileSyncName(out)), 'utf8'))
    const card = deck.ObjectStates[0]   // one card: a card, not a deck
    expect(card.Description).toBe('Flying star')
    expect(card.Nickname).toBe('Flying star')
  })

  it('lets an export filter compare a Rich text field as plain text', async () => {
    const s = await seed('rich_text', ['**Red**', '*Blue*'])
    const out = mkdtempSync(join(tmpdir(), 'rich-filter-'))
    const res = await invoke('export:png-sheet', { setIds: [s.set.id], outputDir: out, cardWidth: 50, cardHeight: 70, filter: "body == 'Red'" })
    expect(res.cardCount).toBe(1)
  })
})

describe('find and replace', () => {
  it('searches a Rich text field as text including its markup, and says which results are rich', async () => {
    const s = await seed('rich_text', ['a **loud** word', 'quiet'])
    const found = await invoke('cards:find-replace', { setIds: [s.set.id], find: '**loud**', replace: 'soft', previewOnly: true })
    expect(found).toHaveLength(1)
    expect(found[0].changes.body).toMatchObject({ from: 'a **loud** word', to: 'a soft word', rich: true })
    await invoke('cards:find-replace', { setIds: [s.set.id], find: 'loud', replace: 'calm' })
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('a **calm** word')
  })

  it('marks results of a plain field as not rich', async () => {
    const s = await seed('text', ['abc'])
    const found = await invoke('cards:find-replace', { setIds: [s.set.id], find: 'b', replace: 'c', previewOnly: true })
    expect(found[0].changes.body.rich).toBe(false)
  })
})

describe('importing into a Rich text field', () => {
  const rows = [{ Body: 'a *b* {fire} c_d' }]
  const mapping = { Body: 'body' }

  it('reads the incoming text as markup by default', async () => {
    const s = await seed('rich_text', [])
    await invoke('dataio:import', { setId: s.set.id, rows, mapping, mode: 'append' })
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('a *b* {fire} c_d')
  })

  it('keeps the incoming text exactly as written when asked, by escaping it', async () => {
    const s = await seed('rich_text', [])
    await invoke('dataio:import', { setId: s.set.id, rows, mapping, mode: 'append', richText: 'literal' })
    const stored = (await invoke('cards:list', s.set.id))[0].fields.body
    expect(stored).toBe('a \\*b\\* \\{fire\\} c\\_d')
    const { stripMarkup } = await import('../../src/shared/richText.js')
    expect(stripMarkup(stored)).toBe('a *b* {fire} c_d')
  })

  it('does not escape text going into a plain field', async () => {
    const s = await seed('text', [])
    await invoke('dataio:import', { setId: s.set.id, rows, mapping, mode: 'append', richText: 'literal' })
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('a *b* {fire} c_d')
  })

  it('exports the markup as it is stored', async () => {
    const s = await seed('rich_text', ['**x** {fire}'])
    const out = join(mkdtempSync(join(tmpdir(), 'rich-csv-')), 'cards.csv')
    mockDialog.save(out)
    await invoke('dataio:export', { setIds: [s.set.id], format: 'csv' })
    expect(readFileSync(out, 'utf8')).toContain('**x** {fire}')
  })
})

describe('changing a field between Text and Rich text', () => {
  it('lists the cards that would look different, and none that would not', async () => {
    const s = await seed('text', ['plain words', 'a **loud** one', '{fire} cost', 'snake_case only', '2 * 3 = 6'])
    const field = (await invoke('fields:list', s.set.id))[0]
    const impact = await invoke('fields:convert-impact', { id: field.id, type: 'rich_text' })
    expect(impact.count).toBe(2)
    expect(impact.cards.map(c => c.text).sort()).toEqual(['a **loud** one', '{fire} cost'])
  })

  it('looks the other way too, and has nothing to say about other changes', async () => {
    const s = await seed('rich_text', ['**bold**', 'plain'])
    const field = (await invoke('fields:list', s.set.id))[0]
    expect((await invoke('fields:convert-impact', { id: field.id, type: 'text' })).count).toBe(1)
    expect((await invoke('fields:convert-impact', { id: field.id, type: 'number' })).count).toBe(0)
    await expect(invoke('fields:convert-impact', { id: 'missing', type: 'text' })).rejects.toThrow()
  })
})

function readFileSyncName(out) { return 'base_set.json' }
