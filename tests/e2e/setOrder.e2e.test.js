/**
 * The order of the sets in the left panel is the person's: drag a set to a new place, or Alt+Up / Alt+Down on it; it is kept with the project.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

async function projectWithSets(...names) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `order-${Date.now()}`, parentDir: app.root })
  for (const name of names) await app.invoke('sets:create', { name })
  await app.goto()
  await app.page.waitForSelector('.set-row')
}
const shown = () => app.page.locator('.set-row .set-name').allInnerTexts()
const stored = async () => (await app.invoke('sets:list')).map(s => s.name)

describe('the order of the sets', () => {
  it('is changed by dragging a set above or below another, and is kept', async () => {
    await projectWithSets('Alpha', 'Beta', 'Gamma')
    expect(await shown()).toEqual(['Alpha', 'Beta', 'Gamma'])

    // Gamma to the top
    await app.page.locator('.set-row', { hasText: 'Gamma' }).dragTo(app.page.locator('.set-row', { hasText: 'Alpha' }), { targetPosition: { x: 40, y: 2 } })
    await app.page.waitForFunction(() => document.querySelector('.set-row .set-name')?.textContent === 'Gamma')
    expect(await shown()).toEqual(['Gamma', 'Alpha', 'Beta'])
    expect(await stored()).toEqual(['Gamma', 'Alpha', 'Beta'])

    // Gamma to the bottom, below the last set
    await app.page.locator('.set-row', { hasText: 'Gamma' }).dragTo(app.page.locator('.set-row', { hasText: 'Beta' }), { targetPosition: { x: 40, y: 20 } })
    await app.page.waitForFunction(() => [...document.querySelectorAll('.set-row .set-name')].at(-1)?.textContent === 'Gamma')
    expect(await shown()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(await stored()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(await app.page.locator('.set-row.drop-before, .set-row.drop-after, .set-row.dragging').count()).toBe(0)   // no mark is left behind

    // a drag that changes nothing writes nothing and does not break the list
    await app.page.locator('.set-row', { hasText: 'Alpha' }).dragTo(app.page.locator('.set-row', { hasText: 'Alpha' }))
    expect(await shown()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(app.errors).toEqual([])
  })

  it('is kept when the window is opened again', async () => {
    await projectWithSets('One', 'Two', 'Three')
    await app.page.locator('.set-row', { hasText: 'Three' }).dragTo(app.page.locator('.set-row', { hasText: 'One' }), { targetPosition: { x: 40, y: 2 } })
    await app.page.waitForFunction(() => document.querySelector('.set-row .set-name')?.textContent === 'Three')
    await app.goto()
    await app.page.waitForSelector('.set-row')
    expect(await shown()).toEqual(['Three', 'One', 'Two'])
  })

  it('can be changed from the keyboard with Alt+Up and Alt+Down, which keeps the focus and says where the set went', async () => {
    await projectWithSets('Red', 'Green', 'Blue')
    const green = app.page.locator('.set-row', { hasText: 'Green' }).locator('.set-item')
    await green.focus()
    await app.page.keyboard.press('Alt+ArrowUp')
    await app.page.waitForFunction(() => document.querySelector('.set-row .set-name')?.textContent === 'Green')
    expect(await shown()).toEqual(['Green', 'Red', 'Blue'])
    await app.page.waitForFunction(() => document.activeElement?.classList.contains('set-item') && document.activeElement.textContent.trim() === 'Green')   // the focus stays on the set that moved
    expect(await app.page.locator('.sidebar [role=status]').innerText()).toBe('Green moved to position 1 of 3')
    await app.page.keyboard.press('Alt+ArrowUp')                       // already first: nothing happens
    expect(await shown()).toEqual(['Green', 'Red', 'Blue'])
    await app.page.keyboard.press('Alt+ArrowDown')
    await app.page.keyboard.press('Alt+ArrowDown')
    await app.page.waitForFunction(() => [...document.querySelectorAll('.set-row .set-name')].at(-1)?.textContent === 'Green')
    expect(await stored()).toEqual(['Red', 'Blue', 'Green'])
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('does not change which set is open', async () => {
    await projectWithSets('First', 'Second')
    await app.page.locator('.set-row', { hasText: 'Second' }).locator('.set-item').click()
    await app.page.waitForSelector('.set-row.active:has-text("Second")')
    await app.page.locator('.set-row', { hasText: 'Second' }).dragTo(app.page.locator('.set-row', { hasText: 'First' }), { targetPosition: { x: 40, y: 2 } })
    await app.page.waitForFunction(() => document.querySelector('.set-row .set-name')?.textContent === 'Second')
    expect(await app.page.locator('.set-row.active .set-name').innerText()).toBe('Second')
  })
})
