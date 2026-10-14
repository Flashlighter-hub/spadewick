import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { readdirSync, mkdirSync } from 'fs'
import { startApp } from './harness.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

describe('first project to exported cards (UC-01, UC-02, UC-03, UC-07)', () => {
  it('shows the welcome screen and creates a project', async () => {
    await app.goto()
    await app.page.waitForSelector('text=New Project')
    app.answer('My Game')
    await app.page.click('button:has-text("New Project")')
    await app.page.waitForSelector('.project-name:has-text("My Game")')
    expect((await app.invoke('projects:get-meta')).meta.name).toBe('My Game')
  })

  it('creates a set and defines fields from the Fields dialog', async () => {
    app.answer('Base Set')
    await app.page.click('button:has-text("+ New Set")')
    await app.page.waitForSelector('.set-row.active')
    await app.page.click('button[title="Manage fields"]')
    const rows = app.page.locator('[role="dialog"] tbody tr')
    // a new set starts with a text field called Name, which is its display name (UPDATES U10)
    expect(await rows.nth(0).locator('input:not([type=checkbox])').first().inputValue()).toBe('Name')
    for (const [i, name] of ['Cost', 'Rules Text'].entries()) {
      app.answer(name)
      await app.page.click('button:has-text("+ Field")')
      await rows.nth(i + 1).waitFor()
      expect(await rows.nth(i + 1).locator('input:not([type=checkbox])').first().inputValue()).toBe(name)
    }
    // Make "Cost" a number field from the UI
    await rows.nth(1).locator('select').selectOption('number')
    await app.page.click('button:has-text("Done")')
    const set = (await app.invoke('sets:list'))[0]
    const fields = await app.invoke('fields:list', set.id)
    expect(fields.map(f => [f.name, f.slug, f.type])).toEqual([['Name', 'name', 'text'], ['Cost', 'cost', 'number'], ['Rules Text', 'rules_text', 'text']])
  })

  it('adds cards and edits cells; every edit is persisted', async () => {
    await app.page.click('button:has-text("+ Card")')
    await app.page.waitForSelector('.grid-row')
    await app.edit(0, 'name', 'Goblin')
    await app.edit(0, 'cost', '2')
    await app.edit(0, 'rules_text', 'Sneaky.\nHits first.')
    const set = (await app.invoke('sets:list'))[0]
    const [card] = await app.invoke('cards:list', set.id)
    expect(card.display_name).toBe('Goblin')
    expect(card.fields).toMatchObject({ name: 'Goblin', cost: '2', rules_text: 'Sneaky.\nHits first.' })
  })

  it('creates a template; it becomes the set default and the preview renders', async () => {
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    app.answer('Basic Frame')
    await app.page.click('button[aria-label="New template"]')
    await app.page.waitForSelector('.template-editor canvas')
    await app.page.click('button:has-text("View source")')
    await app.page.locator('textarea.svg-source').fill(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">
      <rect width="500" height="700" fill="#223355"/>
      <text data-spadewick-id="title" x="30" y="70" font-size="40" fill="#ffffff">{{name}}</text>
      <text data-spadewick-id="body" data-spadewick-field="rules_text" data-spadewick-text-fit="wrap" x="30" y="400" width="440" height="200" font-size="28" fill="#ffffff">{{rules_text}}</text></svg>`)
    await app.page.click('[role=dialog] button:has-text("Done")')
    await app.page.click('button:has-text("Save")')
    const set = (await app.invoke('sets:list'))[0]
    expect(set.default_template_id).toBeTruthy()
    await app.page.click('button[role=tab]:has-text("Card Data")')
    await app.page.locator('.grid-row .cell[data-col="name"]').first().click()
    const img = app.page.locator('img').first()
    await img.waitFor({ timeout: 15000 })
    expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })

  it('exports the cards as a PNG sheet from the Export dialog', async () => {
    const out = join(app.root, 'exports'); mkdirSync(out, { recursive: true })
    await app.menu('menu:export-png')
    await app.page.waitForSelector('[role="dialog"]')
    app.mockDialog.open(out)
    await app.page.click('button:has-text("Browse")')
    await app.page.locator('[role="dialog"] .foot button.primary-btn').click()
    await app.page.waitForSelector('.result-box:has-text("Export complete")', { timeout: 30000 })
    expect(readdirSync(out).some(f => f.endsWith('.png'))).toBe(true)
  })

  it('had no runtime errors along the way', () => {
    expect(app.errors).toEqual([])
  })
})
