/**
 * PRD §20: the "What changed?" screen in the Snapshots panel: headline, tabs, side-by-side pictures, taking a change back.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#ffffff"/><text x="125" y="40" text-anchor="middle" font-size="26" data-spadewick-field="name">{{name}}</text></svg>'

describe('snapshot compare screen', () => {
  it('shows what changed, draws both versions and takes one change back', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `cmp-${Date.now()}`, parentDir: app.root })
    const seeded = await seedSet({ name: 'Deck', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }], cards: [{ name: 'A', fields: { name: 'Alpha', cost: 1 } }], template: { svg: TPL } })
    await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
    await app.invoke('snapshots:create', { name: 'Before balance' })
    await app.invoke('cards:update', { id: seeded.cards[0].id, fields: { cost: 5, name: 'Alpha Prime' } })
    await app.goto()
    await app.menu('menu:view-snapshots')
    await app.page.click('button:has-text("What changed?")')
    await app.page.waitForSelector('.headline')
    expect(await app.page.innerText('.headline')).toMatch(/1 card changed, 0 added, 0 removed/)
    await app.page.click('.open')
    await app.page.waitForSelector('.pics img')
    expect(await app.page.locator('.pics img').count()).toBe(2)
    expect(await app.page.innerText('.detail')).toMatch(/Cost: 1 → 5/)
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.locator('.change', { hasText: 'Cost' }).locator('button').click()
    await app.page.waitForFunction(() => !document.querySelector('.detail')?.innerText.includes('Cost: 1'))
    const card = (await app.invoke('cards:list', seeded.set.id))[0]
    expect(card.fields.cost).toBe(1)
    expect(card.fields.name).toBe('Alpha Prime')
    expect(app.errors).toEqual([])
  })

  it('offers overlay and slider views, and Project > What Changed Since... asks which snapshot', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `cmp2-${Date.now()}`, parentDir: app.root })
    const seeded = await seedSet({ name: 'Deck', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'Alpha' } }], template: { svg: TPL } })
    await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
    await app.invoke('snapshots:create', { name: 'Earlier' })
    await app.invoke('cards:update', { id: seeded.cards[0].id, fields: { name: 'Beta' } })
    await app.goto()
    await app.menu('menu:what-changed')
    await app.page.waitForSelector('.ask select')
    await app.page.click('.ask button:has-text("Compare")')
    await app.page.waitForSelector('.headline')
    await app.page.click('.open')
    await app.page.waitForSelector('.pics img')
    await app.page.selectOption('.bar select', 'slider')
    await app.page.waitForSelector('input[type=range]')
    expect(await app.page.locator('.frame img').count()).toBe(2)
    await app.page.selectOption('.bar select', 'overlay')
    expect(await app.page.locator('.frame img').count()).toBe(2)
    expect(await axeViolations(app.page)).toEqual([])
    expect(app.errors).toEqual([])
  })
})
