/**
 * PRD §8.7 — template editor improvements: source on demand, layers panel, live image resizing,
 * edge snapping and alignment guides. (Run with the rest of the end-to-end suite: npm run test:e2e.)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { startApp } from './harness.js'
import { seedSet, makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

// SVG order: the background (no id), then title, then frame: so the frame is in front
const TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><text data-spadewick-id="title" x="30" y="70" font-size="40" fill="#ffffff">{{name}}</text><rect data-spadewick-id="frame" x="40" y="120" width="200" height="100" fill="#cc3333"/></svg>`

async function openEditor(svg = TEMPLATE) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `tpl-${Date.now()}`, parentDir: app.root })
  const seeded = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }, { name: 'Art', type: 'image_ref' }], cards: [{ name: 'Orc', fields: { name: 'Orc' } }], template: { svg } })
  await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
  await app.goto()
  await app.page.click('.set-item')
  await app.page.click('button[role=tab]:has-text("Template Editor")')
  await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
  await app.page.waitForSelector('.template-editor canvas')
  return seeded
}

const openSource = async () => { await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('textarea.svg-source') }
const closeSource = () => app.page.click('[role=dialog] button:has-text("Done")')
const sourceText = async () => { await openSource(); const v = await app.page.locator('textarea.svg-source').inputValue(); await closeSource(); return v }
const canvasBox = () => app.page.locator('.stage-host').boundingBox()   // the card (the canvases reach past it: the pasteboard)
/** Click on the canvas until the element with this id is selected (the handles appear a moment after the canvas does). */
async function selectOnCanvas(x, y, id) {
  const box = await canvasBox()
  for (let i = 0; i < 15; i++) {
    await app.page.mouse.click(box.x + x, box.y + y)
    if (await app.page.locator(`.props-title:has-text("${id}")`).count()) return
    await app.page.waitForTimeout(250)
  }
  throw new Error(`could not select ${id} on the canvas`)
}
const layerLabels = () => app.page.locator('.layers .row .label').allInnerTexts()

describe('source on demand (PRD §8.7.1)', () => {
  beforeEach(async () => { await openEditor() })

  it('has no always-visible source pane or view switcher; View source opens a dialog and Escape returns focus', async () => {
    expect(await app.page.locator('textarea.svg-source').count()).toBe(0)
    expect(await app.page.locator('.views').count()).toBe(0)
    await app.page.click('button:has-text("View source")')
    await app.page.waitForSelector('[role=dialog] textarea.svg-source')
    expect(await app.page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))).toBe(true)
    await app.page.keyboard.press('Escape')
    await app.page.waitForSelector('[role=dialog]', { state: 'detached' })
    expect(await app.page.evaluate(() => document.activeElement?.textContent)).toMatch(/View source/)
  })

  it('applies edits as they are typed, records them for undo, and Revert restores the opening source', async () => {
    const original = await sourceText()
    await openSource()
    await app.page.locator('textarea.svg-source').fill(original + '<!-- edited -->')
    await closeSource()
    await app.page.waitForSelector('.unsaved')
    await app.menu('menu:undo')
    await expect.poll(sourceText, { timeout: 5000 }).toBe(original)

    await openSource()
    await app.page.locator('textarea.svg-source').fill(original + '<!-- again -->')
    await app.page.click('[role=dialog] button:has-text("Revert")')
    expect(await app.page.locator('textarea.svg-source').inputValue()).toBe(original)
    await closeSource()
  })

  it('shows the parse error with its line when the source is not valid SVG, and the canvas says so', async () => {
    await openSource()
    await app.page.locator('textarea.svg-source').fill('<svg xmlns="http://www.w3.org/2000/svg">\n<rect>\n</svg>')
    await app.page.waitForSelector('[role=dialog] [role=alert]')
    expect(await app.page.locator('[role=dialog] [role=alert]').innerText()).toMatch(/not valid SVG \(line \d+\)/)
    await closeSource()
    expect(await app.page.locator('.canvas-editor .banner.err').innerText()).toMatch(/View source/)
  })

  it('opens with the caret at the selected element', async () => {
    await selectOnCanvas(40, 60, 'title')   // the title text
    await openSource()
    const [at, value] = await app.page.evaluate(() => { const t = document.querySelector('textarea.svg-source'); return [t.selectionStart, t.value] })
    expect(at).toBe(value.indexOf('<text data-spadewick-id="title"'))
    await closeSource()
  })
})

