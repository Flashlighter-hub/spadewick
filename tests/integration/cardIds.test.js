import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, mkdtempSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import Database from 'better-sqlite3'
import { createTestProject, seedSet, invoke, mockDialog } from '../helpers/project.js'
import { openProjectDb, closeProjectDb, SchemaTooNewError, CURRENT_SCHEMA_VERSION } from '../../src/main/db.js'
import { evaluateFormula } from '../../src/main/formula.js'
import { parseCsv } from '../../src/main/csv.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const codes = async setId => (await invoke('cards:list', setId)).map(c => c.card_code)

async function importRows(set, rows, mapping, extra = {}) {
  return invoke('dataio:import', { setId: set.id, rows, mapping, mode: 'append', ...extra })
}
async function readCsv(setId, text) {
  const path = join(ctx.root, `in-${Math.random().toString(36).slice(2)}.csv`)
  const { writeFileSync } = await import('fs'); writeFileSync(path, text)
  mockDialog.open(path)
  return invoke('dataio:read-file', { format: 'csv', setId })
}

describe('card IDs: assignment (PRD §5.8)', () => {
  it('gives a new set a code from its name and new cards sequential IDs', async () => {
    const { set } = await seedSet({ name: 'Fire Creatures', cards: [{ name: 'a' }, { name: 'b' }] })
    expect(set.code).toBe('FIRE')
    expect(await codes(set.id)).toEqual(['FIRE-0001', 'FIRE-0002'])
  })

  it('gives different sets different codes, and counts per set', async () => {
    const a = await seedSet({ name: 'Fire Creatures', cards: [{ name: 'a' }] })
    const b = await seedSet({ name: 'Fire Spells', cards: [{ name: 'b' }] })
    expect(b.set.code).not.toBe(a.set.code)
    expect(await codes(b.set.id)).toEqual([`${b.set.code}-0001`])
  })

  it('a duplicate gets a new ID', async () => {
    const { set, cards } = await seedSet({ name: 'Base', cards: [{ name: 'a' }] })
    const [copy] = await invoke('cards:duplicate', [cards[0].id])
    expect(copy.card_code).toBe('BASE-0002')
    expect(await codes(set.id)).toEqual(['BASE-0001', 'BASE-0002'])
  })

  it('never reuses an ID: not after delete, not after undo or redo', async () => {
    const { set, cards } = await seedSet({ name: 'Base', cards: [{ name: 'a' }, { name: 'b' }] })
    await invoke('cards:delete', [cards[1].id])
    const c = await invoke('cards:create', { setId: set.id, displayName: 'c' })
    expect(c.card_code).toBe('BASE-0003')
    await invoke('history:undo')   // the creation of c
    await invoke('history:undo')   // the deletion of b brings it back with its old ID
    const all = (await invoke('cards:list', set.id)).map(x => x.card_code)
    expect(all).toEqual(['BASE-0001', 'BASE-0002'])
    const d = await invoke('cards:create', { setId: set.id, displayName: 'd' })
    expect(d.card_code).toBe('BASE-0004')
    await invoke('history:undo'); await invoke('history:redo')
    expect((await invoke('cards:list', set.id)).map(x => x.card_code)).toContain('BASE-0004')
  })

  it('supports a per-project counter, a start, a step and an author code', async () => {
    const a = await seedSet({ name: 'Alpha' })
    const b = await seedSet({ name: 'Beta' })
    const saved = await invoke('cardids:save', { pattern: '{set}-{author}-{n:3}', scope: 'project', start: 10, step: 5, author: 'k7' })
    expect(saved).toMatchObject({ scope: 'project', start: 10, step: 5, author: 'K7' })
    const c1 = await invoke('cards:create', { setId: a.set.id, displayName: '1' })
    const c2 = await invoke('cards:create', { setId: b.set.id, displayName: '2' })
    expect([c1.card_code, c2.card_code]).toEqual(['ALPH-K7-010', 'BETA-K7-015'])
  })

  it('refuses a pattern that is not valid and an author code of the wrong length', async () => {
    await expect(invoke('cardids:save', { pattern: '{set}', scope: 'set', start: 1, step: 1 })).rejects.toThrow(/\{n\}/)
    await expect(invoke('cardids:save', { pattern: '{n}', scope: 'weird', start: 1, step: 1 })).rejects.toThrow(/per set or per project/)
    await expect(invoke('cardids:save', { pattern: '{n}', scope: 'set', start: -1, step: 1 })).rejects.toThrow(/start/)
    await expect(invoke('cardids:save', { pattern: '{n}', scope: 'set', start: 1, step: 0 })).rejects.toThrow(/step/)
    await expect(invoke('cardids:save', { pattern: '{n}', scope: 'set', start: 1, step: 1, author: 'ABC' })).rejects.toThrow(/author/)
  })

  it('lets the user edit an ID, but only to an unused one', async () => {
    const { cards } = await seedSet({ name: 'Base', cards: [{ name: 'a' }, { name: 'b' }] })
    expect((await invoke('cards:update', { id: cards[0].id, cardCode: ' PROMO-1 ' })).card_code).toBe('PROMO-1')
    await expect(invoke('cards:update', { id: cards[1].id, cardCode: 'PROMO-1' })).rejects.toThrow(/already used/)
    await expect(invoke('cards:update', { id: cards[1].id, cardCode: '  ' })).rejects.toThrow(/empty/)
  })

  it('an edited ID ahead of the counter moves the counter past it', async () => {
    const { set, cards } = await seedSet({ name: 'Base', cards: [{ name: 'a' }] })
    await invoke('cards:update', { id: cards[0].id, cardCode: 'BASE-0050' })
    expect((await invoke('cards:create', { setId: set.id, displayName: 'b' })).card_code).toBe('BASE-0051')
  })

  it('set codes can be edited, stay unique, and do not rewrite existing IDs', async () => {
    const a = await seedSet({ name: 'Alpha', cards: [{ name: 'x' }] })
    const b = await seedSet({ name: 'Beta' })
    expect((await invoke('sets:update', { id: a.set.id, code: 'al-2' })).code).toBe('AL2')
    await expect(invoke('sets:update', { id: b.set.id, code: 'AL2' })).rejects.toThrow(/already used/)
    await expect(invoke('sets:update', { id: b.set.id, code: 'A' })).rejects.toThrow(/2 to 6/)
    expect(await codes(a.set.id)).toEqual(['ALPH-0001'])
    expect((await invoke('cards:create', { setId: a.set.id, displayName: 'y' })).card_code).toBe('AL2-0002')
  })
})

