/**
 * The template canvas (A80): selecting several elements, moving and resizing them together, copy, paste, duplicate, group and ungroup.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
  + '<rect data-spadewick-id="a" x="50" y="50" width="100" height="60" fill="#c8553d"/>'
  + '<rect data-spadewick-id="b" x="200" y="50" width="100" height="60" fill="#3d7bc8"/>'
  + '<rect data-spadewick-id="c" x="50" y="200" width="100" height="60" fill="#3dc86b"/>'
  + '</svg>'

async function openEditor(svg = TPL) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `sel-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }], template: { svg } })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  await app.page.waitForSelector('.zoombar')
}
const host = () => app.page.locator('.stage-host').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top } })
const sourceText = async () => {
  await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source')
  const t = await app.page.locator('textarea.svg-source').inputValue()
  await app.page.keyboard.press('Escape'); await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
  return t
}
/** The attributes of the element with this id, as a plain object. */
const attrsOf = (src, id) => {
  const tag = new RegExp(`<[a-z]+[^>]*data-spadewick-id="${id}"[^>]*>`).exec(src)
  if (!tag) return null
  return Object.fromEntries([...tag[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
}
const click = async (x, y, mods = []) => {
  const h = await host()
  for (const m of mods) await app.page.keyboard.down(m)
  await app.page.mouse.click(h.x + x, h.y + y)
  for (const m of mods) await app.page.keyboard.up(m)
}
const title = () => app.page.locator('.props-title').innerText()
const selectAB = async () => { await click(100, 80); await click(250, 80, ['Shift']); await expect.poll(title).toMatch(/2 elements selected/) }

describe('selecting several', () => {
  beforeEach(() => openEditor())

  it('Shift+click adds and takes out; the panel says how many; Escape and a click on empty canvas let go', async () => {
    await click(100, 80)
    expect(await title()).toMatch(/rect · a/)
    await click(250, 80, ['Shift'])
    expect(await title()).toMatch(/2 elements selected/)
    await click(100, 230, ['Control'])
    expect(await title()).toMatch(/3 elements selected/)
    await click(100, 230, ['Shift'])                                    // out again
    expect(await title()).toMatch(/2 elements selected/)
    await app.page.keyboard.press('Escape')
    await expect.poll(() => app.page.locator('.props-title').count()).toBe(0)
    await click(100, 80); await click(400, 500)                         // empty canvas
    await expect.poll(() => app.page.locator('.props-title').count()).toBe(0)
    expect(app.errors).toEqual([])
  })

  it('Ctrl+A selects everything that can be selected', async () => {
    await app.page.mouse.move(400, 400)
    await app.page.keyboard.press('Control+a')
    await expect.poll(title).toMatch(/3 elements selected/)
  })

  it('a rubber band selects what it touches, and Shift adds to the selection', async () => {
    const h = await host()
    await app.page.mouse.move(h.x + 20, h.y + 20); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 330, h.y + 140, { steps: 6 }); await app.page.mouse.up()    // a and b, not c
    await expect.poll(title).toMatch(/2 elements selected/)
    await app.page.keyboard.press('Escape')
    await app.page.mouse.move(h.x + 20, h.y + 20); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 330, h.y + 140, { steps: 4 }); await app.page.mouse.up()
    await app.page.keyboard.down('Shift')
    await app.page.mouse.move(h.x + 20, h.y + 180); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 170, h.y + 280, { steps: 4 }); await app.page.mouse.up()
    await app.page.keyboard.up('Shift')
    await expect.poll(title).toMatch(/3 elements selected/)
  })

  it('Ctrl+click in the layers panel selects several too', async () => {
    await click(100, 80)
    await app.page.locator('.layers .row', { hasText: 'b' }).first().click({ modifiers: ['Control'] })
    await expect.poll(title).toMatch(/2 elements selected/)
  })
})

