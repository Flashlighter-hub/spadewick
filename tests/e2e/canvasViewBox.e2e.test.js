/**
 * A template whose view box does not start at 0 0 (every design imported with its bleed taken off, or a design tool's artboard that
 * starts elsewhere): the handles and the properties must sit where the card is drawn, not shifted by the view box's origin.
 * Found with the Pelt & Plunder skill card: the box of a text was drawn 37.5 units right and below the words it belongs to.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

// the card is 750 x 1050 and starts at 37.5 37.5 of the drawing; the group moves its content by the same 37.5, as the generated files do
const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="63.5mm" height="88.9mm" viewBox="37.5 37.5 750 1050"><rect x="0" y="0" width="825" height="1125" fill="#ffffff"/>'
  + '<g id="trim" transform="translate(37.5 37.5)"><rect data-spadewick-id="a" x="100" y="100" width="200" height="120" fill="#c8553d"/></g></svg>'

async function openEditor(svg) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `vb-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }], template: { svg } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top } })
const click = async (x, y) => { const h = await host(); await app.page.mouse.click(h.x + x, h.y + y) }
const title = () => app.page.locator('.props-title').innerText()

describe('a view box that does not start at 0 0', () => {
  it('puts the handles on the element where the card is drawn, and reads its position in card units', async () => {
    await openEditor(TPL)
    // the red rectangle is at 100,100 of the group: 137.5 in the drawing, 100 on the card (the card starts at 37.5)
    await click(150, 150)                                              // inside it on the card
    await expect.poll(title).toMatch(/rect · a/)
    expect(await app.page.locator('label:has-text("X") input').first().inputValue()).toBe('100')
    expect(await app.page.locator('label:has-text("Y") input').first().inputValue()).toBe('100')
    // and not where the shift would put it: 37.5 units to the right and below
    await click(20, 20)                                                // empty card
    await click(320, 235)                                              // below-right of where the red rectangle really ends (300, 220)
    expect(await app.page.locator('.props-title').count()).toBe(0)     // nothing is selected there
  })
})