describe('card IDs: reserved name', () => {
  it('refuses a field called card_id by name or slug', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Cost', type: 'text' }] })
    await expect(invoke('fields:create', { setId: set.id, name: 'Card ID', type: 'text' })).rejects.toThrow(/reserved/)
    await expect(invoke('fields:create', { setId: set.id, name: 'Ident', slug: 'card_id', type: 'text' })).rejects.toThrow(/reserved/)
    const [cost] = await invoke('fields:list', set.id)
    await expect(invoke('fields:update', { id: cost.id, slug: 'card_id' })).rejects.toThrow(/reserved/)
    await expect(invoke('fields:update', { id: cost.id, name: 'card id' })).rejects.toThrow(/reserved/)
  })

  it('CSV import offers a different name for a column called Card ID that is not mapped to the ID', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(set.id, 'Name,card_id\nOrc,X1\n')
    expect(file.mapping.card_id).toBe('__card_id')
    file.mapping.card_id = '__new'
    await importRows(set, file.rows, file.mapping)
    const fields = await invoke('fields:list', set.id)
    expect(fields.map(f => f.slug)).toContain('card_id_2')
    expect(fields.map(f => f.slug)).not.toContain('card_id')
  })
})

describe('card IDs: import and export', () => {
  it('writes a card_id column first in CSV and JSON', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }], cards: [{ fields: { name: 'Orc' } }] })
    const csv = join(ctx.root, 'o.csv'); mockDialog.save(csv)
    await invoke('dataio:export', { setIds: [set.id], format: 'csv' })
    expect(parseCsv(readFileSync(csv, 'utf8'))[0][0]).toBe('card_id')
    const json = join(ctx.root, 'o.json'); mockDialog.save(json)
    await invoke('dataio:export', { setIds: [set.id], format: 'json' })
    expect(Object.keys(JSON.parse(readFileSync(json, 'utf8'))[0])[0]).toBe('card_id')
  })

  it('round trips: IDs survive export and import into another project set', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }], cards: [{ fields: { name: 'Orc' } }, { fields: { name: 'Elf' } }] })
    const csv = join(ctx.root, 'o.csv'); mockDialog.save(csv)
    await invoke('dataio:export', { setIds: [set.id], format: 'csv' })
    const other = await seedSet({ name: 'Copy', fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(other.set.id, readFileSync(csv, 'utf8'))
    // the same IDs already exist in the first set, so the copies get fresh IDs rather than a clash
    await importRows(other.set, file.rows, file.mapping)
    expect(await codes(other.set.id)).toEqual(['COPY-0001', 'COPY-0002'])
  })

  it('a row whose ID is new keeps it, and the counter moves past it (counter safety)', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(set.id, 'card_id,Name\nBASE-0007,Orc\n,Elf\n')
    await importRows(set, file.rows, file.mapping)
    expect(await codes(set.id)).toEqual(['BASE-0007', 'BASE-0008'])
    expect((await invoke('cards:create', { setId: set.id, displayName: 'z' })).card_code).toBe('BASE-0009')
  })

  it('a generated ID never equals one that a later row of the same file brings', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(set.id, 'card_id,Name\n,First\nBASE-0001,Second\n')
    await importRows(set, file.rows, file.mapping)
    const list = await invoke('cards:list', set.id)
    expect(list.map(c => c.fields.name)).toEqual(['First', 'Second'])
    expect(list[1].card_code).toBe('BASE-0001')
    expect(new Set(list.map(c => c.card_code)).size).toBe(2)
  })

  it('merge updates the card with the matching ID, whatever the other columns say', async () => {
    const { set, cards } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }], cards: [{ fields: { name: 'Orc' } }, { fields: { name: 'Elf' } }] })
    const file = await readCsv(set.id, 'card_id,Name\nBASE-0001,Goblin\nBASE-0099,New\n')
    const res = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'merge' })   // no key field needed
    expect(res).toMatchObject({ created: 1, updated: 1 })
    const list = await invoke('cards:list', set.id)
    expect(list.map(c => [c.card_code, c.fields.name])).toEqual([['BASE-0001', 'Goblin'], ['BASE-0002', 'Elf'], ['BASE-0099', 'New']])
    expect(list[0].id).toBe(cards[0].id)   // the same card, so its template and quantity are kept
  })

  it('merge still needs a key when the file has no IDs', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(set.id, 'Name\nOrc\n')
    await expect(invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'merge' })).rejects.toThrow(/key field/)
  })

  it('reports two rows with the same ID as a row error', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(set.id, 'card_id,Name\nA-1,Orc\nA-1,Elf\n')
    const res = await importRows(set, file.rows, file.mapping)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatchObject({ row: 3 })
    expect(res.errors[0].message).toMatch(/more than once/)
    expect(res.created).toBe(1)
  })

  it('an imported card with a new ID is one undo step', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }] })
    const file = await readCsv(set.id, 'card_id,Name\nBASE-0005,Orc\n')
    await importRows(set, file.rows, file.mapping)
    await invoke('history:undo')
    expect(await codes(set.id)).toEqual([])
  })
})

