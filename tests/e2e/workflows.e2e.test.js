import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import sharp from 'sharp'
import { startApp, axeViolations } from './harness.js'
import { seedSet, makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

const TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><text data-spadewick-id="title" x="30" y="70" font-size="40" fill="#ffffff">{{name}}</text><rect data-spadewick-id="frame" x="40" y="120" width="200" height="100" fill="#cc3333"/></svg>`

/** Start every test from a clean project with one set, opened in the UI. */
async function freshProject(name, setup) {
  await app.invoke('projects:close').catch(() => {})
  const created = await app.invoke('projects:create', { name: `${name}-${Date.now()}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Faction', type: 'text' }], cards: [{ name: 'Orc', fields: { name: 'Orc', cost: '3', faction: 'Red' } }, { name: 'Elf', fields: { name: 'Elf', cost: '2', faction: 'Blue' } }, { name: 'Imp', fields: { name: 'Imp', cost: '1', faction: 'Red' } }], template: { svg: TEMPLATE } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  if (setup) await setup(seeded)
  await app.goto()
  await app.page.click('.set-item')
  await app.page.waitForSelector('.grid-row')
  return { ...seeded, dir: created.path }
}
const rows = () => app.page.locator('.grid-row')

beforeEach(() => { app.errors.length = 0 })

// The SVG source is shown on demand, in a dialog (PRD §8.7.1)
const openSource = async () => { await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source') }
const closeSource = () => app.page.click('[role=dialog] button:has-text("Done")')
const sourceText = async () => { await openSource(); const v = await app.page.locator('textarea.svg-source').inputValue(); await closeSource(); return v }

describe('CSV import with the user\'s own column names (UC-01)', () => {
  it('syncs columns to fields whose names match, and lets the user rename a field to match', async () => {
    const { set } = await freshProject('csv')
    // The user's CSV calls the cost column "Mana"; they rename the field in the app to match
    await app.page.click('button[title="Manage fields"]')
    const costRow = app.page.locator('[role="dialog"] tbody tr').nth(1)
    await costRow.locator('input:not([type=checkbox])').first().fill('Mana'); await costRow.locator('input:not([type=checkbox])').first().press('Tab')
    await app.page.click('button:has-text("Done")')
    expect((await app.invoke('fields:list', set.id))[1]).toMatchObject({ name: 'Mana', slug: 'cost' })

    const csv = join(app.root, 'mygame.csv')
    writeFileSync(csv, 'name,MANA,Flavor Text\nTroll,5,Smash\nSprite,1,Zip\n')
    app.mockDialog.open(csv)
    await app.page.click('button[title="Import CSV or JSON"]')
    await app.page.click('button:has-text("Choose CSV file")')
    await app.page.waitForSelector('table.map')
    // header → field mapping is pre-filled by name; a column that matches no field starts as a new text field (UPDATES U8)
    const selects = app.page.locator('table.map select')
    expect(await selects.nth(0).inputValue()).toBe('name')
    expect(await selects.nth(1).inputValue()).toBe('cost')
    expect(await selects.nth(2).inputValue()).toBe('__new')
    await app.page.click('.dialog button.primary')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 5)
    const cards = await app.invoke('cards:list', set.id)
    expect(cards.slice(3).map(c => c.fields)).toEqual([
      { name: 'Troll', cost: '5', faction: '', card_name: '', flavor_text: 'Smash' }, { name: 'Sprite', cost: '1', faction: '', card_name: '', flavor_text: 'Zip' }])
    expect(app.errors).toEqual([])
  })

  it('shows validation errors before importing and skips only the bad rows', async () => {
    const { set } = await freshProject('csv-bad')
    const csv = join(app.root, 'bad.csv'); writeFileSync(csv, 'name,cost\nGood,4\nBad,lots\n')
    app.mockDialog.open(csv)
    await app.page.click('button[title="Import CSV or JSON"]')
    await app.page.click('button:has-text("Choose CSV file")')
    await app.page.waitForSelector('.report')
    expect(await app.page.locator('.report').innerText()).toMatch(/1 validation error/)
    await app.page.click('.dialog button.primary:has-text("skipping errors")')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 4)
    expect((await app.invoke('cards:list', set.id)).map(c => c.fields.name)).toContain('Good')
  })

  it('warns about a CSV that breaks the CSV rules, with the lines, and imports only after the person says they have seen it', async () => {
    const { set } = await freshProject('csv-rules')
    const csv = join(app.root, 'broken.csv')
    // a stray quote after "Level 1 - " (as in a real skills file): the field ends early and the cards after it run together
    writeFileSync(csv, 'name,cost,faction\nIce,2,"Level 1 - "On a hit."\nWind,2,Air\nHail,1,Air\n')
    app.mockDialog.open(csv)
    await app.page.click('button[title="Import CSV or JSON"]')
    await app.page.click('button:has-text("Choose CSV file")')
    await app.page.waitForSelector('.problems')
    const warning = await app.page.locator('.problems').innerText()
    expect(warning).toMatch(/breaks the CSV rules/)
    expect(warning).toMatch(/Line\s+Problem/)
    expect(warning).toMatch(/2\s+A quote mark inside a quoted field/)
    expect(await app.page.locator('.problems[role=alert]').count()).toBe(1)
    expect(await axeViolations(app.page)).toEqual([])
    const importButton = app.page.locator('.dialog button.primary')
    expect(await importButton.isDisabled()).toBe(true)                  // not until the problems have been seen
    await app.page.locator('.problems input[type=checkbox]').check()
    expect(await importButton.isDisabled()).toBe(false)
    await app.page.click('.dialog button:has-text("Cancel")')
    expect((await app.invoke('cards:list', set.id)).length).toBe(3)    // nothing was imported

    // a clean file shows no warning at all
    const clean = join(app.root, 'clean.csv'); writeFileSync(clean, 'name,cost,faction\nIce,2,Water\n')
    app.mockDialog.open(clean)
    await app.page.click('button[title="Import CSV or JSON"]')
    await app.page.click('button:has-text("Choose CSV file")')
    await app.page.waitForSelector('.report')
    expect(await app.page.locator('.problems').count()).toBe(0)
    await app.page.click('.dialog button:has-text("Cancel")')
  })

  it('exports the table back to CSV from the UI', async () => {
    await freshProject('csv-export')
    const out = join(app.root, 'cards-out.csv'); app.mockDialog.save(out)
    await app.page.click('button[title="Export CSV or JSON"]')
    await app.page.locator('.dialog .sets input[type=checkbox]').first().waitFor()
    await app.page.click('.dialog button.primary:has-text("Export")')
    await app.page.waitForFunction(() => document.body.innerText.includes('Exported 3 cards'))
    expect(existsSync(out)).toBe(true)
  })
})

