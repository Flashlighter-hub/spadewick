import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync } from 'fs'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

/** WebP pictures: the window shows them, and so must the card the drawing engine (which cannot read WebP) makes of them. */
sharp.cache(false)   // Windows keeps a decoded file open while libvips caches it, which stops the test folder being removed
let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#ffffff"/>${inner}</svg>`
const render = async (cardId, opts = {}) => Buffer.from(await invoke('templates:render', { cardId, ...opts }), 'base64')
const pixel = async (buf, x, y) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const near = (rgb, want, tol = 12) => rgb.every((v, i) => Math.abs(v - want[i]) <= tol)
const importWebp = async (name, colour) => {
  const path = join(ctx.root, name)
  await sharp({ create: { width: 40, height: 40, channels: 3, background: colour } }).webp({ lossless: true }).toFile(path)
  return (await invoke('assets:import', [path]))[0]
}

describe('WebP pictures in cards', () => {
  it('are drawn on the card, as a fixed picture and as a field, and the library keeps the original file', async () => {
    const fixed = await importWebp('frame.webp', '#ff0000'), art = await importWebp('art.webp', '#0000ff')
    expect(fixed.mime_type).toBe('image/webp')
    const { cards } = await seedSet({
      fields: [{ name: 'Art', type: 'image_ref' }],
      cards: [{ name: 'a', fields: { art: `asset:${art.id}` } }],
      template: { svg: svg(`<image x="0" y="0" width="100" height="100" href="{{@asset.${fixed.id}}}"/><image x="100" y="0" width="100" height="100" href="{{art}}"/>`) }
    })
    const buf = await render(cards[0].id, { width: 200 })
    expect(near(await pixel(buf, 50, 50), [255, 0, 0])).toBe(true)
    expect(near(await pixel(buf, 150, 50), [0, 0, 255])).toBe(true)
    expect(existsSync(join(ctx.dir, 'assets', fixed.filename))).toBe(true)
    expect(fixed.filename.endsWith('.webp')).toBe(true)
  })

  it('are drawn after the project is used for a while: the PNG copy is made once and reused', async () => {
    const art = await importWebp('once.webp', '#00ff00')
    const { cards } = await seedSet({ fields: [{ name: 'Art', type: 'image_ref' }], cards: [{ name: 'a', fields: { art: `asset:${art.id}` } }], template: { svg: svg('<image x="0" y="0" width="200" height="280" href="{{art}}"/>') } })
    await render(cards[0].id, { width: 200 })
    expect(existsSync(join(ctx.dir, '.cache', 'png', `${art.filename}.png`))).toBe(true)
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 100, 140), [0, 255, 0])).toBe(true)
  })
})

describe('a WebP written into a template', () => {
  it('is drawn too', async () => {
    const webp = (await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff00ff' } }).webp({ lossless: true }).toBuffer()).toString('base64')
    const { cards } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg(`<image x="0" y="0" width="200" height="280" href="data:image/webp;base64,${webp}"/>`) } })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 100, 140), [255, 0, 255])).toBe(true)
  })
})
