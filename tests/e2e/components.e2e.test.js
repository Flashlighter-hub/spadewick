/**
 * Components in the Template Editor (PRD §7.10): making one from a selection, putting one from the library into a template, changing
 * its colours and words, updating from the library, saving changes to the library, and letting go.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
  + '<rect data-spadewick-id="a" x="60" y="100" width="200" height="100" fill="#cc0000" stroke="#000000"/>'
  + '<text data-spadewick-id="t" x="80" y="300" font-size="40" fill="#000000">Hi</text>'
  + '</svg>'

async function freshProject() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `comp-${Date.now()}`, parentDir: app.root })
  // the library is shared by every project: start each test with an empty one
  for (const c of await app.invoke('components:list')) await app.invoke('components:delete', c.id)
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Cost', type: 'number' }], cards: [{ name: 'A', fields: { cost: 3 } }], template: { svg: TPL } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
async function show() {
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top } })
const click = async (x, y) => { const h = await host(); await app.page.mouse.click(h.x + x, h.y + y) }
const sourceText = async () => {
  await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
  const t = await app.page.locator('textarea.svg-source').inputValue()
  await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
  return t
}
const tagOf = (src, id) => new RegExp(`<[a-z]+[^>]*data-spadewick-id="${id}"[^>]*>`).exec(src)?.[0] ?? ''
const attr = (src, id, name) => new RegExp(` ${name}="([^"]*)"`).exec(tagOf(src, id))?.[1] ?? null
const save = async s => { await app.page.click('button:has-text("Save")'); await app.page.waitForFunction(() => !document.querySelector('button.dirty')); return s }
const dialog = () => app.page.locator('[role=dialog]')

/** Click a part, then take the whole component (a click on a part picks the part). */
async function selectInstance() {
  await click(100, 130)
  await app.page.click('.props .part-of button:has-text("Select the component")')
  await app.page.waitForSelector('.props .comp')
}

async function makeFromSelection(name = 'Hello box') {
  await click(100, 130)                                                   // the rectangle
  await app.page.waitForSelector('.props-title:has-text("a")')
  await app.page.keyboard.down('Shift'); await click(90, 285); await app.page.keyboard.up('Shift')   // and the text
  await app.page.waitForSelector('.props-title:has-text("2 elements")')
  app.answer(name)
  await app.page.click('.props button:has-text("Make component")')
  await app.page.waitForSelector('.props .comp')
}

