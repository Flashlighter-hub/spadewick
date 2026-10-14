/**
 * UPDATES U29: a card's own instance of its template. The template stays one; a card keeps a patch of what it changed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { openProjectDb } from '../../src/main/db.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect data-spadewick-id="bg" width="200" height="280" fill="#ff0000"/><rect data-spadewick-id="band" x="0" y="200" width="200" height="40" fill="#0000ff"/></svg>'
const px = async (buf, x, y) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const render = async (cardId, opts = {}) => Buffer.from(await invoke('templates:render', { cardId, width: 200, ...opts }), 'base64')
const near = (rgb, want) => rgb.every((v, i) => Math.abs(v - want[i]) <= 10)

async function deck() {
  const s = await seedSet({ name: 'Deck', cards: [{ name: 'One' }, { name: 'Two' }], template: { svg: TEMPLATE } })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}

describe('a card with a version of its own', () => {
  it('is drawn with its own changes while the other cards, and the template, are not', async () => {
    const s = await deck()
    const own = (await invoke('instances:get', { cardId: s.cards[0].id }))
    expect(own).toMatchObject({ hasInstance: false, templateId: s.template.id, changes: 0 })
    const edited = own.source.replace('fill="#ff0000"', 'fill="#00ff00"')
    const saved = await invoke('instances:save', { cardId: s.cards[0].id, source: edited })
    expect(saved).toMatchObject({ hasInstance: true, changes: 1 })
    expect(near(await px(await render(s.cards[0].id), 100, 50), [0, 255, 0])).toBe(true)
    expect(near(await px(await render(s.cards[1].id), 100, 50), [255, 0, 0])).toBe(true)
    expect((await invoke('templates:get', s.template.id)).svg_source).toBe(TEMPLATE)
    expect(await invoke('instances:list', { setId: s.set.id })).toEqual([s.cards[0].id])
  })

  it('follows a change of the template in everything it did not change itself', async () => {
    const s = await deck()
    const own = await invoke('instances:get', { cardId: s.cards[0].id })
    await invoke('instances:save', { cardId: s.cards[0].id, source: own.source.replace('fill="#ff0000"', 'fill="#00ff00"') })
    await invoke('templates:update', { id: s.template.id, svgSource: TEMPLATE.replace('fill="#0000ff"', 'fill="#ffff00"') })
    const buf = await render(s.cards[0].id)
    expect(near(await px(buf, 100, 50), [0, 255, 0])).toBe(true)      // its own change stays
    expect(near(await px(buf, 100, 220), [255, 255, 0])).toBe(true)   // the template's new colour reaches it
  })

  it('is edited again from where it was: the source offered is the template with the card\'s changes on it', async () => {
    const s = await deck()
    const first = await invoke('instances:get', { cardId: s.cards[0].id })
    await invoke('instances:save', { cardId: s.cards[0].id, source: first.source.replace('fill="#ff0000"', 'fill="#00ff00"') })
    const again = await invoke('instances:get', { cardId: s.cards[0].id })
    expect(again.source).toContain('fill="#00ff00"')
    expect(again.base).toBe(TEMPLATE)
    await invoke('instances:save', { cardId: s.cards[0].id, source: again.source.replace('fill="#0000ff"', 'fill="#123456"') })
    expect((await invoke('instances:get', { cardId: s.cards[0].id })).changes).toBe(2)
  })

  it('goes back to the template with Reset, or by saving the template\'s own source; each is undone with Undo', async () => {
    const s = await deck()
    const own = await invoke('instances:get', { cardId: s.cards[0].id })
    await invoke('instances:save', { cardId: s.cards[0].id, source: own.source.replace('fill="#ff0000"', 'fill="#00ff00"') })
    await invoke('instances:reset', { cardId: s.cards[0].id })
    expect((await invoke('instances:get', { cardId: s.cards[0].id })).hasInstance).toBe(false)
    await invoke('history:undo')
    expect((await invoke('instances:get', { cardId: s.cards[0].id })).hasInstance).toBe(true)
    const same = await invoke('instances:save', { cardId: s.cards[0].id, source: TEMPLATE })
    expect(same.hasInstance).toBe(false)
    expect(openProjectDb(ctx.dir).prepare('SELECT instance_json FROM cards WHERE id = ?').get(s.cards[0].id).instance_json).toBe(null)
  })

  it('is copied by Duplicate, and an added element (art) and new text are drawn', async () => {
    const s = await deck()
    const own = await invoke('instances:get', { cardId: s.cards[0].id })
    const png = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ffff' } }).png().toBuffer()).toString('base64')
    const art = `<image data-spadewick-id="art_1" x="0" y="0" width="200" height="100" preserveAspectRatio="none" href="data:image/png;base64,${png}"/>`
    await invoke('instances:save', { cardId: s.cards[0].id, source: own.source.replace('</svg>', `${art}</svg>`) })
    expect(near(await px(await render(s.cards[0].id), 100, 50), [0, 255, 255])).toBe(true)
    expect(near(await px(await render(s.cards[1].id), 100, 50), [255, 0, 0])).toBe(true)
    const [copy] = await invoke('cards:duplicate', [s.cards[0].id])
    expect(near(await px(await render(copy.id), 100, 50), [0, 255, 255])).toBe(true)
  })

  it('is not used when the editor draws a source it chose itself, and a card with no template cannot have one', async () => {
    const s = await deck()
    const own = await invoke('instances:get', { cardId: s.cards[0].id })
    await invoke('instances:save', { cardId: s.cards[0].id, source: own.source.replace('fill="#ff0000"', 'fill="#00ff00"') })
    const chosen = await render(s.cards[0].id, { templateId: s.template.id, svgSource: TEMPLATE })
    expect(near(await px(chosen, 100, 50), [255, 0, 0])).toBe(true)
    const bare = await seedSet({ name: 'Bare', cards: [{ name: 'x' }] })
    await expect(invoke('instances:get', { cardId: bare.cards[0].id })).rejects.toThrow(/no template/i)
    await expect(invoke('instances:save', { cardId: s.cards[0].id, source: '<svg><script>x</script></svg>' })).rejects.toThrow()
  })
})
