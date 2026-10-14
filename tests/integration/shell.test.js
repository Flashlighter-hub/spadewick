import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, mkdtempSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { createTestProject, seedSet, invoke, mockDialog } from '../helpers/project.js'
import { setLogsDir, logError } from '../../src/main/log.js'

let ctx
afterEach(async () => { await ctx?.cleanup(); ctx = null; setLogsDir(null) })

describe('opening a project file (PRD §12.2)', () => {
  it('opens a path to project.db as well as the folder', async () => {
    ctx = await createTestProject('ByFile')
    await invoke('projects:close')
    const state = await invoke('projects:open', join(ctx.dir, 'project.db'))
    expect(state.path).toBe(ctx.dir); expect(state.meta.name).toBe('ByFile')
  })
  it('opens through the file picker', async () => {
    ctx = await createTestProject('Picked')
    await invoke('projects:close')
    mockDialog.open(join(ctx.dir, 'project.db'))
    expect((await invoke('projects:open-file')).meta.name).toBe('Picked')
    expect(await invoke('projects:open-file')).toBe(null)   // cancelled
  })
  it('refuses other files', async () => {
    ctx = await createTestProject('Wrong')
    const { writeFileSync } = await import('fs')
    writeFileSync(join(ctx.root, 'notes.txt'), 'x')
    await expect(invoke('projects:open', join(ctx.root, 'notes.txt'))).rejects.toThrow(/project folder or its project\.db/)
  })
})

describe('error log (PRD §12.2 Open Logs Folder)', () => {
  it('records failing handlers with their channel name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-')); setLogsDir(dir)
    ctx = await createTestProject('Logged')
    await expect(invoke('projects:open', join(ctx.root, 'nope'))).rejects.toThrow()
    const text = readFileSync(join(dir, 'spadewick.log'), 'utf8')
    expect(text).toMatch(/\[projects:open\]/); expect(text).toMatch(/does not contain a Spadewick project/)
  })
  it('rotates at one megabyte and never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-')); setLogsDir(dir)
    const big = 'x'.repeat(200000)
    for (let i = 0; i < 8; i++) logError('t', new Error(big))
    expect(existsSync(join(dir, 'spadewick.log.1'))).toBe(true)
    expect(statSync(join(dir, 'spadewick.log')).size).toBeLessThan(1.5 * 1024 * 1024)
    setLogsDir(join(dir, 'spadewick.log', 'cannot-be-a-folder'))   // a path under a regular file: creating it fails
    expect(() => logError('t', 'x')).not.toThrow()
  })
})

describe('reliability and size targets (PRD §14.1, §14.2, §14.6)', () => {
  it('keeps the database in WAL mode', async () => {
    ctx = await createTestProject('Wal')
    const raw = new Database(join(ctx.dir, 'project.db'), { readonly: true })
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal'); raw.close()
  })

  it('a failed bulk operation leaves no partial changes', async () => {
    ctx = await createTestProject('Atomic')
    const { set, cards } = await seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: [{ fields: { name: 'a' } }, { fields: { name: 'b' } }] })
    const before = JSON.stringify((await invoke('cards:list', set.id)).map(c => c.fields))
    // the second id does not exist: the whole batch must be rejected or leave the first card untouched
    await invoke('cards:batch-update', { cardIds: [cards[0].id, 'missing-id'], fields: { name: 'CHANGED' } }).catch(() => {})
    const after = JSON.stringify((await invoke('cards:list', set.id)).map(c => c.fields))
    expect(after).toBe(before)
  })

  it('opens a 500-card project in under 2 seconds', async () => {
    ctx = await createTestProject('Large')
    const set = await invoke('sets:create', { name: 'Big' })
    await invoke('fields:create', { setId: set.id, name: 'Name', type: 'text' })
    const d = new Database(join(ctx.dir, 'project.db'))
    const ins = d.prepare("INSERT INTO cards (id, set_id, display_name, fields_json, sort_order, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, 1)")
    d.transaction(() => { for (let i = 0; i < 500; i++) ins.run(`c${i}`, set.id, `Card ${i}`, JSON.stringify({ name: `N${i}`, text: 'lorem ipsum '.repeat(20) }), i) })(); d.close()
    await invoke('projects:close')
    const t = Date.now()
    const state = await invoke('projects:open', ctx.dir)
    const cards = await invoke('cards:list', state.sets[0].id)
    expect(cards).toHaveLength(500)
    expect(Date.now() - t).toBeLessThan(2000)
  })

  it('a 200-card project database stays under 5 MB', async () => {
    ctx = await createTestProject('Small')
    const set = await invoke('sets:create', { name: 'S' })
    for (const n of ['Name', 'Cost', 'Text']) await invoke('fields:create', { setId: set.id, name: n, type: 'text' })
    for (let i = 0; i < 200; i++) await invoke('cards:create', { setId: set.id, displayName: `Card ${i}`, fields: { name: `N${i}`, cost: String(i % 10), text: 'Some rules text for the card. '.repeat(6) } })
    await invoke('projects:autosave')
    const dbBytes = statSync(join(ctx.dir, 'project.db')).size + (existsSync(join(ctx.dir, 'project.db-wal')) ? statSync(join(ctx.dir, 'project.db-wal')).size : 0)
    expect(dbBytes).toBeLessThan(5 * 1024 * 1024)
  })
})

describe('Unicode and right-to-left text (PRD §14.5)', () => {
  it('survives storage, CSV round trip and rendering unchanged', async () => {
    ctx = await createTestProject('Intl')
    const values = ['日本語のカード', 'مرحبا بالعالم', 'שלום עולם', 'Ünïcödé — “quotes” 🐉', 'a\u200fb\u202ec']
    const { set, cards } = await seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: values.map(v => ({ name: v, fields: { name: v } })), template: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><text x="4" y="30" font-size="18">{{name}}</text></svg>' } })
    expect((await invoke('cards:list', set.id)).map(c => c.fields.name)).toEqual(values)
    const out = join(ctx.root, 'u.csv'); mockDialog.save(out)
    await invoke('dataio:export', { setIds: [set.id], format: 'csv' })
    const set2 = await invoke('sets:create', { name: 'Copy' })
    await invoke('fields:create', { setId: set2.id, name: 'Name', type: 'text' })
    mockDialog.open(out)
    const file = await invoke('dataio:read-file', { format: 'csv', setId: set2.id })
    await invoke('dataio:import', { setId: set2.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    expect((await invoke('cards:list', set2.id)).map(c => c.fields.name)).toEqual(values)
    for (const c of cards) await expect(invoke('templates:render', { cardId: c.id, width: 300 })).resolves.toBeTruthy()   // no XML errors
  })
})