describe('making a component', () => {
  it('keeps the selection in the library, and the template uses an instance of it', async () => {
    await freshProject(); await show()
    await makeFromSelection()
    await app.page.waitForSelector('.toast:has-text("Saved the component")')
    const item = (await app.invoke('components:list')).find(c => !c.builtIn)
    expect(item).toMatchObject({ name: 'Hello box', version: 1, parts: 2 })
    expect(await app.page.locator('.props .comp-name').innerText()).toContain('Hello box')
    expect(await app.page.locator('.props .comp-name').innerText()).toContain('version 1')
    const src = await sourceText()
    const g = /<g[^>]*data-spadewick-component="[^"]+"[^>]*>/.exec(src)?.[0] ?? ''
    expect(g).toContain(`data-spadewick-component="${item.id}"`)
    expect(g).toContain('data-spadewick-component-name="Hello box"')
    expect(attr(src, 'a', 'data-spadewick-part')).toBe('a')
    expect(await app.page.locator('.props .parts li').count()).toBe(2)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('asks for a name, and makes nothing when it is not given', async () => {
    await freshProject(); await show()
    await click(100, 130)
    app.answer('   ')
    await app.page.click('.props button:has-text("Make component")')
    await app.page.waitForTimeout(300)
    expect((await app.invoke('components:list')).filter(c => !c.builtIn)).toEqual([])
    expect(await app.page.locator('.props .comp').count()).toBe(0)
  })
})

describe('using a component from the library', () => {
  it('puts it into another template from the Components dialog, with its parts, and says which fields it needs', async () => {
    const s = await freshProject()
    const saved = await app.invoke('components:save', {
      name: 'Cost badge', description: 'Round', bounds: { x: 0, y: 0, w: 60, h: 60 }, refWidth: 500,
      xml: ['<circle xmlns="http://www.w3.org/2000/svg" data-spadewick-id="badge" cx="30" cy="30" r="30" fill="#2266cc"/>', '<text xmlns="http://www.w3.org/2000/svg" data-spadewick-id="cost" x="30" y="40" font-size="26" text-anchor="middle" fill="#ffffff">{{cost}}</text>', '<text xmlns="http://www.w3.org/2000/svg" data-spadewick-id="rank" x="30" y="55" font-size="12" fill="#fff">{{rank}}</text>'], defs: []
    })
    await show()
    await app.page.click('button[aria-label^="Components"]')
    await dialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    const tile = dialog().locator('.tile', { hasText: 'Cost badge' })
    expect(await tile.locator('img').count()).toBe(1)
    expect(await tile.locator('.warn').innerText()).toContain('rank')               // this set has no "rank" field
    await tile.locator('button:has-text("Insert")').click()
    await app.page.waitForSelector('.props .comp')
    expect(await app.page.locator('.toast:has-text("does not have: rank")').count()).toBe(1)
    const src = await sourceText()
    expect(src).toContain(`data-spadewick-component="${saved.id}"`)
    expect(src).toMatch(/transform="translate\(220 320\)"/)                          // its middle is the middle of the card
    expect(src).toContain('{{cost}}')
    expect(s.set.id).toBeTruthy()
  })

  it('a second copy is its own: changing the colour of one leaves the other', async () => {
    await freshProject()
    const saved = await app.invoke('components:save', { name: 'Dot', bounds: { x: 0, y: 0, w: 40, h: 40 }, refWidth: 500, xml: ['<circle xmlns="http://www.w3.org/2000/svg" data-spadewick-id="dot" cx="20" cy="20" r="20" fill="#2266cc"/>'], defs: [] })
    await show()
    for (let i = 0; i < 2; i++) {
      await app.page.click('button[aria-label^="Components"]'); await dialog().waitFor()
      await dialog().locator('.tile', { hasText: 'Dot' }).locator('button:has-text("Insert")').click()
      await app.page.waitForSelector('.props .comp')
    }
    const input = app.page.locator('.props .parts li').first().locator('input[type=color]').first()
    await input.fill('#ff0000')
    await expect.poll(async () => (await sourceText()).includes('fill="#ff0000"'), { timeout: 5000 }).toBe(true)
    const src = await sourceText()
    expect(src.match(/fill="#2266cc"/g)).toHaveLength(1)
    expect(src.match(/fill="#ff0000"/g)).toHaveLength(1)
    expect(saved.id).toBeTruthy()
  })
})

describe('colours and words of an instance, and updating', () => {
  it('keeps a changed colour and words when the library has a newer version', async () => {
    await freshProject(); await show()
    await makeFromSelection()
    const item = (await app.invoke('components:list')).find(c => !c.builtIn)
    // change the colour of the rectangle and the words of the text, from the panel
    await app.page.locator('.props .parts li', { hasText: 'a' }).first().locator('input[type=color]').first().fill('#00aa00')
    await app.page.locator('.props .parts li', { hasText: 't' }).locator('input:not([type=color])').fill('Bye')
    await expect.poll(async () => (await sourceText()).includes('>Bye</text>'), { timeout: 5000 }).toBe(true)
    expect(attr(await sourceText(), 'a', 'fill')).toBe('#00aa00')
    expect(await app.page.locator('.props .parts li.changed').count()).toBe(2)

    // somebody improves the component in the library: a rounder rectangle, a bigger text
    const lib = await app.invoke('components:get', item.id)
    await app.invoke('components:save', { id: item.id, bounds: lib.bounds, refWidth: lib.refWidth, defs: [], xml: [
      '<rect xmlns="http://www.w3.org/2000/svg" data-spadewick-id="a" data-spadewick-part="a" x="60" y="100" width="200" height="100" rx="30" fill="#cc0000" stroke="#000000"/>',
      '<text xmlns="http://www.w3.org/2000/svg" data-spadewick-id="t" data-spadewick-part="t" x="80" y="300" font-size="72" fill="#000000">Hi</text>'] })
    await app.page.keyboard.press('Escape')                                           // let go of it, and pick it again: the library is looked at again
    await selectInstance()
    await app.page.waitForSelector('.props .comp .note:has-text("newer version (2)")')
    await app.page.click('.props button:has-text("Update from library")')
    await expect.poll(async () => attr(await sourceText(), 'a', 'rx'), { timeout: 5000 }).toBe('30')
    const src = await sourceText()
    expect(attr(src, 'a', 'fill')).toBe('#00aa00')                                   // the colour that was changed stays
    expect(src).toContain('>Bye</text>')                                               // and so do the words
    expect(attr(src, 't', 'font-size')).toBe('72')                                     // the rest is the library's
    expect(await app.page.locator('.props .comp-name').innerText()).toContain('version 2')
    expect(await app.page.locator('.props .comp .note').count()).toBe(0)

    // back to the library's colours and words
    await app.page.click('.props button:has-text("Back to the library")')
    await expect.poll(async () => attr(await sourceText(), 'a', 'fill'), { timeout: 5000 }).toBe('#cc0000')
    expect(await sourceText()).toContain('>Hi</text>')
  })

  it('saves the changes of an instance as the next version of the component', async () => {
    await freshProject(); await show()
    await makeFromSelection()
    const item = (await app.invoke('components:list')).find(c => !c.builtIn)
    await app.page.locator('.props .parts li', { hasText: 'a' }).first().locator('input[type=color]').first().fill('#112233')
    await expect.poll(async () => attr(await sourceText(), 'a', 'fill'), { timeout: 5000 }).toBe('#112233')
    await app.page.click('.props button:has-text("Save changes to library")')
    await app.page.waitForSelector('.toast:has-text("as version 2")')
    const lib = await app.invoke('components:get', item.id)
    expect(lib.version).toBe(2)
    expect(lib.xml.join('')).toContain('#112233')
    expect(await app.page.locator('.props .comp-name').innerText()).toContain('version 2')
    expect(await app.page.locator('.props .parts li.changed').count()).toBe(0)         // the change is part of the component now
  })

  it('says when the component is no longer in the library, and saving makes it again', async () => {
    await freshProject(); await show()
    await makeFromSelection()
    const item = (await app.invoke('components:list')).find(c => !c.builtIn)
    await app.invoke('components:delete', item.id)
    await app.page.keyboard.press('Escape')                                           // let go of it, and pick it again: the library is looked at again
    await selectInstance()
    await app.page.waitForSelector('.props .comp .note:has-text("not in your library")')
    expect(await app.page.locator('.props button:has-text("Update from library")').isDisabled()).toBe(true)
    await app.page.click('.props button:has-text("Save changes to library")')
    await app.page.waitForSelector('.toast:has-text("as version 1")')
    const again = (await app.invoke('components:list')).filter(c => !c.builtIn)
    expect(again).toHaveLength(1)
    expect(again[0].name).toBe('Hello box')
  })

  it('detach makes an ordinary group again, which can be taken apart', async () => {
    await freshProject(); await show()
    await makeFromSelection()
    await app.page.click('.props button:has-text("Detach")')
    await expect.poll(async () => (await sourceText()).includes('data-spadewick-component'), { timeout: 5000 }).toBe(false)
    expect(await app.page.locator('.props .comp').count()).toBe(0)
    await app.page.click('.props button:has-text("Ungroup")')
    await expect.poll(async () => /<g[ >]/.test(await sourceText()), { timeout: 5000 }).toBe(false)
  })
})

describe('the built-in components', () => {
  it('are in the library from the start, cannot be changed, and one can be put into a template', async () => {
    await freshProject(); await show()
    await app.page.click('button[aria-label^="Components"]'); await dialog().waitFor()
    await dialog().locator('.tile').first().waitFor()
    expect(await dialog().locator('.tile').count()).toBe(42)             // twelve digit slots, banners and text blocks, and thirty icons
    const tile = dialog().locator('.tile', { hasText: 'Round gem digit' })
    expect(await tile.locator('.dim').innerText()).toBe('built in')
    expect(await tile.locator('button:has-text("Rename")').isDisabled()).toBe(true)
    expect(await tile.locator('button:has-text("Delete")').isDisabled()).toBe(true)
    expect(await axeViolations(app.page)).toEqual([])
    await tile.locator('button:has-text("Insert")').click()
    await app.page.waitForSelector('.props .comp')
    expect(await app.page.locator('.props .comp-name').innerText()).toContain('Round gem digit')
    expect(await sourceText()).toContain('{{cost}}')
  })
})

describe('the built-in icons', () => {
  it('are found by name in the library, and one put into a template is a set of parts that can each be recoloured', async () => {
    await freshProject(); await show()
    await app.page.click('button[aria-label^="Components"]'); await dialog().waitFor()
    await dialog().locator('.tile').first().waitFor()
    await dialog().locator('input.field').fill('sword')
    await expect.poll(() => dialog().locator('.tile').count()).toBe(1)
    const tile = dialog().locator('.tile', { hasText: 'Sword icon' })
    expect(await tile.locator('.dim').innerText()).toBe('built in')
    await tile.locator('button:has-text("Insert")').click()
    await app.page.waitForSelector('.props .comp')
    expect(await app.page.locator('.props .comp-name').innerText()).toContain('Sword icon')
    const src = await sourceText()
    for (const part of ['blade', 'fuller', 'guard', 'grip', 'pommel']) expect(src).toContain(`data-spadewick-part="${part}"`)   // each part is named, so each can be recoloured
    expect(await app.page.locator('.props .parts li').count()).toBeGreaterThanOrEqual(5)
  })
})

describe('the library dialog', () => {
  it('renames, finds and deletes a component; a template that used it keeps its copy', async () => {
    await freshProject(); await show()
    await makeFromSelection()
    await app.page.click('button[aria-label^="Components"]'); await dialog().waitFor()
    app.answer('Greeting')
    await dialog().locator('button[aria-label="Rename Hello box"]').click()
    await app.page.waitForSelector('.tile:has-text("Greeting")')
    await dialog().locator('input.field').fill('zzz')
    expect(await dialog().locator('.none').innerText()).toContain('No component matches')
    await dialog().locator('input.field').fill('greet')
    await dialog().locator('button[aria-label="Delete Greeting from the library"]').click()
    await app.page.waitForSelector('.none')
    expect(await dialog().locator('.none').innerText()).toContain('No component matches')       // the built-in ones are still in the library
    expect((await app.invoke('components:list')).filter(c => !c.builtIn)).toEqual([])
    await dialog().locator('button:has-text("Close")').click()
    expect(await sourceText()).toContain('data-spadewick-component-name="Hello box"')   // the instance is still there, and draws
  })
})