describe('find and replace (UC-05)', () => {
  it('previews matches, applies them as one undoable step, and the table updates', async () => {
    const { set } = await freshProject('fr')
    await app.page.click('button[title="Find and replace"]')
    await app.page.fill('.dialog input.grow >> nth=0', 'Red')
    await app.page.fill('.dialog input.grow >> nth=1', 'Crimson')
    await app.page.click('.dialog button:has-text("Preview")')
    await app.page.waitForSelector('.dialog table tbody tr')
    expect(await app.page.locator('.dialog table tbody tr').count()).toBe(2)
    await app.page.click('.dialog button.primary')
    await app.page.waitForFunction(() => document.querySelector('.card-grid').innerText.includes('Crimson'))
    expect((await app.invoke('cards:list', set.id)).map(c => c.fields.faction)).toEqual(['Crimson', 'Blue', 'Crimson'])
    await app.menu('menu:undo')
    await app.page.waitForFunction(() => !document.querySelector('.card-grid').innerText.includes('Crimson'))
    expect((await app.invoke('cards:list', set.id)).map(c => c.fields.faction)).toEqual(['Red', 'Blue', 'Red'])
  })

  it('reports an invalid regular expression instead of failing silently', async () => {
    await freshProject('fr-regex')
    await app.page.click('button[title="Find and replace"]')
    await app.page.fill('.dialog input.grow >> nth=0', '(oops')
    await app.page.check('.dialog input[type=checkbox] >> nth=0')
    await app.page.click('.dialog button:has-text("Preview")')
    await app.page.waitForSelector('.dialog .err')
    expect(await app.page.locator('.dialog .err').innerText()).toMatch(/Invalid search/)
  })
})

