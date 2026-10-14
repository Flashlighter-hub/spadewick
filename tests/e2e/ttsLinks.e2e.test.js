/**
 * PRD §10.2.1: the TTS export writes full local file links by default, can write bare file names, remembers the
 * choice, and tells the user what a local link means.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, readFileSync, existsSync } from 'fs'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><text x="30" y="70" font-size="40" fill="#fff">{{name}}</text></svg>'

async function open() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `tts-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, parentDir: app.root })
  await app.invoke('settings:set', 'tts_image_links', undefined)
  const seeded = await seedSet({ name: 'Test Set', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }, { name: 'B', fields: { name: 'B' } }], template: { svg: TEMPLATE } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return seeded
}

const dialogOpen = async () => { await app.menu('menu:export-tts'); await app.page.waitForSelector('[role=dialog] select[aria-describedby="tts-links-help"]') }
const linksSelect = () => app.page.locator('[role=dialog] select[aria-describedby="tts-links-help"]')

async function runExport(dirName) {
  const out = join(app.root, dirName); mkdirSync(out, { recursive: true })
  app.mockDialog.open(out)
  await app.page.click('[role=dialog] button:has-text("Browse")')
  await app.page.locator('[role=dialog] .foot button.primary-btn').click()
  await app.page.waitForSelector('.result-box:has-text("Export complete")', { timeout: 30000 })
  return out
}
const faceUrl = out => JSON.parse(readFileSync(join(out, readFileSyncName(out)), 'utf8')).ObjectStates[0].CustomDeck['1'].FaceURL
const readFileSyncName = out => 'test_set.json'

describe('image links in the TTS export dialog (PRD §10.2.1)', () => {
  it('offers local file paths by default, explains them, and passes axe', async () => {
    await open()
    await dialogOpen()
    expect(await linksSelect().inputValue()).toBe('local')
    const text = await app.page.locator('[role=dialog]').innerText()
    expect(text).toMatch(/Local file paths \(this computer\)/)
    expect(text).toMatch(/will not load on another computer/)
    expect(text).toMatch(/Saved Objects/)                                   // the loading steps
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('writes a full file link to a file that exists, and says where the links point', async () => {
    await open()
    await dialogOpen()
    const out = await runExport('links-local')
    const url = faceUrl(out)
    expect(url).toMatch(/^file:\/\//)
    expect(url).toContain('test_set_face.png')
    expect(existsSync(join(out, 'test_set_face.png'))).toBe(true)
    expect(await app.page.locator('.result-box').innerText()).toMatch(/Image links point to files in:/)
  })

  it('"File names only" writes the bare names, and the choice is remembered', async () => {
    await open()
    await dialogOpen()
    await linksSelect().selectOption('names')
    expect(await app.page.locator('[role=dialog]').innerText()).toMatch(/WWW Image Error/)
    await expect.poll(() => app.invoke('settings:get', 'tts_image_links')).toBe('names')
    const out = await runExport('links-names')
    expect(faceUrl(out)).toBe('test_set_face.png')
    expect(await app.page.locator('.result-box').innerText()).not.toMatch(/Image links point to/)
    // after a restart the choice is still there
    await app.page.reload(); await app.page.click('.set-item')
    await dialogOpen()
    expect(await linksSelect().inputValue()).toBe('names')
  })

  it('has nothing to choose when no JSON file is written', async () => {
    await open()
    await dialogOpen()
    await app.page.locator('[role=dialog] label:has-text("companion file") input[type=checkbox]').uncheck()
    expect(await linksSelect().count()).toBe(0)
  })

  it('Steam Cloud: lists the sheets to upload, takes their addresses and writes a _cloud JSON', async () => {
    await open()
    await dialogOpen()
    await linksSelect().selectOption('cloud')
    expect(await app.page.locator('[role=dialog]').innerText()).toMatch(/Delete the files in Cloud Manager/)
    await expect.poll(() => app.invoke('settings:get', 'tts_image_links')).toBe('cloud')
    const out = await runExport('links-cloud')
    const inputs = app.page.locator('.result-box input')
    expect(await inputs.count()).toBe(2)                                    // the face sheet and the back
    for (let i = 0; i < 2; i++) await inputs.nth(i).fill('http://cloud-3.steamusercontent.com/ugc/' + (i + 1) + '/AB/')
    await app.page.click('.result-box button:has-text("Write the _cloud JSON")')
    await app.page.waitForSelector('.result-box [role=status]')
    const cloud = JSON.parse(readFileSync(join(out, 'test_set_cloud.json'), 'utf8')).ObjectStates[0].CustomDeck['1']
    expect(cloud.FaceURL).toContain("http://cloud-3")
    expect(cloud.BackURL).toContain("http://cloud-3")
    expect(await axeViolations(app.page)).toEqual([])
  })
})
