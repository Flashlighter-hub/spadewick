/**
 * PRD §12.5 (panels the user can resize), §8.3 (no zoom; a two-tone grid), §8.7.2 (layers under the properties).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/><text data-spadewick-id="title" x="30" y="70" font-size="40" fill="#000000">{{name}}</text><rect data-spadewick-id="frame" x="40" y="120" width="200" height="100" fill="#cc3333"/></svg>'

async function open() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `lay-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  await app.invoke('settings:set', 'ui_layout', undefined)
  const seeded = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'Orc', fields: { name: 'Orc' } }], template: { svg: TEMPLATE } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const toEditor = async () => {
  await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl').first().click()
  await app.page.waitForSelector('.template-editor canvas')
}
const sep = label => app.page.locator(`[role=separator][aria-label="${label}"]`)
const value = async label => Number(await sep(label).getAttribute('aria-valuenow'))
const saved = async () => app.invoke('settings:get', 'ui_layout')

describe('panels the user can resize (PRD §12.5)', () => {
  beforeEach(async () => { await open() })

  it('the project panel: arrow keys, limits, reset, and it is remembered after a restart', async () => {
    const label = 'Resize the project panel'
    expect(await value(label)).toBe(220)
    await sep(label).focus()
    await app.page.keyboard.press('ArrowRight'); await app.page.keyboard.press('ArrowRight'); await app.page.keyboard.press('ArrowRight')
    expect(await value(label)).toBe(256)
    expect(await app.page.locator('nav.sidebar').evaluate(n => n.style.width)).toBe('256px')
    await app.page.keyboard.press('PageUp');   expect(await value(label)).toBe(420)    // the largest it can be
    await app.page.keyboard.press('PageDown'); expect(await value(label)).toBe(160)    // and the smallest: it can never be dragged out of reach
    await app.page.keyboard.press('ArrowRight'); await app.page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await saved())?.sidebar, { timeout: 4000 }).toBe(184)
    await app.page.reload(); await app.page.waitForSelector('.set-item')
    expect(await value(label)).toBe(184)
    await sep(label).focus(); await app.page.keyboard.press('Home')        // Home puts the panel back
    expect(await value(label)).toBe(220)
  })

  it('can be dragged with the mouse, and a double-click puts the panel back', async () => {
    const label = 'Resize the project panel'
    const box = await sep(label).boundingBox()
    await app.page.mouse.move(box.x + box.width / 2, box.y + 200); await app.page.mouse.down()
    await app.page.mouse.move(box.x + 60, box.y + 200, { steps: 6 }); await app.page.mouse.up()
    const dragged = await value(label)
    expect(dragged).toBeGreaterThan(260); expect(dragged).toBeLessThanOrEqual(420)
    await sep(label).dblclick()
    expect(await value(label)).toBe(220)
  })

  it('the template list closes to a thin rail, opens again, and keeps its width and state', async () => {
    await toEditor()
    const label = 'Resize the template list'
    expect(await value(label)).toBe(190)
    await sep(label).focus(); await app.page.keyboard.press('ArrowRight')
    expect(await value(label)).toBe(202)
    await app.page.click('button[aria-label="Hide the template list"]')
    expect(await app.page.locator('.template-list').count()).toBe(0)
    expect(await app.page.locator('button[aria-label="Show the template list"]').getAttribute('aria-expanded')).toBe('false')
    expect(await app.page.locator('.template-rail').evaluate(n => n.getBoundingClientRect().width)).toBeLessThan(40)
    expect(await axeViolations(app.page)).toEqual([])
    await expect.poll(async () => (await saved())?.templateListOpen, { timeout: 4000 }).toBe(false)
    await app.page.reload(); await app.page.click('.set-item')
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    expect(await app.page.locator('.template-list').count()).toBe(0)          // still closed after a restart
    await app.page.click('button[aria-label="Show the template list"]')
    expect(await value(label)).toBe(202)
  })

  it('the properties and the layers share one panel, split by a divider that scrolls each half', async () => {
    await toEditor()
    expect(await app.page.locator('.work > .layers, .work > aside.layers').count()).toBe(0)       // layers are not a panel of their own
    expect(await app.page.locator('.canvas-editor .side .layers').count()).toBe(1)
    expect(await app.page.locator('.canvas-editor .toolbar button:has-text("Layers")').count()).toBe(0)
    const label = 'Resize properties and layers'
    const side = await app.page.locator('.canvas-editor .side').evaluate(n => n.clientHeight)
    const half = await value(label)
    expect(Math.abs(half - side / 2)).toBeLessThanOrEqual(2)                                       // half and half to begin with
    for (const sel of ['.canvas-editor .side .props', '.canvas-editor .side .layers']) {
      expect(await app.page.locator(sel).evaluate(n => getComputedStyle(n).overflowY)).toBe('auto')
    }
    await sep(label).focus(); await app.page.keyboard.press('ArrowDown'); await app.page.keyboard.press('ArrowDown')
    expect(await value(label)).toBe(half + 24)
    await app.page.keyboard.press('PageDown')
    expect(await value(label)).toBe(Math.round(side * 0.15))                                       // the properties can shrink to 15%, no further
    expect(await axeViolations(app.page)).toEqual([])
    await expect.poll(async () => (await saved())?.propsSplit, { timeout: 4000 }).toBeCloseTo(0.15, 1)
  })

  it('the properties panel is wider or narrower on request', async () => {
    await toEditor()
    const label = 'Resize the properties panel'
    expect(await value(label)).toBe(280)
    await sep(label).focus(); await app.page.keyboard.press('ArrowLeft')      // the panel is on the right: moving left makes it wider
    expect(await value(label)).toBe(292)
    expect(await app.page.locator('.canvas-editor .side').evaluate(n => n.style.width)).toBe('292px')
  })

  it('the card preview is resizable, and Small, Medium and Large are widths of it', async () => {
    const label = 'Resize the card preview'
    await app.page.locator('.cell[data-col="__id"]').first().click()
    await app.page.waitForSelector('.preview-pane')
    expect(await value(label)).toBe(220)
    await app.menu('menu:preview-size', 'large')
    await app.page.waitForFunction(() => document.querySelector('.preview-pane')?.style.width === '320px')
    expect(await value(label)).toBe(320)
    await app.menu('menu:preview-size', 'small')
    await app.page.waitForFunction(() => document.querySelector('.preview-pane')?.style.width === '170px')
    await sep(label).focus(); await app.page.keyboard.press('ArrowLeft')
    expect(await value(label)).toBe(182)
  })

  it('Preferences can put every panel back to its original size', async () => {
    await toEditor()
    await sep('Resize the project panel').focus(); await app.page.keyboard.press('PageUp')
    await sep('Resize the template list').focus(); await app.page.keyboard.press('PageUp')
    await app.menu('menu:preferences')
    await app.page.waitForSelector('[role=dialog]')
    await app.page.click('[role=dialog] button:has-text("Reset")')
    await app.page.waitForSelector('.toast:has-text("original sizes")')
    await app.page.keyboard.press('Escape')
    expect(await value('Resize the project panel')).toBe(220)
    expect(await value('Resize the template list')).toBe(190)
  })
})

describe('the canvas zoom (A79, replacing A57), and the grid shows on any background', () => {
  beforeEach(async () => { await open(); await toEditor() })

  it('starts at 100%, keeps the zoom out of the tool row, and the View menu commands zoom', async () => {
    const toolbar = app.page.locator('.canvas-editor .toolbar')
    expect(await toolbar.innerText()).not.toMatch(/\d+%/)                              // the zoom lives in its own bar over the canvas
    const width = () => app.page.locator('.stage-host').evaluate(n => Math.round(n.getBoundingClientRect().width))
    expect(await width()).toBe(500)
    await app.menu('menu:canvas', 'zoom-in')
    expect(await width()).toBe(625)
    await app.menu('menu:canvas', 'zoom-out')
    expect(await width()).toBe(500)
    await app.menu('menu:canvas', 'zoom-in'); await app.menu('menu:canvas', 'zoom-reset')
    expect(await width()).toBe(500)
    await app.menu('menu:canvas', 'zoom-fit')
    expect(await width()).toBeGreaterThan(300)
    expect(app.errors).toEqual([])
  })

  it('draws the grid with a dark and a light line side by side, so it shows on dark and light cards alike', async () => {
    await app.page.click('.canvas-editor .toolbar button:has-text("Grid")')
    const px = (x, y) => app.page.evaluate(([x, y]) => {
      const grid = document.querySelectorAll('.stage-view canvas')[2]          // background, live picture, grid, handles
      const r = window.devicePixelRatio || 1
      const hb = document.querySelector('.stage-host').getBoundingClientRect(), cb = grid.getBoundingClientRect(), ox = hb.left - cb.left, oy = hb.top - cb.top
      return [...grid.getContext('2d').getImageData(Math.round((x + ox) * r), Math.round((y + oy) * r), 1, 1).data]
    }, [x, y])
    await expect.poll(async () => (await px(50, 3))[3], { timeout: 4000 }).toBeGreaterThan(100)    // the grid is drawn a moment after the button
    const dark = await px(50, 3), light = await px(51, 3)           // a stronger line every 50 units: dark at 50.5, light at 51.5
    expect(dark[3]).toBeGreaterThan(100); expect(dark[0]).toBeLessThan(40)       // a dark, clearly visible pixel
    expect(light[3]).toBeGreaterThan(100); expect(light[0]).toBeGreaterThan(215) // and a light one next to it
    const minor = await px(10, 3)
    expect(minor[3]).toBeGreaterThan(40); expect(minor[3]).toBeLessThan(dark[3])  // the lines between are fainter
  })
})