describe('layers panel (PRD §8.7.2)', () => {
  beforeEach(async () => { await openEditor() })

  it('lists the selectable elements front-most first, and background elements are not listed', async () => {
    expect(await layerLabels()).toEqual(['frame', '{{name}}'])
    expect(await app.page.locator('.layers .hint').last().innerText()).toMatch(/without an id are background/)
  })

  it('selects in both directions', async () => {
    await app.page.click('button[data-layer="title"]')
    await app.page.waitForSelector('.props-title:has-text("title")')
    await selectOnCanvas(100, 150, 'frame')
    await app.page.waitForSelector('button[data-layer="frame"][aria-current="true"]')
  })

  it('reorders with Alt+arrows, announces the move, and each move is one undo step', async () => {
    await app.page.focus('button[data-layer="frame"]')
    await app.page.keyboard.press('Alt+ArrowDown')            // one step towards the back
    await expect.poll(layerLabels).toEqual(['{{name}}', 'frame'])
    expect(await app.page.locator('.layers [role=status]').innerText()).toMatch(/frame moved to position 2 of 2/)
    expect(await sourceText()).toMatch(/data-spadewick-id="frame"[\s\S]*data-spadewick-id="title"/)

    await app.menu('menu:undo')
    await expect.poll(layerLabels).toEqual(['frame', '{{name}}'])

    await app.page.focus('button[data-layer="title"]')
    await app.page.keyboard.press('Alt+Home')                 // to the front
    await expect.poll(layerLabels).toEqual(['{{name}}', 'frame'])
    await app.page.keyboard.press('Alt+End')                  // and back again
    await expect.poll(layerLabels).toEqual(['frame', '{{name}}'])
  })

  it('reorders by dragging a row', async () => {
    const from = await app.page.locator('.layers .row', { hasText: 'frame' }).boundingBox()
    const to = await app.page.locator('.layers .row', { hasText: '{{name}}' }).boundingBox()
    await app.page.mouse.move(from.x + 30, from.y + from.height / 2); await app.page.mouse.down()
    await app.page.mouse.move(to.x + 30, to.y + to.height - 3, { steps: 10 })   // the lower half of the title's row: behind it
    await app.page.mouse.up()
    await expect.poll(layerLabels).toEqual(['{{name}}', 'frame'])
  })

  it('renames an element id with F2: unique and well-formed ids only', async () => {
    await app.page.focus('button[data-layer="frame"]')
    await app.page.keyboard.press('F2')
    await app.page.keyboard.type('title')                       // taken (typed after the existing text is selected)
    await app.page.keyboard.press('Enter')
    await app.page.waitForSelector('.layers [role=alert]')
    expect(await app.page.locator('.layers [role=alert]').innerText()).toMatch(/already has the id title/)
    await app.page.keyboard.press('Control+A'); await app.page.keyboard.type('1bad')
    await app.page.keyboard.press('Enter')
    expect(await app.page.locator('.layers [role=alert]').innerText()).toMatch(/starts with a letter/)
    await app.page.keyboard.press('Control+A'); await app.page.keyboard.type('badge')
    await app.page.keyboard.press('Enter')
    await app.page.waitForSelector('button[data-layer="badge"]')
    expect(await sourceText()).toMatch(/data-spadewick-id="badge"/)
    expect(await sourceText()).not.toMatch(/data-spadewick-id="frame"/)
  })

  it('hides and locks in the editor only: the SVG is never changed', async () => {
    const before = await sourceText()
    await app.page.click('.layers .row:has-text("frame") .mini:has-text("Hide")')
    await app.page.waitForSelector('.layers .row:has-text("frame") .badge:has-text("hidden")')
    await app.page.click('.layers .row:has-text("{{name}}") .mini:has-text("Lock")')
    await app.page.waitForSelector('.layers .row:has-text("{{name}}") .badge:has-text("locked")')
    const after = await sourceText()
    expect(after).toBe(before)
    expect(after).not.toMatch(/display="none"/)
  })
})