describe('card IDs: tokens, formulas and file names', () => {
  const px = async (id, x) => {
    const { data, info } = await sharp(Buffer.from(await invoke('templates:render', { cardId: id, width: 100 }), 'base64')).raw().toBuffer({ resolveWithObject: true })
    const i = x * info.channels
    return [data[i], data[i + 1], data[i + 2]]
  }

  it('substitutes {{@card.number}} and {{@card.count}} (and {{@card.id}} without error)', async () => {
    // the bar is as wide as 10 x the card's number; the second bar is as wide as 10 x the count
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140" viewBox="0 0 100 140"><rect width="100" height="140" fill="#ffffff"/><rect width="{{@card.number}}0" height="10" fill="#ff0000"/><rect y="20" width="{{@card.count}}0" height="10" fill="#0000ff"/><!-- {{@card.id}} --></svg>'
    const { cards } = await seedSet({ name: 'Base', cards: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], template: { svg } })
    const row = async (id, y) => {
      const { data, info } = await sharp(Buffer.from(await invoke('templates:render', { cardId: id, width: 100 }), 'base64')).raw().toBuffer({ resolveWithObject: true })
      return x => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 2]]
    }
    const first = await row(cards[0].id, 5), second = await row(cards[1].id, 5), third = await row(cards[2].id, 25)
    expect(first(5)[0]).toBe(255); expect(first(15)).toEqual([255, 255])     // card 1: 10 wide, white beyond
    expect(second(15)).toEqual([255, 0])                                      // card 2: 20 wide
    expect(second(25)).toEqual([255, 255])
    expect(third(25)).toEqual([0, 255])                                       // count is 3: 30 wide
  })

  it('a formula field can use card_id() while rendering', async () => {
    const probe = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><rect width="100" height="40" fill="{{fill}}"/></svg>'
    const { cards } = await seedSet({ name: 'Probe', fields: [{ name: 'Fill', type: 'formula', formula: 'if(eq(card_id(), "PROB-0001"), "#ff0000", "#00ff00")' }], cards: [{ name: 'p' }, { name: 'q' }], template: { svg: probe } })
    expect(await px(cards[0].id, 5)).toEqual([255, 0, 0])
    expect(await px(cards[1].id, 5)).toEqual([0, 255, 0])
  })

  it('card_id(), card_number() and card_count() are formula functions', () => {
    const f = { '@card.id': 'FIRE-0042', '@card.number': '3', '@card.count': '10' }
    expect(evaluateFormula('card_id()', f)).toBe('FIRE-0042')
    expect(evaluateFormula('concat(card_number(), "/", card_count())', f)).toBe('3/10')
    expect(evaluateFormula('card_id()', {})).toBe('')
  })

  it('numbers follow the current order and ignore deleted cards', async () => {
    const { cardContext } = await import('../../src/main/cardIds.js')
    const { set, cards } = await seedSet({ name: 'Base', cards: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    await invoke('cards:delete', [cards[0].id])
    const d = openProjectDb(ctx.dir)
    const row = id => d.prepare('SELECT * FROM cards WHERE id = ?').get(id)
    expect(cardContext(d, row(cards[1].id))).toEqual({ id: 'BASE-0002', number: 1, count: 2 })
    expect(cardContext(d, row(cards[2].id))).toEqual({ id: 'BASE-0003', number: 2, count: 2 })
    await invoke('cards:reorder', { setId: set.id, orderedIds: [cards[2].id, cards[1].id] })
    expect(cardContext(d, row(cards[2].id)).number).toBe(1)
  })

  it('the export card filter and individual PNG file names can use the ID', async () => {
    const svgPlain = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140" viewBox="0 0 100 140"><rect width="100" height="140" fill="#336699"/></svg>'
    const { set } = await seedSet({ name: 'Base', cards: [{ name: 'a' }, { name: 'b' }], template: { svg: svgPlain } })
    const out = join(ctx.root, 'png')
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: out, cardWidth: 50, cardHeight: 70, individualFiles: true, fileNameTemplate: '{{card_id}}', filter: "card_id == 'BASE-0002'" })
    expect(res.cardCount).toBe(1)
    expect(readdirSync(out)).toEqual(['BASE-0002.png'])
  })
})

