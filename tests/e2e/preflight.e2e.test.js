/**
 * PRD §17.7: the print preflight in the production export (findings, the gate on errors and Export anyway), in its own dialog
 * (Project → Check print readiness…, the minimums), and Show me, which opens the template editor on the element. Axe at each step.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

// text near the left edge (outside the safe area) and a light text that is too small
const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#f4ebd0"/>' +
  '<text data-spadewick-id="title" data-spadewick-field="name" x="3" y="60" font-size="24" fill="#222222">{{name}}</text>' +
  '<text data-spadewick-id="tiny" x="40" y="120" font-size="5" fill="#222222">small print</text></svg>'
const dialog = () => app.page.locator('[role=dialog]').last()

async function open() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `pre-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Deck', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'Alpha' } }, { name: 'B', fields: { name: 'Beta' } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}

describe('in the production export', () => {
  it('lists what is wrong with the cards, and is accessible', async () => {
    await open()
    await app.menu('menu:export-pdf')
    await dialog().waitFor()
    await dialog().locator('label:has-text("A manufacturer (production)") input').check()
    await dialog().locator('.pre table').waitFor()
    const text = await dialog().locator('.pre').innerText()
    expect(text).toMatch(/2 card\(s\) checked: 0 error\(s\), 2 warning\(s\)/)
    expect(text).toMatch(/Text or an icon reaches outside the safe area/)
    expect(text).toMatch(/Text is 3\.6 pt; the smallest allowed is 6 pt/)
    expect(text).toMatch(/What to do: Move it inside the safe line/)
    expect(await dialog().locator('button.primary-btn').isDisabled()).toBe(false)               // warnings never block
    expect(await axeViolations(app.page)).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('stops the export on an error until the person insists', async () => {
    await open()
    await app.menu('menu:export-pdf')
    await dialog().waitFor()
    await dialog().locator('label:has-text("A manufacturer (production)") input').check()
    await dialog().locator('.pre table').waitFor()
    await dialog().locator('label:has-text("None") input').first().check()                      // no card back: an error
    await dialog().locator('.pre [role=alert]').waitFor()
    expect(await dialog().locator('.pre').innerText()).toMatch(/No card back is chosen/)
    expect(await dialog().locator('button.primary-btn').isDisabled()).toBe(true)
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('label:has-text("Export anyway") input').check()
    expect(await dialog().locator('button.primary-btn').isDisabled()).toBe(false)
  })
})

describe('Project → Check print readiness…', () => {
  it('runs on its own, keeps the minimums in the project and applies them', async () => {
    await open()
    await app.menu('menu:check-print')
    await dialog().locator('table').waitFor()
    expect(await dialog().innerText()).toMatch(/Text is 3\.6 pt/)
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('details.mins summary').click()
    await dialog().locator('label:has-text("Smallest text (pt)") input').fill('3')
    await dialog().locator('button:has-text("Save the minimums")').click()
    await app.settle()
    expect((await app.invoke('preflight:get-minimums')).textPt).toBe(3)
    await dialog().locator('table').waitFor()
    expect(await dialog().innerText()).not.toMatch(/Text is 3\.6 pt/)                            // 3.6 pt is over the new minimum
    await dialog().locator('label:has-text("Smallest text (pt)") input').fill('0')
    await dialog().locator('button:has-text("Save the minimums")').click()
    await dialog().locator('[role=alert]').waitFor()
    expect(await dialog().locator('[role=alert]').innerText()).toMatch(/not valid/)
    expect(app.errors).toEqual([])
  })

  it('Show me opens the template editor on the element of a finding', async () => {
    await open()
    await app.menu('menu:check-print')
    await dialog().locator('table').waitFor()
    await dialog().locator('tr', { hasText: 'smallest allowed' }).locator('button:has-text("Show me")').click()
    await app.page.waitForSelector('.template-editor canvas')
    await app.page.locator('.props-title:has-text("tiny")').waitFor({ timeout: 15000 })
    expect(await app.page.locator('button[role=tab][aria-selected=true]').innerText()).toMatch(/Template Editor/)
    expect(app.errors).toEqual([])
  })
})
