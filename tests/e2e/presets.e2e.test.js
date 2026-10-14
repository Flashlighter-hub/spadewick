/**
 * PRD §18: the Preset menu of the export dialog (production PDF and per-card images), the "Custom (based on …)" label, the notes
 * about what was not confirmed and the card size, the presets dialog (duplicate, edit, remove, import and export), and the preflight
 * rules of a preset. Accessibility is checked with axe at each step.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#f4ebd0"/><text data-spadewick-id="t" data-spadewick-field="name" x="40" y="60" font-size="24" fill="#222">{{name}}</text></svg>'
const dialog = () => app.page.locator('[role=dialog]').last()

async function open(cardSize = 'poker', cards = 2) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `pre-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Deck', cardSize, fields: [{ name: 'Name', type: 'text' }], cards: Array.from({ length: cards }, (_, i) => ({ name: `Card ${i + 1}`, fields: { name: `C${i}` } })), template: { svg: TPL } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const openProduction = async () => {
  await app.menu('menu:export-pdf')
  await dialog().waitFor()
  await dialog().locator('label:has-text("A manufacturer (production)") input').check()
  await dialog().locator('.pre').waitFor()
}

describe('the Preset menu of the production PDF', () => {
  it('fills the settings, shows where the values come from and what was not confirmed, and passes axe', async () => {
    await open()
    await openProduction()
    await app.page.waitForFunction(() => document.querySelectorAll('#preset-menu option').length === 8)   // none + the seven that apply to PDF
    await dialog().locator('#preset-menu').selectOption('panda-cards')
    await dialog().locator('.info').waitFor()
    const text = await dialog().locator('.bar').innerText()
    expect(text).toMatch(/read on 2026-10-02/)
    expect(text).toMatch(/Not proof-tested/)
    expect(text).toMatch(/Read the manufacturer's current artwork guide and order a proof copy/)
    expect(text).toMatch(/Not confirmed with the manufacturer's guide.*die line, deck size rules/)
    expect(text).toMatch(/expects the profile U\.S\. Sheetfed Uncoated v2/)
    expect(text).toMatch(/pure black text, overprint of black/)
    expect(await dialog().locator('select[aria-label="Standard"], #prod-intent').count()).toBeGreaterThan(0)
    expect(await dialog().locator('label:has-text("PDF/X-4:2008") input').isChecked()).toBe(true)
    expect(await dialog().locator('label:has-text("Spot colour name") input').inputValue()).toBe('DieCut')
    expect(await axeViolations(app.page)).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('turns the label into "Custom (based on …)" when a setting is changed, and back when it is put right', async () => {
    await open()
    await openProduction()
    await dialog().locator('#preset-menu').selectOption('generic-offset-metric')
    expect(await dialog().locator('.custom').count()).toBe(0)
    await dialog().locator('label:has-text("Bleed") input[type=number]').first().fill('4')
    await dialog().locator('.custom').waitFor()
    expect(await dialog().locator('.custom').innerText()).toBe('Custom (based on Generic offset printer, metric)')
    await dialog().locator('label:has-text("Bleed") input[type=number]').first().fill('3')
    await app.page.waitForFunction(() => !document.querySelector('.custom'))
  })

  it('warns when the card size is not one the manufacturer offers', async () => {
    await open('tarot')
    await openProduction()
    await dialog().locator('#preset-menu').selectOption('dtc-poker')
    await dialog().locator('.bar [role=alert]').waitFor()
    expect(await dialog().locator('.bar [role=alert]').innerText()).toMatch(/lists these card sizes: poker\. This set is tarot; check with the manufacturer/)
    await dialog().locator('.pre').getByText(/The preset DriveThruCards, poker lists these card sizes/).waitFor()
    expect(await dialog().locator('.pre').innerText()).toMatch(/The preset DriveThruCards, poker lists these card sizes: poker\. This set is tarot/)
  })

  it('the preset\'s deck rule shows in the preflight', async () => {
    const s = await open('poker', 10)
    // a preset of the person's own with a rule: multiples of 9
    const mine = await app.invoke('presets:duplicate', { id: 'generic-offset-metric', name: 'Nine' })
    await app.invoke('presets:save', { ...mine, deck: { multiple: 9 } })
    await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    await openProduction()
    await dialog().locator('#preset-menu').selectOption('nine')
    await dialog().locator('.pre').getByText('prints in multiples of 9').waitFor()
    expect(await dialog().locator('.pre').innerText()).toMatch(/add 8 or remove 1/)
    void s
  })
})

describe('the presets dialog', () => {
  it('duplicates a preset, edits the copy, exports it, removes it, and imports a file', async () => {
    await open()
    await openProduction()
    await dialog().locator('button:has-text("Presets…")').click()
    const dlg = app.page.locator('[role=dialog]').last()
    await dlg.locator('table tbody tr').nth(8).waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await dlg.locator('button[aria-label="Duplicate Generic offset printer, metric"]').click()
    await dlg.locator('form.edit').waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await dlg.locator('form.edit label:has-text("Bleed (mm)") input').fill('2.5')
    await dlg.locator('form.edit label:has-text("Cards come in multiples of") input').fill('9')
    await dlg.locator('form.edit button.primary:has-text("Save")').click()
    await app.settle()
    const saved = (await app.invoke('presets:list')).presets.find(p => !p.shipped)
    expect(saved).toMatchObject({ name: 'Copy of Generic offset printer, metric', bleedMm: 2.5, deck: { multiple: 9 }, basedOn: 'generic-offset-metric' })
    const file = join(mkdtempSync(join(tmpdir(), 'e2e-preset-')), 'mine.json')
    app.mockDialog.save(file)
    await dlg.locator('button[aria-label^="Export Copy of"]').click()
    await app.settle()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ id: saved.id, bleedMm: 2.5 })
    app.declineNextConfirm?.()
    await dlg.locator('button[aria-label^="Delete Copy of"]').click()
    app.mockDialog.open(file)
    await dlg.locator('button:has-text("Import a preset")').click()
    await app.settle()
    expect((await app.invoke('presets:list')).presets.filter(p => !p.shipped).length).toBeGreaterThanOrEqual(2)
    expect(app.errors).toEqual([])
  })
})

describe('per-card images for a print service', () => {
  it('uses a preset\'s pixel size and writes the cards and one back', async () => {
    await open('poker', 2)
    const outDir = mkdtempSync(join(tmpdir(), 'e2e-img-'))
    await app.menu('menu:export-png')
    await dialog().waitFor()
    await dialog().locator('label:has-text("Per-card images for a print service") input').check()
    await dialog().locator('#preset-menu').waitFor()
    await app.page.waitForFunction(() => document.querySelectorAll('#preset-menu option').length === 5)   // none + the four that apply to images
    await dialog().locator('#preset-menu').selectOption('tgc-poker')
    await dialog().locator('text=Each image will be 825 × 1125 px.').waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('label:has-text("Resolution (dpi)") input').fill('150')
    await dialog().locator('text=Each image will be 413 × 563').waitFor()
    await dialog().locator('label:has-text("Resolution (dpi)") input').fill('300')
    await dialog().locator('input.dir-input').first().fill(outDir)
    await dialog().locator('button.primary-btn').click()
    await dialog().locator('.result-box').waitFor()
    const files = readdirSync(outDir).sort()
    expect(files).toHaveLength(3)
    expect(files.filter(f => /_back\.png$/.test(f))).toHaveLength(1)
    const m = await sharp(join(outDir, files[0])).metadata()
    expect([m.width, m.height]).toEqual([825, 1125])
    expect(await dialog().locator('.result-box').innerText()).toMatch(/Each image is 825 × 1125 px/)
    expect(app.errors).toEqual([])
    void writeFileSync
  })

  it('runs the print readiness check, holds the export back on errors and lets the person go ahead', async () => {
    await open('poker', 2)
    const outDir = mkdtempSync(join(tmpdir(), 'e2e-imgpre-'))
    await app.menu('menu:export-png')
    await dialog().waitFor()
    await dialog().locator('label:has-text("Per-card images for a print service") input').check()
    await dialog().locator('.pre [role=status]').waitFor()
    await dialog().locator('label:has-text("Bleed") input').first().fill('0')
    await dialog().locator('.pre [role=alert]:has-text("There are errors")').waitFor()
    expect(await dialog().locator('.pre [role=status]').innerText()).toMatch(/[1-9]\d* errors?/)
    await dialog().locator('input.dir-input').first().fill(outDir)
    expect(await dialog().locator('button.primary-btn').isDisabled()).toBe(true)
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('label:has-text("Export anyway") input').check()
    expect(await dialog().locator('button.primary-btn').isDisabled()).toBe(false)
    await dialog().locator('button.primary-btn').click()
    await dialog().locator('.result-box').waitFor()
    expect(readdirSync(outDir).length).toBe(3)
    expect(app.errors).toEqual([])
  })
})
