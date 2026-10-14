/**
 * Playing together, in the window (PRD §22.0, steps 5 and 6): one window shares its table, another (with no project) joins it by
 * trading two codes, sees only its own hand, gets its cards and pictures from the host, and plays. A real WebRTC connection between two
 * pages of the application; the pictures are drawn by the host's own renderer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'

let app, guest
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await guest?.close().catch(() => {}); await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const FRONT = svg('<rect width="500" height="700" fill="#336699"/><text x="40" y="200" font-size="60" fill="#ffffff">{{title}}</text>')
const NAMES = ['Fire', 'Ice', 'Wind', 'Stone', 'Light', 'Shade', 'Moss', 'Rain']
const hostDialog = () => app.page.locator('[role=dialog]')
const guestDialog = () => guest.locator('[role=dialog]')

async function hostStartsTable() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `share-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }], template: { svg: FRONT }, cards: NAMES.map(n => ({ name: n, fields: { title: n } })) })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  const back = await app.invoke('templates:create', { name: 'Back', svgSource: svg('<rect width="500" height="700" fill="#aa2222"/>'), cardSize: 'poker' })
  await app.invoke('sets:update', { id: s.set.id, defaultBackTemplateId: back.id })
  await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Table")')
  await app.page.click('.bar button:has-text("New table")')
  await hostDialog().waitFor()
  await hostDialog().locator('input[type=number]').nth(0).fill('2')
  await hostDialog().locator('input[type=number]').nth(1).fill('2')
  await hostDialog().locator('label:has-text("Shuffle the decks") input').uncheck()
  await hostDialog().locator('button.primary', { hasText: 'Start' }).click()
  await app.page.waitForSelector('.pile')
  return s
}

describe('sharing a table between two windows', () => {
  it('the host starts sharing, invites a player, and the player joins from a window that has no project', async () => {
    await hostStartsTable()
    await app.page.click('.bar button:has-text("Share…")')
    await hostDialog().waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    await hostDialog().locator('input.field').first().fill('Hosty')
    await hostDialog().locator('button.primary', { hasText: 'Start sharing' }).click()
    await hostDialog().locator('button:has-text("New invitation")').click()
    const invitation = await hostDialog().locator('textarea[aria-label="Invitation code"]').inputValue()
    expect(invitation).toMatch(/^SPW1-O-/)

    guest = await app.newGuestPage()
    await guest.waitForSelector('text=New Project')
    await guest.click('button:has-text("Join a shared table")')
    await guestDialog().waitFor()
    expect(await axeViolations(guest)).toEqual([])
    await guestDialog().locator('input.field').first().fill('Ann')
    await guestDialog().locator('textarea[aria-label="Invitation code"]').fill(invitation)
    await guestDialog().locator('button.primary', { hasText: 'Make an answer' }).click()
    const answer = await guestDialog().locator('textarea[aria-label="Answer code"]').inputValue()
    expect(answer).toMatch(/^SPW1-A-/)

    await hostDialog().locator('textarea[aria-label="Answer code"]').fill(answer)
    await hostDialog().locator('button.primary', { hasText: 'Connect' }).click()
    await hostDialog().locator('.players li', { hasText: 'Ann' }).waitFor()
    expect(await hostDialog().locator('.players li').allInnerTexts().then(a => a.map(t => t.replace(/\s+/g, ' ')))).toEqual([expect.stringContaining('Hosty (you)'), expect.stringContaining('Ann')])

    // the player's window shows the table at once, with no project open: the dialog closes by itself
    await guest.waitForSelector('.table-view .pile')
    expect(await guestDialog().count()).toBe(0)
    expect(await guest.locator('[role=tablist]').count()).toBe(0)                              // no project: no tabs, only the table
    expect(await app.page.locator('.bar button:has-text("Sharing (2 players)")').count()).toBe(1)
  }, 90000)

  it('each player sees their own hand and only the number of cards in the others', async () => {
    await app.page.keyboard.press('Escape')
    await hostDialog().locator('button:has-text("Done")').click().catch(() => {})
    await guest.waitForSelector('.hand')
    // the host: own hand (hand 1) shown, hand 2 a count
    expect(await app.page.locator('.hand[data-seat="0"] .hcard').count()).toBe(2)
    expect(await app.page.locator('.hand[data-seat="1"] .hcard').count()).toBe(0)
    expect(await app.page.locator('.hand[data-seat="1"] .mini-back').count()).toBe(2)
    // the guest: the other way round
    expect(await guest.locator('.hand[data-seat="1"] .hcard').count()).toBe(2)
    expect(await guest.locator('.hand[data-seat="0"] .hcard').count()).toBe(0)
    expect(await guest.locator('.hand[data-seat="0"] .mini-back').count()).toBe(2)
    expect(await guest.locator('.hand[data-seat="0"] header .n').innerText()).toBe('2')
    // the names of the host's cards are nowhere in the guest's window
    const hostNames = await app.page.locator('.hand[data-seat="0"] .hcard').evaluateAll(els => els.map(e => e.getAttribute('aria-label').split(',')[0]))
    const guestText = await guest.evaluate(() => document.body.innerHTML)
    for (const n of hostNames) expect(guestText).not.toContain(n)
    // the cards of the guest's hand have their names and their pictures
    expect(await guest.locator('.hand[data-seat="1"] .hcard').first().getAttribute('aria-label')).toMatch(/^(Fire|Ice|Wind|Stone|Light|Shade|Moss|Rain), card 1 of 2/)
  }, 30000)

  it('the pictures of the guest\'s cards come from the host: the guest draws nothing itself', async () => {
    await guest.waitForFunction(() => document.querySelectorAll('.hand[data-seat="1"] .hcard img').length === 2, null, { timeout: 20000 })
    expect(await guest.locator('.hand[data-seat="1"] .hcard img').first().getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    // the back of the deck too
    await guest.waitForFunction(() => document.querySelector('.pile .face:not(.up) img'), null, { timeout: 20000 })
    expect(await guest.locator('.pile .face:not(.up) img').first().getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(await guest.evaluate(() => window.__renders)).toBe(0)
  }, 40000)

  it('moves go through the host: the guest draws a card and moves the deck, and the host sees both', async () => {
    const pileLeft = await app.page.locator('.pile').first().evaluate(n => n.style.left)
    await guest.locator('.pile').first().focus()
    await guest.keyboard.press('d')
    await guest.waitForFunction(() => document.querySelectorAll('.hand[data-seat="1"] .hcard').length === 3)
    await app.page.waitForFunction(() => document.querySelector('.hand[data-seat="1"] header .n')?.textContent === '3')
    expect(await app.page.locator('.hand[data-seat="1"] .hcard').count()).toBe(0)                 // the host sees a number, not the card
    await guest.keyboard.press('ArrowRight')
    await app.page.waitForFunction(old => document.querySelector('.pile').style.left !== old, pileLeft)
    // the host plays face up from their own hand: the guest sees the card, and its picture
    await app.page.locator('.hand[data-seat="0"] .hcard').first().focus()
    await app.page.keyboard.press('Enter')
    await guest.waitForFunction(() => document.querySelectorAll('.pile').length === 2)
    await guest.waitForFunction(() => [...document.querySelectorAll('.pile .face.up img')].length === 1, null, { timeout: 20000 })
    expect(await guest.evaluate(() => window.__renders)).toBe(0)
  }, 60000)

  it('what a guest may not do is not offered: no new table, no changing the seats, no looking through the deck', async () => {
    expect(await guest.locator('.bar button:has-text("New table")').isDisabled()).toBe(true)
    expect(await guest.locator('.bar button[aria-label="More hands"]').isDisabled()).toBe(true)
    await guest.locator('.pile').first().click()
    expect(await guest.locator('.bar button:has-text("Look through")').isDisabled()).toBe(true)      // the deck is face down: its cards are not known to a guest
    await guest.locator('.pile').first().click({ button: 'right' })
    expect(await guest.locator('.ctx-menu button:has-text("Collect")').count()).toBe(0)
    await guest.keyboard.press('Escape')
    expect(await axeViolations(guest)).toEqual([])
  }, 30000)

  it('a change in the project reaches the guest: the card has its new name, and is drawn again', async () => {
    const [card] = await app.invoke('cards:list', (await app.invoke('sets:list'))[0].id)
    const label = await guest.locator('.hand[data-seat="1"] .hcard').first().getAttribute('aria-label')
    const mine = (await app.invoke('cards:list', (await app.invoke('sets:list'))[0].id)).find(c => c.display_name === label.split(',')[0])
    await app.raw('cards:update', { id: mine.id, displayName: 'Renamed card' })
    await guest.waitForFunction(() => [...document.querySelectorAll('.hand[data-seat="1"] .hcard')].some(e => e.getAttribute('aria-label').startsWith('Renamed card')), null, { timeout: 20000 })
    expect(card.id).toBeTruthy()
  }, 40000)

  it('the guest leaves; the host stops sharing and the table goes on as theirs, with every hand as it is', async () => {
    await guest.locator('.bar button:has-text("Leave the table")').click()
    await guest.waitForSelector('text=New Project')
    await app.page.waitForFunction(() => document.querySelector('.bar button[aria-pressed=true]')?.textContent?.includes('1 player'))
    await app.page.click('.bar button:has-text("Sharing")')
    await hostDialog().waitFor()
    expect(await hostDialog().locator('.players li').count()).toBe(1)
    await hostDialog().locator('button:has-text("Stop sharing")').click()
    await app.page.locator('.bar button', { hasText: /^Share…$/ }).waitFor()
    // the table is the host's own again: the hand that was the guest's is theirs to see (3 cards)
    expect(await app.page.locator('.hand[data-seat="1"] .hcard').count()).toBe(3)
    expect(await app.page.locator('.hand[data-seat="0"] .hcard').count()).toBe(1)
    expect(app.errors.filter(e => !/guest/.test(e))).toEqual([])
  }, 40000)
})

describe('a player whose window goes away', () => {
  it('the seat is kept and shown as away; the host can free it', async () => {
    await hostStartsTable()
    await app.page.click('.bar button:has-text("Share…")')
    await hostDialog().locator('button.primary', { hasText: 'Start sharing' }).click()
    await hostDialog().locator('button:has-text("New invitation")').click()
    const invitation = await hostDialog().locator('textarea[aria-label="Invitation code"]').inputValue()
    const second = await app.newGuestPage()
    await second.click('button:has-text("Join a shared table")')
    await second.locator('[role=dialog] input.field').first().fill('Bea')
    await second.locator('[role=dialog] textarea[aria-label="Invitation code"]').fill(invitation)
    await second.locator('[role=dialog] button.primary', { hasText: 'Make an answer' }).click()
    const answer = await second.locator('[role=dialog] textarea[aria-label="Answer code"]').inputValue()
    await hostDialog().locator('textarea[aria-label="Answer code"]').fill(answer)
    await hostDialog().locator('button.primary', { hasText: 'Connect' }).click()
    await second.waitForSelector('.table-view .pile')
    await second.close()                                                               // the window is gone: no goodbye
    await hostDialog().locator('.players li.away').waitFor({ timeout: 20000 })
    expect(await hostDialog().locator('.players li.away').innerText()).toContain('Bea')
    await hostDialog().locator('.players li.away button').click()
    await hostDialog().locator('.players li.away').waitFor({ state: 'detached' })
    await hostDialog().locator('button:has-text("Stop sharing")').click()
  }, 90000)
})
