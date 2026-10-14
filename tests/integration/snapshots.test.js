import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { createTestProject, seedSet, invoke, mockDialog, makePng } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const setNames = async () => (await invoke('sets:list')).map(s => s.name)

describe('snapshots (PRD §11.1)', () => {
  it('creates a zip containing the database, assets and fonts, and lists it', async () => {
    await seedSet({ name: 'Base' })
    await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'))])
    copyFileSync(join(process.cwd(), 'resources/fonts/LiberationMono-Regular.ttf'), join(ctx.root, 'm.ttf'))
    await invoke('fonts:import', [join(ctx.root, 'm.ttf')])
    const snap = await invoke('snapshots:create', { name: 'Before balance', description: 'pass 1' })
    const zip = join(ctx.dir, 'snapshots', `${snap.id}.zip`)
    expect(existsSync(zip)).toBe(true)
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(names).toContain('project.db')
    expect(names.some(n => n.startsWith('assets/'))).toBe(true)
    expect(names.some(n => n.startsWith('fonts/'))).toBe(true)
    expect(() => execFileSync('unzip', ['-tq', zip])).not.toThrow()
    expect(await invoke('snapshots:list')).toEqual([expect.objectContaining({ name: 'Before balance', description: 'pass 1' })])
  })

  it('captures data that is still in the write-ahead log', async () => {
    await seedSet({ name: 'Fresh' })               // just written, not yet checkpointed
    const snap = await invoke('snapshots:create', { name: 's' })
    await invoke('sets:create', { name: 'Later' })
    await invoke('snapshots:restore', snap.id)
    expect(await setNames()).toEqual(['Fresh'])
  })

  it('restore replaces the database and folders, removing files added afterwards', async () => {
    await seedSet({ name: 'Original' })
    const [kept] = await invoke('assets:import', [await makePng(join(ctx.root, 'kept.png'))])
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('sets:create', { name: 'Added later' })
    const [extra] = await invoke('assets:import', [await makePng(join(ctx.root, 'extra.png'))])
    await invoke('snapshots:restore', snap.id)
    expect(await setNames()).toEqual(['Original'])
    expect(existsSync(join(ctx.dir, 'assets', kept.filename))).toBe(true)
    expect(existsSync(join(ctx.dir, 'assets', extra.filename))).toBe(false)
    expect(await invoke('projects:check-integrity')).toBe(true)
  })

  it('keeps an automatic snapshot so a restore can be reversed', async () => {
    await seedSet({ name: 'A' })
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('sets:create', { name: 'B' })
    const res = await invoke('snapshots:restore', snap.id)
    expect(await setNames()).toEqual(['A'])
    await invoke('snapshots:restore', res.autoSnapshot.id)
    expect(await setNames()).toEqual(['A', 'B'])
  })

  it('refuses a damaged archive without touching the project', async () => {
    await seedSet({ name: 'Safe' })
    const snap = await invoke('snapshots:create', { name: 'v1' })
    writeFileSync(join(ctx.dir, 'snapshots', `${snap.id}.zip`), 'garbage')
    await expect(invoke('snapshots:restore', snap.id)).rejects.toThrow()
    expect(await setNames()).toEqual(['Safe'])
    expect(await invoke('projects:check-integrity')).toBe(true)
  })

  it('rolls back if the archive is valid but its contents cannot be applied', async () => {
    await seedSet({ name: 'Safe' })
    const snap = await invoke('snapshots:create', { name: 'v1' })
    // Replace the archive with a valid zip that has no database in it
    const empty = join(ctx.root, 'empty'); rmSync(empty, { recursive: true, force: true })
    const { writeZip } = await import('../../src/main/zip.js')
    writeFileSync(join(ctx.root, 'x.txt'), 'x')
    writeZip(join(ctx.dir, 'snapshots', `${snap.id}.zip`), [{ name: 'readme.txt', file: join(ctx.root, 'x.txt') }])
    await expect(invoke('snapshots:restore', snap.id)).rejects.toThrow(/database/i)
    expect(await setNames()).toEqual(['Safe'])
  })

  it('exports the zip to a chosen location, and deletes snapshots', async () => {
    await seedSet({ name: 'A' })
    const snap = await invoke('snapshots:create', { name: 'v1' })
    const dest = join(ctx.root, 'copy.zip'); mockDialog.save(dest)
    expect(await invoke('snapshots:export', snap.id)).toEqual({ path: dest })
    expect(readFileSync(dest).equals(readFileSync(join(ctx.dir, 'snapshots', `${snap.id}.zip`)))).toBe(true)
    await invoke('snapshots:delete', snap.id)
    expect(await invoke('snapshots:list')).toEqual([])
    expect(readdirSync(join(ctx.dir, 'snapshots'))).toEqual([])
  })

  it('snapshots are independent of undo history', async () => {
    const { cards } = await seedSet({ cards: [{ fields: { x: '1' } }] })
    await invoke('cards:update', { id: cards[0].id, fields: { x: '2' } })
    const before = (await invoke('history:get-stack')).undo.length
    await invoke('snapshots:create', { name: 's' })
    expect((await invoke('history:get-stack')).undo.length).toBe(before)
  })
})
