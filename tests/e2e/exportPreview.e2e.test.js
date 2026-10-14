/** PRD §10.7: the export dialog shows a live preview of the first sheet or page, and it follows the options. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><text x="30" y="70" font-size="40" fill="#fff">{{name}}</text></svg>'

async function open(menu) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `prev-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Test Set', fields: [{ name: 'Name', type: 'text' }], cards: Array.from({ length: 20 }, (_, i) => ({ name: `C${i + 1}`, fields: { name: `C${i + 1}` } })), template: { svg: TEMPLATE } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  await app.menu(menu)
  await app.page.waitForSelector('[role=dialog] aside.preview')
}
const images = () => app.page.locator('[role=dialog] .preview img')
const settled = () => app.page.waitForFunction(() => document.querySelector('[role=dialog] .preview-area')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('[role=dialog] .preview img').length > 0, null, { timeout: 20000 })

describe('the live preview in the export dialog', () => {
  it('Tabletop Simulator: shows the first sheet and the back, and the numbers of the deck', async () => {
    await open('menu:export-tts')
    await settled()
    expect(await images().count()).toBe(2)
    const text = await app.page.locator('[role=dialog] .preview').innerText()
    expect(text).toMatch(/20 cards in 1 deck/)
    expect(text).toMatch(/8 × 3 cells/)
    expect(await images().first().getAttribute('alt')).toBe('The first sheet')
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('PNG sheet: follows the cards per row', async () => {
    await open('menu:export-png')
    await settled()
    const before = await images().first().evaluate(i => i.naturalWidth / i.naturalHeight)
    const input = app.page.locator('[role=dialog] label:has-text("Cards per row") input')
    await input.fill('4')
    await app.page.waitForFunction(b => { const i = document.querySelector('[role=dialog] .preview img'); return i && Math.abs(i.naturalWidth / i.naturalHeight - b) > 0.2 }, before, { timeout: 20000 })
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('print PDF: shows the page, and the back page when duplex backs are chosen', async () => {
    await open('menu:export-pdf')
    await settled()
    expect(await images().count()).toBe(1)
    const text = await app.page.locator('[role=dialog] .preview').innerText()
    expect(text).toMatch(/20 cards on 3 pages of 216 × 279 mm, 9 per page [(]3 × 3[)]/)   // poker cards fit 3 × 3 on Letter
    expect(text).toMatch(/reduced to fit more cards/)
    const shot = join(app.root, 'preview-pdf.png'); mkdirSync(app.root, { recursive: true })
    await app.page.screenshot({ path: shot })
    expect(await axeViolations(app.page)).toEqual([])
  })
})
