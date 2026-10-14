/**
 * PRD §16.7: the Rich text field type in the card table (styled cells, the cell editor with its toolbar and shortcuts),
 * the preview before a field changes between Text and Rich text, and the rich text switch of a text element.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/>' +
  '<text data-spadewick-id="title" x="30" y="70" font-size="40" fill="#fff">{{body}}</text></svg>'

async function open(fieldType = 'rich_text', body = '**bold** and *it*') {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `rich-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Set', fields: [{ name: 'Body', type: fieldType }], cards: [{ name: 'A', fields: { body } }], template: { svg: TEMPLATE } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}

const cell = () => app.page.locator('.grid-row').first().locator('.cell[data-col="body"]')
const editor = () => app.page.locator('[role=dialog][aria-label="Edit Body"]')
const area = () => editor().locator('textarea')
const selectText = (from, to) => area().evaluate((el, [a, b]) => { el.focus(); el.setSelectionRange(a, b) }, [from, to])
const storedBody = async seeded => (await app.invoke('cards:list', seeded.set.id))[0].fields.body

describe('a Rich text cell', () => {
  it('shows the markup as styled text, and opens its editor from the keyboard', async () => {
    await open()
    const html = await cell().innerHTML()
    expect(html).toMatch(/font-weight:\s*700/)
    expect(html).toMatch(/font-style:\s*italic/)
    expect(await cell().innerText()).toBe('bold and it')
    await cell().click()
    await app.page.keyboard.press('Enter')
    await editor().waitFor()
    expect(await app.page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
    expect(await area().inputValue()).toBe('**bold** and *it*')
  })

  it('starts editing with the character typed on the cell', async () => {
    await open('rich_text', '')
    await cell().click()
    await app.page.keyboard.type('x')
    await editor().waitFor()
    expect(await area().inputValue()).toBe('x')
  })

  it('has Bold, Italic, Underline, Colour and Insert icon, and keyboard shortcuts, with a live preview', async () => {
    const seeded = await open('rich_text', '')
    await cell().dblclick()
    await editor().waitFor()
    await area().fill('make this bold and italic and under')
    await selectText(5, 9)
    await app.page.keyboard.press('Control+b')
    expect(await area().inputValue()).toBe('make **this** bold and italic and under')
    expect(await editor().locator('.preview span[style*="font-weight"]').innerText()).toBe('this')

    await selectText(14, 18)                                   // "bold"
    await editor().locator('button[aria-label="Italic"]').click()
    expect(await area().inputValue()).toContain('*bold*')

    await selectText(0, 4)                                     // "make"
    await editor().locator('button[aria-label="Text colour"]').click()
    await app.page.locator('input[aria-label="Hex color"]').fill('#cc3333')
    await app.page.keyboard.press('Enter')
    expect(await area().inputValue()).toMatch(/^\{color:#cc3333\}make\{\/color\}/)

    await area().evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
    await editor().locator('button[aria-label="Insert icon"]').click()
    await app.page.locator('input[aria-label="Search icons"]').fill('star')
    await app.page.locator('button[aria-label="star"]').click()
    expect(await area().inputValue()).toMatch(/\{icon:star\}$/)
    expect(await editor().locator('.preview svg[aria-label="star"]').count()).toBe(1)

    await selectText(0, 0)
    await area().press('Control+u')
    expect(await area().inputValue()).toMatch(/^____\{color/)

    await app.page.keyboard.press('Control+Enter')
    await editor().waitFor({ state: 'detached' })
    const stored = await storedBody(seeded)
    expect(stored).toContain('{icon:star}')
    expect(stored).toContain('**this**')
    expect(await cell().locator('svg[aria-label="star"]').count()).toBe(1)
    expect(app.errors).toEqual([])
  })

  it('cancels with Escape and leaves the card as it was', async () => {
    const seeded = await open('rich_text', 'keep me')
    await cell().dblclick()
    await editor().waitFor()
    await area().fill('changed')
    await app.page.keyboard.press('Escape')
    await editor().waitFor({ state: 'detached' })
    expect(await storedBody(seeded)).toBe('keep me')
  })

  it('saves when focus leaves the editor', async () => {
    const seeded = await open('rich_text', 'old')
    await cell().dblclick()
    await editor().waitFor()
    await area().fill('new **text**')
    await app.page.locator('.add-row-btn').click()
    await editor().waitFor({ state: 'detached' })
    expect(await storedBody(seeded)).toBe('new **text**')
  })

  it('lists markup problems in the editor and passes axe', async () => {
    await open('rich_text', '')
    await cell().dblclick()
    await editor().waitFor()
    await area().fill('**oops {nosuchicon} {style:keyword}x{/style}')
    const problems = await editor().locator('.problems').innerText()
    expect(problems).toMatch(/nothing closes it: \*\*/)
    expect(problems).toMatch(/No icon named "nosuchicon"/)
    expect(problems).toMatch(/No text style named "keyword"/)
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('changing a field between Text and Rich text', () => {
  const typeSelect = () => app.page.locator('select[aria-label="Type of field Body"]')

  it('shows the cards that would look different first, and changes the type only on confirmation', async () => {
    const seeded = await open('text', 'a **loud** word')
    await app.menu('menu:manage-fields')
    await typeSelect().selectOption('rich_text')
    await app.page.waitForSelector('.convert')
    const panel = await app.page.locator('.convert').innerText()
    expect(panel).toMatch(/1 cards would look different/)
    expect(await app.page.locator('.convert td span[style*="font-weight"]').innerText()).toBe('loud')
    expect((await app.invoke('fields:list', seeded.set.id))[0].type).toBe('text') // nothing changed yet
    expect(await axeViolations(app.page)).toEqual([])

    await app.page.locator('.convert button:has-text("Cancel")').click()
    expect((await app.invoke('fields:list', seeded.set.id))[0].type).toBe('text')
    await typeSelect().selectOption('rich_text')
    await app.page.locator('.convert button:has-text("Change type")').click()
    await app.page.waitForSelector('.convert', { state: 'detached' })
    await app.settle()
    expect((await app.invoke('fields:list', seeded.set.id))[0].type).toBe('rich_text')
  })

  it('changes at once when no card would look different', async () => {
    const seeded = await open('text', 'plain words')
    await app.menu('menu:manage-fields')
    await typeSelect().selectOption('rich_text')
    await app.settle()
    expect(await app.page.locator('.convert').count()).toBe(0)
    expect((await app.invoke('fields:list', seeded.set.id))[0].type).toBe('rich_text')
  })
})

describe('the Rich text switch of a text element (template editor)', () => {
  it('can be turned on for a text element, and is on already for a field of the Rich text type', async () => {
    await open('text', 'x')
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click().catch(() => app.page.locator('.template-list .tpl').first().click())
    await app.page.waitForSelector('.template-editor canvas')
    await app.page.locator('.layers button[data-layer="title"]').click()
    const box = app.page.locator('.props label.inline', { hasText: 'Rich text (markup)' }).locator('input')
    await box.waitFor()
    expect(await box.isChecked()).toBe(false)
    await box.check()
    await app.page.click('button:has-text("View source")')
    await app.page.waitForSelector('textarea.svg-source')
    expect(await app.page.locator('textarea.svg-source').inputValue()).toContain('data-spadewick-rich="true"')
  })
})
