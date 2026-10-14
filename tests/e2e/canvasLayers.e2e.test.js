/**
 * Every element is a layer, and every layer can be resized and recoloured: a design drawn elsewhere keeps its elements inside groups with no
 * ids of their own, so only the group could be taken hold of, and a group, a path or a line could not be resized.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

// as imported from a drawing program: all the art in a group that moves it, none of it named
const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">'
  + '<g id="trim" data-spadewick-id="trim" transform="translate(50 50)">'
  + '<path d="M0 0H200V100H0Z" fill="#c8102e"/>'
  + '<path d="M0 150H200V250H0Z" fill="#1e5aa8" stroke="#000000" stroke-width="4"/>'
  + '<line x1="0" y1="300" x2="200" y2="300" stroke="#222222" stroke-width="6"/>'
  + '</g></svg>'

async function openEditor() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `lay-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top } })
// the handles are drawn on the next frame after the layers change: a click in the same instant would find none of them
const click = async (x, y) => { await app.page.waitForTimeout(250); const h = await host(); await app.page.mouse.click(h.x + x, h.y + y) }
const title = () => app.page.locator('.props-title').innerText()
const field = label => app.page.locator(`label:has-text("${label}") input`).first()
const set = async (locator, value) => { await locator.fill(String(value)); await locator.dispatchEvent('change') }
const menu = async item => { await app.page.click('.editor-toolbar button[aria-haspopup=menu]'); await app.page.click(`[role=menu] [role=menuitem]:has-text("${item}")`) }
const layerRows = () => app.page.locator('[data-layer]').evaluateAll(n => n.map(x => x.getAttribute('data-layer')))
const sourceText = async () => {
  await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
  const t = await app.page.locator('textarea.svg-source').inputValue()
  await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
  return t
}
const tagOf = (src, id) => new RegExp(`<[a-z]+[^>]*data-spadewick-id="${id}"[^>]*>`).exec(src)?.[0] ?? ''
const attr = (src, id, name) => new RegExp(` ${name}="([^"]*)"`).exec(tagOf(src, id))?.[1] ?? null

describe('every element a layer', () => {
  beforeEach(openEditor)

  it('Template → Make every element a layer gives the elements inside the group layers of their own, and says how many', async () => {
    expect(await layerRows()).toEqual(['trim'])                         // only the group was a layer
    await menu('Make every element a layer')
    await app.page.waitForSelector('.toast:has-text("3 elements made into layers")')
    expect(await layerRows()).toEqual(['trim', 'line', 'path_2', 'path'])
    await menu('Make every element a layer')
    await app.page.waitForSelector('.toast:has-text("already a layer")')
    // one step of undo takes them all away again
    await app.menu('menu:undo')
    await expect.poll(layerRows).toEqual(['trim'])
  })

  it('a click on a shape inside a group takes the shape, not the group; a click on empty space inside the group takes nothing', async () => {
    await menu('Make every element a layer')
    await expect.poll(async () => (await layerRows()).length).toBe(4)
    await click(150, 100)                                              // inside the first path (50 + 100, 50 + 50)
    await expect.poll(title).toMatch(/path · path$/)
    expect(await field('X').inputValue()).toBe('50')
    expect(await field('W').inputValue()).toBe('200')
    await click(380, 160)                                              // inside the group's box? no: beside the paths, on empty card
    await expect.poll(() => app.page.locator('.props-title').count()).toBe(0)
  })
})

describe('everything can be resized', () => {
  beforeEach(async () => { await openEditor(); await menu('Make every element a layer'); await expect.poll(async () => (await layerRows()).length).toBe(4) })

  it('a path is made larger and smaller by typing its size, with a transform, and stays where its corner is', async () => {
    await click(150, 100)
    await expect.poll(title).toMatch(/path · path$/)
    await set(field('W'), 300)
    await expect.poll(async () => attr(await sourceText(), 'path', 'transform')).toMatch(/^matrix\(1\.5 0 0 1 /)
    expect(await field('W').inputValue()).toBe('300')
    expect(await field('X').inputValue()).toBe('50')
    await set(field('H'), 50)
    await expect.poll(() => field('H').inputValue()).toBe('50')
    expect(await field('Y').inputValue()).toBe('50')
    const src = await sourceText()
    expect(src).toContain('viewBox="0 0 500 700"')                    // the card is the same size
    expect(src).toContain('d="M0 0H200V100H0Z"')                      // the data of the path itself is not rewritten
  })

  it('a path has handles on its corners and sides, and a drag of one resizes it', async () => {
    await click(150, 100)
    await expect.poll(title).toMatch(/path · path$/)
    const h = await host()
    // the bottom-right corner of the first path is at (250, 150) on the card
    await app.page.mouse.move(h.x + 250, h.y + 150); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 350, h.y + 250, { steps: 8 }); await app.page.mouse.up()
    await expect.poll(() => field('W').inputValue().then(Number)).toBeGreaterThan(250)
    expect(await field('X').inputValue()).toBe('50')
  })

  it('a group is resized as well and takes everything in it along; a line inside it can be resized after', async () => {
    await app.page.locator('[data-layer="trim"]').click()
    await expect.poll(title).toMatch(/g · trim/)
    expect(await field('W').isDisabled()).toBe(false)
    await set(field('W'), 400)
    await expect.poll(async () => attr(await sourceText(), 'trim', 'transform')).toMatch(/^matrix\(2 0 0 /)
    await app.page.locator('[data-layer="line"]').click()
    await expect.poll(title).toMatch(/line · line/)
    expect(await field('W').inputValue()).toBe('400')                  // inside the group that was made wider
    expect(await field('W').isDisabled()).toBe(false)
    await set(field('W'), 100)
    await expect.poll(() => field('W').inputValue()).toBe('100')
  })
})

describe('everything can be recoloured', () => {
  beforeEach(async () => { await openEditor(); await menu('Make every element a layer'); await expect.poll(async () => (await layerRows()).length).toBe(4) })

  it('a path takes its own fill; a group passes a colour on to every shape in it that sets one', async () => {
    await click(150, 100)
    await expect.poll(title).toMatch(/path · path$/)
    await set(app.page.locator('input[aria-label="Fill value"]'), '#00aa00')
    await expect.poll(async () => attr(await sourceText(), 'path', 'fill')).toBe('#00aa00')

    await app.page.locator('[data-layer="trim"]').click()
    await expect.poll(title).toMatch(/g · trim/)
    await set(app.page.locator('input[aria-label="Fill value"]'), '#ffcc00')
    await expect.poll(async () => ((await sourceText()).match(/fill="#ffcc00"/g) ?? []).length, { timeout: 6000 }).toBe(3)   // the group, and the two paths that set a fill (the line sets none)
    const src = await sourceText()
    expect(src).not.toContain('fill="#00aa00"')                       // the colour chosen earlier for one path was replaced
    expect(attr(src, 'path_2', 'fill')).toBe('#ffcc00')
    expect(attr(src, 'path_2', 'stroke')).toBe('#000000')              // its outline is untouched by a fill
  })

  it('an outline colour and width go to the shapes of a group that have one', async () => {
    await app.page.locator('[data-layer="trim"]').click()
    await expect.poll(title).toMatch(/g · trim/)
    await set(app.page.locator('input[aria-label="Stroke value"]'), '#ff00ff')
    await expect.poll(async () => attr(await sourceText(), 'path_2', 'stroke')).toBe('#ff00ff')
    const src = await sourceText()
    expect(attr(src, 'line', 'stroke')).toBe('#ff00ff')
    expect(attr(src, 'path', 'stroke')).toBeNull()                     // a shape with no outline did not get one from the group's colour
  })
})
