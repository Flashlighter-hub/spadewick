/**
 * PRD §16.2: the text engine switch in the Fonts dialog (per project), and the notice shown when an older project
 * moves to the engine.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'
import { openProjectDb } from '../../src/main/db.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/>' +
  '<text x="30" y="60" width="440" height="200" font-size="30" data-spadewick-field="body" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="60" fill="#fff">{{body}}</text></svg>'
const LONG = 'AVATAR Tower of the Wave, with a long text that needs wrapping over several lines and then some more words to fill it up nicely, again and again, to make it long.'

async function openNewProject() {
  await app.invoke('projects:close').catch(() => {})
  const made = await app.invoke('projects:create', { name: `engine-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Set', fields: [{ name: 'Body', type: 'text' }], cards: [{ name: 'A', fields: { body: LONG } }], template: { svg: TEMPLATE } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return made
}

describe('the text engine switch (Fonts dialog)', () => {
  it('is on for a new project, can be turned off and on again, is saved per project, and passes axe', async () => {
    await openNewProject()
    await app.menu('menu:manage-fonts')
    const box = app.page.locator('[role=dialog] input[type=checkbox]')
    await box.waitFor()
    expect(await box.isChecked()).toBe(true)
    expect(await app.page.locator('[role=dialog]').innerText()).toMatch(/Draw text from the real font outlines/)
    expect(await axeViolations(app.page)).toEqual([])

    await box.uncheck()
    expect((await app.invoke('projects:get-meta')).meta.text_engine).toBe('estimate')
    await box.check()
    expect((await app.invoke('projects:get-meta')).meta.text_engine).toBe('outlines')
    expect(app.errors).toEqual([])
  })
})

describe('moving an older project to the engine', () => {
  it('opens it, says what changed, and keeps the snapshot that was taken first', async () => {
    const made = await openNewProject()
    await app.invoke('projects:close')
    openProjectDb(made.path).prepare("DELETE FROM project_meta WHERE key = 'text_engine'").run() // as a project from before the engine
    await app.goto()
    await app.menu('menu:open-recent', made.path)
    await app.page.waitForSelector('.toast:has-text("Text is now measured and drawn with the real font outlines")', { timeout: 15000 })
    const toast = await app.page.locator('.toast:has-text("Text is now measured")').innerText()
    expect(toast).toMatch(/In 1 cards the text changed size or line breaks/)
    expect(toast).toMatch(/A snapshot was taken first/)
    const snapshots = await app.invoke('snapshots:list')
    expect(snapshots.some(s => /text engine/.test(s.name))).toBe(true)
    expect((await app.invoke('projects:get-meta')).meta.text_engine).toBe('outlines')
  })
})