describe('edge snapping and alignment guides (PRD §8.7.4)', () => {
  beforeEach(async () => { await app.invoke('settings:set', 'canvas_smart_guides', true); await openEditor() })

  /** Drag the "frame" rectangle left by `dx` pixels and return its saved x. */
  async function dragFrame(dx, { alt = false } = {}) {
    await selectOnCanvas(100, 150, 'frame')
    const box = await canvasBox()
    await app.page.mouse.move(box.x + 100, box.y + 150); await app.page.mouse.down()
    if (alt) await app.page.keyboard.down('Alt')
    await app.page.mouse.move(box.x + 100 + dx, box.y + 150, { steps: 8 })
    await app.page.mouse.up()
    if (alt) await app.page.keyboard.up('Alt')
    return (/data-spadewick-id="frame" x="([\d.-]+)"/.exec(await sourceText()) || [])[1]
  }

  it('is on by default and the toggle is remembered', async () => {
    const btn = app.page.locator('.canvas-editor .toolbar button:has-text("Guides")')
    expect(await btn.getAttribute('aria-pressed')).toBe('true')
    await btn.click()
    expect(await btn.getAttribute('aria-pressed')).toBe('false')
    expect(await app.invoke('settings:get', 'canvas_smart_guides')).toBe(false)
    await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    expect(await app.page.locator('.canvas-editor .toolbar button:has-text("Guides")').getAttribute('aria-pressed')).toBe('false')
  })

  it('snaps an element near the card edge onto it', async () => {
    expect(await dragFrame(-37)).toBe('0')   // x would be 3; the card edge is within 6 px
  })

  it('holding Alt pauses snapping for that drag', async () => {
    expect(await dragFrame(-37, { alt: true })).toBe('3')
  })

  it('leaves positions alone when Guides is off', async () => {
    await app.invoke('settings:set', 'canvas_smart_guides', false)
    await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')
    expect(await dragFrame(-37)).toBe('3')
  })
})