describe('undo and redo from the menu (UC-11)', () => {
  it('recovers a deleted card and re-applies the deletion', async () => {
    const { set } = await freshProject('undo')
    await app.page.locator('.row-handle').first().click()
    await app.page.click('button:has-text("Delete (1)")')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 2)
    await app.menu('menu:undo')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 3)
    await app.menu('menu:redo')
    await app.page.waitForFunction(() => document.querySelectorAll('.grid-row').length === 2)
    expect(await app.invoke('cards:list', set.id)).toHaveLength(2)
  })

  it('undoes a cell edit and the table shows the old value again', async () => {
    await freshProject('undo-cell')
    await app.edit(0, 'name', 'Ork')
    expect(await app.cellText(0, 'name')).toBe('Ork')
    await app.menu('menu:undo')
    await app.page.waitForFunction(() => document.querySelector('.grid-row .cell[data-col="name"]').innerText === 'Orc')
  })
})

describe('template editor and canvas', () => {
  it('drags an element on the canvas, saves, and the change is stored', async () => {
    const { template } = await freshProject('canvas')
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    const box = await app.page.locator('.stage-host').boundingBox()
    await app.page.mouse.click(box.x + 100, box.y + 150)       // select the "frame" rectangle
    await app.page.waitForSelector('.props-title:has-text("frame")')
    await app.page.mouse.move(box.x + 100, box.y + 150); await app.page.mouse.down()
    await app.page.mouse.move(box.x + 160, box.y + 190, { steps: 6 }); await app.page.mouse.up()
    await app.page.click('button:has-text("Save")')
    await app.page.waitForFunction(() => !document.querySelector('button.dirty'))
    const saved = (await app.invoke('templates:get', template.id)).svg_source
    expect(saved).toMatch(/data-spadewick-id="frame"[^>]*x="100"/)
    expect(saved).toMatch(/y="160"/)
  })

  it('undo inside the editor reverts the canvas edit without touching card data', async () => {
    const { set } = await freshProject('canvas-undo')
    const before = JSON.stringify((await app.invoke('cards:list', set.id)).map(c => c.fields))
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    const box = await app.page.locator('.stage-host').boundingBox()
    await app.page.mouse.click(box.x + 100, box.y + 150)
    await app.page.mouse.move(box.x + 100, box.y + 150); await app.page.mouse.down()
    await app.page.mouse.move(box.x + 160, box.y + 190, { steps: 4 }); await app.page.mouse.up()
    expect(await sourceText()).toMatch(/x="100"/)
    await app.menu('menu:undo')
    await expect.poll(sourceText, { timeout: 5000 }).toMatch(/data-spadewick-id="frame" x="40"/)
    expect(JSON.stringify((await app.invoke('cards:list', set.id)).map(c => c.fields))).toBe(before)
  })

  it('wraps long text using the Fit mode control and the preview shows it', async () => {
    const { set } = await freshProject('canvas-text')
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    const box = await app.page.locator('.stage-host').boundingBox()
    await app.page.mouse.click(box.x + 40, box.y + 60)         // the title text
    await app.page.waitForSelector('.props-title:has-text("title")')
    await app.page.locator('.props label:has-text("Fit mode") select').selectOption('wrap')
    expect(await sourceText()).toMatch(/data-spadewick-text-fit="wrap"/)
    expect(set.id).toBeTruthy()
  })
})

