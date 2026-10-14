/**
 * PRD §7.7: templates are made, kept and exchanged from the Template Editor (there is no separate "Manage Templates"
 * window). The library dialog opens from the editor, and shows only templates of the active set's card size (§10.6).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

async function freshProject(opts = {}) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `tm-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Creatures', fields: [{ name: 'Cost', type: 'text' }], cards: [{ name: 'Orc' }], ...opts })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const dialog = () => app.page.locator('[role=dialog]')
const toEditor = () => app.page.click('button[role=tab]:has-text("Template Editor")')
const openLibrary = async () => { await toEditor(); await app.page.click('button:has-text("Library…")'); await dialog().waitFor() }
const tile = name => dialog().locator('.entry', { has: app.page.locator(`h4:text-is("${name}")`) })
const listed = () => app.page.locator('.template-list .tpl').allInnerTexts().then(t => t.map(x => x.trim()))
const chooseTemplate = async name => { await app.page.locator('.template-list .tpl', { hasText: name }).click(); await app.page.waitForSelector('.template-editor canvas') }
const menu = async item => { await app.page.click('.editor-toolbar button[aria-haspopup=menu]'); await app.page.click(`[role=menu] [role=menuitem]:has-text("${item}")`) }

describe('there is one place for templates: the Template Editor', () => {
  it('has no Manage Templates menu entry and no palette dialog any more', async () => {
    await freshProject()
    expect(await app.menu('menu:manage-templates').then(() => dialog().count())).toBe(0)   // nothing listens for it
    expect(await app.menu('menu:manage-palette').then(() => dialog().count())).toBe(0)
  })

  it('opens the library from the editor, showing only templates of the set\'s card size', async () => {
    await freshProject()
    await openLibrary()
    expect(await dialog().innerText()).toMatch(/Showing templates for the active set's card size: Poker/)
    await app.page.waitForSelector('.entry.tile')
    // Poker: the blank frame, the poker-size examples and the poker card backs; tarot and the other sizes are not offered
    const names = await dialog().locator('.entry.tile h4').allInnerTexts()
    expect(names).toEqual(expect.arrayContaining(['Playing card', 'Creature card (with a shared frame)', 'Quest card', 'Action card (modern)', 'Card back (classic lattice)', 'Card back (glow)']))
    expect(names.filter(n => /^Blank frame — Poker/.test(n))).toHaveLength(1)
    expect(names.some(n => /tarot|oracle/i.test(n))).toBe(false)
    expect(names).toHaveLength(7)
    expect(await dialog().locator('.entry.tile img').first().getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('uses a starter template in the active set: it opens in the editor with an origin and sample cards', async () => {
    const { set } = await freshProject()
    await openLibrary()
    await tile('Playing card').locator('button.primary').click()
    await app.page.waitForSelector('text=Which set should get its fields?')
    await dialog().locator('input[type=radio][value=existing]').check()
    await dialog().locator('select[aria-label="An existing set:"]').selectOption(set.id)
    await app.page.waitForFunction(() => !document.querySelector('[role=dialog] button.primary')?.disabled)
    await dialog().locator('button.primary', { hasText: 'Use template' }).click()
    await app.page.waitForSelector('.toast:has-text("was added to the project")')
    await dialog().waitFor({ state: 'detached' })                                  // the dialog closes: the template is ready in the editor
    expect(await listed()).toEqual(['Playing card'])
    expect(await app.page.locator('.editor-toolbar strong').innerText()).toBe('Playing card')   // and is already open
    const [t] = await app.invoke('templates:list')
    expect(JSON.parse((await app.invoke('templates:get', t.id)).origin)).toMatchObject({ source: 'library', kind: 'starter', name: 'Playing card' })
    expect((await app.invoke('cards:list', set.id)).length).toBeGreaterThan(1)       // the sample cards came with it
    expect(app.errors).toEqual([])
  })

  it('"New set from template" makes a set of the template\'s card size with the template as its default', async () => {
    await freshProject()
    await app.page.click('button:has-text("New Set from Template")')
    await dialog().waitFor()
    expect(await dialog().innerText()).toMatch(/Showing templates of every card size/)
    expect(await dialog().locator('.entry.tile').count()).toBeGreaterThan(14)        // 12 blank frames + 3 examples
    await tile('Tarot card with collector number').locator('button.primary').click()
    await dialog().locator('input.inline').fill('Major Arcana')
    await app.page.waitForFunction(() => !document.querySelector('[role=dialog] button.primary')?.disabled)
    await dialog().locator('button.primary', { hasText: 'Use template' }).click()
    await app.page.waitForSelector('.toast:has-text("was added to the project")')
    const deck = (await app.invoke('sets:list')).find(s => s.name === 'Major Arcana')
    expect(deck).toMatchObject({ card_size: 'tarot' })
    expect(deck.default_template_id).toBeTruthy()
    expect(await app.page.locator('.set-item', { hasText: 'Major Arcana' }).count()).toBe(1)
  })

  it('asks for a decision on every clash before anything is copied', async () => {
    const { set } = await freshProject()    // the set has a "Cost" text field; the creature example wants a number
    await openLibrary()
    await tile('Creature card (with a shared frame)').locator('button.primary').click()
    await dialog().locator('input[type=radio][value=existing]').check()
    await dialog().locator('select[aria-label="An existing set:"]').selectOption(set.id)
    await app.page.waitForSelector('text=These need your decision')
    const use = dialog().locator('button.primary', { hasText: 'Use template' })
    expect(await use.isDisabled()).toBe(true)
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('select[aria-label="What to do about cost"]').selectOption('rename')
    expect(await use.isDisabled()).toBe(false)
    await use.click()
    await app.page.waitForSelector('.toast:has-text("was added")')
    expect((await app.invoke('fields:list', set.id)).map(f => f.slug)).toContain('cost_2')
  })
})

describe('making a template: its card size is chosen, then locked (PRD §10.6)', () => {
  it('the new template dialog offers the set\'s size, and the template is made at it and becomes the default', async () => {
    const { set } = await freshProject()
    await toEditor()
    app.answer('Basic Frame')
    await app.page.click('button[aria-label="New template"]')    // the name is typed by the test harness
    await app.page.waitForSelector('.editor-toolbar strong:has-text("Basic Frame")')
    const [t] = await app.invoke('templates:list')
    expect(t).toMatchObject({ name: 'Basic Frame', card_size: 'poker' })
    expect((await app.invoke('sets:list'))[0].default_template_id).toBe(t.id)
    expect(await app.page.locator('.editor-toolbar .size-badge').innerText()).toMatch(/Poker.*🔒/)
    expect(set.id).toBeTruthy()
  })

  it('a template made for another size is not listed for this set, and says so', async () => {
    await freshProject()
    await toEditor()
    await app.holdPrompts(true)                              // look at the dialog itself instead of answering it
    await app.page.click('button[aria-label="New template"]')
    await app.page.waitForSelector('[role=dialog] form')
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('select').selectOption('tarot')
    expect(await dialog().innerText()).toMatch(/locked once the template is made/)
    await dialog().locator('input.field').fill('Tall frame')
    await dialog().locator('button[type=submit]').click()
    await app.holdPrompts(false)
    await app.page.waitForSelector('.toast:has-text("was made for Tarot")')
    expect((await app.invoke('templates:list')).map(t => [t.name, t.card_size])).toEqual([['Tall frame', 'tarot']])
    expect(await listed()).toEqual([])                       // the poker set does not list it
    expect(await app.invoke('templates:list', { setId: (await app.invoke('sets:list'))[0].id })).toEqual([])
  })

  it('lists, for each set, only the templates of its own size', async () => {
    await freshProject()
    await app.invoke('templates:create', { name: 'Poker frame', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"/>' })
    await app.invoke('templates:create', { name: 'Tarot frame', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="857"/>', cardSize: 'tarot' })
    const tarotSet = await app.invoke('sets:create', { name: 'Tarot set', cardSize: 'tarot' })
    await app.page.reload()
    await app.page.locator('.set-item', { hasText: 'Creatures' }).click(); await toEditor()
    expect(await listed()).toEqual(['Poker frame'])
    await app.page.locator('.set-item', { hasText: 'Tarot set' }).click(); await toEditor()
    expect(await listed()).toEqual(['Tarot frame'])
    // the default-template choice and the card table's template column offer the same, and only those
    expect(await app.page.locator('.sidebar .template-picker select').first().locator('option').allInnerTexts()).toEqual(['— none —', 'Tarot frame'])
    expect(tarotSet.id).toBeTruthy()
  })
})

describe('the actions of one template (the Template menu in the editor)', () => {
  it('saves to the library, exports a package, and resets a copy', async () => {
    const { set } = await freshProject()
    await app.invoke('templatelib:use', { kind: 'starter', id: 'blank-poker', setId: set.id, makeDefault: true })
    await toEditor(); await chooseTemplate('Blank poker')
    await menu('Save to library')
    await app.page.waitForSelector('text=Save “Blank poker” to your library')
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('input').first().fill('My poker frame')
    await dialog().locator('button.primary', { hasText: 'Save to library' }).click()
    await app.page.waitForSelector('.toast:has-text("saved to your library")')
    await dialog().waitFor({ state: 'detached' })

    await app.page.click('button:has-text("Library…")'); await dialog().waitFor()
    await app.page.waitForSelector('.entry.tile h4:text-is("My poker frame")')
    const file = join(app.root, 'frame.spadewick-template')
    app.mockDialog.save(file)
    await tile('My poker frame').getByRole('button', { name: 'Export My poker frame as a package' }).click()
    await dialog().locator('button.primary', { hasText: 'Export…' }).click()
    await app.page.waitForSelector('.toast:has-text("Package saved")')
    await dialog().locator('button', { hasText: 'Done' }).last().click()

    // reset: edit the copy, then put the library version back
    const t = (await app.invoke('templates:list'))[0]
    const original = (await app.invoke('templates:get', t.id)).svg_source
    await app.invoke('templates:update', { id: t.id, svgSource: original.replace('</svg>', '<rect width="1" height="1" fill="#f0f"/></svg>') })   // an edit (the canvas of a template is locked, so it keeps its size)
    await menu('Reset to the library version')
    await app.page.waitForSelector('.toast:has-text("was reset")')
    expect((await app.invoke('templates:get', t.id)).svg_source).toBe(original)
  })

  it('renames, duplicates and deletes', async () => {
    const { set } = await freshProject()
    await app.invoke('templatelib:use', { kind: 'starter', id: 'blank-poker', setId: set.id, makeDefault: true })
    await toEditor(); await chooseTemplate('Blank poker')
    app.answer('Frame A')
    await menu('Rename')
    await app.page.waitForSelector('.editor-toolbar strong:has-text("Frame A")')
    expect(await listed()).toEqual(['Frame A'])
    await menu('Duplicate')
    await app.page.waitForSelector('.editor-toolbar strong:has-text("Frame A copy")')
    expect((await listed()).sort()).toEqual(['Frame A', 'Frame A copy'])
    expect((await app.invoke('templates:list')).every(t => t.card_size === 'poker')).toBe(true)   // a copy keeps the size
    await menu('Delete')
    await app.page.waitForFunction(() => document.querySelectorAll('.template-list .tpl').length === 1)
    expect(await listed()).toEqual(['Frame A'])
    expect(await app.page.locator('.editor-toolbar').count()).toBe(0)        // nothing is open any more
  })

  it('imports a package from a file, from the list\'s own button', async () => {
    await freshProject()
    const file = join(app.root, 'incoming.spadewick-template')
    await app.raw('templatepkg:export', { kind: 'starter', id: 'example-playing-card', path: file, confirmRights: true })
    await toEditor()
    app.mockDialog.open(file)
    await app.page.click('button:has-text("Import package…")')
    await app.page.waitForSelector('text=Import “Playing card”')
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('input[type=radio][value=library]').check()
    await dialog().locator('button.primary', { hasText: 'Import' }).click()
    await app.page.waitForSelector('.toast:has-text("was imported")')
    await dialog().waitFor({ state: 'detached' })
    expect(await app.invoke('templates:list')).toEqual([])      // library only: the project is untouched
    await app.page.click('button:has-text("Library…")'); await dialog().waitFor()
    await app.page.waitForSelector('.entry.tile h4:text-is("Playing card")')
    expect(app.errors).toEqual([])
  })

  it('shows a clear message for a damaged package and closes without leaving anything half-done', async () => {
    await freshProject()
    const { writeFileSync } = await import('fs')
    const file = join(app.root, 'bad.spadewick-template'); writeFileSync(file, 'nope')
    await toEditor()
    app.mockDialog.open(file)
    await app.page.click('button:has-text("Import package…")')
    await app.page.waitForSelector('.toast:has-text("Not a valid ZIP")')
    await dialog().waitFor({ state: 'detached' })
    expect(await app.invoke('templates:list')).toEqual([])
  })
})
