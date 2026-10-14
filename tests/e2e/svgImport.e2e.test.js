/**
 * PRD §19: the Import SVG dialog (size, clean-up report, binding review), by keyboard where it matters and with axe at every
 * step, the result in the template editor, and Re-import design.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { startApp, axeViolations } from './harness.js'
import { seedSet, makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const FIX = name => join(process.cwd(), 'tests/fixtures/svgImport', `${name}.svg`)
const dialog = () => app.page.locator('[role=dialog]').last()

async function openEditor() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `svg-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({
    name: 'Cards', cardSize: 'poker',
    fields: [{ name: 'Name', type: 'text' }, { name: 'Mana cost', type: 'text' }, { name: 'Rules', type: 'rich_text' }, { name: 'Art', type: 'image_ref' }],
    cards: [{ name: 'Existing', fields: { name: 'Existing' } }]
  })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.waitForSelector('.template-editor')
  return seeded
}
const start = async (...files) => {
  app.mockDialog.open(...files.map(FIX))
  await app.page.locator('.list-foot button:has-text("Import SVG")').click()
  await dialog().waitFor()
  await dialog().locator('.preview img').waitFor()
}
const next = () => dialog().locator('button:has-text("Next")').click()

describe('Import SVG', () => {
  it('walks through size, clean-up and binding, with no accessibility violations at any step', async () => {
    await openEditor()
    await start('figma')
    expect(await dialog().innerText()).toMatch(/The file is 744 × 1039 units/)
    expect(await dialog().locator('select').first().inputValue()).toBe('poker')                // proposed from the shape of the design
    expect(await axeViolations(app.page)).toEqual([])
    await next()
    const text = await dialog().innerText()
    expect(text).toMatch(/1 hidden layer/)
    expect(text).toMatch(/Inter/); expect(text).toMatch(/missing/)
    expect(text).toMatch(/pattern fill/)
    expect(await axeViolations(app.page)).toEqual([])
    await next()
    const rows = dialog().locator('table.rows tbody tr')
    expect(await rows.count()).toBeGreaterThan(5)
    const nameRow = rows.filter({ hasText: /^\s*Name\b/ }).first()
    expect(await nameRow.locator('input[type=checkbox]').isChecked()).toBe(true)                // an exact match is pre-checked
    const copy = rows.filter({ hasText: 'Name_1' })
    expect(await copy.locator('input[type=checkbox]').isChecked()).toBe(false)                  // a close match waits for the person
    expect(await copy.innerText()).toMatch(/a copy of the name/)
    expect(await axeViolations(app.page)).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('selecting a row outlines the element in the preview; the guide opens', async () => {
    await openEditor()
    await start('figma')
    await next(); await next()
    expect(await dialog().locator('.hl').count()).toBe(0)
    await dialog().locator('table.rows tbody tr').filter({ hasText: /^\s*Name\b/ }).first().locator('input[type=checkbox]').focus()
    await dialog().locator('.hl').waitFor()
    await dialog().locator('details.guide summary').click()
    expect(await dialog().innerText()).toMatch(/Name your layers after your fields/)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('imports by keyboard: the exact matches are bound, the template opens in the editor, fields and a sample card are made', async () => {
    const seeded = await openEditor()
    await start('illustrator')
    await dialog().locator('input.field').first().fill('Illustrated')
    await next(); await next()
    await dialog().locator('button:has-text("Import")').last().click()
    await app.page.locator('.template-list .tpl', { hasText: 'Illustrated' }).waitFor()
    await app.settle()
    const templates = await app.invoke('templates:list')
    const t = templates.find(x => x.name === 'Illustrated')
    expect(t).toBeTruthy()
    const full = await app.invoke('templates:get', t.id)
    expect(full.svg_source).toContain('data-spadewick-field="name"')
    expect(JSON.parse(full.origin).source).toBe('svg-import')
    // the design's picture is in the asset library and the set has a sample card
    expect((await app.invoke('assets:list')).length).toBe(1)
    expect((await app.invoke('cards:list', seeded.set.id)).length).toBe(1)                      // the set already had a card: no sample card is added
    expect(await app.page.locator('.template-editor canvas').count()).toBeGreaterThan(0)
    expect(app.errors).toEqual([])
  })

  it('creates a field from a layer and maps a missing font', async () => {
    const seeded = await openEditor()
    await start('sketch')
    await next()
    await dialog().locator('select[aria-label="Font to use instead of Helvetica"]').selectOption('Liberation Sans')
    await next()
    const row = dialog().locator('table.rows tbody tr').filter({ hasText: 'Effect' })
    await row.locator('select').selectOption('new')
    await row.locator('input.newname').fill('Effect text')
    await row.locator('input[type=checkbox]').check()
    await dialog().locator('button:has-text("Import")').last().click()
    await app.page.locator('.template-list .tpl').first().waitFor()
    await app.settle()
    const fields = await app.invoke('fields:list', seeded.set.id)
    expect(fields.map(f => f.slug)).toContain('effect_text')
    const t = (await app.invoke('templates:list')).find(x => x.name === 'sketch')
    const svg = (await app.invoke('templates:get', t.id)).svg_source
    expect(svg).toContain('{{effect_text}}')
    expect(svg).not.toContain('Helvetica')
  })

  it('refuses a file that is not an SVG with a message', async () => {
    await openEditor()
    const bad = join(mkdtempSync(join(tmpdir(), 'e2e-svg-')), 'x.svg')
    writeFileSync(bad, 'not xml')
    app.mockDialog.open(bad)
    await app.page.locator('.list-foot button:has-text("Import SVG")').click()
    await dialog().locator('[role=alert]').waitFor()
    expect(await dialog().innerText()).toMatch(/not an SVG file/)
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('several files and linked pictures', () => {
  it('imports several files in turn, and a missing linked picture can be located', async () => {
    await openEditor()
    const dir = mkdtempSync(join(tmpdir(), 'e2e-svg-'))
    const linked = join(dir, 'linked.svg')
    writeFileSync(linked, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="180" height="252" viewBox="0 0 180 252"><image id="Art" x="0" y="0" width="100" height="100" xlink:href="elsewhere/pic.png"/></svg>')
    const pic = await makePng(join(dir, 'pic.png'), 20, 20, '#00aa00')
    app.mockDialog.open(linked, FIX('sketch'))
    await app.page.locator('.list-foot button:has-text("Import SVG")').click()
    await dialog().locator('.preview img').waitFor()
    expect(await dialog().innerText()).toMatch(/File 1 of 2: linked\.svg/)
    await next()
    expect(await dialog().innerText()).toMatch(/not found: a grey box is left/)
    app.mockDialog.open(pic)
    await dialog().locator('button:has-text("Locate")').click()
    await dialog().locator('text=found next to the file').waitFor()
    await next()
    await dialog().locator('button:has-text("Import")').last().click()
    await dialog().locator('text=File 2 of 2').waitFor()
    await dialog().locator('button:has-text("Skip this file")').click()
    await dialog().waitFor({ state: 'detached' })
    await app.settle()
    expect((await app.invoke('templates:list')).map(t => t.name)).toEqual(['linked'])
    expect((await app.invoke('assets:list')).length).toBe(1)
    expect(app.errors).toEqual([])
  })
})

describe('Re-import design', () => {
  it('shows what changed, keeps the bindings and replaces the template', async () => {
    await openEditor()
    await start('figma')
    await next(); await next()
    await dialog().locator('button:has-text("Import")').last().click()
    await app.page.locator('.template-list .tpl', { hasText: 'figma' }).waitFor()
    await app.page.locator('.template-list .tpl', { hasText: 'figma' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    const dir = mkdtempSync(join(tmpdir(), 'e2e-svg-'))
    const next2 = join(dir, 'figma2.svg')
    writeFileSync(next2, readFileSync(FIX('figma'), 'utf8').replace('<tspan x="60" y="104.8">Fireball', '<tspan x="90" y="150">Fireball').replace('<text id="Name"', '<text id="Name" x="90" y="150"'))
    app.mockDialog.open(next2)
    await app.page.click('.editor-toolbar button[aria-haspopup=menu]')
    await app.page.click('[role=menu] [role=menuitem]:has-text("Re-import design")')
    await dialog().locator('.preview img').waitFor()
    expect(await dialog().innerText()).toMatch(/cannot change/)                                   // the size is locked
    await next(); await next()
    expect(await dialog().innerText()).toMatch(/Moved or resized:\s*Name/)
    const rows = dialog().locator('table.rows tbody tr')
    expect(await rows.filter({ hasText: 'kept from the last import' }).count()).toBeGreaterThan(2)
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('button:has-text("Re-import")').last().click()
    await app.settle()
    await dialog().waitFor({ state: 'detached' })
    const t = (await app.invoke('templates:list')).find(x => x.name === 'figma')
    expect((await app.invoke('templates:get', t.id)).svg_source).toContain('x="90"')
    expect(app.errors).toEqual([])
  })
})
