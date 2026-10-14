import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readdirSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestProject, seedSet, invoke, mockDialog } from '../helpers/project.js'
import { CURRENT_SCHEMA_VERSION } from '../../src/main/db.js'

let ctx
afterEach(async () => { await ctx?.cleanup(); ctx = null })

describe('projects (PRD §5.1, §12)', () => {
  it('creates the project folder structure and metadata', async () => {
    ctx = await createTestProject('My Game')
    for (const sub of ['templates', 'assets', 'fonts', 'exports', 'snapshots']) expect(existsSync(join(ctx.dir, sub)), sub).toBe(true)
    expect(existsSync(join(ctx.dir, 'project.db'))).toBe(true)
    const state = await invoke('projects:get-meta')
    expect(state.meta).toMatchObject({ name: 'My Game', card_width_px: '500', schema_version: String(CURRENT_SCHEMA_VERSION) })
    expect(state.meta.card_size).toBeUndefined()   // card size belongs to each set, not to the project
    expect(state.sets).toEqual([])
  })

  it('rejects creating a project over an existing one', async () => {
    ctx = await createTestProject('Dup')
    await expect(invoke('projects:create', { name: 'Dup', parentDir: ctx.root })).rejects.toThrow(/already exists/)
  })

  it('stores no absolute paths in the database (portability contract)', async () => {
    ctx = await createTestProject('Portable')
    const s = await seedSet({ fields: [{ name: 'Art', type: 'image_ref' }], cards: [{ name: 'A' }] })
    const Database = (await import('better-sqlite3')).default
    const raw = new Database(join(ctx.dir, 'project.db'), { readonly: true })
    const dump = JSON.stringify([raw.prepare('SELECT * FROM project_meta').all(), raw.prepare('SELECT * FROM cards').all(), raw.prepare('SELECT * FROM fields').all()])
    raw.close()
    expect(dump).not.toContain(ctx.root)
    expect(s.set.id).toBeTruthy()
  })

  it('opens an existing project and refuses a non-project folder', async () => {
    ctx = await createTestProject('Openable')
    mockDialog.open(ctx.dir)
    const state = await invoke('projects:open', null)
    expect(state.meta.name).toBe('Openable')
    await expect(invoke('projects:open', mkdtempSync(join(tmpdir(), 'empty-')))).rejects.toThrow(/does not contain a Spadewick project/)
  })

  it('records recent projects', async () => {
    ctx = await createTestProject('Recent')
    await invoke('projects:open', ctx.dir)
    expect((await invoke('projects:list-recent'))[0]).toBe(ctx.dir)
  })

  it('duplicates a project including all committed data', async () => {
    ctx = await createTestProject('Original')
    await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'Keep me', fields: { name: 'Keep me' } }] })
    const copy = await invoke('projects:duplicate', { targetDir: ctx.root, newName: 'Copy' })
    await invoke('projects:open', copy.path)
    const state = await invoke('projects:get-meta')
    expect(state.meta.name).toBe('Copy')
    expect(state.sets.map(s => s.name)).toEqual(['Base'])
    const cards = await invoke('cards:list', state.sets[0].id)
    expect(cards.map(c => c.display_name)).toEqual(['Keep me'])
  })

  it('refuses to duplicate onto an existing folder', async () => {
    ctx = await createTestProject('Orig2')
    await invoke('projects:duplicate', { targetDir: ctx.root, newName: 'Twice' })
    await expect(invoke('projects:duplicate', { targetDir: ctx.root, newName: 'Twice' })).rejects.toThrow(/already exists/)
  })

  it('passes the integrity check and autosaves', async () => {
    ctx = await createTestProject('Healthy')
    expect(await invoke('projects:check-integrity')).toBe(true)
    expect(typeof (await invoke('projects:autosave'))).toBe('number')
  })

  it('has no active project after close', async () => {
    ctx = await createTestProject('Closer')
    await invoke('projects:close')
    expect(await invoke('projects:get-meta')).toBe(null)
    await expect(invoke('sets:list')).rejects.toThrow(/No project open/)
  })

  it('reads and writes settings', async () => {
    ctx = await createTestProject('Settings')
    await invoke('settings:set', 'theme', 'dark')
    expect(await invoke('settings:get', 'theme')).toBe('dark')
    expect((await invoke('settings:get-all')).default_card_size).toBe('poker')
  })
})

describe('integrity on open (PRD §14.2)', () => {
  it('reports a database that cannot be opened and restores from the latest snapshot', async () => {
    const { writeFileSync } = await import('fs')
    ctx = await createTestProject('Fragile')
    await seedSet({ name: 'Precious' })
    await invoke('snapshots:create', { name: 'safe copy' })
    await invoke('projects:close')
    writeFileSync(join(ctx.dir, 'project.db'), Buffer.alloc(4096, 7))   // trample the database
    for (const f of ['project.db-wal', 'project.db-shm']) { try { (await import('fs')).rmSync(join(ctx.dir, f)) } catch { /* none */ } }

    const state = await invoke('projects:open', ctx.dir)
    expect(state.corrupt).toBe(true)
    expect(state.error).toMatch(/database/i)

    const [latest] = await invoke('snapshots:list')
    await invoke('snapshots:restore', latest.id)
    const healthy = await invoke('projects:get-meta')
    expect(healthy.sets.map(s => s.name)).toEqual(['Precious'])
    expect(await invoke('projects:check-integrity')).toBe(true)
    expect(readdirSync(ctx.dir).some(f => f.startsWith('project.corrupt-'))).toBe(true)  // the damaged file was kept
  })

  it('opens a healthy project normally', async () => {
    ctx = await createTestProject('Fine')
    const state = await invoke('projects:open', ctx.dir)
    expect(state.corrupt).toBeUndefined()
    expect(state.meta.name).toBe('Fine')
  })
})