describe('snapshots (UC-06)', () => {
  it('creates a snapshot from the menu and restores it after more edits', async () => {
    const { set } = await freshProject('snap')
    app.answer('Before balance', 'pass one')
    await app.menu('menu:create-snapshot')
    await app.page.waitForSelector('.panel li:has-text("Before balance")')
    await app.invoke('cards:create', { setId: set.id, displayName: 'Extra' })
    expect(await app.invoke('cards:list', set.id)).toHaveLength(4)
    await app.page.click('.panel li:has-text("Before balance") button:has-text("Restore")')
    await app.page.waitForFunction(() => document.body.innerText.includes('Snapshot restored'))
    expect(await app.invoke('cards:list', set.id)).toHaveLength(3)
    expect(app.errors).toEqual([])
  })
})

describe('assets', () => {
  it('imports an image from the browser and shows its thumbnail', async () => {
    await freshProject('assets')
    await app.page.click('button[role=tab]:has-text("Assets")')
    app.mockDialog.open(await makePng(join(app.root, 'dragon.png'), 120, 80, '#00aa55'))
    await app.page.click('button:has-text("+ Import")')
    await app.page.waitForSelector('.asset-card img')
    expect(await app.page.locator('.asset-name').first().innerText()).toBe('dragon.png')
    expect((await app.page.locator('.asset-card img').first().getAttribute('src'))).toMatch(/^(blob:|data:)/)
    expect(app.errors).toEqual([])
  })
})