describe('moving and resizing several', () => {
  beforeEach(() => openEditor())

  it('dragging one of them moves them all, as one step of undo', async () => {
    await selectAB()
    const h = await host()
    await app.page.mouse.move(h.x + 100, h.y + 80); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 133, h.y + 100, { steps: 8 }); await app.page.mouse.up()       // +33, +20
    await expect.poll(async () => attrsOf(await sourceText(), 'b')?.x, { timeout: 5000 }).toBe('233')
    const src = await sourceText()
    expect(attrsOf(src, 'a')).toMatchObject({ x: '83', y: '70' })
    expect(attrsOf(src, 'b')).toMatchObject({ x: '233', y: '70' })
    expect(attrsOf(src, 'c')).toMatchObject({ x: '50', y: '200' })           // not selected: stays
    await app.menu('menu:undo')
    await expect.poll(async () => attrsOf(await sourceText(), 'a')?.x, { timeout: 5000 }).toBe('50')
    expect(attrsOf(await sourceText(), 'b')).toMatchObject({ x: '200', y: '50' })   // both came back in one step
  })

  it('the arrow keys nudge all of them', async () => {
    await selectAB()
    await app.page.mouse.move(600, 400)
    await app.page.keyboard.press('Shift+ArrowRight')
    await app.page.keyboard.press('ArrowDown')
    await expect.poll(async () => attrsOf(await sourceText(), 'b')?.y, { timeout: 5000 }).toBe('51')
    const src = await sourceText()
    expect(attrsOf(src, 'a')).toMatchObject({ x: '60', y: '51' })
    expect(attrsOf(src, 'b')).toMatchObject({ x: '210', y: '51' })
  })

  it('resizing the block scales every element with it', async () => {
    await selectAB()                         // the block is (50, 50) to (300, 110)
    const h = await host()
    await app.page.mouse.move(h.x + 300, h.y + 110); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 400, h.y + 110, { steps: 8 }); await app.page.mouse.up()       // 250 wide becomes 350: x 1.4
    await expect.poll(async () => attrsOf(await sourceText(), 'a')?.width, { timeout: 5000 }).toBe('140')
    const src = await sourceText()
    expect(attrsOf(src, 'a')).toMatchObject({ x: '50', width: '140' })
    expect(attrsOf(src, 'b')).toMatchObject({ x: '260', width: '140' })
    expect(attrsOf(src, 'a').height).toBe('60')
  })

  it('Escape in the middle of a drag leaves them where they were', async () => {
    await selectAB()
    const before = await sourceText()
    const h = await host()
    await app.page.mouse.move(h.x + 100, h.y + 80); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 160, h.y + 130, { steps: 5 })
    await app.page.keyboard.press('Escape')
    await app.page.mouse.up()
    expect(await sourceText()).toBe(before)
  })
})

describe('copy, paste, duplicate, delete', () => {
  beforeEach(() => openEditor())

  it('Ctrl+C and Ctrl+V put a copy on top, a little further each time; Ctrl+X cuts', async () => {
    await click(100, 80)
    await app.page.keyboard.press('Control+c')
    await app.page.keyboard.press('Control+v')
    await expect.poll(async () => attrsOf(await sourceText(), 'a_copy')?.x, { timeout: 5000 }).toBe('62')
    expect(attrsOf(await sourceText(), 'a_copy')).toMatchObject({ x: '62', y: '62', width: '100' })
    expect(await title()).toMatch(/rect · a_copy/)                       // the copy is what is selected
    await app.page.keyboard.press('Control+v')
    await expect.poll(async () => attrsOf(await sourceText(), 'a_copy2')?.x, { timeout: 5000 }).toBe('74')
    await click(100, 230)
    await app.page.keyboard.press('Control+x')
    await expect.poll(async () => attrsOf(await sourceText(), 'c'), { timeout: 5000 }).toBeNull()
    await app.page.keyboard.press('Control+v')
    await expect.poll(async () => attrsOf(await sourceText(), 'c')?.x, { timeout: 5000 }).toBe('62')
  })

  it('Ctrl+D duplicates the selection next to the originals, and Delete removes several at once', async () => {
    await selectAB()
    await app.page.keyboard.press('Control+d')
    await expect.poll(async () => attrsOf(await sourceText(), 'b_copy')?.x, { timeout: 5000 }).toBe('212')
    expect(await title()).toMatch(/2 elements selected/)
    await app.page.keyboard.press('Delete')
    await expect.poll(async () => attrsOf(await sourceText(), 'b_copy'), { timeout: 5000 }).toBeNull()
    expect(attrsOf(await sourceText(), 'a_copy')).toBeNull()
    expect(attrsOf(await sourceText(), 'a')).not.toBeNull()              // the originals stay
  })

  it('the Duplicate button does the same, and the new names are free ones', async () => {
    await click(100, 80)
    await app.page.click('.props button:has-text("Duplicate")')
    await expect.poll(async () => attrsOf(await sourceText(), 'a_copy')?.x, { timeout: 5000 }).toBe('62')
    await app.page.click('.props button:has-text("Duplicate")')                // a copy of the copy
    await expect.poll(async () => attrsOf(await sourceText(), 'a_copy2')?.x, { timeout: 5000 }).toBe('74')
  })
})