describe('card IDs: upgrading a project made before IDs existed', () => {
  function legacyProject() {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-ids-'))
    const raw = new Database(join(dir, 'project.db'))
    raw.exec(`
      CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO project_meta VALUES ('schema_version','5'), ('name','Old Game');
      CREATE TABLE sets(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, card_size TEXT, card_mm_w REAL, card_mm_h REAL, default_template_id TEXT);
      INSERT INTO sets VALUES ('s1','Fire Creatures',NULL,0,1,1,NULL,NULL,NULL,NULL), ('s2','Fire Spells',NULL,1,1,1,NULL,NULL,NULL,NULL);
      CREATE TABLE fields(id TEXT PRIMARY KEY, set_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, type TEXT NOT NULL, default_value TEXT, formula TEXT, validation TEXT, display_order INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, width_px INTEGER, created_at INTEGER NOT NULL);
      INSERT INTO fields VALUES ('f1','s1','Card ID','card_id','text',NULL,NULL,NULL,0,0,NULL,1), ('f2','s1','Label','label','formula',NULL,'upper(card_id)',NULL,1,0,NULL,1);
      CREATE TABLE cards(id TEXT PRIMARY KEY, set_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', template_id TEXT, quantity INTEGER NOT NULL DEFAULT 1, fields_json TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO cards VALUES ('c1','s1','Second',NULL,1,'{"card_id":"X9"}',1,0,1,1), ('c2','s1','First',NULL,1,'{}',0,0,1,1), ('c3','s1','Gone',NULL,1,'{}',2,1,1,1), ('c4','s2','Spell',NULL,1,'{}',0,0,1,1);
      CREATE TABLE templates(id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, svg_source TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO templates VALUES ('t1','T',NULL,'<svg>{{card_id}}</svg>',1,1);
    `)
    raw.close()
    return dir
  }

  it('gives every card an ID in display order, deleted cards included, and sets a code on every set', () => {
    const dir = legacyProject()
    const d = openProjectDb(dir)
    expect(d.prepare('SELECT code FROM sets ORDER BY sort_order').all().map(r => r.code)).toEqual(['FIRE', 'FIRE2'])
    const code = id => d.prepare('SELECT card_code FROM cards WHERE id = ?').get(id).card_code
    expect([code('c2'), code('c1'), code('c3'), code('c4')]).toEqual(['FIRE-0001', 'FIRE-0002', 'FIRE-0003', 'FIRE2-0001'])
    expect(d.prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe(String(CURRENT_SCHEMA_VERSION))
    closeProjectDb(dir)
  })

  it('renames an existing card_id field (data, formulas and templates follow) and says so', async () => {
    const dir = legacyProject()
    const d = openProjectDb(dir)
    const f = d.prepare("SELECT name, slug FROM fields WHERE id = 'f1'").get()
    expect(f).toEqual({ name: 'Card ID 2', slug: 'card_id_2' })
    expect(JSON.parse(d.prepare("SELECT fields_json FROM cards WHERE id = 'c1'").get().fields_json)).toMatchObject({ card_id_2: 'X9' })
    expect(d.prepare("SELECT formula FROM fields WHERE id = 'f2'").get().formula).toBe('upper(card_id_2)')
    expect(d.prepare("SELECT svg_source FROM templates WHERE id = 't1'").get().svg_source).toBe('<svg>{{card_id_2}}</svg>')
    const { takeUpgradeInfo } = await import('../../src/main/db.js')
    const info = takeUpgradeInfo(dir)
    expect(info).toMatchObject({ from: 5, to: CURRENT_SCHEMA_VERSION })
    expect(info.notices.join(' ')).toMatch(/Card ID.*Card ID 2/)
    expect(takeUpgradeInfo(dir)).toBeNull()   // reported once
    closeProjectDb(dir)
  })

  it('takes a snapshot first, and continues numbering after the upgrade', async () => {
    const dir = legacyProject()
    const d = openProjectDb(dir)
    const snaps = readdirSync(join(dir, 'snapshots')).filter(f => f.endsWith('.zip'))
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatch(/^pre_upgrade_v5_/)
    // the snapshot holds the old format: restoring it brings the old schema back (and the upgrade runs again on open)
    const { listZip } = await import('../../src/main/zip.js')
    expect(listZip(join(dir, 'snapshots', snaps[0])).map(e => e.name)).toContain('project.db')
    const { extractZip } = await import('../../src/main/zip.js')
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    extractZip(join(dir, 'snapshots', snaps[0]), out)
    const old = new Database(join(out, 'project.db'), { readonly: true })
    expect(old.prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe('5')
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'id_counters'").get()).toBeUndefined()   // taken before anything was added
    old.close()
    expect(d.prepare('SELECT next FROM id_counters WHERE scope = ?').get('s1').next).toBe(4)
    closeProjectDb(dir)
  })

  it('opening the upgraded project again changes nothing and takes no second snapshot', () => {
    const dir = legacyProject()
    closeProjectDb(dir); openProjectDb(dir); closeProjectDb(dir)
    const d = openProjectDb(dir)
    expect(readdirSync(join(dir, 'snapshots')).filter(f => f.endsWith('.zip'))).toHaveLength(1)
    expect(d.prepare("SELECT card_code FROM cards WHERE id = 'c2'").get().card_code).toBe('FIRE-0001')
    closeProjectDb(dir)
  })
})

describe('schema guard (PRD §24.2, phase 0.2)', () => {
  it('refuses a project from a newer version and leaves it untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'newer-'))
    const raw = new Database(join(dir, 'project.db'))
    raw.exec(`CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','${CURRENT_SCHEMA_VERSION + 1}');`)
    raw.close()
    expect(() => openProjectDb(dir)).toThrow(SchemaTooNewError)
    expect(() => openProjectDb(dir)).toThrow(/newer version of Spadewick/)
    const check = new Database(join(dir, 'project.db'))
    expect(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)).toEqual(['project_meta'])   // no tables were added
    expect(check.prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe(String(CURRENT_SCHEMA_VERSION + 1))
    check.close()
    expect(existsSync(join(dir, 'snapshots'))).toBe(false)
  })

  it('projects:open reports it as a plain error, not as a damaged database to restore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'newer-'))
    const raw = new Database(join(dir, 'project.db'))
    raw.exec(`CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','99');`)
    raw.close()
    await expect(invoke('projects:open', dir)).rejects.toThrow(/newer version of Spadewick/)
    expect((await invoke('projects:get-meta')).meta.name).toBe('Test Game')   // the project that was open stays open
  })
})

