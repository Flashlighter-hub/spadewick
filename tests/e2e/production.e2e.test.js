/**
 * PRD §17: the production mode of the PDF export (settings, proof, profiles, print colours, saved settings), and the template's
 * bleed and the print guides in the canvas editor. Accessibility is checked with axe at each dialog.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startApp, axeViolations } from './harness.js'
import { PDFDocument } from 'pdf-lib'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#00ffff"/><rect y="0" width="250" height="60" fill="#000000"/><text x="125" y="40" text-anchor="middle" font-size="26" fill="#fff" data-spadewick-field="name">{{name}}</text></svg>'
const dialog = () => app.page.locator('[role=dialog]').last()

async function open() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `prod-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Deck', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'Alpha' } }, { name: 'B', fields: { name: 'Beta' } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
async function openProduction() {
  await app.menu('menu:export-pdf')
  await dialog().waitFor()
  await dialog().locator('label:has-text("A manufacturer (production)") input').check()
  await dialog().locator('.proof .stage').waitFor()
}

describe('the production export', () => {
  it('shows the settings and a proof with the colours the press cannot print, and passes axe', async () => {
    await open()
    await openProduction()
    const text = await dialog().innerText()
    expect(text).toMatch(/PDF\/X-4-style, unvalidated/)
    expect(text).toMatch(/Highest total ink/)
    expect(text).toMatch(/Colours outside the press range: [1-9]/)                       // screen cyan cannot be printed
    expect(await dialog().locator('#prod-profile option').allInnerTexts()).toEqual(['CGATS21_CRPC1 (US sheet-fed)'])
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('label:has-text("Show trim and safe lines") input').uncheck()
    expect(await dialog().locator('.g.trim').count()).toBe(0)
    expect(app.errors).toEqual([])
  })

  it('exports with the chosen settings and says what was written', async () => {
    const seeded = await open()
    const outDir = mkdtempSync(join(tmpdir(), 'e2e-prod-'))
    await openProduction()
    await dialog().locator('input.dir-input').first().fill(outDir)
    await dialog().locator('#prod-ink').fill('250')
    await dialog().locator('select:has(option[value="450"])').selectOption('150')
    await dialog().locator('label:has-text("Crop marks") input').check()
    await dialog().locator('button.primary-btn').click()
    await dialog().locator('.result-box').waitFor()
    const text = await dialog().locator('.result-box').innerText()
    expect(text).toMatch(/deck_fronts\.pdf/); expect(text).toMatch(/deck_backs\.pdf/)
    expect(text).toMatch(/not been checked by a commercial preflight tool/)
    expect(readdirSync(outDir).sort()).toEqual(['deck_backs.pdf', 'deck_fronts.pdf'])
    const doc = await PDFDocument.load(readFileSync(join(outDir, 'deck_fronts.pdf')))
    expect(doc.getSubject()).toBe('PDF/X-4-style, unvalidated')
    expect(doc.getPageCount()).toBe(2)
    expect(readFileSync(join(outDir, 'deck_fronts.pdf'), 'latin1')).toContain('/TrimBox')
    expect(app.errors).toEqual([])
    void seeded
  })

  it('saves settings under a name and applies them again; a die line asks for its name and radius', async () => {
    await open()
    await openProduction()
    await dialog().locator('#prod-ink').fill('260')
    await dialog().locator('select:has(option[value="spot"])').selectOption('spot')
    await dialog().locator('input[aria-label="Name for these settings"]').fill('Press A')
    await dialog().locator('button:has-text("Save")').first().click()
    await app.settle()
    expect((await app.invoke('exportprofiles:list', {})).map(p => [p.name, p.options.inkLimit, p.options.dieLine])).toEqual([['Press A', 260, 'spot']])
    await dialog().locator('#prod-ink').fill('300')
    await dialog().locator('select[aria-label="Saved production settings"]').selectOption({ label: 'Press A' })
    expect(await dialog().locator('#prod-ink').inputValue()).toBe('260')
    expect(await dialog().locator('label:has-text("Spot colour name") input').inputValue()).toBe('DieCut')
    expect(app.errors).toEqual([])
  })

  it('imports an output profile in the profiles dialog and offers it', async () => {
    await open()
    await openProduction()
    await dialog().locator('button:has-text("Profiles…")').click()
    const dlg = app.page.locator('[role=dialog]').last()
    await dlg.locator('table').waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    const src = join(mkdtempSync(join(tmpdir(), 'e2e-icc-')), 'press.icc')
    writeFileSync(src, readFileSync(join(process.cwd(), 'resources/profiles/CGATS21_CRPC1.icc')))
    app.mockDialog.open(src)
    await dlg.locator('button:has-text("Import profiles")').click()
    await dlg.locator('tbody tr').nth(1).waitFor()
    expect(await dlg.locator('tbody tr').count()).toBe(2)
    await dlg.locator('button:has-text("Done")').click()
    await app.page.waitForFunction(() => document.querySelectorAll('#prod-profile option').length === 2)
  })

  it('manages print colours with exact inks and a spot name, and passes axe', async () => {
    await open()
    await openProduction()
    await dialog().locator('button:has-text("Print colours…")').click()
    const dlg = app.page.locator('[role=dialog]').last()
    await dlg.locator('form').waitFor()
    await dlg.locator('form input.field').first().fill('Brand cyan')
    await dlg.locator('form input[aria-label="C ink of the new colour"]').fill('100')
    await dlg.locator('form input[aria-label="K ink of the new colour"]').fill('0')
    await dlg.locator('form button[type=submit]').click()
    await dlg.locator('tbody input[aria-label="Name of Brand cyan"]').waitFor()
    expect((await app.invoke('printcolors:list'))[0]).toMatchObject({ name: 'Brand cyan', cmyk: [100, 0, 0, 0] })
    expect(await axeViolations(app.page)).toEqual([])
    await dlg.locator('tbody input[aria-label="Spot colour name of Brand cyan"]').fill('Cyan Spot')
    await dlg.locator('tbody input[aria-label="Spot colour name of Brand cyan"]').press('Tab')
    await app.settle()
    expect((await app.invoke('printcolors:list'))[0].spotName).toBe('Cyan Spot')
  })
})

describe('template bleed and the print guides', () => {
  async function openEditor() {
    const seeded = await open()
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    return seeded
  }
  const menu = async item => { await app.page.click('.editor-toolbar button[aria-haspopup=menu]'); await app.page.click(`[role=menu] [role=menuitem]:has-text("${item}")`) }

  it('widens the canvas to include bleed, from the Bleed dialog, and the guides toggle is pressable', async () => {
    const seeded = await openEditor()
    await app.page.click('button:has-text("Trim and bleed lines")')
    await expect.poll(() => app.page.locator('button:has-text("Trim and bleed lines")').getAttribute('aria-pressed')).toBe('true')
    await menu('Bleed…')
    await dialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('label:has-text("The canvas: the template is drawn with the bleed included") input').check()
    expect(await dialog().innerText()).toMatch(/The canvas should then be 69\.5 × 94\.9 mm/)
    await dialog().locator('button:has-text("Make the canvas include this bleed")').click()
    await app.settle()
    const t = await app.invoke('templates:get', seeded.template.id)
    expect(t).toMatchObject({ bleed_mode: 'included', bleed_mm: 3 })
    expect(t.svg_source).toMatch(/viewBox="0 0 273\.622 373\.622"/)
    expect(app.errors).toEqual([])
  })

  it('stores the bleed mode and a fill colour', async () => {
    const seeded = await openEditor()
    await menu('Bleed…')
    await dialog().locator('label:has-text("A colour") input').check()
    await dialog().locator('input[type=color]').fill('#336699')
    await dialog().locator('button.primary:has-text("Save")').click()
    await app.settle()
    expect(await app.invoke('templates:get', seeded.template.id)).toMatchObject({ bleed_mode: 'fill', bleed_color: '#336699', bleed_mm: 0 })
  })
})
