import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import Database from 'better-sqlite3'
import { startApp } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

async function freshProject() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `ids-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Fire Creatures', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'Orc', fields: { name: 'Orc' } }, { name: 'Elf', fields: { name: 'Elf' } }] })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}
const idCell = row => app.page.locator('.grid-row').nth(row).locator('.cell[data-col="__id"]')

describe('card IDs in the table (PRD §5.8, §6.1)', () => {
  it('shows each card\'s ID in a read-only column that typing does not edit', async () => {
    await freshProject()
    expect(await idCell(0).innerText()).toBe('FIRE-0001')
    expect(await idCell(1).innerText()).toBe('FIRE-0002')
    await idCell(0).click()
    await app.page.keyboard.type('X')
    expect(await app.page.locator('.cell-editor').count()).toBe(0)
    expect(await idCell(0).innerText()).toBe('FIRE-0001')
  })

  it('changes an ID only after a warning, and refuses an ID another card has', async () => {
    const { set } = await freshProject()
    await idCell(0).dblclick()
    await app.page.waitForSelector('.cell-editor')
    expect(app.dialogs.at(-1).message).toMatch(/permanent|recognise a card/i)
    await app.page.locator('.cell-editor').fill('PROMO-1')
    await app.page.locator('.cell-editor').press('Enter')
    await app.page.locator('.cell-editor').waitFor({ state: 'detached' })
    expect((await app.invoke('cards:list', set.id))[0].card_code).toBe('PROMO-1')

    await idCell(1).dblclick()
    await app.page.locator('.cell-editor').fill('PROMO-1')
    await app.page.locator('.cell-editor').press('Enter')
    await app.page.waitForSelector('.toast.error, .toast:has-text("already used")')
    expect((await app.invoke('cards:list', set.id))[1].card_code).toBe('FIRE-0002')
    await app.page.keyboard.press('Escape')
  })

  it('a new card gets the next ID, and a duplicate gets its own', async () => {
    const { set } = await freshProject()
    await app.page.locator('.toolbar button').first().click()
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 3)
    await app.page.locator('.grid-row').first().locator('.row-handle').click()
    await app.page.click('button:has-text("Duplicate")')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 4)
    expect((await app.invoke('cards:list', set.id)).map(c => c.card_code)).toEqual(['FIRE-0001', 'FIRE-0002', 'FIRE-0003', 'FIRE-0004'])
  })
})

describe('Card IDs dialog and set codes', () => {
  it('previews a pattern, rejects a bad one, and applies a good one to the next card', async () => {
    const { set } = await freshProject()
    await app.menu('menu:card-ids')
    await app.page.waitForSelector('[role=dialog]')
    const pattern = app.page.locator('[role=dialog] input.mono').first()
    await pattern.fill('{set}-X')
    expect(await app.page.locator('#pattern-error').innerText()).toMatch(/\{n\}/)
    expect(await app.page.locator('[role=dialog] button.primary').isDisabled()).toBe(true)
    await pattern.fill('{set}-{author}-{n:3}')
    expect(await app.page.locator('#pattern-error').innerText()).toBe('')
    expect(await app.page.locator('[role=status] code').innerText()).toMatch(/^FIRE-[A-Z0-9]{2}-001/)
    await app.page.click('[role=dialog] button.primary')
    await app.page.waitForFunction(() => !document.querySelector('[role=dialog]'))
    await app.page.locator('.toolbar button').first().click()
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 3)
    const cards = await app.invoke('cards:list', set.id)
    expect(cards[2].card_code).toMatch(/^FIRE-[A-Z0-9]{2}-003$/)
    expect(cards[0].card_code).toBe('FIRE-0001')   // existing IDs are untouched
  })

  it('edits the set code from the sidebar and refuses a code another set uses', async () => {
    const { set } = await freshProject()
    const other = await app.invoke('sets:create', { name: 'Water' })
    await app.goto(); await app.page.click('.set-item >> nth=0'); await app.page.waitForSelector('.grid-row')
    const input = app.page.locator('.code-input')
    expect(await input.inputValue()).toBe('FIRE')
    await input.fill('fl'); await input.press('Tab')
    await app.page.waitForFunction(async () => true)
    expect((await app.invoke('sets:list')).find(s => s.id === set.id).code).toBe('FL')
    await input.fill(other.code); await input.press('Tab')
    await app.page.waitForSelector('.toast:has-text("already used")')
    expect(await input.inputValue()).toBe('FL')
  })
})

describe('opening projects made by other versions', () => {
  function legacy(dir) {
    mkdirSync(dir, { recursive: true })
    const raw = new Database(join(dir, 'project.db'))
    raw.exec(`CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','5'), ('name','Old');
      CREATE TABLE sets(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, card_size TEXT, card_mm_w REAL, card_mm_h REAL, default_template_id TEXT);
      INSERT INTO sets VALUES ('s','Heroes',NULL,0,1,1,NULL,NULL,NULL,NULL);
      CREATE TABLE cards(id TEXT PRIMARY KEY, set_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', template_id TEXT, quantity INTEGER NOT NULL DEFAULT 1, fields_json TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO cards VALUES ('c','s','Knight',NULL,1,'{}',0,0,1,1);`)
    raw.close()
  }

  it('tells the user an older project was upgraded, with a snapshot, and shows the new IDs', async () => {
    await freshProject()
    const dir = join(app.root, `old-${Date.now()}`)
    legacy(dir)
    await app.page.evaluate(path => window.__emitMenu('menu:open-recent', path), dir)
    await app.page.waitForSelector('.toast:has-text("upgraded")')
    await app.page.click('.set-item')
    await app.page.waitForSelector('.grid-row')
    expect(await idCell(0).innerText()).toBe('HERO-0001')
    expect((await app.invoke('snapshots:list')).map(s => s.name)).toEqual([expect.stringMatching(/before upgrade/)])
    expect(app.errors).toEqual([])
  })

  it('refuses a project from a newer version with a clear message and keeps the current project', async () => {
    await freshProject()
    const dir = join(app.root, `new-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const raw = new Database(join(dir, 'project.db'))
    raw.exec("CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','99');")
    raw.close()
    await app.page.evaluate(path => window.__emitMenu('menu:open-recent', path), dir)
    await app.page.waitForSelector('.toast:has-text("newer version of Spadewick")')
    expect(await app.page.locator('.grid-row').count()).toBe(2)   // the open project is still there
  })
})
