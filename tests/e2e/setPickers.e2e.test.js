/** The Template and Card back lists of THIS SET keep showing the template that was chosen when the person goes to another set and back. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApp } from './harness.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#336699"/></svg>'
const pickerValue = label => app.page.locator(`.template-picker select, .back-picker select`).evaluateAll((els, l) => els.find(e => e.closest('label')?.innerText.includes(l))?.selectedOptions[0]?.textContent ?? null, label)

describe('the lists of THIS SET', () => {
  it('still show the chosen template and card back after leaving the set and coming back', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `pick-${Date.now()}`, parentDir: app.root })
    const a = await app.invoke('sets:create', { name: 'Alpha' })
    await app.invoke('sets:create', { name: 'Beta', cardSize: 'tarot' })   // another size: its list of templates is another list
    const front = await app.invoke('templates:create', { name: 'Front one', svgSource: svg })
    const back = await app.invoke('templates:create', { name: 'Back one', svgSource: svg })
    await app.invoke('templates:create', { name: 'Tarot one', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="857" viewBox="0 0 500 857"><rect width="500" height="857" fill="#336699"/></svg>', cardSize: 'tarot' })
    await app.invoke('sets:update', { id: a.id, defaultTemplateId: front.id, defaultBackTemplateId: back.id })
    await app.goto()
    await app.page.waitForSelector('.set-item')
    const item = name => app.page.locator('.set-item', { hasText: name }).first()
    for (let round = 0; round < 3; round++) {
      await item('Alpha').click()
      await app.page.waitForFunction(() => [...document.querySelectorAll('.template-picker option')].some(o => o.textContent === 'Front one'))
      expect(await pickerValue('Card back')).toBe('Back one')
      expect(await pickerValue('Template')).toBe('Front one')
      await item('Beta').click()
      await app.page.waitForFunction(() => document.querySelectorAll('.template-picker option').length === 2)
      expect(await pickerValue('Card back')).toBe('— none —')
    }
  }, 60000)
})
