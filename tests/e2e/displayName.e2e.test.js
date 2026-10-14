/**
 * The name of a card is a field the set points at, the identifier column and edits that spread (UPDATES U9, U10), and the guide in the
 * Help tab (UPDATES U11), in the window.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const dialog = () => app.page.locator('[role=dialog]')

async function newProjectWithSet() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `names-${Date.now()}`, parentDir: app.root })
  await app.goto()
  app.answer('Base')
  await app.page.click('button:has-text("+ New Set")')
  await app.page.waitForSelector('.set-row.active')
  return (await app.invoke('sets:list'))[0]
}
async function addFields(...names) {
  await app.page.click('button[title="Manage fields"]')
  for (const name of names) {
    const rows = await app.page.locator('[role=dialog] tbody tr').count()
    app.answer(name); await app.page.click('button:has-text("+ Field")')
    await app.page.waitForFunction(n => document.querySelectorAll('[role=dialog] tbody tr').length === n, rows + 1)
  }
}

describe('the display name (U10)', () => {
  it('a set made in the window starts with a Name column that is its display name; a card added is called New Card', async () => {
    const set = await newProjectWithSet()
    expect(set.display_field).toBe('name')
    expect(await app.page.locator('.head-cell .head-label').allInnerTexts()).toEqual(['ID', 'Template', 'Card back', 'Quantity', 'Name'])
    expect(await app.page.locator('.head-cell', { hasText: 'Name' }).locator('.chip').innerText()).toBe('name')
    await app.page.click('button:has-text("+ Card")')
    await app.page.waitForSelector('.grid-row')
    expect(await app.cellText(0, 'name')).toBe('New Card')
    expect((await app.invoke('cards:list', set.id))[0].display_name).toBe('New Card')
    await app.edit(0, 'name', 'Goblin')
    expect((await app.invoke('cards:list', set.id))[0].display_name).toBe('Goblin')
  })

  it('another field, or none, can be chosen in Manage Fields, and the cards follow', async () => {
    const set = await newProjectWithSet()
    await addFields('Title')
    await app.page.locator('[role=dialog] .columns-of-set select').first().selectOption('title')
    await app.page.click('button:has-text("Done")')
    expect((await app.invoke('sets:list'))[0].display_field).toBe('title')
    await app.page.click('button[title="Manage fields"]')
    await app.page.locator('[role=dialog] .columns-of-set select').first().selectOption('')
    await app.page.click('button:has-text("Done")')
    expect((await app.invoke('sets:list'))[0].display_field).toBe(null)
    expect(await app.page.locator('.head-cell .chip').count()).toBe(0)
    expect(set.id).toBeTruthy()
  })

  it('passes axe in Manage Fields, with the display name, the identifier and the Spread column', async () => {
    await newProjectWithSet()
    await addFields('Sku')
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('the unique identifier and edits that spread (U9)', () => {
  it('marks the identifier, shares a column between cards with the same identifier, and undoes it all at once', async () => {
    const set = await newProjectWithSet()
    await addFields('Sku', 'Price')
    const dlg = dialog()
    await dlg.locator('.columns-of-set select').nth(1).selectOption('sku')
    await expect.poll(() => dlg.locator('input[aria-label="Spread edits of field Name to cards with the same identifier"]').isDisabled()).toBe(false)   // the choice is saved, then the column opens
    expect(await dlg.locator('input[aria-label="Spread edits of field Sku to cards with the same identifier"]').isDisabled()).toBe(true)   // the identifier itself does not spread
    await dlg.locator('input[aria-label="Spread edits of field Price to cards with the same identifier"]').check()
    await app.page.click('button:has-text("Done")')
    expect((await app.invoke('sets:list'))[0].identifier_field).toBe('sku')
    for (const [name, sku, price] of [['Orc', 'A', '1'], ['Orc foil', 'A', '1'], ['Elf', 'B', '5']]) await app.raw('cards:create', { setId: set.id, fields: { name, sku, price } })
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    // the identifier A is shared by two cards: it is shown, not refused
    expect(await app.page.locator('.cell[data-col="sku"] .text.shared').count()).toBe(2)
    await app.edit(0, 'price', '9')
    await app.page.waitForFunction(() => document.body.innerText.includes('1 other card with the same identifier changed too'))
    expect((await app.invoke('cards:list', set.id)).map(c => c.fields.price)).toEqual(['9', '9', '5'])
    expect(await app.cellText(1, 'price')).toBe('9')
    await app.menu('menu:undo')
    await app.page.waitForFunction(() => document.querySelector('.grid-row:nth-child(2) .cell[data-col="price"]')?.innerText === '1')
    expect((await app.invoke('cards:list', set.id)).map(c => c.fields.price)).toEqual(['1', '1', '5'])
  })
})

describe('the guide in the Help tab (U11)', () => {
  it('opens from the Help menu, lists every function, and finds one by what it does', async () => {
    await newProjectWithSet()
    await app.menu('menu:guide')
    await app.page.waitForSelector('.help')
    expect(await app.page.locator('[role=tab][aria-selected=true]').innerText()).toBe('Help')
    expect(await app.page.locator('.page h3').innerText()).toBe('Quick start')   // the guide opens on the quick start
    await app.page.locator('.nav button', { hasText: 'Formulas' }).click()
    expect(await app.page.locator('.entries li').count()).toBeGreaterThan(30)
    expect(await app.page.locator('#help-fn-concat').innerText()).toContain('concat(a, b, …)')
    await app.page.locator('.help input[type=search]').fill('capital')
    expect(await app.page.locator('.entries li').allInnerTexts().then(a => a.some(t => t.includes('upper(text)')))).toBe(true)
    expect(await app.page.locator('.help [role=status]').innerText()).toMatch(/\d+ entries found|1 entry found/)
    await app.page.locator('.help input[type=search]').fill('zzzz-not-there')
    expect(await app.page.locator('.help .dim').innerText()).toContain('Nothing in the guide matches')
  })

  it('shows what each example gives, switches between the guides, and copies an example', async () => {
    await newProjectWithSet()
    await app.menu('menu:guide')
    await app.page.waitForSelector('.help')
    await app.page.locator('.nav button', { hasText: 'Formulas' }).click()
    const concat = app.page.locator('#help-fn-concat')
    expect(await concat.locator('code').allInnerTexts()).toEqual(['concat(first, " ", last)', 'Ada Lovelace'])
    await app.page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await concat.locator('button.copy').click()
    await app.page.waitForFunction(() => document.body.innerText.includes('Copied.'))
    await app.page.locator('.nav button', { hasText: 'Tokens in templates' }).click()
    expect(await app.page.locator('.entries li').first().innerText()).toContain('{{cost}}')
    await app.page.locator('.nav button', { hasText: 'Field types' }).click()
    expect(await app.page.locator('.page h3').innerText()).toBe('Field types')
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('is there with no project open, and can be closed', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.goto()
    await app.page.waitForSelector('text=New Project')
    await app.menu('menu:guide')
    await app.page.waitForSelector('.help')
    expect(await app.page.locator('.nav button').count()).toBe(24)
    await app.page.locator('button.back').click()
    await app.page.waitForSelector('text=New Project')
  })
})