describe('live image resizing (PRD §8.7.3)', () => {
  it('draws the image at its new size while the handle is still being dragged', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `live-${Date.now()}`, parentDir: app.root })
    const [asset] = await app.invoke('assets:import', [await makePng(join(app.root, 'live.png'), 60, 60, '#ff0000')])
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/><image data-spadewick-id="pic" href="{{@asset.${asset.id}}}" x="40" y="120" width="100" height="100" preserveAspectRatio="none"/></svg>`
    const seeded = await seedSet({ name: 'Base', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'Orc', fields: { name: 'Orc' } }], template: { svg } })
    await app.invoke('sets:update', { id: seeded.set.id, defaultTemplateId: seeded.template.id })
    await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl', { hasText: 'Base' }).click()
    await app.page.waitForSelector('.template-editor canvas')

    const box = await canvasBox()
    await selectOnCanvas(60, 150, 'pic')                        // select the image
    await app.page.waitForTimeout(2500)                          // the card without the image is prepared in the background

    // drag the bottom-right handle from (140, 220) to (240, 320) and look at the live layer before releasing
    await app.page.mouse.move(box.x + 140, box.y + 220); await app.page.mouse.down()
    await app.page.mouse.move(box.x + 240, box.y + 320, { steps: 8 })
    const alpha = await app.page.evaluate(([x, y]) => {
      const canvases = [...document.querySelectorAll('.stage-view canvas')]      // background, live, grid, handles
      const c = canvases[1], r = window.devicePixelRatio || 1
      const hb = document.querySelector('.stage-host').getBoundingClientRect(), cb = c.getBoundingClientRect(), ox = hb.left - cb.left, oy = hb.top - cb.top
      return c.getContext('2d').getImageData(Math.round((x + ox) * r), Math.round((y + oy) * r), 1, 1).data[3]
    }, [200, 280])
    await app.page.mouse.up()
    expect(alpha).toBeGreaterThan(0)   // the picture already covers the new area (200, 280); before this change the layer was empty

    // Escape during a drag leaves the template unchanged
    const before = await sourceText()
    await app.page.mouse.move(box.x + 240, box.y + 320); await app.page.mouse.down()
    await app.page.mouse.move(box.x + 300, box.y + 380, { steps: 4 })
    await app.page.keyboard.press('Escape')
    await app.page.mouse.up()
    expect(await sourceText()).toBe(before)
  })
})

describe('resizing an element that overlaps another (Fixes F4)', () => {
  it('the corner handles of a selected element in front of another stay usable', async () => {
    // A text box lying entirely inside an image: every corner of the text is over the image's own handle
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
      + '<rect data-spadewick-id="art" x="40" y="120" width="300" height="300" fill="#44aa88"/>'
      + '<text data-spadewick-id="label" data-spadewick-field="name" data-spadewick-text-fit="wrap" x="80" y="160" width="120" height="60" font-size="20" fill="#000000">{{name}}</text></svg>'
    await openEditor(svg)
    await selectOnCanvas(100, 180, 'label')              // the front element wins the click
    const box = await canvasBox()
    await app.page.mouse.move(box.x + 200, box.y + 220); await app.page.mouse.down()   // its bottom-right corner, inside the image
    await app.page.mouse.move(box.x + 240, box.y + 260, { steps: 6 }); await app.page.mouse.up()
    await expect.poll(sourceText, { timeout: 5000 }).toMatch(/data-spadewick-id="label"[^>]*width="160"[^>]*height="100"/)
    expect(await app.page.locator('.props-title').innerText()).toMatch(/label/)   // and it stayed selected: no switch to the image
  })
})

describe('live text while dragging (PRD §8.7.3)', () => {
  it('re-renders the card with the text at its dragged place before the mouse is released, and Escape leaves it alone', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
      + '<text data-spadewick-id="label" data-spadewick-field="name" data-spadewick-text-fit="wrap" x="80" y="160" width="160" height="60" font-size="40" font-weight="bold" fill="#000000">{{name}}</text></svg>'
    await openEditor(svg)
    await selectOnCanvas(100, 180, 'label')
    const box = await canvasBox()
    const inkAt = (x0, y0, w, h) => app.page.evaluate(([x, y, w, h]) => {
      const c = document.querySelectorAll('.stage-view canvas')[0], r = window.devicePixelRatio || 1
      const hb = document.querySelector('.stage-host').getBoundingClientRect(), cb = c.getBoundingClientRect(), ox = hb.left - cb.left, oy = hb.top - cb.top
      const d = c.getContext('2d').getImageData(Math.round((x + ox) * r), Math.round((y + oy) * r), Math.round(w * r), Math.round(h * r)).data
      let dark = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 0) dark++
      return dark
    }, [x0, y0, w, h])
    const before = await sourceText()
    await expect.poll(() => inkAt(80, 160, 160, 60), { timeout: 15000 }).toBeGreaterThan(20)   // the first render has arrived

    await app.page.mouse.move(box.x + 140, box.y + 190); await app.page.mouse.down()
    await app.page.mouse.move(box.x + 140, box.y + 390, { steps: 10 })      // 200 px lower
    await expect.poll(() => inkAt(80, 350, 160, 60), { timeout: 5000 }).toBeGreaterThan(20)   // text drawn at the new place, mouse still down
    expect(await inkAt(80, 160, 160, 40)).toBe(0)                                           // and gone from the old one
    await app.page.keyboard.press('Escape')
    await app.page.mouse.up()
    expect(await sourceText()).toBe(before)
    await expect.poll(() => inkAt(80, 160, 160, 60), { timeout: 5000 }).toBeGreaterThan(20)   // back where it was
  })
})

describe('freetext in the properties panel', () => {
  it('an unbound text is edited in the panel, the same on every card, and undone in one step', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
      + '<text data-spadewick-id="label" x="60" y="160" font-size="40" fill="#000000">Text</text></svg>'
    await openEditor(svg)
    await selectOnCanvas(80, 150, 'label')
    const box = app.page.locator('textarea.literal')
    await box.waitFor()
    await box.fill('Attack')
    await box.blur()
    await expect.poll(sourceText, { timeout: 5000 }).toMatch(/data-spadewick-id="label"[^>]*>Attack<\/text>/)
    await app.page.keyboard.press('Control+z')
    await expect.poll(sourceText, { timeout: 5000 }).toMatch(/>Text<\/text>/)
  })

  it('a bound text has no freetext box until the binding is set to none', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
      + '<text data-spadewick-id="label" x="60" y="160" font-size="40" fill="#000000">{{name}}</text></svg>'
    await openEditor(svg)
    await selectOnCanvas(80, 150, 'label')
    expect(await app.page.locator('textarea.literal').count()).toBe(0)
    await app.page.locator('label:has-text("Field binding") select').selectOption('')
    await app.page.locator('textarea.literal').waitFor()
  })
})

describe('a template with a shared frame (Fixes F14)', () => {
  it('lists the frame with its child under it, and the child opens in the canvas without an XML error', async () => {
    await app.invoke('projects:close').catch(() => {})
    await app.invoke('projects:create', { name: `frame-${Date.now()}`, parentDir: app.root })
    const seeded = await seedSet({ name: 'Creatures', cardSize: 'poker', fields: [] })
    await app.invoke('templatelib:use', { kind: 'starter', id: 'example-creature', setId: seeded.set.id, includeSampleCards: true, makeDefault: true })
    await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.waitForSelector('.template-list .tpl')
    const rows = await app.page.locator('.template-list li').evaluateAll(lis => lis.map(li => ({ child: li.classList.contains('child'), text: li.innerText.replace(/\s+/g, ' ').trim() })))
    expect(rows).toEqual([{ child: false, text: 'Creature frame frame' }, { child: true, text: 'Creature child' }])
    await app.page.locator('.template-list li.child .tpl').click()
    await app.page.waitForSelector('.template-editor canvas')
    expect(await app.page.locator('text=not valid XML').count()).toBe(0)
    await expect.poll(() => app.page.locator('.layers .row').count(), { timeout: 8000 }).toBeGreaterThan(3)   // the title, cost, art, type, rules... are elements the editor can select
  })
})
