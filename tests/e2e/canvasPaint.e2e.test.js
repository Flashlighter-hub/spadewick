/**
 * The Appearance section (A80): gradients, stroke options, opacity and blend mode, drop shadow and blur, and the colours of the template as
 * swatches. Checked in the SVG the editor writes, and in the picture the card is drawn with.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const TPL = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ffffff"/>'
  + '<rect data-spadewick-id="a" x="50" y="50" width="200" height="100" fill="#c8553d" stroke="#222222" stroke-width="2"/>'
  + '<rect data-spadewick-id="b" x="50" y="250" width="200" height="100" fill="#3d7bc8"/>'
  + '</svg>'

async function openEditor() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `paint-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A' } }], template: { svg: TPL } })
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
const tagOf = (src, id) => new RegExp(`<[a-z]+[^>]*data-spadewick-id="${id}"[^>]*>`).exec(src)?.[0] ?? ''
const attr = (src, id, name) => new RegExp(` ${name}="([^"]*)"`).exec(tagOf(src, id))?.[1] ?? null
const select = async (x, y, mods = []) => { const h = await host(); for (const m of mods) await app.page.keyboard.down(m); await app.page.mouse.click(h.x + x, h.y + y); for (const m of mods) await app.page.keyboard.up(m) }
const props = () => app.page.locator('.props')
const set = async (locator, value) => { await locator.fill(String(value)); await locator.dispatchEvent('change') }

describe('fill: colours and gradients', () => {
  beforeEach(openEditor)

  it('a gradient of its own: two stops to start with, a stop can be added, moved and removed, and Solid brings the colour back', async () => {
    await select(100, 100)
    await props().locator('.seg button:has-text("Linear")').click()
    await expect.poll(async () => attr(await sourceText(), 'a', 'fill'), { timeout: 5000 }).toBe('url(#grad_a)')
    let src = await sourceText()
    expect(src).toMatch(/<linearGradient[^>]*id="grad_a"/)
    expect((src.match(/<stop /g) ?? []).length).toBe(2)
    expect(src).toMatch(/stop-color="#c8553d"/)                                // it starts from the colour it had
    await props().locator('button:has-text("Add stop")').click()
    await expect.poll(async () => ((await sourceText()).match(/<stop /g) ?? []).length, { timeout: 5000 }).toBe(3)
    await set(props().locator('input[aria-label="Stop 1 colour"]'), '#00ff00')
    await expect.poll(async () => (await sourceText()).includes('stop-color="#00ff00"'), { timeout: 5000 }).toBe(true)
    await set(props().locator('input[aria-label^="Stop 2 position"]'), 20)
    await expect.poll(async () => (await sourceText()).includes('offset="20%"'), { timeout: 5000 }).toBe(true)
    await props().locator('button[aria-label="Remove stop 2"]').click()
    await expect.poll(async () => ((await sourceText()).match(/<stop /g) ?? []).length, { timeout: 5000 }).toBe(2)
    expect(await props().locator('button[aria-label^="Remove stop"]').first().isDisabled()).toBe(true)     // two is the least
    await set(props().locator('.row label:has-text("Angle") input'), 0)
    await expect.poll(async () => /x1="0"[^>]*y1="0.5"[^>]*x2="1"/.test(await sourceText()), { timeout: 5000 }).toBe(true)
    await props().locator('.seg button:has-text("Radial")').click()
    await expect.poll(async () => (await sourceText()).includes('<radialGradient'), { timeout: 5000 }).toBe(true)
    expect((await sourceText()).includes('<linearGradient')).toBe(false)
    await props().locator('.seg button:has-text("Solid")').click()
    await expect.poll(async () => attr(await sourceText(), 'a', 'fill'), { timeout: 5000 }).toBe('#00ff00')
    src = await sourceText()
    expect(src.includes('Gradient')).toBe(false)                                // the definition went with it
    expect(app.errors).toEqual([])
  })

  it('the card picture shows the gradient', async () => {
    await select(100, 100)
    await props().locator('.seg button:has-text("Linear")').click()
    await set(props().locator('input[aria-label="Stop 1 colour"]'), '#ff0000')
    await set(props().locator('input[aria-label="Stop 2 colour"]'), '#0000ff')
    await set(props().locator('.row label:has-text("Angle") input'), 0)
    const px = x => app.page.evaluate(([x, y]) => { const c = document.querySelectorAll('.stage-view canvas')[0]; const hb = document.querySelector('.stage-host').getBoundingClientRect(), cb = c.getBoundingClientRect(), ox = hb.left - cb.left, oy = hb.top - cb.top; return [...c.getContext('2d').getImageData(Math.round(x + ox), Math.round(y + oy), 1, 1).data] }, [x, 120])
    await expect.poll(async () => { const p = await px(55); return p[3] === 255 && p[0] > 200 }, { timeout: 8000 }).toBe(true)
    const left = await px(55), right = await px(245)
    expect(left[2]).toBeLessThan(80)
    expect(right[2]).toBeGreaterThan(180)
    expect(right[0]).toBeLessThan(80)
  })

  it('a gradient applies to every selected element, each with its own', async () => {
    await select(100, 100); await select(100, 300, ['Shift'])
    await expect.poll(() => app.page.locator('.props-title').innerText()).toMatch(/2 elements selected/)
    await props().locator('.seg button:has-text("Linear")').click()
    await expect.poll(async () => attr(await sourceText(), 'b', 'fill'), { timeout: 5000 }).toBe('url(#grad_b)')
    expect(attr(await sourceText(), 'a', 'fill')).toBe('url(#grad_a)')
  })

  it('offers the colours the template already uses, and a tap uses one', async () => {
    await select(100, 100)
    const chips = props().locator('.swatches').first().locator('button.sw')
    expect(await chips.evaluateAll(b => b.map(x => x.getAttribute('title')))).toEqual(['#ffffff', '#c8553d', '#222222', '#3d7bc8'])
    await props().locator('.swatches').first().locator('button[title="#3d7bc8"]').click()
    await expect.poll(async () => attr(await sourceText(), 'a', 'fill'), { timeout: 5000 }).toBe('#3d7bc8')
  })
})

describe('stroke, opacity and blend mode', () => {
  beforeEach(openEditor)

  it('width, dashes, dots, ends and corners, and the dash pattern follows the width', async () => {
    await select(100, 100)
    await set(props().locator('label:has-text("Width") input'), 4)
    await props().locator('label:has-text("Line") select').selectOption('dashed')
    await expect.poll(async () => attr(await sourceText(), 'a', 'stroke-dasharray'), { timeout: 5000 }).toBe('12 8')
    expect(attr(await sourceText(), 'a', 'stroke-width')).toBe('4')
    await set(props().locator('label:has-text("Width") input'), 10)
    await expect.poll(async () => attr(await sourceText(), 'a', 'stroke-dasharray'), { timeout: 5000 }).toBe('30 20')
    await props().locator('label:has-text("Line") select').selectOption('dotted')
    await expect.poll(async () => attr(await sourceText(), 'a', 'stroke-dasharray'), { timeout: 5000 }).toBe('0 20')
    expect(attr(await sourceText(), 'a', 'stroke-linecap')).toBe('round')
    await props().locator('label:has-text("Corners") select').selectOption('bevel')
    await expect.poll(async () => attr(await sourceText(), 'a', 'stroke-linejoin'), { timeout: 5000 }).toBe('bevel')
    await props().locator('label:has-text("Line") select').selectOption('solid')
    await expect.poll(async () => attr(await sourceText(), 'a', 'stroke-dasharray'), { timeout: 5000 }).toBeNull()
  })

  it('opacity and blend mode are written, and Normal takes the blend mode away', async () => {
    await select(100, 100)
    await set(props().locator('label:has-text("Opacity") input[type=range]'), 0.5)
    await expect.poll(async () => attr(await sourceText(), 'a', 'opacity'), { timeout: 5000 }).toBe('0.5')
    await props().locator('label:has-text("Blend mode") select').selectOption('multiply')
    await expect.poll(async () => attr(await sourceText(), 'a', 'style'), { timeout: 5000 }).toBe('mix-blend-mode:multiply')
    await props().locator('label:has-text("Blend mode") select').selectOption('normal')
    await expect.poll(async () => attr(await sourceText(), 'a', 'style'), { timeout: 5000 }).toBeNull()
  })
})

describe('shadow and blur', () => {
  beforeEach(openEditor)

  it('a drop shadow is a filter of its own with the values typed, and goes away when switched off', async () => {
    await select(100, 100)
    await props().locator('label:has-text("Drop shadow") input').check()
    await expect.poll(async () => attr(await sourceText(), 'a', 'filter'), { timeout: 5000 }).toBe('url(#fx_a)')
    let src = await sourceText()
    expect(src).toMatch(/<feDropShadow[^>]*dx="4"[^>]*dy="4"/)
    await set(props().locator('.paint label:has-text("X") input').first(), 10)
    await expect.poll(async () => /<feDropShadow[^>]*dx="10"/.test(await sourceText()), { timeout: 5000 }).toBe(true)
    await set(props().locator('label:has-text("Opacity (%)") input'), 60)
    await expect.poll(async () => /flood-opacity="0.6"/.test(await sourceText()), { timeout: 5000 }).toBe(true)
    await set(props().locator('fieldset:has-text("Effects") label:has-text("Blur") input').last(), 3)
    await expect.poll(async () => (await sourceText()).includes('<feGaussianBlur'), { timeout: 5000 }).toBe(true)
    await props().locator('label:has-text("Drop shadow") input').uncheck()
    await set(props().locator('fieldset:has-text("Effects") label:has-text("Blur") input').last(), 0)
    await expect.poll(async () => attr(await sourceText(), 'a', 'filter'), { timeout: 5000 }).toBeNull()
    src = await sourceText()
    expect(src.includes('<filter')).toBe(false)
  })

  it('the card picture shows the shadow', async () => {
    await select(100, 100)
    await props().locator('label:has-text("Drop shadow") input').check()
    await set(props().locator('.paint label:has-text("X") input').first(), 30)
    await set(props().locator('.paint label:has-text("Y") input').first(), 30)
    await set(props().locator('fieldset:has-text("Effects") label:has-text("Blur") input').first(), 0)
    await set(props().locator('label:has-text("Opacity (%)") input'), 100)
    const px = (x, y) => app.page.evaluate(([x, y]) => { const c = document.querySelectorAll('.stage-view canvas')[0]; const hb = document.querySelector('.stage-host').getBoundingClientRect(), cb = c.getBoundingClientRect(), ox = hb.left - cb.left, oy = hb.top - cb.top; return [...c.getContext('2d').getImageData(Math.round(x + ox), Math.round(y + oy), 1, 1).data] }, [x, y])
    await expect.poll(async () => { const p = await px(270, 160); return p[3] === 255 && p[0] < 80 }, { timeout: 8000 }).toBe(true)     // beside the red rectangle, inside the shadow (opaque: the picture is there)
    expect((await px(100, 100))[0]).toBeGreaterThan(150)                                                    // the rectangle itself is still red
  })

  it('passes axe with a gradient and a shadow open', async () => {
    await select(100, 100)
    await props().locator('.seg button:has-text("Linear")').click()
    await props().locator('label:has-text("Drop shadow") input').check()
    await expect.poll(() => props().locator('.stop').count()).toBe(2)
    expect(await axeViolations(app.page)).toEqual([])
  })
})
