/**
 * The template canvas (A79): zoom and pan, the rulers that follow them, the keyboard shortcuts, and that editing still lands on the
 * right card units at any zoom.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
  + '<rect data-spadewick-id="band" x="100" y="200" width="200" height="100" fill="#c8553d"/></svg>'

async function openEditor() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `zoom-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
const sourceText = async () => {
  await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
  const t = await app.page.locator('textarea.svg-source').inputValue()
  await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
  return t
}
const zoomSelect = () => app.page.locator('.zoombar select').inputValue()

describe('zoom', () => {
  beforeEach(openEditor)

  it('opens at 100% with rulers, and the keyboard zooms: Ctrl+plus, Ctrl+minus, Ctrl+1, Ctrl+0', async () => {
    expect((await host()).w).toBe(500)
    expect(await zoomSelect()).toBe('1')
    expect(await app.page.locator('.ruler.h').count()).toBe(1)
    await app.page.keyboard.press('Control+=')
    expect((await host()).w).toBe(625)
    expect(await zoomSelect()).toBe('1.25')
    await app.page.keyboard.press('Control+-')
    expect((await host()).w).toBe(500)
    await app.page.keyboard.press('Control+=')
    await app.page.keyboard.press('Control+1')
    expect((await host()).w).toBe(500)
    await app.page.keyboard.press('Control+0')
    const fit = await host()
    expect(fit.w / fit.h).toBeCloseTo(500 / 700, 2)
    expect(fit.h).toBeLessThanOrEqual(780)                       // it fits the scrolling area
    expect(app.errors).toEqual([])
  })

  it('the zoom bar: a menu of steps, plus, minus and Fit', async () => {
    await app.page.locator('.zoombar select').selectOption('2')
    expect((await host()).w).toBe(1000)
    await app.page.click('.zoombar button[aria-label^="Zoom out"]')
    expect((await host()).w).toBe(800)
    await app.page.click('.zoombar button[aria-label^="Zoom in"]')
    expect((await host()).w).toBe(1000)
    await app.page.click('.zoombar button:has-text("Fit")')
    expect((await host()).w).toBeLessThan(1000)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('Ctrl+wheel zooms around the pointer: the card point under it stays put', async () => {
    const before = await host()
    const point = { x: before.x + 200, y: before.y + 300 }          // card point (200, 300)
    await app.page.mouse.move(point.x, point.y)
    await app.page.keyboard.down('Control')
    await app.page.mouse.wheel(0, -400)
    await app.page.keyboard.up('Control')
    await expect.poll(async () => (await host()).w, { timeout: 3000 }).toBeGreaterThan(550)
    const after = await host()
    const zoom = after.w / 500
    expect(Math.abs(after.x + 200 * zoom - point.x)).toBeLessThan(3)
    expect(Math.abs(after.y + 300 * zoom - point.y)).toBeLessThan(3)
  })

  it('space and drag pans, and the stage does not see that drag', async () => {
    await app.page.locator('.zoombar select').selectOption('3')
    const scroll = () => app.page.locator('.scroller').evaluate(n => [n.scrollLeft, n.scrollTop])
    const before = await scroll()
    const r = await app.page.locator('.scroller').boundingBox()
    await app.page.mouse.move(r.x + 300, r.y + 300)
    await app.page.keyboard.down('Space')
    await app.page.mouse.down()
    await app.page.mouse.move(r.x + 200, r.y + 220, { steps: 5 })
    await app.page.mouse.up()
    await app.page.keyboard.up('Space')
    const after = await scroll()
    expect(after[0]).toBeGreaterThan(before[0] + 50)
    expect(after[1]).toBeGreaterThan(before[1] + 30)
    expect(await app.page.locator('.props-title').count()).toBe(0)           // nothing was selected by it
  })

  it('moves an element by the right number of card units at 200%', async () => {
    await app.page.locator('.zoombar select').selectOption('2')
    const h = await host()
    await app.page.mouse.click(h.x + 200 * 2, h.y + 250 * 2)               // the band, at (200, 250) in card units
    await app.page.waitForSelector('.props-title:has-text("band")')
    await app.page.mouse.move(h.x + 200 * 2, h.y + 250 * 2); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 200 * 2 + 100, h.y + 250 * 2 + 60, { steps: 8 }); await app.page.mouse.up()    // 100 x 60 screen pixels = 50 x 30 units
    await expect.poll(sourceText, { timeout: 5000 }).toMatch(/x="150"[^>]*y="230"|y="230"[^>]*x="150"/)
  })

  it('draws a new rectangle with its size in card units at 200%', async () => {
    await app.page.locator('.zoombar select').selectOption('2')
    const h = await host()
    await app.page.click('button[title^="Rectangle"]')
    await app.page.mouse.move(h.x + 2 * 150, h.y + 2 * 350); await app.page.mouse.down()       // card point (150, 350), in view at 200%
    await app.page.mouse.move(h.x + 2 * 150 + 160, h.y + 2 * 350 + 100, { steps: 6 }); await app.page.mouse.up()
    await app.page.waitForTimeout(800)
    const t = await sourceText()
    const el = /<rect[^>]*data-spadewick-id="rect_1"[^>]*>/.exec(t)[0]
    const attr = n => Number(new RegExp(` ${n}="([\\d.]+)"`).exec(el)[1])
    expect([attr('x'), attr('y'), attr('width'), attr('height')]).toEqual([150, 350, 80, 50])
  })
})

describe('rulers', () => {
  beforeEach(openEditor)

  it('are labelled in card units and change their step with the zoom, and can be switched off', async () => {
    const labels = () => app.page.locator('.ruler.h .tick i').allInnerTexts()
    expect(await labels()).toContain('100')
    expect(await labels()).not.toContain('50')                 // 50 units are 50 px at 100%: too close to label
    await app.page.locator('.zoombar select').selectOption('2')
    await expect.poll(labels, { timeout: 3000 }).toContain('50')
    await app.page.click('.canvas-editor .toolbar button:has-text("Rulers")')
    expect(await app.page.locator('.ruler.h').count()).toBe(0)
  })
})

describe('tool shortcuts', () => {
  beforeEach(openEditor)

  it('V, T, I, R and E pick the tools; Escape lets go of the selection', async () => {
    const pressed = title => app.page.locator(`.toolbar button[title^="${title}"]`).getAttribute('aria-pressed')
    for (const [key, title] of [['t', 'Text'], ['i', 'Image'], ['r', 'Rectangle'], ['e', 'Ellipse'], ['v', 'Select']]) {
      await app.page.keyboard.press(key)
      expect(await pressed(title)).toBe('true')
    }
    const h = await host()
    await app.page.mouse.click(h.x + 200, h.y + 250)
    await app.page.waitForSelector('.props-title:has-text("band")')
    await app.page.keyboard.press('Escape')
    await expect.poll(() => app.page.locator('.props-title').count()).toBe(0)
  })

  it('Space still presses a focused button', async () => {
    await app.page.locator('.zoombar button[aria-label^="Zoom in"]').focus()
    await app.page.keyboard.press('Space')
    expect((await host()).w).toBe(625)
  })
})