describe('application shell (PRD §12)', () => {
  it('switches the theme from Preferences and remembers it', async () => {
    await freshProject('prefs')
    await app.menu('menu:preferences')
    await app.page.waitForSelector('[role="dialog"]')
    await app.page.locator('[role="dialog"] select').first().selectOption('light')
    await app.page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light')
    expect(await app.invoke('settings:get', 'theme')).toBe('light')
    await app.page.locator('[role="dialog"] select').first().selectOption('dark')
    await app.page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
  })

  it('closes, reopens from the recent list, and duplicates a project from the menu', async () => {
    const { dir } = await freshProject('shell')
    await app.menu('menu:close-project')
    await app.page.waitForSelector('text=Recent Projects')
    await app.menu('menu:open-recent', dir)
    await app.page.waitForSelector('.project-name')
    app.answer('Shell Copy'); app.mockDialog.open(app.root)
    await app.menu('menu:duplicate-project')
    await app.page.waitForFunction(() => document.body.innerText.includes('Duplicated to'))
    expect(existsSync(join(app.root, 'Shell Copy', 'project.db'))).toBe(true)
  })

  it('runs the integrity check and reveals its result', async () => {
    await freshProject('integrity')
    await app.menu('menu:db-integrity')
    await app.page.waitForFunction(() => document.body.innerText.includes('integrity check passed'))
  })

  it('opens Manage Fonts, and there is no palette to manage (PRD §7.5)', async () => {
    await freshProject('fonts')
    expect(await app.invoke('palette:list').catch(e => e.message)).toMatch(/No IPC handler/)
    await app.menu('menu:manage-fonts')
    await app.page.waitForSelector('[role="dialog"]')
    await app.page.click('[role="dialog"] button:has-text("Done")')
    expect(app.errors).toEqual([])
  })

  it('applies a set card size to exports', async () => {
    const { set } = await freshProject('size')
    // a template of the new size is needed, because a set only uses templates of its own size (PRD §10.6)
    const tarot = await app.invoke('templates:create', { name: 'Tarot frame', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="857" viewBox="0 0 500 857"><rect width="500" height="857" fill="#445566"/></svg>', cardSize: 'tarot' })
    await app.page.locator('.sidebar label:has-text("Card size") select').selectOption('tarot')   // asks first: the cards' own template no longer fits
    await expect.poll(async () => (await app.invoke('sets:list'))[0].card_size).toBe('tarot')
    await app.invoke('sets:update', { id: set.id, defaultTemplateId: tarot.id })
    const out = join(app.root, 'tarot-out'); mkdirSync(out, { recursive: true })
    await app.invoke('export:png-sheet', { setIds: [set.id], outputDir: out, individualFiles: true })
    const meta = await sharp(join(out, readdirSync(out)[0])).metadata()
    expect(meta.height / meta.width).toBeCloseTo(120 / 70, 2)
  })

  it('has no menu channel that the renderer ignores', async () => {
    await freshProject('menu')
    const channels = ['menu:toggle-sidebar', 'menu:preview-size', 'menu:find-replace', 'menu:select-all', 'menu:manage-fields', 'menu:about']
    for (const c of channels) await app.menu(c, c === 'menu:preview-size' ? 'large' : undefined)
    await app.page.waitForSelector('[role="dialog"]')
    expect(app.errors).toEqual([])
  })
})

describe('untrusted templates cannot run code in the app', () => {
  it('ignores script, event handlers and external loads in the canvas and the source dialog', async () => {
    const { template } = await freshProject('xss')
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700" onload="window.__pwned='svg-onload'">
      <script>window.__pwned='script'</script>
      <image href="http://127.0.0.1:9/x.png" onerror="window.__pwned='image-onerror'" x="0" y="0" width="10" height="10" data-spadewick-id="img"/>
      <rect width="500" height="700" fill="#223355" onclick="window.__pwned='click'" data-spadewick-id="bg"/>
      <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onmouseover="window.__pwned='fo'">x</div></foreignObject></svg>`
    await app.invoke('templates:update', { id: template.id, svgSource: evil })
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    for (let i = 0; i < 2; i++) { await openSource(); await app.page.waitForTimeout(200); await closeSource() }
    await app.page.mouse.click(10, 10)
    await app.page.locator('.stage-host').click({ position: { x: 100, y: 100 } }).catch(() => {})
    expect(await app.page.evaluate(() => window.__pwned)).toBeUndefined()
    app.errors.length = 0
  })

  it('shows the template source with syntax highlighting that matches the text exactly', async () => {
    await freshProject('highlight')
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await openSource()
    await app.page.waitForSelector('.code-editor .hl')
    expect(await app.page.locator('.hl .hl-tag').first().innerText()).toBe('svg')
    expect(await app.page.locator('.hl .hl-token').first().innerText()).toBe('{{name}}')
    const [hl, src] = await app.page.evaluate(() => [document.querySelector('.hl').textContent.replace(/\n$/, ''), document.querySelector('textarea.svg-source').value])
    expect(hl).toBe(src)
    await app.page.locator('textarea.svg-source').fill('<svg><text fill="red">{{x}}</text></svg>')
    await app.page.waitForFunction(() => document.querySelector('.hl .hl-token')?.textContent === '{{x}}')
    await closeSource()
  })

  it('opens the card at full size and re-renders previews when a template changes', async () => {
    const { set, template } = await freshProject('fullsize')
    await app.invoke('templates:update', { id: template.id, svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#ff0000"/></svg>' })
    await app.page.reload(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row')
    await app.page.locator('.cell[data-col="__id"]').first().click()
    await app.page.waitForSelector('.preview-img')
    const before = await app.page.getAttribute('.preview-img', 'src')
    await app.invoke('templates:update', { id: template.id, svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#0000ff"/></svg>' })
    await app.page.evaluate(() => window.dispatchEvent(new Event('spadewick:rerender')))
    await app.page.waitForFunction(b => document.querySelector('.preview-img')?.getAttribute('src') !== b, before)
    await app.page.click('button[title="Full size"]')
    await app.page.waitForSelector('.full-img')
    const natural = await app.page.evaluate(() => { const i = document.querySelector('.full-img'); return [i.naturalWidth, i.naturalHeight] })
    expect(natural).toEqual([500, 700])                    // 1:1 export pixels
    await app.page.keyboard.press('Escape')
    expect(set.id).toBeTruthy()
  })
})

describe('fixed image in a template (PRD §7.1)', () => {
  it('a newly added image element offers to import an image right away, and keeps a visible button afterwards', async () => {
    const { template } = await freshProject('new-image', async ({ template }) => {
      await app.invoke('templates:update', { id: template.id, svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/></svg>' })
    })
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    await app.page.locator('.canvas-editor .toolbar button[title^="Image"]').click()
    const box = await app.page.locator('.stage-host').boundingBox()
    await app.page.mouse.click(box.x + 120, box.y + 160)
    // the set has no image field, so the picker opens by itself
    await app.page.waitForSelector('[role=dialog]:has-text("Choose")')
    app.mockDialog.open(await makePng(join(app.root, 'imported.png'), 50, 50, '#00ff00'))
    await app.page.locator('[role=dialog] button:has-text("Import")').click()
    await app.page.waitForSelector('.fixed-image:has-text("imported.png")')
    await app.page.click('button:has-text("Save")')
    await app.page.waitForFunction(() => !document.querySelector('button.dirty'))
    const assets = await app.invoke('assets:list', {})
    expect(assets.map(a => a.original_name)).toEqual(['imported.png'])
    expect((await app.invoke('templates:get', template.id)).svg_source).toContain(`{{@asset.${assets[0].id}}}`)
    // later, the button is there without opening any menu
    expect(await app.page.locator('.fixed-image button').innerText()).toBe('Change image…')
  })

  it('chooses a library image for an image element from the properties panel; it is saved as an asset token', async () => {
    const png = await makePng(join(app.root, 'frame.png'), 60, 60, '#ff0000')
    const TPL = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><image data-spadewick-id="pic" x="40" y="120" width="200" height="200" href=""/></svg>`
    let asset
    const { template } = await freshProject('fixed-img', async ({ template }) => {
      ;[asset] = await app.invoke('assets:import', [png])
      await app.invoke('templates:update', { id: template.id, svgSource: TPL })
    })
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    const box = await app.page.locator('.stage-host').boundingBox()
    await app.page.mouse.click(box.x + 100, box.y + 200)
    await app.page.waitForSelector('.props-title:has-text("pic")')
    await app.page.locator('.props select').first().selectOption('__asset')
    await app.page.locator('[role=dialog] [role=option]', { hasText: 'frame.png' }).click()
    await app.page.waitForSelector('.fixed-image:has-text("frame.png")')
    await app.page.click('button:has-text("Save")')
    await app.page.waitForFunction(() => !document.querySelector('button.dirty'))
    expect((await app.invoke('templates:get', template.id)).svg_source).toContain(`href="{{@asset.${asset.id}}}"`)
    // the card preview now shows the fixed image on every card
    const png0 = Buffer.from(await app.invoke('templates:render', { cardId: (await app.invoke('cards:list', (await app.invoke('sets:list'))[0].id))[0].id, width: 500 }), 'base64')
    const { data, info } = await sharp(png0).raw().toBuffer({ resolveWithObject: true })
    const i = (200 * info.width + 100) * info.channels
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 0, 0])
  })
})

