/**
 * PRD §10.6, §7.5, §12.2: card size belongs to each set and each template; there is no project default size, no
 * palette, and no Views list in the project panel.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svgOf = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#445566"/></svg>`

async function open() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `cs-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Heroes', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'Orc' }, { name: 'Elf' }], template: { svg: svgOf(500, 700), name: 'Poker frame' } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const sizeSelect = () => app.page.locator('.sidebar label:has-text("Set card size") select')
const lastConfirm = () => app.dialogs.filter(d => d.type === 'confirm').at(-1)?.message

describe('the project panel (PRD §12.1)', () => {
  it('has no Views list (the tabs are the way to switch), and one card size, the set\'s', async () => {
    await open()
    const headers = await app.page.locator('.sidebar h2').allInnerTexts()
    expect(headers.map(h => h.toLowerCase())).toEqual(['project', 'sets', 'this set'])
    expect(await app.page.locator('.sidebar .view-item, .sidebar .view-list').count()).toBe(0)
    expect(await app.page.locator('.sidebar label:has-text("card size")').count()).toBe(1)          // no "Default card size" any more
    expect(await app.page.locator('.sidebar label:has-text("Default card size")').count()).toBe(0)
    for (const tab of ['Card Data', 'Template Editor', 'Assets', 'Snapshots']) expect(await app.page.locator(`button[role=tab]:has-text("${tab}")`).count()).toBe(1)
  })

  it('Preferences has no default card size or default pixel size for new projects', async () => {
    await open()
    await app.menu('menu:preferences')
    await app.page.waitForSelector('[role=dialog]')
    const text = await app.page.locator('[role=dialog]').innerText()
    expect(text).not.toMatch(/Default card (size|width|height)/)
    expect(text).toMatch(/Default export DPI/)
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('a new set has a card size of its own (PRD §10.6)', () => {
  it('asks for the size, with Poker preselected', async () => {
    await open()
    await app.holdPrompts(true)
    await app.page.locator('.sidebar .add-btn').first().click()
    await app.page.waitForSelector('[role=dialog] form')
    expect(await app.page.locator('[role=dialog] select').inputValue()).toBe('poker')
    await app.page.locator('[role=dialog] input.field').fill('Oracle')
    await app.page.locator('[role=dialog] select').selectOption('tarot')
    await app.page.locator('[role=dialog] button[type=submit]').click()
    await app.page.waitForSelector('.set-item:has-text("Oracle")')
    expect((await app.invoke('sets:list')).find(s => s.name === 'Oracle')).toMatchObject({ card_size: 'tarot' })
    await expect.poll(() => sizeSelect().inputValue()).toBe('tarot')                  // and the new set is open at that size
    await app.holdPrompts(false)
  })

  it('a new set made with just a name is Poker', async () => {
    await open()
    app.answer('Plain')
    await app.page.locator('.sidebar .add-btn').first().click()
    await app.page.waitForSelector('.set-item:has-text("Plain")')
    expect((await app.invoke('sets:list')).find(s => s.name === 'Plain')).toMatchObject({ card_size: 'poker' })
  })
})

describe('changing a set\'s card size asks first (PRD §10.6)', () => {
  it('warns about the default template and the cards\' templates, and does nothing when declined', async () => {
    const { set } = await open()
    app.declineNextConfirm()
    await sizeSelect().selectOption('tarot')
    await expect.poll(lastConfirm).toMatch(/Change the card size of “Heroes” to Tarot/)
    expect(lastConfirm()).toMatch(/default template “Poker frame” is for another card size and will be cleared/)
    expect(lastConfirm()).toMatch(/2 cards use a template of another card size/)
    expect(lastConfirm()).toMatch(/No template of the new size exists yet/)
    await expect.poll(() => sizeSelect().inputValue()).toBe('poker')                  // the picker goes back
    expect((await app.invoke('sets:list'))[0]).toMatchObject({ card_size: 'poker', default_template_id: expect.any(String) })
    expect(set.id).toBeTruthy()
  })

  it('applies the change once confirmed: the set changes size, what no longer fits is let go, the cards stay', async () => {
    const { set } = await open()
    await sizeSelect().selectOption('tarot')
    await expect.poll(async () => (await app.invoke('sets:list'))[0].card_size).toBe('tarot')
    expect((await app.invoke('sets:list'))[0].default_template_id).toBeNull()
    expect((await app.invoke('cards:list', set.id)).map(c => [c.display_name, c.template_id])).toEqual([['Orc', null], ['Elf', null]])
    expect((await app.invoke('cardsize:get', set.id))).toMatchObject({ id: 'tarot', heightPx: 857 })
    // the template list of the set now shows nothing of the old size
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    expect(await app.page.locator('.template-list .tpl').count()).toBe(0)
    expect(await app.page.locator('.template-list').innerText()).toMatch(/No template of this card size yet/)
  })

  it('changes without a question when nothing is affected', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `cs-empty-${Date.now()}`, parentDir: app.root })
    await app.invoke('sets:create', { name: 'Empty' })
    await app.goto(); await app.page.click('.set-item')
    const before = app.dialogs.length
    await sizeSelect().selectOption('mini_us')
    await expect.poll(async () => (await app.invoke('sets:list'))[0].card_size).toBe('mini_us')
    expect(app.dialogs.length).toBe(before)                                        // no confirm was shown
  })
})
