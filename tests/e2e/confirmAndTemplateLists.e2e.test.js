/**
 * UPDATES U1 and U12. U1: the application never uses the browser's own confirm() (in Electron it takes the window's keyboard focus away, so
 * the next dialog could not be typed in): every question is the application's own dialog. U12: in a set of Tarot size the Template and Card
 * back lists work, and say why they are empty when no template of that size exists.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0; app.holdConfirms(false); app.holdPrompts(false).catch(() => {}) })

const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#336699"/></svg>`
const natives = () => app.dialogs.filter(d => d.native)

async function freshProject() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `u1-${Date.now()}`, parentDir: app.root })
}

describe('questions are the application\'s own dialogs (U1)', () => {
  it('deleting a set asks in the application\'s dialog, and New Set can be typed in straight after', async () => {
    await freshProject()
    await app.invoke('sets:create', { name: 'First' })
    await app.invoke('sets:create', { name: 'Second' })
    await app.goto()
    await app.page.waitForSelector('.set-item')
    app.dialogs.length = 0
    app.holdConfirms(true)                                                  // look at the question
    await app.page.locator('.del-btn').first().click()
    const dialog = app.page.locator('[data-confirm-dialog]')
    await dialog.waitFor()
    expect(await dialog.locator('.message').innerText()).toBe('Delete this set and all its cards?')
    expect(await axeViolations(app.page)).toEqual([])
    await dialog.locator('[data-confirm-no]').click()
    expect(await app.page.locator('.set-item').count()).toBe(2)             // cancelled: nothing was deleted
    await app.page.locator('.del-btn').first().click()
    await dialog.waitFor()
    await dialog.locator('[data-confirm-yes]').click()
    app.holdConfirms(false)
    await app.page.waitForFunction(() => document.querySelectorAll('.set-item').length === 1)

    // the next dialog takes the keyboard at once
    await app.holdPrompts(true)                                             // look at the dialog, do not answer it for the test
    await app.page.click('button:has-text("+ New Set")')
    const input = app.page.locator('[role=dialog] input').first()
    await input.waitFor()
    await app.page.keyboard.type('Typed straight away')
    expect(await input.inputValue()).toBe('Typed straight away')
    expect(await app.page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
    expect(natives()).toEqual([])
  }, 30000)

  it('Escape answers no; the dialog starts on Cancel, so a stray Enter does not delete; Tab to OK and Enter answers yes', async () => {
    await freshProject()
    await app.invoke('sets:create', { name: 'Only' })
    await app.goto()
    await app.page.waitForSelector('.set-item')
    app.holdConfirms(true)
    await app.page.locator('.del-btn').first().click()
    await app.page.locator('[data-confirm-dialog]').waitFor()
    await app.page.keyboard.press('Escape')
    await app.page.locator('[data-confirm-dialog]').waitFor({ state: 'detached' })
    expect(await app.page.locator('.set-item').count()).toBe(1)
    await app.page.locator('.del-btn').first().click()
    await app.page.locator('[data-confirm-dialog]').waitFor()
    expect(await app.page.evaluate(() => document.activeElement?.getAttribute('data-confirm-no'))).not.toBe(null)   // the focus starts on Cancel
    await app.page.keyboard.press('Tab')
    await app.page.keyboard.press('Enter')
    await app.page.waitForFunction(() => document.querySelectorAll('.set-item').length === 0)
    app.holdConfirms(false)
    expect(natives()).toEqual([])
  }, 30000)

  it('the other questions too: deleting a card, a field and a template, and leaving a changed table, never open a native dialog', async () => {
    await freshProject()
    const set = await app.invoke('sets:create', { name: 'Cards', nameField: true })
    await app.raw('cards:create', { setId: set.id, fields: { name: 'A' } })
    const t = await app.invoke('templates:create', { name: 'T', svgSource: svg(500, 700), cardSize: 'poker' })
    await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    app.dialogs.length = 0
    // a card
    await app.page.locator('.row-handle').first().click()
    await app.page.locator('.card-grid').focus()
    await app.page.keyboard.press('Delete')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 0)
    // a field
    await app.page.click('button[title="Manage fields"]')
    await app.page.locator('[role=dialog] button[aria-label^="Delete field"]').first().click()
    await app.page.waitForFunction(() => document.querySelectorAll('[role=dialog] tbody tr').length === 0)
    await app.page.click('button:has-text("Done")')
    // a template
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl').first().click()
    await app.page.click('.editor-toolbar button[aria-haspopup=menu]')
    await app.page.click('[role=menu] [role=menuitem]:has-text("Delete")')
    await app.page.waitForFunction(() => document.querySelectorAll('.template-list .tpl').length === 0)
    const asked = app.dialogs.filter(d => d.type === 'confirm')
    expect(asked.length).toBe(3)
    expect(natives()).toEqual([])
    expect(t.id).toBeTruthy()
  }, 40000)
})

describe('the Template and Card back lists of a Tarot set (U12)', () => {
  async function tarotSet() {
    await freshProject()
    const set = await app.invoke('sets:create', { name: 'Tarot deck', cardSize: 'tarot' })
    await app.goto(); await app.page.click('.set-item')
    return set
  }
  const lists = () => ({ template: app.page.locator('.sidebar .template-picker select'), back: app.page.locator('.sidebar .back-picker select') })

  it('with no template of that size, says why the lists are empty, and the button opens the library', async () => {
    await tarotSet()
    await app.invoke('templates:create', { name: 'Poker frame', svgSource: svg(500, 700), cardSize: 'poker' })   // another size: not offered
    await app.page.reload(); await app.page.click('.set-item')
    expect(await lists().template.locator('option').allInnerTexts()).toEqual(['— none —'])
    expect(await lists().back.locator('option').allInnerTexts()).toEqual(['— none —'])
    expect(await app.page.locator('.sidebar .no-templates').innerText()).toMatch(/No template of this size \(.*70.*120.*\)/)
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.locator('.sidebar .library-btn').click()
    await app.page.locator('[role=dialog]').waitFor()
    expect(await app.page.locator('[role=dialog]').innerText()).toMatch(/Library|library/)
  }, 30000)

  it('offers the Tarot templates, takes a choice with the keyboard and the pointer, and follows a template that is made meanwhile', async () => {
    const set = await tarotSet()
    const a = await app.invoke('templates:create', { name: 'Tarot frame', svgSource: svg(700, 1200), cardSize: 'tarot' })
    await app.invoke('templates:create', { name: 'Tarot US frame', svgSource: svg(550, 950), cardSize: 'tarot_us' })
    await app.page.waitForFunction(() => document.querySelectorAll('.sidebar .template-picker select option').length === 2)   // seen without focusing the list
    expect(await lists().template.locator('option').allInnerTexts()).toEqual(['— none —', 'Tarot frame'])
    expect(await app.page.locator('.sidebar .no-templates').count()).toBe(0)
    await lists().template.selectOption(a.id)
    await app.page.waitForFunction(() => !window.__pending)
    expect((await app.invoke('sets:list'))[0].default_template_id).toBe(a.id)
    // with the keyboard, as a person who cannot use the pointer does
    await lists().back.focus()
    await app.page.keyboard.press('ArrowDown')
    await app.page.waitForFunction(() => !window.__pending)
    expect((await app.invoke('sets:list'))[0].default_back_template_id).toBe(a.id)
    expect(set.id).toBeTruthy()
    expect(app.errors).toEqual([])
  }, 30000)
})
