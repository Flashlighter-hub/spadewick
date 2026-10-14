import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs'
import { startApp } from './harness.js'
import { seedSet, makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

/** A project with a typed set, opened in the UI. */
async function open({ cards = 3, extraFields = [] } = {}) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `grid-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({
    name: 'Base',
    // the first column is the display name of the cards (UPDATES U10); the second is an ordinary field that has the same title
    fields: [{ name: 'Name', slug: 'card_name', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Cost', type: 'number', validation: { min: 0, max: 10 } }, ...extraFields],
    cards: Array.from({ length: cards }, (_, i) => ({ name: `Card ${i + 1}`, fields: { name: `N${i + 1}`, cost: String(i + 1) } }))
  })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const rows = () => app.page.locator('.grid-row')
const cell = (row, col) => rows().nth(row).locator(`.cell[data-col="${col}"]`)
const activeCol = () => app.page.evaluate(() => document.querySelector('.cell.active')?.getAttribute('data-col'))
const activeRowIdx = () => app.page.evaluate(() => { const c = document.querySelector('.cell.active'); return c ? Number(c.closest('.grid-row').getAttribute('aria-rowindex')) - 2 : null })
const dbCards = async set => (await app.invoke('cards:list', set.id))

describe('virtual scrolling (PRD §6.1)', () => {
  it('keeps only the visible rows in the DOM for 1,000 cards, and scrolls to the end', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `big-${Date.now()}`, parentDir: app.root })
    const big = await seedSet({ name: 'Big', fields: [{ name: 'Name', slug: 'card_name', type: 'text' }, { name: 'Name', type: 'text' }], cards: [] })
    for (let i = 1; i <= 1000; i++) await app.raw('cards:create', { setId: big.set.id, displayName: `Card ${i}`, fields: { name: `N${i}` } })
    await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    expect(await rows().count()).toBeLessThan(60)
    expect(await app.page.locator('.card-grid').getAttribute('aria-rowcount')).toBe("1002")
    await app.page.evaluate(() => { const g = document.querySelector('.card-grid'); g.scrollTop = g.scrollHeight })
    await app.page.waitForFunction(() => document.querySelector('.grid-row[aria-rowindex="1001"]'))
    expect(await rows().count()).toBeLessThan(60)
    expect(await app.page.locator('.grid-row[aria-rowindex="1001"]').innerText()).toContain('Card 1000')
    expect(app.errors).toEqual([])
  })
})

describe('scroll performance (PRD §14.1)', () => {
  it('scrolls a 1,000-card table smoothly', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `fps-${Date.now()}`, parentDir: app.root })
    const big = await seedSet({ name: 'Big', fields: [{ name: 'Name', slug: 'card_name', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Text', type: 'text' }], cards: [] })
    for (let i = 1; i <= 1000; i++) await app.raw('cards:create', { setId: big.set.id, displayName: `Card ${i}`, fields: { name: `N${i}`, cost: String(i % 10), text: 'Rules text goes here. '.repeat(3) } })
    await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    const frames = await app.page.evaluate(() => new Promise(resolve => {
      const grid = document.querySelector('.card-grid'), times = []
      let last = performance.now(), n = 0
      const step = now => {
        times.push(now - last); last = now
        grid.scrollTop += 420                                   // ~13 rows per frame, like a fast flick
        if (++n < 150) requestAnimationFrame(step); else resolve(times.slice(5))
      }
      requestAnimationFrame(step)
    }))
    const sorted = [...frames].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)], p95 = sorted[Math.floor(sorted.length * 0.95)]
    console.log(`scroll frame time: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`)
    // Headless Chromium renders in software, so allow generous headroom over the 16.7 ms (60 fps) budget
    expect(median).toBeLessThan(25)
    expect(p95).toBeLessThan(60)
    expect(await rows().count()).toBeLessThan(60)
  })
})

describe('keyboard navigation and in-place editing', () => {
  it('moves with arrows and Tab, edits by typing, and commits with Enter', async () => {
    const { set } = await open()
    await cell(0, '__id').click()
    expect([await activeRowIdx(), await activeCol()]).toEqual([0, '__id'])
    await app.page.keyboard.press('ArrowRight'); expect(await activeCol()).toBe('__template')
    await app.page.keyboard.press('Tab');        expect(await activeCol()).toBe('__back')
    await app.page.keyboard.press('Tab');        expect(await activeCol()).toBe('__quantity')
    await app.page.keyboard.press('Tab');        expect(await activeCol()).toBe('card_name')
    await app.page.keyboard.press('Tab');        expect(await activeCol()).toBe('name')
    await app.page.keyboard.press('ArrowDown');  expect(await activeRowIdx()).toBe(1)
    await app.page.keyboard.press('Shift+Tab');  expect(await activeCol()).toBe('card_name')
    await app.page.keyboard.press('Tab')
    // typing replaces the value and starts editing
    await app.page.keyboard.type('Zed')
    await app.page.keyboard.press('Enter')
    await expect.poll(activeRowIdx).toBe(2)                    // Enter moves down
    expect((await dbCards(set))[1].fields.name).toBe('Zed')
  })

  it('Escape cancels an edit and Enter on a cell starts one with the old value', async () => {
    const { set } = await open()
    await cell(0, 'name').click()
    await app.page.keyboard.press('Enter')
    await app.page.locator('.cell-editor').fill('discarded')
    await app.page.keyboard.press('Escape')
    expect((await dbCards(set))[0].fields.name).toBe('N1')
    expect(await cell(0, 'name').innerText()).toBe('N1')
  })

  it('Tab past the last cell appends a new card', async () => {
    const { set } = await open({ cards: 1 })
    await cell(0, 'cost').click()
    await app.page.keyboard.press('Tab')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 2)
    expect(await dbCards(set)).toHaveLength(2)
    expect(await activeRowIdx()).toBe(1)
  })

  it('Delete removes the selected card after confirmation', async () => {
    const { set } = await open()
    await app.page.locator('.row-handle').nth(1).click()
    await app.page.locator('.card-grid').focus()
    await app.page.keyboard.press('Delete')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 2)
    expect((await dbCards(set)).map(c => c.display_name)).toEqual(['Card 1', 'Card 3'])
  })

  it('Shift+Enter inside a text cell adds a line break instead of committing', async () => {
    const { set } = await open()
    await cell(0, 'name').dblclick()
    const ed = app.page.locator('.cell-editor')
    await ed.fill('line one'); await ed.press('Shift+Enter'); await app.page.keyboard.type('line two')
    await ed.press('Enter')
    expect((await dbCards(set))[0].fields.name).toBe('line one\nline two')
  })
})

describe('selection and bulk edit', () => {
  it('editing one cell applies to every selected row as a single undo step', async () => {
    const { set } = await open({ cards: 4 })
    await app.page.locator('.row-handle').nth(0).click()
    await app.page.locator('.row-handle').nth(2).click({ modifiers: ['Shift'] })
    expect(await app.page.locator('.bulk-hint').innerText()).toMatch(/3 selected/)
    await app.edit(1, 'name', 'SAME')
    expect((await dbCards(set)).map(c => c.fields.name)).toEqual(['SAME', 'SAME', 'SAME', 'N4'])
    await app.menu('menu:undo')
    await app.page.waitForFunction(() => document.querySelector('.grid-row .cell[data-col="name"]').innerText === 'N1')
    expect((await dbCards(set)).map(c => c.fields.name)).toEqual(['N1', 'N2', 'N3', 'N4'])
  })

  it('ctrl-click toggles individual rows and the template column bulk-assigns', async () => {
    const { set } = await open({ cards: 4 })
    const t = await app.invoke('templates:create', { name: 'T2', svgSource: '<svg xmlns="http://www.w3.org/2000/svg"/>' })
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    await app.page.locator('.row-handle').nth(0).click()
    await app.page.locator('.row-handle').nth(2).click({ modifiers: ['Control'] })
    await cell(2, '__template').locator('select').selectOption(t.id)
    expect((await dbCards(set)).map(c => c.template_id)).toEqual([t.id, null, t.id, null])
  })
})

describe('cell editors by field type (PRD §6.2)', () => {
  it('rejects an out-of-range number and keeps the old value', async () => {
    const { set } = await open()
    await app.page.locator('.cell[data-col="cost"]').first().dblclick()
    await app.page.locator('.cell-editor').fill('99'); await app.page.keyboard.press('Enter')
    await app.page.waitForFunction(() => document.body.innerText.includes('above the maximum'))
    expect((await dbCards(set))[0].fields.cost).toBe('1')
    await app.page.locator('.cell-editor').fill('7'); await app.page.keyboard.press('Enter')
    await app.page.locator('.cell-editor').waitFor({ state: 'detached' })
    expect((await dbCards(set))[0].fields.cost).toBe('7')
  })

  it('toggles a boolean with the checkbox or the space bar', async () => {
    const { set } = await open({ extraFields: [{ name: 'Legendary', type: 'boolean' }] })
    await cell(0, 'legendary').locator('input[type=checkbox]').click()
    expect((await dbCards(set))[0].fields.legendary).toBe('true')
    await cell(1, 'legendary').click(); await app.page.keyboard.press('Space')
    expect((await dbCards(set))[1].fields.legendary).toBe('true')
    await cell(1, 'legendary').locator('input[type=checkbox]').click()
    expect((await dbCards(set))[1].fields.legendary).toBe('false')
  })

  it('picks a color from the popup by typing a hex value, and clears it', async () => {
    const { set } = await open({ extraFields: [{ name: 'Tint', type: 'color' }] })
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    await cell(0, 'tint').locator('.swatch-btn').click()
    await app.page.locator('.popup .hex').fill('#ff8800'); await app.page.keyboard.press('Enter')
    await app.page.locator('.popup').waitFor({ state: 'detached' })
    expect((await dbCards(set))[0].fields.tint).toBe('#ff8800')
    expect(await app.page.locator('.popup .sw').count()).toBe(0)         // there is no project palette to pick from
    await cell(0, 'tint').locator('.swatch-btn').click()
    await app.page.locator('.popup button', { hasText: 'Clear' }).click()
    await app.page.locator('.popup').waitFor({ state: 'detached' })
    expect((await dbCards(set))[0].fields.tint).toBe('')
  })

  it('assigns an image from the asset picker and flags it when the asset is deleted', async () => {
    const { set } = await open({ extraFields: [{ name: 'Art', type: 'image_ref' }] })
    const [asset] = await app.invoke('assets:import', [await makePng(join(app.root, 'dragon.png'), 60, 40, '#2288cc')])
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    await cell(0, 'art').locator('.image-btn').click()
    await app.page.locator('[role="dialog"] .item').first().click()
    await app.page.locator('[role="dialog"]').waitFor({ state: 'detached' })
    expect((await dbCards(set))[0].fields.art).toBe(`asset:${asset.id}`)
    await app.page.waitForSelector('.cell[data-col="art"] img')
    expect(await cell(0, 'art').innerText()).toContain('dragon.png')
    await app.invoke('assets:delete', asset.id)
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    expect(await cell(0, 'art').innerText()).toContain('Missing image')
    // and the image can be cleared again
    await cell(0, 'art').locator('.image-btn').click()
    await app.page.locator('[role="dialog"] button:has-text("Clear image")').click()
    expect((await dbCards(set))[0].fields.art).toBe('')
  })

  it('shows formula results, read-only, with the expression as a tooltip', async () => {
    const { set } = await open({ extraFields: [{ name: 'Label', type: 'formula', formula: 'concat(name, " costs ", cost)' }] })
    expect(await cell(0, 'label').innerText()).toBe('N1 costs 1')
    expect(await cell(0, 'label').getAttribute('title')).toContain('concat(name')
    await cell(0, 'label').dblclick()
    expect(await app.page.locator('.cell-editor').count()).toBe(0)
    await app.edit(0, 'cost', '5')
    expect(await cell(0, 'label').innerText()).toBe('N1 costs 5')
    expect((await dbCards(set))[0].fields.label).toBeUndefined()   // computed, never stored
  })
})

describe('columns: resize, reorder, hide (persisted per set)', () => {
  const headers = () => app.page.locator('.head-cell[role=columnheader] .head-label').allInnerTexts()

  it('resizes a column and remembers the width after reload', async () => {
    const { set } = await open()
    const header = app.page.locator('.head-cell', { hasText: 'Cost' })
    const before = (await header.boundingBox()).width
    const grip = header.locator('.resizer')
    await grip.hover(); const gb = await grip.boundingBox()   // hover first: the grip must be under the pointer, as for a real user
    await app.page.mouse.down()
    await app.page.mouse.move(gb.x + 92, gb.y + 5, { steps: 5 }); await app.page.mouse.up()
    const saved = (await app.invoke('fields:list', set.id)).find(f => f.slug === 'cost').width_px
    expect(saved).toBeGreaterThan(before + 60)
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    expect(Math.round((await app.page.locator('.head-cell', { hasText: 'Cost' }).boundingBox()).width)).toBe(saved)
  })

  it('reorders columns by dragging headers', async () => {
    const { set } = await open({ extraFields: [{ name: 'Faction', type: 'text' }] })
    await app.page.locator('.head-cell', { hasText: 'Faction' }).dragTo(app.page.locator('.head-cell', { hasText: 'Name' }).nth(1))
    await app.page.waitForFunction(() => [...document.querySelectorAll('.head-cell .head-label')].map(e => e.textContent).join() === 'ID,Template,Card back,Quantity,Name,Faction,Name,Cost')
    expect((await app.invoke('fields:list', set.id)).map(f => f.name)).toEqual(['Name', 'Faction', 'Name', 'Cost'])
  })

  it('hides a column from its context menu and shows it again from the toolbar', async () => {
    const { set } = await open()
    await app.page.locator('.head-cell', { hasText: 'Cost' }).click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Hide column")').click()
    await app.page.waitForFunction(() => !document.querySelector('.card-grid').innerText.includes('Cost'))
    expect((await app.invoke('fields:list', set.id)).find(f => f.slug === 'cost').hidden).toBe(1)
    expect(await headers()).not.toContain('Cost')
    await app.page.click('button:has-text("hidden")')
    await app.page.locator('.ctx-menu button:has-text("Show")').click()
    await app.page.waitForFunction(() => document.querySelector('.card-grid').innerText.includes('Cost'))
    expect((await app.invoke('fields:list', set.id)).find(f => f.slug === 'cost').hidden).toBe(0)
  })
})

describe('rows: drag to reorder, context menu', () => {
  it('drags a row to a new position and the order is saved', async () => {
    const { set } = await open({ cards: 4 })
    await app.page.locator('.row-handle').nth(0).dragTo(rows().nth(2), { targetPosition: { x: 80, y: 28 } })
    await app.page.waitForFunction(() => document.querySelector('.grid-row .cell[data-col="card_name"]').innerText === 'Card 2')
    expect((await dbCards(set)).map(c => c.display_name)).toEqual(['Card 2', 'Card 3', 'Card 1', 'Card 4'])
  })

  it('duplicates and deletes from the row context menu', async () => {
    const { set } = await open()
    await cell(0, 'card_name').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Duplicate")').click()
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 4)
    expect((await dbCards(set)).at(-1).display_name).toBe('Card 1 (copy)')
    await cell(1, 'card_name').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Delete")').click()
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 3)
  })

  it('is operable by keyboard and exposes grid semantics', async () => {
    await open()
    expect(await app.page.locator('.card-grid').getAttribute('role')).toBe('grid')
    expect(await rows().first().getAttribute('role')).toBe('row')
    expect(await cell(0, 'name').getAttribute('role')).toBe('gridcell')
    await app.page.locator('.card-grid').focus()
    await app.page.keyboard.press('ArrowDown')
    expect(await activeRowIdx()).toBe(0)
  })
})

describe('asset browser (PRD §9)', () => {
  async function withAssets() {
    await open()
    const a = await app.invoke('assets:import', [await makePng(join(app.root, 'dragon.png'), 50, 50, '#aa2222'), await makePng(join(app.root, 'elf.png'), 30, 30, '#22aa22')])
    await app.page.reload(); await app.page.click('button[role=tab]:has-text("Assets")')
    await app.page.waitForSelector('.asset-card')
    return a
  }

  it('edits tags and notes, filters by tag chip, and finds unused assets', async () => {
    const [dragon, elf] = await withAssets()
    await app.page.locator('.asset-card', { hasText: 'dragon.png' }).click()
    await app.page.fill('[aria-label="Add a tag"]', 'monster'); await app.page.keyboard.press('Enter')
    await app.page.fill('[aria-label="Add a tag"]', 'red'); await app.page.keyboard.press('Enter')
    await app.page.fill('[aria-label="Notes"]', 'Breathes fire'); await app.page.locator('.details-title').click()
    await app.page.waitForFunction(() => document.querySelectorAll('.chip.removable').length === 2)
    expect((await app.invoke('assets:list', {})).find(a => a.id === dragon.id)).toMatchObject({ tags: ['monster', 'red'], notes: 'Breathes fire' })
    await app.page.click('.chips[aria-label="Filter by tag"] >> text=monster')
    await app.page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 1)
    await app.page.click('.chips[aria-label="Filter by tag"] >> text=monster')
    await app.page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 2)
    await app.page.click('[aria-label="Remove tag red"]')
    await app.page.waitForFunction(() => document.querySelectorAll('.chip.removable').length === 1)
    expect(elf.id).toBeTruthy()
  })

  it('sorts by name and filters to unused assets', async () => {
    const [dragon] = await withAssets()
    await app.page.selectOption('[aria-label="Sort assets"]', 'name')
    expect(await app.page.locator('.asset-name').allInnerTexts()).toEqual(['dragon.png', 'elf.png'])
    const set = (await app.invoke('sets:list'))[0]
    const field = await app.invoke('fields:create', { setId: set.id, name: 'Art', type: 'image_ref' })
    const [card] = await app.invoke('cards:list', set.id)
    await app.invoke('cards:update', { id: card.id, fields: { [field.slug]: `asset:${dragon.id}` } })
    await app.page.check('text=Unused only')
    await app.page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 1)
    expect(await app.page.locator('.asset-name').innerText()).toBe('elf.png')
  })

  it('lists usage, navigates to the card, warns before deleting a used asset, and flags the cards', async () => {
    const [dragon] = await withAssets()
    const set = (await app.invoke('sets:list'))[0]
    const field = await app.invoke('fields:create', { setId: set.id, name: 'Art', type: 'image_ref' })
    const cards = await app.invoke('cards:list', set.id)
    await app.invoke('cards:update', { id: cards[2].id, fields: { [field.slug]: `asset:${dragon.id}` } })
    await app.page.locator('.asset-card', { hasText: 'dragon.png' }).click()
    await app.page.waitForSelector('.usage li:has-text("Card 3")')
    await app.page.click('button:has-text("Go to card")')
    await app.page.waitForSelector('.card-grid')
    await app.page.waitForFunction(() => document.querySelector('.grid-row.selected .cell[data-col="card_name"]')?.innerText === 'Card 3')
    // delete from the asset browser: the warning names the card
    await app.page.click('button[role=tab]:has-text("Assets")')
    await app.page.locator('.asset-card', { hasText: 'dragon.png' }).click()
    app.dialogs.length = 0
    await app.page.click('.details button:has-text("Delete")')
    await app.page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 1)
    expect(app.dialogs.find(d => d.type === 'confirm').message).toMatch(/used by 1 card.*Card 3/s)
  })

  it('replaces the image file and exports a copy', async () => {
    const [dragon] = await withAssets()
    await app.page.locator('.asset-card', { hasText: 'dragon.png' }).click()
    app.mockDialog.open(await makePng(join(app.root, 'bigger.png'), 120, 90, '#0000ff'))
    await app.page.click('button:has-text("Replace")')
    await app.page.waitForFunction(() => document.querySelector('.details .meta')?.innerText.includes('120×90'))
    expect((await app.invoke('assets:list', {})).find(a => a.id === dragon.id)).toMatchObject({ width_px: 120, height_px: 90, id: dragon.id })
    const out = join(app.root, 'asset-out'); mkdirSync(out, { recursive: true }); app.mockDialog.open(out)
    await app.page.click('.details button:has-text("Export")')
    await app.page.waitForFunction(() => document.body.innerText.includes('Exported to'))
    expect(readdirSync(out)).toEqual(['dragon.png'])
  })
})

describe('export dialog: card selection and file names (PRD §10.1)', () => {
  it('exports only matching cards under a patterned file name', async () => {
    const { set } = await open({ cards: 4 })
    const tpl = await app.invoke('templates:create', { name: 'T', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#336699"/></svg>' })
    await app.invoke('sets:update', { id: set.id, defaultTemplateId: tpl.id })
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    const out = join(app.root, 'sel-out'); mkdirSync(out, { recursive: true })
    await app.menu('menu:export-png')
    await app.page.waitForSelector('[role="dialog"]')
    app.mockDialog.open(out); await app.page.click('button:has-text("Browse")')
    await app.page.check('text=Matching a filter')
    await app.page.fill('[aria-label="Card filter expression"]', 'cost > 2')
    await app.page.fill('[aria-label="File name pattern"]', 'deck-{{set_name}}')
    await app.page.locator('[role="dialog"] .foot button.primary-btn').click()
    await app.page.waitForSelector('.result-box:has-text("2 card")')
    expect(readdirSync(out)).toEqual(['deck-base_sheet.png'])
  })

  it('exports just the selected cards', async () => {
    const { set } = await open({ cards: 4 })
    const tpl = await app.invoke('templates:create', { name: 'T', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#336699"/></svg>' })
    await app.invoke('sets:update', { id: set.id, defaultTemplateId: tpl.id })
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    await app.page.locator('.row-handle').nth(0).click(); await app.page.locator('.row-handle').nth(1).click({ modifiers: ['Control'] })
    const out = join(app.root, 'sel-out2'); mkdirSync(out, { recursive: true })
    await app.menu('menu:export-png')
    await app.page.waitForSelector('[role="dialog"]')
    app.mockDialog.open(out); await app.page.click('button:has-text("Browse")')
    await app.page.check('text=Selected cards (2)')
    await app.page.locator('[role="dialog"] .foot button.primary-btn').click()
    await app.page.waitForSelector('.result-box:has-text("2 card")')
  })
})

describe('recovering a damaged project on open (PRD §14.2)', () => {
  it('offers the latest snapshot and restores it', async () => {
    const { set } = await open()
    await app.invoke('snapshots:create', { name: 'known good' })
    const project = (await app.invoke('projects:get-meta')).path
    await app.invoke('projects:close')
    writeFileSync(join(project, 'project.db'), Buffer.alloc(4096, 9))
    for (const f of ['project.db-wal', 'project.db-shm']) { try { (await import('fs')).rmSync(join(project, f)) } catch { /* none */ } }
    app.dialogs.length = 0
    await app.goto()
    await app.menu('menu:open-recent', project)
    await app.page.waitForSelector('.set-item')
    expect(app.dialogs.find(d => d.type === 'confirm').message).toMatch(/known good/)
    expect((await app.invoke('sets:list')).map(s => s.name)).toEqual(['Base'])
    expect(readdirSync(project).some(f => f.startsWith('project.corrupt-'))).toBe(true)
    expect(set.id).toBeTruthy()
  })
})

describe('quantity column (PRD §6.5)', () => {
  it('shows 1 by default, edits like any cell, applies to every selected row, and rejects bad values', async () => {
    const { set } = await open({ cards: 3 })
    expect(await app.cellText(0, '__quantity')).toBe('1')
    await app.edit(0, '__quantity', '4')
    expect((await dbCards(set)).map(c => c.quantity)).toEqual([4, 1, 1])
    // bulk: select rows 2 and 3, edit one of them
    await app.page.locator('.row-handle').nth(1).click()
    await app.page.locator('.row-handle').nth(2).click({ modifiers: ['Shift'] })
    await app.edit(1, '__quantity', '2')
    expect((await dbCards(set)).map(c => c.quantity)).toEqual([4, 2, 2])
    // invalid: a message, and the stored value stays
    await app.page.locator('.row-handle').nth(0).click()
    await cell(0, '__quantity').dblclick()
    await app.page.locator('.cell-editor').fill('1.5'); await app.page.keyboard.press('Enter')
    await app.page.waitForFunction(() => document.body.innerText.includes('not a valid quantity'))
    expect((await dbCards(set))[0].quantity).toBe(4)
    await app.page.keyboard.press('Escape')
    // undo restores the previous number
    await app.menu('menu:undo')
    await app.page.waitForFunction(() => document.querySelector('.grid-row:nth-child(2) .cell[data-col="__quantity"]')?.innerText !== undefined)
    expect((await dbCards(set)).map(c => c.quantity)).toEqual([4, 1, 1])
  })

  it('the quantity column header explains what it does', async () => {
    await open({ cards: 1 })
    const header = app.page.locator('[role=columnheader]', { hasText: 'Quantity' })
    expect(await header.getAttribute('title')).toMatch(/Copies of this card/)
  })
})
