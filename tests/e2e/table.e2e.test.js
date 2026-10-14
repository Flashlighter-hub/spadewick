/**
 * The virtual table (PRD §7.9): starting a table from a set, drawing, dealing, flipping, shuffling, dragging between the table and
 * the hands, dice and counters, undo, saving and opening, and the keyboard.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const FRONT = svg('<rect width="500" height="700" fill="#336699"/><text x="40" y="200" font-size="60" fill="#ffffff">{{title}}</text>')
const NAMES = ['Fire', 'Ice', 'Wind', 'Stone', 'Light', 'Shade']

async function freshProject(withBack = false) {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `table-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }], template: { svg: FRONT }, cards: NAMES.map(n => ({ name: n, fields: { title: n } })) })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  if (withBack) {
    const red = await app.invoke('templates:create', { name: 'Red back', svgSource: svg('<rect width="500" height="700" fill="#cc0000"/>'), cardSize: 'poker' })
    await app.invoke('sets:update', { id: s.set.id, defaultBackTemplateId: red.id })
  }
  return s
}
const openTable = async () => { await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Table")') }
const dialog = () => app.page.locator('[role=dialog]')

async function startTable({ seats = 2, deal = 0, shuffle = false } = {}) {
  await app.page.click('.bar button:has-text("New table")')
  await dialog().waitFor()
  await dialog().locator('input[type=number]').nth(0).fill(String(seats))
  await dialog().locator('input[type=number]').nth(1).fill(String(deal))
  if (!shuffle) await dialog().locator('label:has-text("Shuffle the decks") input').uncheck()
  await dialog().locator('button.primary', { hasText: 'Start' }).click()
  await app.page.waitForSelector('.pile')
}
const pileCount = async () => app.page.locator('.pile').count()
const handCount = async seat => Number(await app.page.locator(`.hand[data-seat="${seat}"] header .n`).innerText())
const deckCount = async () => Number((await app.page.locator('.pile .count').first().innerText()).trim())
const press = async key => { await app.page.locator('.pile').first().focus(); await app.page.keyboard.press(key) }

describe('starting a table', () => {
  it('starts from the sets of the project: a face-down deck, a hand for each seat, and cards dealt', async () => {
    await freshProject()
    await openTable()
    expect(await app.page.locator('.empty').innerText()).toContain('The table is where you play')
    await app.page.click('.bar button:has-text("New table")')
    await dialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    expect(await dialog().locator('.deck').innerText()).toContain('6 cards')
    await dialog().locator('button:has-text("Cancel")').click()
    await startTable({ seats: 3, deal: 1 })
    expect(await pileCount()).toBe(1)
    expect(await deckCount()).toBe(3)                                         // 3 hands × 1 card taken from the six
  }, 20000)

  it('shows the deck, the hands and their cards, and leaves the deck as a pile of what is left', async () => {
    await freshProject()
    await openTable()
    await startTable({ seats: 2, deal: 2 })
    expect(await handCount(0)).toBe(2)
    expect(await handCount(1)).toBe(2)
    expect(await deckCount()).toBe(2)
    expect(await app.page.locator('.hcard').count()).toBe(4)
    expect(await app.page.locator('.pile').first().getAttribute('aria-label')).toMatch(/Base: 2 cards, face down/)
  })

  it('keeps the table when another tab is looked at', async () => {
    await freshProject()
    await openTable()
    await startTable({ seats: 1, deal: 1 })
    await app.page.click('button[role=tab]:has-text("Card Data")')
    await app.page.click('button[role=tab]:has-text("Table")')
    expect(await handCount(0)).toBe(1)
    expect(await deckCount()).toBe(5)
  })
})

describe('moving cards about', () => {
  beforeEach(async () => { await freshProject(); await openTable(); await startTable({ seats: 2 }) })

  it('flips a pile with F and with a double click: the top card shows, and the label says so', async () => {
    await press('f')
    await expect.poll(async () => app.page.locator('.pile').first().getAttribute('aria-label')).toMatch(/face up\. (Fire|Ice|Wind|Stone|Light|Shade)$/)
    await press('f')
    expect(await app.page.locator('.pile').first().getAttribute('aria-label')).toMatch(/face down/)
    await app.page.locator('.pile').first().dblclick()
    expect(await app.page.locator('.pile').first().getAttribute('aria-label')).toMatch(/face up/)
  })

  it('draws with D into the chosen hand, and undo and redo (the Edit menu) take it back and again', async () => {
    await press('d')
    expect(await handCount(0)).toBe(1)
    expect(await deckCount()).toBe(5)
    await app.menu('menu:undo')
    expect(await handCount(0)).toBe(0)
    expect(await deckCount()).toBe(6)
    await app.menu('menu:redo')
    expect(await handCount(0)).toBe(1)
    await app.page.locator('.bar select').first().selectOption('1')
    await app.page.locator('.bar input[type=number]').fill('2')
    await app.page.locator('.bar button:text-is("Draw")').click()
    expect(await handCount(1)).toBe(2)
    expect(await deckCount()).toBe(3)
  })

  it('deals one at a time to every hand with Shift+D', async () => {
    await app.page.locator('.bar input[type=number]').fill('2')
    await press('Shift+D')
    expect(await handCount(0)).toBe(2)
    expect(await handCount(1)).toBe(2)
    await app.menu('menu:undo')                                                 // all of it is one step
    expect(await handCount(0)).toBe(0)
    expect(await deckCount()).toBe(6)
  })

  it('dragging a deck takes its top card: into a hand, onto the table, and onto another pile', async () => {
    const mouse = app.page.mouse
    const deckBox = await app.page.locator('.pile').first().boundingBox()
    const handBox = await app.page.locator('.hand[data-seat="1"]').boundingBox()
    await mouse.move(deckBox.x + 60, deckBox.y + 80); await mouse.down()
    await mouse.move(deckBox.x + 100, deckBox.y + 120, { steps: 4 })
    await mouse.move(handBox.x + 80, handBox.y + 100, { steps: 8 })
    await mouse.up()
    expect(await handCount(1)).toBe(1)
    expect(await deckCount()).toBe(5)

    // the hand card goes back onto the table, face up, as a pile of its own
    const card = await app.page.locator('.hand[data-seat="1"] .hcard').first().boundingBox()
    await mouse.move(card.x + 40, card.y + 60); await mouse.down()
    await mouse.move(card.x + 50, card.y - 40, { steps: 4 })
    await mouse.move(deckBox.x + 400, deckBox.y + 150, { steps: 8 })
    await mouse.up()
    expect(await handCount(1)).toBe(0)
    expect(await pileCount()).toBe(2)
    const loose = app.page.locator('.pile', { hasText: '' }).nth(1)
    expect(await loose.getAttribute('aria-label')).toMatch(/face up/)

    // and onto the deck: it lies on top, and the deck has its card again
    const looseBox = await app.page.locator('.pile').nth(1).boundingBox()
    const target = await app.page.locator('.pile').first().boundingBox()
    await mouse.move(looseBox.x + 50, looseBox.y + 70); await mouse.down()
    await mouse.move(looseBox.x + 20, looseBox.y + 40, { steps: 3 })
    await mouse.move(target.x + 60, target.y + 80, { steps: 8 })
    await mouse.up()
    expect(await pileCount()).toBe(1)
    expect(await deckCount()).toBe(6)
  })

  it('Shift-drag, or the grip, moves the whole pile; arrow keys nudge it', async () => {
    const before = await app.page.locator('.pile').first().boundingBox()
    await app.page.keyboard.down('Shift')
    await app.page.mouse.move(before.x + 60, before.y + 80); await app.page.mouse.down()
    await app.page.mouse.move(before.x + 160, before.y + 180, { steps: 6 })
    await app.page.mouse.up()
    await app.page.keyboard.up('Shift')
    const after = await app.page.locator('.pile').first().boundingBox()
    expect(Math.round(after.x - before.x)).toBe(100)
    expect(Math.round(after.y - before.y)).toBe(100)
    expect(await deckCount()).toBe(6)
    await press('ArrowRight')
    const nudged = await app.page.locator('.pile').first().boundingBox()
    expect(Math.round(nudged.x - after.x)).toBe(10)
  })

  it('rotates a quarter turn and can lock a pile in place', async () => {
    await press('r')
    expect(await app.page.locator('.pile').first().evaluate(n => n.style.transform)).toBe('rotate(90deg)')
    const before = await app.page.locator('.pile').first().boundingBox()
    await app.page.locator('.pile').first().click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Lock in place")').click()
    await app.page.keyboard.press('ArrowRight')
    const after = await app.page.locator('.pile').first().boundingBox()
    expect(after.x).toBe(before.x)
    expect(await app.page.locator('.pile .lock').count()).toBe(1)
  })

  it('looks through a pile, and takes a chosen card into a hand or onto the table', async () => {
    await press('l')
    await dialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    expect(await dialog().locator('li .name').count()).toBe(6)
    await dialog().locator('input.field').fill('wind')
    expect(await dialog().locator('li .name').allInnerTexts()).toEqual(['Wind'])
    await dialog().locator('button[aria-label="Take Wind into hand 2"]').click()
    await dialog().locator('button:has-text("Close")').click()
    expect(await handCount(1)).toBe(1)
    expect(await app.page.locator('.hand[data-seat="1"] .hcard').first().getAttribute('aria-label')).toMatch(/^Wind, card 1 of 1/)
    expect(await deckCount()).toBe(5)
  })

  it('plays a hand card with Enter, face down with Shift+Enter, and passes it to another hand from its menu', async () => {
    await press('d'); await press('d')
    expect(await handCount(0)).toBe(2)
    await app.page.locator('.hand[data-seat="0"] .hcard').first().focus()
    await app.page.keyboard.press('ArrowRight')
    await app.page.keyboard.press('ArrowLeft')
    await app.page.keyboard.press('Enter')
    expect(await handCount(0)).toBe(1)
    expect(await pileCount()).toBe(2)
    // Shift+Enter plays the next one face down
    await app.page.locator('.hand[data-seat="0"] .hcard').first().focus()
    await app.page.keyboard.press('Shift+Enter')
    expect(await handCount(0)).toBe(0)
    expect(await app.page.locator('.pile', { hasText: '' }).last().getAttribute('aria-label')).toMatch(/face down/)
    await press('d')
    await app.page.locator('.hand[data-seat="0"] .hcard').first().click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Pass to hand 2")').click()
    expect(await handCount(0)).toBe(0)
    expect(await handCount(1)).toBe(1)
  })

  it('collects every card back onto a pile, and changes the number of hands', async () => {
    await press('d'); await press('d')
    await app.page.locator('.pile').first().click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Collect every card here")').click()
    expect(await handCount(0)).toBe(0)
    expect(await deckCount()).toBe(6)
    await app.page.locator('.bar button[aria-label="More hands"]').click()
    expect(await app.page.locator('.hand').count()).toBe(3)
    await app.page.locator('.bar button[aria-label="Fewer hands"]').click()
    await app.page.locator('.bar button[aria-label="Fewer hands"]').click()
    expect(await app.page.locator('.hand').count()).toBe(1)
  })
})

describe('dice, counters and the view', () => {
  beforeEach(async () => { await freshProject(); await openTable(); await startTable({ seats: 1 }) })

  it('adds a die that rolls when pressed, and a counter that counts', async () => {
    await app.page.locator('.bar select[aria-label="Sides of the die"]').selectOption('20')
    await app.page.locator('.bar button:has-text("Add dice")').click()
    const die = app.page.locator('.token .die')
    expect(await die.getAttribute('aria-label')).toMatch(/1 d20 showing 1, total 1: press to roll/)
    const seen = new Set()
    for (let i = 0; i < 12; i++) { await die.click(); seen.add(await die.locator('.value').innerText()) }
    expect(seen.size).toBeGreaterThan(1)
    for (const v of seen) { expect(Number(v)).toBeGreaterThanOrEqual(1); expect(Number(v)).toBeLessThanOrEqual(20) }
    await app.page.locator('.bar button:has-text("Add a counter")').click()
    const counter = app.page.locator('.token .counter')
    await counter.locator('button[aria-label="One more"]').click()
    await counter.locator('button[aria-label="One more"]').click()
    await counter.locator('button[aria-label="One less"]').click()
    expect(await counter.locator('.value').innerText()).toBe('1')
    await app.page.locator('.token', { has: app.page.locator('.die') }).click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Remove")').click()
    expect(await app.page.locator('.token .die').count()).toBe(0)
  })

  it('zooms the table', async () => {
    await app.page.locator('.bar button[aria-label="Zoom out"]').click()
    expect(await app.page.locator('.bar .num').nth(1).innerText()).toBe('80%')
    expect(await app.page.locator('.plane').evaluate(n => n.style.transform)).toBe('scale(0.8)')
    await app.page.locator('.bar button[aria-label="Zoom in"]').click()
    await app.page.locator('.bar button[aria-label="Zoom in"]').click()
    expect(await app.page.locator('.bar .num').nth(1).innerText()).toBe('125%')
  })

  it('draws the front of a card as its picture, and a back set for the set as the picture of the deck', async () => {
    await app.page.locator('.pile').first().dblclick()                          // face up: the front
    await app.page.waitForSelector('.pile .face.up img')
    await app.page.locator('.pile').first().dblclick()
    expect(await app.page.locator('.pile .face:not(.up) img').count()).toBe(0)  // no back yet: the plain back
    await app.page.waitForSelector('.pile .plain-back')
  })

  it('passes axe, with the table, a hand and a die', async () => {
    await app.page.locator('.bar button:has-text("Add dice")').click()
    await app.page.locator('.bar button:has-text("Add a counter")').click()
    await app.page.locator('.pile').first().dblclick()
    await app.page.locator('.bar button:text-is("Draw")').click()
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('the back of the deck', () => {
  it('shows the card back of the set on a face-down deck', async () => {
    await freshProject(true)
    await openTable()
    await startTable({ seats: 1 })
    await app.page.waitForSelector('.pile .face:not(.up) img')
    expect(await app.page.locator('.pile .plain-back').count()).toBe(0)
  })
})

describe('saving and opening', () => {
  it('saves a table in the project, and opens it again with the same cards in the same places', async () => {
    await freshProject()
    await openTable()
    await startTable({ seats: 2, shuffle: true, deal: 1 })
    await app.page.locator('.pile').first().dblclick()
    const before = await app.page.locator('.pile').first().getAttribute('aria-label')
    app.answer('Opening')
    await app.page.locator('.bar button:has-text("Save")').first().click()
    await app.page.waitForSelector('.toast:has-text("Saved the table")')
    expect((await app.invoke('table:list')).map(t => t.name)).toEqual(['Opening'])
    expect(await app.page.locator('.bar .state').innerText()).toBe('Opening')

    await app.page.reload(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Table")')
    expect(await app.page.locator('.empty').count()).toBe(1)
    await app.page.click('.bar button:has-text("Open")')
    await dialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('button.open', { hasText: 'Opening' }).click()
    await app.page.waitForSelector('.pile')
    expect(await app.page.locator('.pile').first().getAttribute('aria-label')).toBe(before)
    expect(await handCount(0)).toBe(1)
    expect(await handCount(1)).toBe(1)
  })

  it('asks before leaving a table that has changes, and a saved table can be deleted', async () => {
    await freshProject()
    await openTable()
    await startTable({ seats: 1 })
    await press('f')
    app.declineNextConfirm()
    await app.page.click('.bar button:has-text("New table")')
    expect(await dialog().count()).toBe(0)                                      // declined: still the same table
    expect(app.dialogs.at(-1).message).toMatch(/not saved/)
    app.answer('Gone soon')
    await app.page.locator('.bar button:has-text("Save")').first().click()
    await app.page.waitForSelector('.toast:has-text("Saved the table")')
    await app.page.click('.bar button:has-text("Open")')
    await dialog().waitFor()
    await dialog().locator('button[aria-label^="Delete the saved table"]').click()
    await app.page.waitForFunction(() => !document.querySelector('[role=dialog] ul.saved'))
    expect(await app.invoke('table:list')).toEqual([])
  })
})