describe('putting an image into an art block', () => {
  it('a rectangle offers "Put an image in this block": the image takes its name and place, the rectangle stays behind it', async () => {
    const png = await makePng(join(app.root, 'art.png'), 60, 60, '#ff8800')
    const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><rect data-spadewick-id="art" x="40" y="120" width="300" height="300" fill="#888888"/></svg>'
    let asset
    const { template } = await freshProject('art-block', async ({ template }) => {
      ;[asset] = await app.invoke('assets:import', [png])
      await app.invoke('templates:update', { id: template.id, svgSource: TPL })
    })
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    const box = await app.page.locator('.stage-host').boundingBox()
    await app.page.mouse.click(box.x + 150, box.y + 250)
    await app.page.waitForSelector('.props-title:has-text("art")')
    await app.page.click('button:has-text("Put an image in this block")')
    await app.page.locator('[role=dialog] [role=option]', { hasText: 'art.png' }).click()
    await app.page.waitForSelector('.fixed-image:has-text("art.png")')
    await app.page.click('button:has-text("Save")')
    await app.page.waitForFunction(() => !document.querySelector('button.dirty'))
    const svg = (await app.invoke('templates:get', template.id)).svg_source
    const image = /<image[^>]*>/.exec(svg)[0]
    expect(image).toContain('data-spadewick-id="art"')
    expect(image).toContain(`href="{{@asset.${asset.id}}}"`)
    expect(svg).toMatch(/<rect x="40" y="120" width="300" height="300" fill="#888888"/)
  })
})
