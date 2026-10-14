import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke, makePng } from '../helpers/project.js'

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
const near = (rgb, want, tol = 8) => rgb.every((v, i) => Math.abs(v - want[i]) <= tol)
const importPng = async (name, color) => (await invoke('assets:import', [await makePng(join(ctx.root, name), 40, 40, color)]))[0]

describe('fixed images in templates (PRD §7.1)', () => {
  it('shows the same library image on every card, next to a per-card image field', async () => {
    const frame = await importPng('frame.png', '#ff0000')
    const art1 = await importPng('art1.png', '#0000ff')
    const art2 = await importPng('art2.png', '#00ff00')
    const t = svg(`<image x="0" y="0" width="100" height="100" href="{{@asset.${frame.id}}}"/><image x="100" y="0" width="100" height="100" href="{{art}}"/>`)
    const { cards } = await seedSet({
      fields: [{ name: 'Art', type: 'image_ref' }],
      cards: [{ name: 'a', fields: { art: `asset:${art1.id}` } }, { name: 'b', fields: { art: `asset:${art2.id}` } }],
      template: { svg: t }
    })
    const a = await render(cards[0].id, { width: 200 }), b = await render(cards[1].id, { width: 200 })
    expect(near(await pixel(a, 50, 50), [255, 0, 0])).toBe(true)    // fixed: both cards
    expect(near(await pixel(b, 50, 50), [255, 0, 0])).toBe(true)
    expect(near(await pixel(a, 150, 50), [0, 0, 255])).toBe(true)   // per card
    expect(near(await pixel(b, 150, 50), [0, 255, 0])).toBe(true)
  })

  it('allows several fixed images in one template', async () => {
    const red = await importPng('r.png', '#ff0000'), blue = await importPng('b.png', '#0000ff')
    const { cards } = await seedSet({
      cards: [{ name: 'a' }],
      template: { svg: svg(`<image x="0" y="0" width="100" height="100" href="{{@asset.${red.id}}}"/><image x="100" y="0" width="100" height="100" href="{{@asset.${blue.id}}}"/>`) }
    })
    const buf = await render(cards[0].id, { width: 200 })
    expect(near(await pixel(buf, 50, 50), [255, 0, 0])).toBe(true)
    expect(near(await pixel(buf, 150, 50), [0, 0, 255])).toBe(true)
  })

  it('renders without the image, and without failing, when the asset is gone', async () => {
    const red = await importPng('r.png', '#ff0000')
    const { cards } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg(`<image x="0" y="0" width="100" height="100" href="{{@asset.${red.id}}}"/>`) } })
    await invoke('assets:delete', red.id)
    const buf = await render(cards[0].id, { width: 200 })
    expect(near(await pixel(buf, 50, 50), [255, 255, 255])).toBe(true)
  })

  it('an unknown asset id is harmless', async () => {
    const { cards } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('<image x="0" y="0" width="100" height="100" href="{{@asset.nope}}"/>') } })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 50, 50), [255, 255, 255])).toBe(true)
  })

  it("also works in the template editor's unsaved source preview", async () => {
    const red = await importPng('r.png', '#ff0000')
    const parent = await invoke('templates:create', { name: 'Parent', svgSource: svg(`<image x="0" y="0" width="100" height="100" href="{{@asset.${red.id}}}"/>`) })
    const { cards } = await seedSet({ cards: [{ name: 'a' }] })
    await invoke('cards:update', { id: cards[0].id, templateId: parent.id })
    const viaSource = await render(cards[0].id, { width: 200, templateId: parent.id, svgSource: svg(`<image x="100" y="0" width="100" height="100" href="{{@asset.${red.id}}}"/>`) })
    expect(near(await pixel(viaSource, 150, 50), [255, 0, 0])).toBe(true)
  })

  it('knows which templates use an image, and does not call it unused', async () => {
    const red = await importPng('r.png', '#ff0000'), spare = await importPng('s.png', '#00ff00')
    await invoke('templates:create', { name: 'Frame', svgSource: svg(`<image href="{{@asset.${red.id}}}"/>`) })
    expect(await invoke('assets:get-template-usage', red.id)).toMatchObject([{ name: 'Frame' }])
    expect(await invoke('assets:get-template-usage', spare.id)).toEqual([])
    const unused = await invoke('assets:list', { unusedOnly: true })
    expect(unused.map(a => a.id)).toEqual([spare.id])
  })
})
