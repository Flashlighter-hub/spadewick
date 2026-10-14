/**
 * PRD §16.4 to §16.6, §16.9: the icon library, text styles and keyword rules, the text check, library icons and keywords in
 * the rich text editor, and the typography controls of a text element.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startApp, axeViolations } from './harness.js'
import { seedSet, writeText } from '../helpers/project.js'

let app, dir
beforeAll(async () => { app = await startApp(); dir = mkdtempSync(join(tmpdir(), 'e2e-icons-')) })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svg = fill => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="${fill}"/></svg>`
const icon = (name, fill = '#112233') => { const p = join(dir, `${name}.svg`); writeText(p, svg(fill)); return p }
const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/>' +
  '<text data-spadewick-id="rules" x="30" y="60" width="440" height="40" font-size="30" font-family="Liberation Sans" data-spadewick-field="body" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="30" data-spadewick-text-min-size="20" fill="#fff">{{body}}</text></svg>'

async function open(body = 'Flying {star}', svgSource = TEMPLATE) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `lib-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Set', fields: [{ name: 'Body', type: 'rich_text' }], cards: [{ name: 'A', fields: { body } }], template: { svg: svgSource } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const dialog = () => app.page.locator('[role=dialog]').last()

describe('the icon library', () => {
  it('imports icons from files, lists them with usage, and passes axe', async () => {
    await open('Tap {fire}')
    await app.menu('menu:icons')
    await dialog().waitFor()
    expect(await dialog().innerText()).toMatch(/No icons yet/)
    app.mockDialog.open(icon('fire'), icon('Big Gem', '#2a7fff'))
    await dialog().locator('button:has-text("Import files")').click()
    await dialog().locator('button.tile', { hasText: 'fire' }).waitFor()
    expect(await dialog().locator('button.tile').count()).toBe(2)
    expect(await dialog().locator('button.tile', { hasText: 'big-gem' }).count()).toBe(1)
    expect(await dialog().locator('button.tile', { hasText: 'fire' }).innerText()).toMatch(/used 1/)    // the card above uses {fire}
    expect(await axeViolations(app.page)).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('filters by unused and by search, and shows the built-in icons', async () => {
    await open('Tap {fire}')
    app.mockDialog.open(icon('fire'), icon('moon'))
    await app.menu('menu:icons')
    await dialog().locator('button:has-text("Import files")').click()
    await dialog().locator('button.tile', { hasText: 'moon' }).waitFor()
    await dialog().locator('select[aria-label="Show"]').selectOption('unused')
    expect(await dialog().locator('button.tile').allInnerTexts()).toHaveLength(1)
    expect(await dialog().locator('button.tile').innerText()).toMatch(/moon/)
    await dialog().locator('select[aria-label="Show"]').selectOption('all')
    await dialog().locator('input[type=search]').fill('fir')
    expect(await dialog().locator('button.tile').count()).toBe(1)
    await dialog().locator('details.builtin summary').click()
    expect(await dialog().locator('.chip', { hasText: 'star' }).count()).toBe(1)
  })

  it('changes the settings of an icon, renames it with its uses, and deletes it with a warning', async () => {
    const seeded = await open('Tap {fire}')
    app.mockDialog.open(icon('fire'))
    await app.menu('menu:icons')
    await dialog().locator('button:has-text("Import files")').click()
    await dialog().locator('button.tile', { hasText: 'fire' }).click()
    const form = dialog().locator('section.detail')
    await form.waitFor()
    await form.locator('label:has-text("Size") input').fill('1.5')
    await form.locator('label:has-text("Size") input').press('Tab')
    await form.locator('label:has-text("Aliases") input').fill('flame, blaze')
    await form.locator('label:has-text("Aliases") input').press('Tab')
    await app.settle()
    const listed = (await app.invoke('icons:list')).icons[0]
    expect(listed).toMatchObject({ size: 1.5, aliases: ['flame', 'blaze'] })

    await form.locator('label:has-text("Name") input').first().fill('inferno')
    await form.locator('button:has-text("Rename")').click()
    await app.page.waitForFunction(async () => (await window.spadewick.icons.list()).icons[0].name === 'inferno')
    expect((await app.invoke('cards:list', seeded.set.id))[0].fields.body).toBe('Tap {inferno}')

    await form.locator('button:has-text("Delete icon")').click()
    await app.page.waitForFunction(async () => (await window.spadewick.icons.list()).icons.length === 0)
    await dialog().locator('li.dim', { hasText: 'No icons yet' }).waitFor()
    expect(app.errors).toEqual([])
  })

  it('asks before replacing an icon whose name is taken, and replacing keeps the settings', async () => {
    await open('x')
    app.mockDialog.open(icon('fire', '#c00000'))
    await app.menu('menu:icons')
    await dialog().locator('button:has-text("Import files")').click()
    await dialog().locator('button.tile', { hasText: 'fire' }).waitFor()
    const before = (await app.invoke('icons:list')).icons[0]
    app.mockDialog.open(icon('fire', '#00c000'))
    await dialog().locator('button:has-text("Import files")').click()          // the confirm is accepted by the harness
    await app.page.waitForFunction(async id => (await window.spadewick.icons.list()).icons[0].svg.includes('#00c000'), before.id)
    const after = (await app.invoke('icons:list')).icons
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
    expect(app.dialogs.some(d => d.type === 'confirm' && /already exist/.test(d.message))).toBe(true)
  })
})

describe('text styles and keyword rules', () => {
  it('creates and edits a style, and shows it in a preview', async () => {
    await open('x')
    await app.menu('menu:text-styles')
    await dialog().waitFor()
    await dialog().locator('button:has-text("New style")').click()
    await dialog().locator('section.form').waitFor()
    await dialog().locator('label.check', { hasText: 'Italic' }).locator('input').check()
    await dialog().locator('label:has-text("Colour") input[type=text], label:has-text("Colour") input:not([type=color])').first().fill('#990000')
    await dialog().locator('label:has-text("Colour") input:not([type=color])').first().press('Tab')
    await app.settle()
    const style = (await app.invoke('textstyles:list'))[0]
    expect(style.props).toMatchObject({ bold: true, italic: true, color: '#990000' })
    expect(await dialog().locator('.form .preview span[style*="#990000"]').count()).toBeGreaterThan(0)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('renames a style and what uses it', async () => {
    const seeded = await open('a {style:old}word{/style}')
    await app.invoke('textstyles:create', { name: 'old', props: { bold: true } })
    await app.menu('menu:text-styles')
    await dialog().locator('button.item').first().click()
    await dialog().locator('section.form label:has-text("Name") input').first().fill('fresh')
    await dialog().locator('section.form button:has-text("Rename")').click()
    await app.page.waitForFunction(async () => (await window.spadewick.textStyles.list())[0].name === 'fresh')
    expect((await app.invoke('cards:list', seeded.set.id))[0].fields.body).toBe('a {style:fresh}word{/style}')
  })

  it('adds a keyword rule, previews it, reorders and deletes it, and passes axe', async () => {
    await open('x')
    await app.invoke('textstyles:create', { name: 'kw', props: { bold: true, color: '#cc3333' } })
    await app.menu('menu:text-styles')
    await dialog().locator('button[role=tab]:has-text("Keyword rules")').click()
    await dialog().locator('button:has-text("Add rule")').click()
    await dialog().locator('li.rule').waitFor()
    expect(await dialog().locator('li.rule .preview span[style*="#cc3333"]').count()).toBeGreaterThan(0)   // "Flying" in the sample
    await dialog().locator('button:has-text("Add rule")').click()
    await app.page.waitForFunction(async () => (await window.spadewick.keywords.list()).length === 2)
    const first = dialog().locator('li.rule').first()
    await first.locator('input').nth(1).fill('Haste')
    await first.locator('input').nth(1).press('Tab')
    await app.page.waitForFunction(async () => (await window.spadewick.keywords.list())[0].match === 'Haste')
    await dialog().locator('li.rule').first().locator('button[aria-label^="Move the rule"][aria-label$="down"]').click()
    await app.page.waitForFunction(async () => (await window.spadewick.keywords.list())[1].match === 'Haste')
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('li.rule').last().locator('button[aria-label^="Delete the rule"]').click()
    await app.page.waitForFunction(async () => (await window.spadewick.keywords.list()).length === 1)
    expect(app.errors).toEqual([])
  })
})

describe('the text check', () => {
  it('lists what is wrong with the cards that have it, and passes axe', async () => {
    await open('Tap {nosuch} and **oops')
    await app.menu('menu:check-text')
    await dialog().locator('table').waitFor()
    const text = await dialog().innerText()
    expect(text).toMatch(/There is no icon named "nosuch"/)
    expect(text).toMatch(/nothing closes it: \*\*/)
    expect(text).toMatch(/Checked 1 cards: 1 errors, 1 warnings/)
    await dialog().locator('label:has-text("Only errors") input').check()
    expect(await dialog().locator('tbody tr').count()).toBe(1)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('says so when nothing is wrong', async () => {
    await open('all fine')
    await app.menu('menu:check-text')
    await dialog().locator('.ok').waitFor()
    expect(await dialog().innerText()).toMatch(/No problems found/)
  })
})

