import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke, makePng } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

describe('asset library (PRD §9)', () => {
  it('imports images with metadata, a generated filename and a 256px JPEG thumbnail', async () => {
    const png = await makePng(join(ctx.root, 'dragon.png'), 600, 300)
    const [a] = await invoke('assets:import', [png])
    expect(a).toMatchObject({ original_name: 'dragon.png', mime_type: 'image/png', width_px: 600, height_px: 300 })
    expect(a.filename).not.toContain('dragon')
    expect(existsSync(join(ctx.dir, 'assets', a.filename))).toBe(true)
    const thumb = await sharp(Buffer.from(await invoke('assets:get-thumbnail', a.id))).metadata()
    expect(thumb.format).toBe('jpeg')
    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(256)
  })

  it('serves a canvas preview picture: at most 2048 px, nothing for a missing asset (PRD §8.7.3)', async () => {
    const png = await makePng(join(ctx.root, 'huge.png'), 3000, 1500)
    const [a] = await invoke('assets:import', [png])
    const res = await invoke('assets:get-preview', a.id)
    expect(res.mime).toBe('image/webp')
    const meta = await sharp(Buffer.from(res.bytes)).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2048)
    expect(meta.width / meta.height).toBeCloseTo(2, 1)
    expect(await invoke('assets:get-preview', 'no-such-asset')).toBeNull()
  })

  it('imports several files at once and skips unsupported types', async () => {
    const files = [await makePng(join(ctx.root, '1.png')), await makePng(join(ctx.root, '2.png'))]
    writeFileSync(join(ctx.root, 'x.txt'), 'no'); files.push(join(ctx.root, 'x.txt'))
    const res = await invoke('assets:import', files)
    expect(res).toHaveLength(2)
    expect(new Set(res.map(r => r.filename)).size).toBe(2)
  })

  it('accepts SVG assets without raster metadata', async () => {
    const f = join(ctx.root, 'i.svg'); writeFileSync(f, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    const [a] = await invoke('assets:import', [f])
    expect(a.mime_type).toBe('image/svg+xml')
  })

  it('searches filename, tags and notes, filters by tags, and finds unused assets', async () => {
    const [a, b] = await invoke('assets:import', [await makePng(join(ctx.root, 'dragon.png')), await makePng(join(ctx.root, 'elf.png'))])
    await invoke('assets:update', { id: a.id, tags: ['monster', 'red'], notes: 'fire breathing' })
    await invoke('assets:update', { id: b.id, tags: ['hero'] })
    expect((await invoke('assets:list', { search: 'DRAG' })).map(x => x.id)).toEqual([a.id])
    expect((await invoke('assets:list', { search: 'fire' })).map(x => x.id)).toEqual([a.id])
    expect((await invoke('assets:list', { search: 'hero' })).map(x => x.id)).toEqual([b.id])
    expect((await invoke('assets:list', { tags: ['monster', 'red'] })).map(x => x.id)).toEqual([a.id])
    await seedSet({ fields: [{ name: 'Art', type: 'image_ref' }], cards: [{ fields: { art: `asset:${a.id}` } }] })
    expect((await invoke('assets:list', { unusedOnly: true })).map(x => x.id)).toEqual([b.id])
  })

  it('tracks which cards use an asset', async () => {
    const [a] = await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'))])
    const { cards } = await seedSet({ fields: [{ name: 'Art', type: 'image_ref' }], cards: [{ name: 'uses', fields: { art: `asset:${a.id}` } }, { name: 'not' }] })
    const usage = await invoke('assets:get-usage', a.id)
    expect(usage).toEqual([{ cardId: cards[0].id, displayName: 'uses', setId: cards[0].set_id }])
  })

  it('replace keeps the id and updates dimensions', async () => {
    const [a] = await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'), 10, 10)])
    const r = await invoke('assets:replace', { id: a.id, newFilePath: await makePng(join(ctx.root, 'b.png'), 80, 40) })
    expect(r).toMatchObject({ id: a.id, filename: a.filename, width_px: 80, height_px: 40 })
  })

  it('delete removes the file and metadata', async () => {
    const [a] = await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'))])
    await invoke('assets:delete', a.id)
    expect(existsSync(join(ctx.dir, 'assets', a.filename))).toBe(false)
    expect(await invoke('assets:list')).toHaveLength(0)
  })

  it('undoing an import removes the file, redo brings it back', async () => {
    const [a] = await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'))])
    await invoke('history:undo')
    expect(existsSync(join(ctx.dir, 'assets', a.filename))).toBe(false)
    expect(await invoke('assets:list')).toHaveLength(0)
    await invoke('history:redo')
    expect(existsSync(join(ctx.dir, 'assets', a.filename))).toBe(true)
    expect(await invoke('assets:list')).toHaveLength(1)
    expect(Buffer.from(await invoke('assets:get-thumbnail', a.id)).length).toBeGreaterThan(0) // BLOB survived the round trip
  })
})
