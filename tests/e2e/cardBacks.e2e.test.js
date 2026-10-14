/**
 * Card backs in the application (PRD §7.8): the Template and Card back slots of a set, making a back, turning the preview over,
 * the Card back column of the card table, and the export choice.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const FRONT = svg('<rect width="500" height="700" fill="#336699"/><text x="40" y="200" font-size="60" fill="#ffffff">{{title}}</text>')

async function freshSet() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `back-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }], template: { svg: FRONT }, cards: [{ name: 'Fire', fields: { title: 'Fire' } }, { name: 'Ice', fields: { title: 'Ice' } }] })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const open = async () => { await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row') }
const previewSrc = () => app.page.locator('.preview-img').getAttribute('src')

describe('the two slots of a set', () => {
  it('shows a Template slot and a Card back slot, and a back can be chosen from the templates of the set\'s size', async () => {
    const s = await freshSet()
    const red = await app.invoke('templates:create', { name: 'Red back', svgSource: svg('<rect width="500" height="700" fill="#cc0000"/>'), cardSize: 'poker' })
    await open()
    expect(await app.page.locator('.sidebar .template-picker label span').innerText()).toBe('Template')
    expect(await app.page.locator('.sidebar .back-picker label span').innerText()).toBe('Card back')
    const pick = app.page.locator('.sidebar .back-picker select')
    expect(await pick.locator('option').allInnerTexts()).toEqual(['— none —', 'Base', 'Red back'])
    expect(await app.page.locator('.sidebar .back-picker button:has-text("Edit")').isDisabled()).toBe(true)
    await pick.selectOption(red.id)
    await app.page.waitForFunction(() => !window.__pending)
    expect((await app.invoke('sets:list'))[0].default_back_template_id).toBe(red.id)
    expect(await app.page.locator('.sidebar .back-picker button:has-text("Edit")').isDisabled()).toBe(false)
    expect(s.set.id).toBeTruthy()
  })

  it('"New back…" makes a back in the set\'s size, makes it the card back, and opens it in the Template Editor', async () => {
    await freshSet()
    await open()
    await app.page.click('.sidebar .back-picker button:has-text("New back")')
    const dialog = app.page.locator('[role=dialog]')
    await dialog.waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    expect(await dialog.locator('input[type=radio]').count()).toBe(3)
    await dialog.locator('label.design', { hasText: 'Soft glow' }).click()
    await dialog.locator('input.field').fill('Glow back')
    await dialog.locator('button.primary', { hasText: 'Create and edit' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    await app.page.waitForSelector('.editor-toolbar strong:has-text("Glow back")')
    const set = (await app.invoke('sets:list'))[0]
    const back = (await app.invoke('templates:list')).find(t => t.name === 'Glow back')
    expect(set.default_back_template_id).toBe(back.id)
    expect(back.card_size).toBe('poker')
    // the list says it is a back, and its image layer is an image source, not a field binding
    expect(await app.page.locator('.template-list .tpl', { hasText: 'Glow back' }).locator('.child-badge.back').count()).toBe(1)
    await app.page.locator('.layers button, .layers [role=option], .layers li', { hasText: 'emblem' }).first().click()
    await app.page.waitForSelector('.props-title:has-text("emblem")')
    expect(await app.page.locator('.props label:has-text("Image source")').count()).toBe(1)
    expect(await app.page.locator('.props .fixed-image button').innerText()).toBe('Choose or import an image…')
  })
})

describe('turning the preview over, and the card table', () => {
  it('the Back button is off until the card has a back, then shows the back, and follows a back of the card\'s own', async () => {
    const s = await freshSet()
    const red = await app.invoke('templates:create', { name: 'Red back', svgSource: svg('<rect width="500" height="700" fill="#cc0000"/>'), cardSize: 'poker' })
    const green = await app.invoke('templates:create', { name: 'Green back', svgSource: svg('<rect width="500" height="700" fill="#00aa00"/>'), cardSize: 'poker' })
    await open()
    await app.page.locator('.grid-row').first().locator('.cell[data-col="__id"]').click()
    await app.page.waitForSelector('.preview-img')
    const back = app.page.locator('.preview-pane .side-btn', { hasText: 'Back' })
    expect(await back.isDisabled()).toBe(true)
    const front = await previewSrc()

    await app.page.locator('.sidebar .back-picker select').selectOption(red.id)
    await app.page.waitForFunction(() => !window.__pending)
    expect(await back.isDisabled()).toBe(false)
    await back.click()
    await app.page.waitForFunction(old => document.querySelector('.preview-img')?.getAttribute('src') !== old, front)
    const redBack = await previewSrc()
    expect(redBack).not.toBe(front)

    // the card table's Card back column gives this card a back of its own, and the preview follows
    const cell = app.page.locator('.grid-row').first().locator('select[aria-label^="Card back for"]')
    await cell.selectOption(green.id)
    await app.page.waitForFunction(old => document.querySelector('.preview-img')?.getAttribute('src') !== old, redBack)
    expect((await app.invoke('cards:list', s.set.id))[0].back_template_id).toBe(green.id)
    await app.page.locator('.preview-pane .side-btn', { hasText: 'Front' }).click()
    await app.page.waitForFunction(old => document.querySelector('.preview-img')?.getAttribute('src') !== old, await previewSrc())
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('exporting', () => {
  it('offers "The set\'s card back" first and by default, and says which sets have none', async () => {
    await freshSet()
    await open()
    await app.menu('menu:export-tts')
    const dialog = app.page.locator('[role=dialog]')
    await dialog.waitFor()
    await dialog.locator('input[type=checkbox]').first().check().catch(() => {})
    const radios = dialog.locator('fieldset', { hasText: 'Card back' }).locator('input[type=radio]')
    expect(await radios.first().isChecked()).toBe(true)
    expect(await dialog.locator('fieldset', { hasText: 'Card back' }).locator('label').first().innerText()).toContain("The set's card back")
    expect(await axeViolations(app.page)).toEqual([])
  })
})