describe('review fixes', () => {
  it('the migration also rewrites dynamic-text and condition references to a renamed card_id field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-attr-'))
    const raw = new Database(join(dir, 'project.db'))
    raw.exec(`
      CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','5');
      CREATE TABLE sets(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, card_size TEXT, card_mm_w REAL, card_mm_h REAL, default_template_id TEXT);
      INSERT INTO sets VALUES ('s','Old',NULL,0,1,1,NULL,NULL,NULL,NULL);
      CREATE TABLE fields(id TEXT PRIMARY KEY, set_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, type TEXT NOT NULL, default_value TEXT, formula TEXT, validation TEXT, display_order INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, width_px INTEGER, created_at INTEGER NOT NULL);
      INSERT INTO fields VALUES ('f','s','card_id','card_id','text',NULL,NULL,NULL,0,0,NULL,1);
      CREATE TABLE templates(id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, svg_source TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO templates VALUES ('t','T',NULL,'<text data-cardexy-field="card_id">x</text><g data-cardexy-show-if="card_id == 1 and cardinal == 2">{{ card_id }}</g>',1,1);
    `)
    raw.close()
    const d = openProjectDb(dir)
    expect(d.prepare("SELECT svg_source FROM templates WHERE id = 't'").get().svg_source)
      .toBe('<text data-cardexy-field="card_id_2">x</text><g data-cardexy-show-if="card_id_2 == 1 and cardinal == 2">{{card_id_2}}</g>')
    closeProjectDb(dir)
  })

  it('a field named like a card function is still found as a dependency', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'Card Count', type: 'number' }, { name: 'Twice', type: 'formula', formula: 'mul(card_count, 2)' }] })
    const { circular } = { circular: await invoke('fields:check-circular', await invoke('fields:list', set.id)) }
    expect(circular).toBe(false)
  })

  it('the export filter can use card_number() and card_count()', async () => {
    const svgPlain = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140" viewBox="0 0 100 140"><rect width="100" height="140" fill="#336699"/></svg>'
    const { set } = await seedSet({ name: 'Base', cards: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], template: { svg: svgPlain } })
    const out = join(ctx.root, 'png')
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: out, cardWidth: 50, cardHeight: 70, individualFiles: true, filter: 'eq(card_number(), card_count())' })
    expect(res.cardCount).toBe(1)
  })

  it('refuses a bad author code before saving anything', async () => {
    const before = await invoke('cardids:get')
    await expect(invoke('cardids:save', { pattern: '{set}.{n}', scope: 'project', start: 5, step: 1, author: 'TOO LONG' })).rejects.toThrow(/author code/)
    expect(await invoke('cardids:get')).toMatchObject({ pattern: before.pattern, scope: before.scope, start: before.start })
  })
})
