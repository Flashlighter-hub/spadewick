/**
 * The pasteboard: elements may spill over the edge of the card. They are drawn (dimmed) outside it, can be taken hold of, moved and
 * resized there, and the card's own size never changes; what lies outside is cut off by the card in the picture and in every export.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="63.5mm" height="88.9mm" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
  + '<rect data-spadewick-id="big" x="-100" y="-100" width="300" height="200" fill="#c8102e"/>'
  + '<rect data-spadewick-id="away" x="520" y="300" width="120" height="80" fill="#1e5aa8"/>'
  + '<rect data-spadewick-id="inside" x="250" y="400" width="100" height="100" fill="#2e8b57"/>'
  + '</svg>'

async function openEditor() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `pb-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
const scrollTo = (l, t) => app.page.locator('.scroller').evaluate((n, [l, t]) => { n.scrollLeft = l; n.scrollTop = t }, [l, t])
const clickCard = async (x, y) => { const h = await host(); await app.page.mouse.click(h.x + x, h.y + y) }
const title = () => app.page.locator('.props-title').innerText()
const field = label => app.page.locator(`label:has-text("${label}") input`).first()
const sourceText = async () => {
  await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
  const t = await app.page.locator('textarea.svg-source').inputValue()
  await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
  return t
}

describe('elements that spill over the edge of the card', () => {
  beforeEach(openEditor)

  it('can be seen outside the card, dimmed, in the picture', async () => {
    await expect.poll(async () => app.page.evaluate(() => {
      const c = document.querySelectorAll('.stage-view canvas')[0], r = window.devicePixelRatio || 1
      const hb = document.querySelector('.stage-host').getBoundingClientRect(), cb = c.getBoundingClientRect()
      const px = (x, y) => [...c.getContext('2d').getImageData(Math.round((x + hb.left - cb.left) * r), Math.round((y + hb.top - cb.top) * r), 1, 1).data]
      const outside = px(-50, -50), nothing = px(-50, 300)    // inside the red rectangle, but outside the card / outside the card with nothing there
      const dimmed = p => p[3] > 0 && p[0] < 200                  // under the veil: darker than the rectangle's own red (200, 16, 46)
      return outside[0] > outside[1] + 30 && dimmed(outside) && !(nothing[0] > nothing[1] + 30)
    }), { timeout: 8000 }).toBe(true)
  })

  it('can be taken hold of outside the card, and moved and resized there; the card keeps its size', async () => {
    const before = await sourceText()
    expect(before).toContain('viewBox="0 0 500 700"')
    await scrollTo(0, 0)
    await clickCard(-30, -30)                                          // the part of the red rectangle that lies outside the card
    await expect.poll(title).toMatch(/rect · big/)
    expect(await field('X').inputValue()).toBe('-100')
    expect(await field('Y').inputValue()).toBe('-100')
    expect(await field('W').inputValue()).toBe('300')
    // larger and smaller, beyond the edge, without touching the card
    await field('W').fill('600'); await field('W').press('Enter')
    await expect.poll(() => field('W').inputValue()).toBe('600')
    await field('W').fill('150'); await field('W').press('Enter')
    await expect.poll(() => field('W').inputValue()).toBe('150')
    await field('X').fill('-40'); await field('X').press('Enter')
    await expect.poll(() => field('X').inputValue()).toBe('-40')
    const after = await sourceText()
    expect(after).toContain('viewBox="0 0 500 700"')                  // the template's size is the card's, whatever was done outside it
    expect(after).toContain('width="63.5mm" height="88.9mm"')
    expect(after).toMatch(/data-spadewick-id="big"[^>]*x="-40"|x="-40"[^>]*data-spadewick-id="big"/)
  })

  it('can be selected when it lies wholly outside the card, and dragged back onto it', async () => {
    const h = await host()
    await app.page.locator('.scroller').evaluate(n => { n.scrollLeft = n.scrollWidth })     // to the right of the card
    const r = await host()
    await app.page.mouse.click(r.x + 560, r.y + 340)                    // inside the blue rectangle, which is 20 units right of the card
    await expect.poll(title).toMatch(/rect · away/)
    expect(await field('X').inputValue()).toBe('520')
    await app.page.mouse.move(r.x + 560, r.y + 340); await app.page.mouse.down()
    await app.page.mouse.move(r.x + 360, r.y + 340, { steps: 8 }); await app.page.mouse.up()
    await expect.poll(() => field('X').inputValue().then(Number)).toBeLessThan(400)
    expect(h.w).toBeGreaterThan(0)
  })

  it('does not select the pasteboard itself: a click on empty space lets go', async () => {
    await scrollTo(0, 0)
    await clickCard(-30, -30)
    await expect.poll(title).toMatch(/rect · big/)
    await clickCard(-60, 300)                                          // empty pasteboard
    await expect.poll(() => app.page.locator('.props-title').count()).toBe(0)
  })
})

describe('the canvas is locked to the card', () => {
  beforeEach(openEditor)

  it('says so in the source dialog when the view box, width or height is edited, and does not let the change be saved', async () => {
    await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
    const area = app.page.locator('textarea.svg-source')
    const original = await area.inputValue()
    await area.fill(original.replace('viewBox="0 0 500 700"', 'viewBox="0 0 640 700"'))
    await app.page.waitForSelector('.source-error')
    expect(await app.page.locator('.source-error').innerText()).toMatch(/canvas is 500 × 700 units and is locked to the card/)
    expect(await app.page.locator('button:has-text("Save")').first().isDisabled()).toBe(true)
    // the same source with only a spilling element added is fine
    await area.fill(original.replace('</svg>', '<rect data-spadewick-id="far" x="-900" y="-900" width="50" height="50" fill="#000"/></svg>'))
    await expect.poll(() => app.page.locator('.source-error').count()).toBe(0)
    await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
    await app.page.locator('button:has-text("Save")').first().click()
    await expect.poll(async () => (await app.invoke('templates:list', {})).length).toBeGreaterThan(0)
    const t = (await app.invoke('templates:list', {})).find(x => x.name === 'Base')
    expect((await app.invoke('templates:get', t.id)).svg_source).toContain('x="-900"')
  })
})
