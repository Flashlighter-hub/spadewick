/**
 * Text on the canvas (A80): applying and saving text styles, and editing the words of a text where it sits.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
  + '<text data-spadewick-id="t" x="60" y="200" font-size="40" fill="#000000">Hello</text>'
  + '<text data-spadewick-id="n" data-spadewick-field="name" x="60" y="300" width="300" height="60" font-size="30" fill="#000000">{{name}}</text>'
  + '</svg>'

async function openEditor() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `txt-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'Card name' } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
async function show() {
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top } })
const sourceText = async () => {
  await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
  const t = await app.page.locator('textarea.svg-source').inputValue()
  await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
  return t
}
const tagOf = (src, id) => new RegExp(`<[a-z]+[^>]*data-spadewick-id="${id}"[^>]*>`).exec(src)?.[0] ?? ''
const attr = (src, id, name) => new RegExp(` ${name}="([^"]*)"`).exec(tagOf(src, id))?.[1] ?? null
const click = async (x, y) => { const h = await host(); await app.page.mouse.click(h.x + x, h.y + y) }

describe('text styles', () => {
  beforeEach(async () => {
    await openEditor()
    await app.invoke('textstyles:create', { name: 'heading', props: { bold: true, color: '#aa0000', tracking: 30, italic: true } })
    await show()
  })

  it('applies a style as a copy of its values on the text', async () => {
    await click(80, 185)
    await app.page.waitForSelector('.props-title:has-text("t")')
    const pick = app.page.locator('.props label:has-text("Text style") select')
    await pick.selectOption({ label: 'heading' })
    await expect.poll(async () => attr(await sourceText(), 't', 'fill'), { timeout: 5000 }).toBe('#aa0000')
    const src = await sourceText()
    expect(attr(src, 't', 'font-weight')).toBe('bold')
    expect(attr(src, 't', 'font-style')).toBe('italic')
    expect(attr(src, 't', 'letter-spacing')).toBe('0.03em')
    expect(await pick.inputValue()).toBe('')                                      // the menu goes back to "Apply a style"
    // a copy: the template does not depend on the style any more
    const [style] = await app.invoke('textstyles:list')
    await app.invoke('textstyles:remove', style.id)
    expect(attr(await sourceText(), 't', 'font-weight')).toBe('bold')
  })

  it('saves the look of a text as a new style, ready to apply to another', async () => {
    await click(80, 185)
    await app.page.waitForSelector('.props-title:has-text("t")')
    await app.page.locator('.props label:has-text("Weight") select').selectOption('bold')
    await expect.poll(async () => attr(await sourceText(), 't', 'font-weight'), { timeout: 5000 }).toBe('bold')
    app.answer('shout')
    await app.page.click('.props button:has-text("Save as style")')
    await app.page.locator('.toast:has-text("Saved the text style")').waitFor()
    const styles = await app.invoke('textstyles:list')
    expect(styles.map(s => s.name)).toContain('shout')
    expect(styles.find(s => s.name === 'shout').props).toMatchObject({ bold: true })
    expect(await app.page.locator('.props label:has-text("Text style") option').allInnerTexts()).toContain('shout')
  })

  it('passes axe', async () => {
    await click(80, 185)
    await app.page.waitForSelector('.props-title:has-text("t")')
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('typing on the canvas', () => {
  beforeEach(async () => { await openEditor(); await show() })
  const editor = () => app.page.locator('textarea.inline-edit')
  const dbl = async (x, y) => { const h = await host(); await app.page.mouse.dblclick(h.x + x, h.y + y) }

  it('a double click opens the words where they sit, and clicking away keeps what was typed, as one step of undo', async () => {
    await dbl(80, 185)                                          // the "Hello" text
    await editor().waitFor()
    expect(await editor().inputValue()).toBe('Hello')
    await app.page.keyboard.type('Brand new words')              // the old words were selected
    await click(400, 600)                                        // empty canvas
    await expect.poll(async () => (await sourceText()).includes('>Brand new words</text>'), { timeout: 5000 }).toBe(true)
    expect(await editor().count()).toBe(0)
    await app.menu('menu:undo')
    await expect.poll(async () => (await sourceText()).includes('>Hello</text>'), { timeout: 5000 }).toBe(true)
  })

  it('Enter on a selected text starts typing; Enter inside is a new line; Ctrl+Enter finishes', async () => {
    await click(80, 185)
    await app.page.waitForSelector('.props-title:has-text("t")')
    await app.page.mouse.move(600, 500)
    await app.page.keyboard.press('Enter')
    await editor().waitFor()
    await app.page.keyboard.type('One')
    await app.page.keyboard.press('Enter')
    await app.page.keyboard.type('Two')
    await app.page.keyboard.press('Control+Enter')
    await expect.poll(async () => (await sourceText()).includes('>One' + String.fromCharCode(10) + 'Two</text>'), { timeout: 5000 }).toBe(true)
  })

  it('Escape finishes too and keeps the words; nothing is written when nothing changed', async () => {
    await dbl(80, 185)
    await editor().waitFor()
    await app.page.keyboard.press('Escape'); await editor().waitFor({ state: 'detached' })
    const before = await sourceText()
    expect(before.includes('>Hello</text>')).toBe(true)
    await dbl(80, 185)
    await editor().waitFor()
    await app.page.keyboard.type('Changed')
    await app.page.keyboard.press('Escape')
    await expect.poll(async () => (await sourceText()).includes('>Changed</text>'), { timeout: 5000 }).toBe(true)
  })

  it('a text that shows a field is not typed on: it says where its words come from', async () => {
    await dbl(100, 330)                                          // the {{name}} text
    await app.page.locator('.toast:has-text("shows a field")').waitFor()
    expect(await editor().count()).toBe(0)
  })

  it('follows the zoom: the box and its letters are as big as the text on screen', async () => {
    await app.page.locator('.zoombar select').selectOption('2')
    const h = await host()
    await app.page.mouse.dblclick(h.x + 80 * 2, h.y + 185 * 2)
    await editor().waitFor()
    expect(await editor().evaluate(n => parseFloat(getComputedStyle(n).fontSize))).toBe(80)         // 40 units at 200%
    await app.page.keyboard.press('Escape')
  })

  it('a new text in a project with no text field is typed straight away', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `nofield-${Date.now()}`, parentDir: app.root })
    const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [], cards: [{}], template: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/></svg>' } })
    await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
    await show()
    await app.page.click('button[title^="Text"]')
    await click(100, 100)
    await editor().waitFor()
    expect(await editor().inputValue()).toBe('Text')
    await app.page.keyboard.type('Typed at once')
    await app.page.keyboard.press('Control+Enter')
    await expect.poll(async () => (await sourceText()).includes('>Typed at once</text>'), { timeout: 5000 }).toBe(true)
  })

  it('passes axe while typing', async () => {
    await dbl(80, 185)
    await editor().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
  })
})
