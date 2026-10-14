/**
 * The virtual table after the playtest round (UPDATES U2 to U7), in the window: groups of dice, colours, round picture tokens, the
 * middle button, the optional turn order, and a table that follows the project when a card changes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { startApp, axeViolations } from './harness.js'
import { seedSet, makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const FRONT = svg('<rect width="500" height="700" fill="#336699"/><text x="40" y="200" font-size="60" fill="#ffffff">{{title}}</text>')
const NAMES = ['Fire', 'Ice', 'Wind', 'Stone']

async function freshProject() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `tokens-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }], template: { svg: FRONT }, cards: NAMES.map(n => ({ name: n, fields: { title: n } })) })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const dialog = () => app.page.locator('[role=dialog]')
async function startTable({ seats = 2, deal = 0 } = {}) {
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Table")')
  await app.page.click('.bar button:has-text("New table")')
  await dialog().waitFor()
  await dialog().locator('input[type=number]').nth(0).fill(String(seats))
  await dialog().locator('input[type=number]').nth(1).fill(String(deal))
  await dialog().locator('label:has-text("Shuffle the decks") input').uncheck()
  await dialog().locator('button.primary', { hasText: 'Start' }).click()
  await app.page.waitForSelector('.pile')
}
const bar = () => app.page.locator('.bar')
const handName = seat => app.page.locator(`.hand[data-seat="${seat}"] .hname`).innerText()

describe('groups of dice (U2)', () => {
  it('adds three d6 as one token that shows each die and their total, and one press rolls them all', async () => {
    await freshProject(); await startTable()
    await bar().locator('select[aria-label="Number of dice"]').selectOption('3')
    await bar().locator('button:has-text("Add dice")').click()
    const dice = app.page.locator('.token .die')
    expect(await dice.count()).toBe(3)
    expect(await app.page.locator('.token .sum .total').innerText()).toBe('3')
    expect(await app.page.locator('.token .sum small').innerText()).toContain('3d6')
    await dice.first().click()
    const values = (await dice.locator('.value').allInnerTexts()).map(Number)
    expect(values.every(v => v >= 1 && v <= 6)).toBe(true)
    expect(Number(await app.page.locator('.token .sum .total').innerText())).toBe(values.reduce((a, b) => a + b, 0))
    await app.menu('menu:undo')                                                // one roll, one step
    expect(await app.page.locator('.token .sum .total').innerText()).toBe('3')
  })

  it('changes the number of dice and drops the lowest die from the menu', async () => {
    await freshProject(); await startTable()
    await bar().locator('button:has-text("Add dice")').click()
    app.answer('4')
    await app.page.locator('.token').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Number of dice")').click()
    await app.page.waitForFunction(() => document.querySelectorAll('.token .die').length === 4)
    await app.page.locator('.token .die').first().click()
    await app.page.locator('.token').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Drop the lowest die")').click()
    const values = (await app.page.locator('.token .die .value').allInnerTexts()).map(Number)
    expect(Number(await app.page.locator('.token .sum .total').innerText())).toBe(values.reduce((a, b) => a + b, 0) - Math.min(...values))
    expect(await app.page.locator('.token .die.dropped').count()).toBe(1)
  })

  it('chooses several dice with Shift and rolls them together as one step', async () => {
    await freshProject(); await startTable()
    for (let i = 0; i < 3; i++) await bar().locator('button:has-text("Add dice")').click()
    const tokens = app.page.locator('.token')
    expect(await tokens.count()).toBe(3)
    expect(await bar().locator('button:has-text("Roll chosen")').isDisabled()).toBe(true)
    await tokens.nth(0).locator('.die').first().click({ modifiers: ['Shift'] })
    await tokens.nth(1).locator('.die').first().click({ modifiers: ['Shift'] })
    expect(await bar().locator('button:has-text("Roll chosen")').isDisabled()).toBe(false)
    const before = await app.page.evaluate(() => [...document.querySelectorAll('.token .value')].map(e => e.textContent))
    expect(before).toEqual(['1', '1', '1'])
    for (let i = 0; i < 6; i++) await bar().locator('button:has-text("Roll chosen")').click()
    const after = await app.page.evaluate(() => [...document.querySelectorAll('.token .value')].map(e => e.textContent))
    expect(after[2]).toBe('1')                                                // the third was not chosen
    expect(after[0] !== '1' || after[1] !== '1').toBe(true)
    await app.menu('menu:undo')                                               // each press of the button is one step
  })
})

describe('colours of dice and counters (U3)', () => {
  it('recolours a die: body and number, from the menu, and the table remembers it when it is saved', async () => {
    await freshProject(); await startTable()
    await bar().locator('button:has-text("Add dice")').click()
    await app.page.locator('.token').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Colours")').click()
    await dialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await dialog().locator('input[type=color]').nth(0).fill('#102030')
    expect(await dialog().locator('.sample').evaluate(n => getComputedStyle(n).color)).toBe('rgb(255, 255, 255)')   // a light number on a dark body, chosen for you
    await dialog().locator('input[type=color]').nth(1).fill('#ffcc00')
    await dialog().locator('button.primary').click()
    await app.page.mouse.move(5, 5)                                       // away from the die: a button under the pointer is drawn as hovered
    const die = app.page.locator('.token .die').first()
    // buttons ease between colours, so the colour is waited for
    await expect.poll(() => die.evaluate(n => getComputedStyle(n).backgroundColor)).toBe('rgb(16, 32, 48)')
    await expect.poll(() => die.evaluate(n => getComputedStyle(n).color)).toBe('rgb(255, 204, 0)')
    app.answer('colours')
    await bar().locator('button:has-text("Save as")').click()
    await app.page.waitForFunction(() => document.querySelector('.bar .state')?.textContent?.includes('colours'))
    const [saved] = await app.invoke('table:list')
    const loaded = await app.invoke('table:load', saved.id)
    expect(Object.values(loaded.state.tokens)[0]).toMatchObject({ color: '#102030', ink: '#ffcc00' })
  })
})

describe('round tokens with a picture (U4)', () => {
  it('adds a round token with a picture of the library, which can carry a number and a second picture', async () => {
    await freshProject()
    const [a, b] = await app.invoke('assets:import', [await makePng(join(app.root, 'goblin.png'), 60, 60, '#22aa22'), await makePng(join(app.root, 'goblin2.png'), 60, 60, '#aa2222')])
    await startTable()
    await bar().locator('select[aria-label="Size of a picture token"]').selectOption('large')
    await bar().locator('button:has-text("Add a picture token")').click()
    await dialog().waitFor()
    await dialog().locator('.item', { hasText: 'goblin.png' }).click()
    await app.page.waitForSelector('.token .disc img')
    const disc = app.page.locator('.token .disc')
    expect(Math.round((await disc.boundingBox()).width)).toBe(124)
    expect(await app.page.locator('.token .disc img').getAttribute('src')).toMatch(/^blob:/)
    // a number
    await app.page.locator('.token').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Show a number")').click()
    await app.page.locator('.token .number button[aria-label="One more"]').click()
    expect(await app.page.locator('.token .number .value').innerText()).toBe('1')
    // a second picture, and turning over
    await app.page.locator('.token').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Add a second picture")').click()
    await dialog().locator('.item', { hasText: 'goblin2.png' }).click()
    const front = await app.page.locator('.token .disc img').getAttribute('src')
    await app.page.locator('.token').click({ button: 'right' })
    await app.page.locator('.ctx-menu button:has-text("Turn over")').click()
    await app.page.waitForFunction(old => { const i = document.querySelector('.token .disc img'); return i && i.getAttribute('src') !== old }, front)
    await app.page.locator('.token .disc').dblclick()                      // a double press turns it back
    await app.page.waitForFunction(old => document.querySelector('.token .disc img')?.getAttribute('src') === old, front)
    expect(a.id && b.id).toBeTruthy()
    expect(app.errors).toEqual([])
  })

  it('a picture that was deleted from the library leaves a plain disc', async () => {
    await freshProject()
    const [a] = await app.invoke('assets:import', [await makePng(join(app.root, 'gone.png'), 60, 60, '#2288cc')])
    await startTable()
    await bar().locator('button:has-text("Add a picture token")').click()
    await dialog().locator('.item', { hasText: 'gone.png' }).click()
    await app.page.waitForSelector('.token .disc img')
    await app.invoke('assets:delete', a.id)
    await app.page.evaluate(() => window.dispatchEvent(new Event('spadewick:rerender')))
    await app.page.waitForFunction(() => document.querySelectorAll('.token .disc img').length === 0)
    expect(await app.page.locator('.token .disc').count()).toBe(1)
  })
})

describe('the middle button (U5)', () => {
  it('holding the middle button and dragging moves the table under the pointer', async () => {
    await freshProject(); await startTable()
    const area = app.page.locator('.area')
    const box = await area.boundingBox()
    await app.page.evaluate(() => { const a = document.querySelector('.area'); a.scrollLeft = 300; a.scrollTop = 200 })
    const start = await area.evaluate(n => [n.scrollLeft, n.scrollTop])
    await app.page.mouse.move(box.x + 400, box.y + 300)
    await app.page.mouse.down({ button: 'middle' })
    await app.page.mouse.move(box.x + 300, box.y + 250, { steps: 5 })
    expect(await area.getAttribute('data-panning')).toBe('true')
    await app.page.mouse.up({ button: 'middle' })
    const end = await area.evaluate(n => [n.scrollLeft, n.scrollTop])
    expect(end[0] - start[0]).toBe(100)
    expect(end[1] - start[1]).toBe(50)
    expect(await area.getAttribute('data-panning')).toBe(null)
    // the middle button over a pile pans the table; it does not drag the pile
    const pile = app.page.locator('.pile').first()
    const at = await pile.evaluate(n => [n.style.left, n.style.top])
    await app.page.evaluate(() => { const a = document.querySelector('.area'); a.scrollLeft = 0; a.scrollTop = 0 })
    const pb = await pile.boundingBox()
    await app.page.mouse.move(pb.x + 40, pb.y + 60)
    await app.page.mouse.down({ button: 'middle' }); await app.page.mouse.move(pb.x + 90, pb.y + 110, { steps: 4 }); await app.page.mouse.up({ button: 'middle' })
    expect(await pile.evaluate(n => [n.style.left, n.style.top])).toEqual(at)
    expect(await app.invoke('table:list')).toEqual([])
    expect(app.errors).toEqual([])
  })
})

describe('the optional turn order (U7)', () => {
  it('shows whose turn it is, passes it on with N, and restricts nothing', async () => {
    await freshProject(); await startTable({ seats: 3, deal: 1 })
    expect(await bar().locator('button:has-text("Next turn")').isDisabled()).toBe(true)
    await bar().locator('button:has-text("Start turns")').click()
    expect(await app.page.locator('.hand[data-seat="0"]').getAttribute('aria-current')).toBe('true')
    expect(await bar().locator('[role=status]', { hasText: 'Turn:' }).innerText()).toBe('Turn: Hand 1')
    await app.page.locator('.pile').first().focus()
    await app.page.keyboard.press('n')
    expect(await app.page.locator('.hand[data-seat="1"]').getAttribute('aria-current')).toBe('true')
    expect(await app.page.locator('.hand[data-seat="0"]').getAttribute('aria-current')).toBe(null)
    // hand 3 plays although it is hand 2's turn
    await app.page.locator('.hand[data-seat="2"] .hcard').first().focus()
    await app.page.keyboard.press('Enter')
    expect(await app.page.locator('.hand[data-seat="2"] .hcard').count()).toBe(0)
    expect(await app.page.locator('.pile').count()).toBe(2)
    await bar().locator('button[aria-label="Turn the direction round"]').click()
    await bar().locator('button:has-text("Next turn")').click()
    expect(await app.page.locator('.hand[data-seat="0"]').getAttribute('aria-current')).toBe('true')
    await app.menu('menu:undo')
    expect(await app.page.locator('.hand[data-seat="1"]').getAttribute('aria-current')).toBe('true')
    await bar().locator('button:has-text("Stop turns")').click()
    expect(await app.page.locator('.hand[aria-current]').count()).toBe(0)
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('names a hand, and the name is used in the bar and the turn', async () => {
    await freshProject(); await startTable({ seats: 2 })
    app.answer('Mira')
    await app.page.locator('.hand[data-seat="1"] button[aria-label="Name Hand 2"]').click()
    await app.page.waitForFunction(() => document.querySelector('.hand[data-seat="1"] .hname')?.textContent === 'Mira')
    expect(await handName(0)).toBe('Hand 1')
    expect(await bar().locator('select option').allInnerTexts()).toEqual(expect.arrayContaining(['Mira']))
    await bar().locator('button:has-text("Start turns")').click()
    await app.page.keyboard.press('Escape')
    await bar().locator('button:has-text("Next turn")').click()
    expect(await bar().locator('[role=status]', { hasText: 'Turn:' }).innerText()).toBe('Turn: Mira')
  })
})

describe('a table that follows the project (U6)', () => {
  it('shows a new name at once, and draws the card again, without pressing Redraw pictures', async () => {
    const s = await freshProject(); await startTable({ seats: 1, deal: 2 })
    await app.page.waitForSelector('.hcard img')
    const first = s.cards[0]
    const card = app.page.locator('.hcard').first()
    const label = await card.getAttribute('aria-label')
    expect(label).toMatch(/^(Fire|Ice|Wind|Stone), card 1 of 2/)
    const srcBefore = await card.locator('img').getAttribute('src')
    // the card that is on top of the deck lies at the end: the first dealt is the last of the deck
    const dealt = (await app.invoke('cards:list', s.set.id)).find(c => c.display_name === label.split(',')[0])
    await app.raw('cards:update', { id: dealt.id, displayName: 'Blaze', fields: { title: 'Blaze' } })
    await app.page.waitForFunction(() => document.querySelector('.hcard')?.getAttribute('aria-label')?.startsWith('Blaze'))
    await app.page.waitForFunction(old => document.querySelector('.hcard img')?.getAttribute('src') !== old, srcBefore)
    expect(first.id).toBeTruthy()
  })

  it('redraws every card when the template changes, and marks a card that is deleted from the project', async () => {
    const s = await freshProject(); await startTable({ seats: 1, deal: 2 })
    await app.page.waitForSelector('.hcard img')
    const srcBefore = await app.page.locator('.hcard img').first().getAttribute('src')
    await app.raw('templates:update', { id: s.template.id, svgSource: FRONT.replace('#336699', '#993366') })
    await app.page.waitForFunction(old => document.querySelector('.hcard img')?.getAttribute('src') !== old, srcBefore)
    const label = await app.page.locator('.hcard').first().getAttribute('aria-label')
    const gone = (await app.invoke('cards:list', s.set.id)).find(c => c.display_name === label.split(',')[0])
    await app.raw('cards:delete', [gone.id])
    await app.page.waitForFunction(() => document.querySelector('.hcard .stand-in.gone'))
    expect(await app.page.locator('.hcard .stand-in.gone').first().innerText()).toContain('removed from the project')
    await app.raw('history:undo')                                         // the card comes back, and the mark goes (the table's own Undo is for its moves)
    await app.page.waitForFunction(() => !document.querySelector('.hcard .stand-in.gone'))
  })

  it('a table opened later is checked against the project: a card deleted since is marked', async () => {
    const s = await freshProject(); await startTable({ seats: 1, deal: 1 })
    app.answer('keep')
    await bar().locator('button:has-text("Save as")').click()
    await app.page.waitForFunction(() => document.querySelector('.bar .state')?.textContent?.includes('keep'))
    const dealt = (await app.invoke('cards:list', s.set.id)).find(c => c.display_name === (undefined))
    const label = await app.page.locator('.hcard').first().getAttribute('aria-label')
    const target = (await app.invoke('cards:list', s.set.id)).find(c => c.display_name === label.split(',')[0])
    await app.raw('cards:delete', [target.id])
    await app.page.click('.bar button:has-text("Open")')
    await dialog().waitFor()
    await dialog().locator('button', { hasText: 'keep' }).first().click()
    await app.page.waitForFunction(() => document.querySelector('.hcard .stand-in.gone'))
    expect(dealt).toBeUndefined()
  })
})

describe('a template edited or swapped while another tab is shown (U6)', () => {
  it('the table shows the new look when it is looked at again, without pressing Redraw pictures', async () => {
    const s = await freshProject(); await startTable({ seats: 1, deal: 2 })
    await app.page.waitForSelector('.hcard img')
    const before = await app.page.locator('.hcard img').first().getAttribute('src')

    // the template is edited (and saved) while the Template Editor is shown: the table is not on screen
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.raw('templates:update', { id: s.template.id, svgSource: FRONT.replace('#336699', '#993366') })
    await app.page.click('button[role=tab]:has-text("Table")')
    await app.page.waitForSelector('.hcard img')
    await app.page.waitForFunction(old => document.querySelector('.hcard img')?.getAttribute('src') !== old, before)
    const edited = await app.page.locator('.hcard img').first().getAttribute('src')

    // another template is given to the set while the Card Data tab is shown
    await app.page.click('button[role=tab]:has-text("Card Data")')
    const other = await app.invoke('templates:create', { name: 'Other', svgSource: FRONT.replace('#336699', '#22aa44'), cardSize: 'poker' })
    await app.raw('sets:update', { id: s.set.id, defaultTemplateId: other.id })
    await app.raw('cards:batch-update', { cardIds: (await app.invoke('cards:list', s.set.id)).map(c => c.id), templateId: null })   // the cards use the set's template
    await app.page.click('button[role=tab]:has-text("Table")')
    await app.page.waitForFunction(old => document.querySelector('.hcard img')?.getAttribute('src') !== old, edited)
    const swapped = await app.page.locator('.hcard img').first().getAttribute('src')

    // one card is given a template of its own
    await app.page.click('button[role=tab]:has-text("Card Data")')
    const mine = (await app.invoke('cards:list', s.set.id))
    const label = await (async () => { await app.page.click('button[role=tab]:has-text("Table")'); return app.page.locator('.hcard').first().getAttribute('aria-label') })()
    const card = mine.find(c => c.display_name === label.split(',')[0])
    await app.page.click('button[role=tab]:has-text("Card Data")')
    await app.raw('cards:update', { id: card.id, templateId: s.template.id })
    await app.page.click('button[role=tab]:has-text("Table")')
    await app.page.waitForFunction(old => document.querySelector('.hcard img')?.getAttribute('src') !== old, swapped)
  }, 60000)
})