describe('the rich text editor with the library', () => {
  it('lists library icons and keywords, and inserts them', async () => {
    const seeded = await open('')
    await app.invoke('icons:import-files', { paths: [icon('fire')] })
    await app.invoke('keywords:create', { match: 'Trample', mode: 'replace', action: { text: 'Smash' } })
    await app.goto()
    await app.page.click('.set-item')
    await app.page.waitForSelector('.grid-row')
    const cell = app.page.locator('.grid-row').first().locator('.cell[data-col="body"]')
    await cell.dblclick()
    const editor = app.page.locator('[role=dialog][aria-label="Edit Body"]')
    await editor.waitFor()
    await editor.locator('button[aria-label="Insert icon"]').click()
    expect(await editor.locator('button[aria-label="fire"]').count()).toBe(1)           // from the library
    expect(await editor.locator('button[aria-label="star"]').count()).toBe(1)           // built in
    await editor.locator('button[aria-label="fire"]').click()
    await editor.locator('button[aria-label="Insert keyword"]').click()
    await editor.locator('button:has-text("Trample")').click()
    expect(await editor.locator('textarea').inputValue()).toBe('{icon:fire}Trample')
    expect(await editor.locator('.preview').innerText()).toContain('Smash')                // the rule shows in the preview
    await app.page.keyboard.press('Control+Enter')
    await editor.waitFor({ state: 'detached' })
    expect((await app.invoke('cards:list', seeded.set.id))[0].fields.body).toBe('{icon:fire}Trample')
  })
})