describe('grouping', () => {
  beforeEach(() => openEditor())

  it('Ctrl+G groups, the group moves as one and Ctrl+Shift+G takes it apart again', async () => {
    await selectAB()
    await app.page.keyboard.press('Control+g')
    await expect.poll(title).toMatch(/g · group_1/)
    let src = await sourceText()
    expect(src).toMatch(/<g[^>]*data-spadewick-id="group_1"[^>]*>\s*<rect[^>]*data-spadewick-id="a"[^>]*\/>\s*<rect[^>]*data-spadewick-id="b"/)
    expect(await app.page.locator('.layers .row').count()).toBe(4)          // the group, a, b (inside it) and c
    await app.page.keyboard.press('Control+Shift+g')
    await expect.poll(async () => (await sourceText()).includes('group_1'), { timeout: 5000 }).toBe(false)
    src = await sourceText()
    expect(attrsOf(src, 'a')).toMatchObject({ x: '50' })
    expect(attrsOf(src, 'b')).toMatchObject({ x: '200' })
    expect(await title()).toMatch(/2 elements selected/)                     // the children are selected
  })

  it('a moved group keeps its place when it is taken apart', async () => {
    await selectAB()
    await app.page.keyboard.press('Control+g')
    await expect.poll(title).toMatch(/group_1/)
    await app.page.keyboard.press('Shift+ArrowRight')                       // 10 to the right: a translate on the group
    await expect.poll(async () => (await sourceText()).includes('translate'), { timeout: 5000 }).toBe(true)
    await app.page.keyboard.press('Control+Shift+g')
    await expect.poll(async () => (await sourceText()).includes('group_1'), { timeout: 5000 }).toBe(false)
    const h = await host()
    await app.page.mouse.click(h.x + 120, h.y + 80)                          // a is now at 60..160
    await expect.poll(async () => (await title()).includes('rect · a'), { timeout: 5000 }).toBe(true)
    expect(attrsOf(await sourceText(), 'a').transform).toMatch(/translate\(10 0\)/)
  })

  it('says why it cannot group one element, and why it will not take a group with opacity apart', async () => {
    await click(100, 80)
    await app.page.keyboard.press('Control+g')
    await app.page.locator('.toast:has-text("Select two or more")').waitFor()
    await selectAB()
    await app.page.keyboard.press('Control+g')
    await expect.poll(title).toMatch(/group_1/)
    await app.page.locator('.props label:has-text("Opacity") input').fill('0.5')
    await app.page.locator('.props label:has-text("Opacity") input').dispatchEvent('change')
    await app.page.keyboard.press('Escape')
    await app.page.locator('.layers .row', { hasText: 'group_1' }).first().click()
    await app.page.mouse.move(600, 400)
    await app.page.keyboard.press('Control+Shift+g')
    await app.page.locator('.toast:has-text("opacity")').waitFor()
  })

  it('passes axe with several elements selected', async () => {
    await selectAB()
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('align and distribute', () => {
  const FOUR = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
    + '<rect data-spadewick-id="a" x="40" y="50" width="100" height="60" fill="#c8553d"/>'
    + '<rect data-spadewick-id="b" x="190" y="90" width="60" height="40" fill="#3d7bc8"/>'
    + '<rect data-spadewick-id="c" x="400" y="150" width="40" height="80" fill="#3dc86b"/>'
    + '</svg>'
  beforeEach(() => openEditor(FOUR))
  const button = name => app.page.locator(`.toolbar .aligners button[aria-label^="${name}"]`)

  it('the buttons are off with nothing selected, and distribute needs three', async () => {
    expect(await button('Align left').isDisabled()).toBe(true)
    await click(90, 80)
    expect(await button('Align left').isDisabled()).toBe(false)
    expect(await button('Space evenly across').isDisabled()).toBe(true)
    await click(220, 110, ['Shift'])
    expect(await button('Space evenly across').isDisabled()).toBe(true)
    await click(420, 190, ['Shift'])
    expect(await button('Space evenly across').isDisabled()).toBe(false)
  })

  it('one element aligns to the card, several to the block that holds them', async () => {
    await click(90, 80)
    await button('Align horizontal centres').click()
    await expect.poll(async () => attrsOf(await sourceText(), 'a')?.x, { timeout: 5000 }).toBe('200')     // (500 - 100) / 2
    await button('Align bottom edges').click()
    await expect.poll(async () => attrsOf(await sourceText(), 'a')?.y, { timeout: 5000 }).toBe('640')
    await app.page.keyboard.press('Escape')
    await app.page.mouse.move(600, 500)
    await app.page.keyboard.press('Control+a')
    await expect.poll(title).toMatch(/3 elements selected/)
    await button('Align left edges').click()
    await expect.poll(async () => attrsOf(await sourceText(), 'c')?.x, { timeout: 5000 }).toBe('190')     // the left-most is b at 190 now, a at 200
    const src = await sourceText()
    expect(attrsOf(src, 'a').x).toBe('190')
    expect(attrsOf(src, 'b').x).toBe('190')
  })

  it('distributes three elements so the gaps are equal, as one step of undo', async () => {
    await app.page.mouse.move(600, 500)
    await app.page.keyboard.press('Control+a')
    await expect.poll(title).toMatch(/3 elements selected/)
    await button('Space evenly across').click()
    // a: 40..140, b: 190..250, c: 400..440: the gap is (440 - 40 - 100 - 60 - 40) / 2 = 100
    await expect.poll(async () => attrsOf(await sourceText(), 'b')?.x, { timeout: 5000 }).toBe('240')
    const src = await sourceText()
    expect(attrsOf(src, 'a').x).toBe('40')
    expect(attrsOf(src, 'c').x).toBe('400')
    await app.menu('menu:undo')
    await expect.poll(async () => attrsOf(await sourceText(), 'b')?.x, { timeout: 5000 }).toBe('190')
  })
})

describe('rotation', () => {
  beforeEach(() => openEditor())

  it('turning the handle writes a rotate() about the centre, and the panel shows the angle', async () => {
    await click(100, 80)                        // a: (50, 50) to (150, 110), centre (100, 80)
    const h = await host()
    await app.page.mouse.move(h.x + 100, h.y + 0); await app.page.mouse.down()               // the round handle, 50 above the top edge
    await app.page.mouse.move(h.x + 160, h.y + 40, { steps: 4 })
    await app.page.mouse.move(h.x + 200, h.y + 80, { steps: 4 })                            // level with the centre, to the right: a quarter turn
    await app.page.mouse.up()
    await expect.poll(async () => attrsOf(await sourceText(), 'a')?.transform, { timeout: 5000 }).toBe('rotate(90 100 80)')
    await expect.poll(() => app.page.locator('.props label:has-text("Rotation") input').inputValue()).toBe('90')
    expect(app.errors).toEqual([])
  })

  it('Escape in the middle of a turn leaves the element as it was', async () => {
    await click(100, 80)
    const before = await sourceText()
    const h = await host()
    await app.page.mouse.move(h.x + 100, h.y + 0); await app.page.mouse.down()
    await app.page.mouse.move(h.x + 200, h.y + 80, { steps: 6 })
    await app.page.keyboard.press('Escape')
    await app.page.mouse.up()
    expect(await sourceText()).toBe(before)
  })
})