describe('the typography controls', () => {
  async function select() {
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl').first().click()
    await app.page.waitForSelector('.template-editor canvas')
    await app.page.locator('.layers button[data-layer="rules"]').click()
    await app.page.locator('.props details.typo').waitFor()
  }
  const source = async () => { await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source'); const v = await app.page.locator('textarea.svg-source').inputValue(); await app.page.click('[role=dialog] button:has-text("Done")'); return v }

  it('writes each control as an attribute of the element, and removes it when emptied', async () => {
    await open('x')
    await select()
    const props = app.page.locator('.props')
    await props.locator('label:has-text("Line height") input').fill('18pt')
    await props.locator('label:has-text("Line height") input').press('Tab')
    await props.locator('label:has-text("Alignment") select, label:has-text("Align") select').first().selectOption('justify')
    await props.locator('label:has-text("Paragraph spacing") input').fill('0.5')
    await props.locator('label:has-text("Paragraph spacing") input').press('Tab')
    await props.locator('label:has-text("Vertical alignment") select').selectOption('middle')
    await props.locator('label:has-text("Text transform") select').selectOption('title')
    await props.locator('label.inline:has-text("Balance lines") input').check()
    await props.locator('label:has-text("Letter spacing (1/1000 em)") input').fill('20')
    await props.locator('label:has-text("Letter spacing (1/1000 em)") input').press('Tab')
    await props.locator('label:has-text("Outline") input').fill('2 #000000')
    await props.locator('label:has-text("Outline") input').press('Tab')
    await app.settle()
    const src = await source()
    for (const expected of ['data-spadewick-line-height="18pt"', 'data-spadewick-text-align="justify"', 'data-spadewick-paragraph-spacing="0.5"', 'data-spadewick-valign="middle"',
      'data-spadewick-text-transform="title"', 'data-spadewick-balance="true"', 'letter-spacing="0.02em"', 'data-spadewick-outline="2 #000000"']) expect(src).toContain(expected)
    await props.locator('label.inline:has-text("Balance lines") input').uncheck()
    await app.settle()
    expect(await source()).not.toContain('data-spadewick-balance')
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('offers the auto-fit options for shrink, and warns when the text cannot fit', async () => {
    await open('word '.repeat(60))
    await select()
    const props = app.page.locator('.props')
    await props.locator('label:has-text("Auto-fit step") select').selectOption('0.5')
    await props.locator('label:has-text("Tighten letter spacing first") input').fill('3')
    await props.locator('label:has-text("Tighten letter spacing first") input').press('Tab')
    await props.locator('label:has-text("Maximum lines") input').fill('1')
    await props.locator('label:has-text("Maximum lines") input').press('Tab')
    await app.settle()
    const src = await source()
    expect(src).toContain('data-spadewick-text-step="0.5"')
    expect(src).toContain('data-spadewick-tighten="3"')
    expect(src).toContain('data-spadewick-text-max-lines="1"')
    await app.page.waitForSelector('.props .warn:has-text("does not fit")', { timeout: 10000 })   // 60 words in one line at 20 px at most
  })
})
