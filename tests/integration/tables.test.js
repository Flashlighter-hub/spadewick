/**
 * The virtual table's services (PRD §7.9): the decks a table is made from, and saved tables.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { createTable, reduce, drawAction } from '../../src/shared/table.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const FRONT = svg('<rect width="500" height="700" fill="#336699"/><text x="20" y="60" font-size="40">{{title}}</text>')

async function seeded() {
  const a = await seedSet({ name: 'Heroes', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }], template: { svg: FRONT }, cards: [{ name: 'Fire', fields: { title: 'Fire' } }, { name: 'Ice', fields: { title: 'Ice' } }, { name: 'Wind', fields: { title: 'Wind' } }] })
  await invoke('sets:update', { id: a.set.id, defaultTemplateId: a.template.id })
  const b = await seedSet({ name: 'Villains', cardSize: 'tarot', fields: [{ name: 'Title', type: 'text' }], cards: [{ name: 'Crow' }] })
  return { a, b }
}
const decksOf = async setIds => invoke('table:cards', { setIds })

describe('what a table is made from', () => {
  it('lists a deck for each set, with its cards, their copies and the size of the card', async () => {
    const { a, b } = await seeded()
    await invoke('cards:update', { id: a.cards[0].id, quantity: 3 })
    const decks = await decksOf()
    expect(decks.map(d => d.name)).toEqual(['Heroes', 'Villains'])
    expect(decks[0].size).toEqual({ mmW: 63.5, mmH: 88.9 })
    expect(decks[1].size).toEqual({ mmW: 70, mmH: 120 })
    expect(decks[0].cards.map(c => [c.name, c.quantity])).toEqual([['Fire', 3], ['Ice', 1], ['Wind', 1]])
    expect(decks[0].hasTemplate).toBe(true)
    expect(decks[1].hasTemplate).toBe(false)
    expect((await decksOf([b.set.id])).map(d => d.name)).toEqual(['Villains'])
  })

  it('says what each card\'s back is: none, one that looks the same on every card, or one that shows the card\'s own data', async () => {
    const { a } = await seeded()
    expect((await decksOf([a.set.id]))[0].cards.every(c => c.backKey === null)).toBe(true)
    const fixed = await invoke('templates:create', { name: 'Fixed', svgSource: svg('<rect width="500" height="700" fill="#cc0000"/>'), cardSize: 'poker' })
    const named = await invoke('templates:create', { name: 'Named', svgSource: svg('<rect width="500" height="700" fill="#fff"/><text x="10" y="300" font-size="90">{{title}}</text>'), cardSize: 'poker' })
    await invoke('sets:update', { id: a.set.id, defaultBackTemplateId: fixed.id })
    await invoke('cards:update', { id: a.cards[2].id, backTemplateId: named.id })
    const keys = (await decksOf([a.set.id]))[0].cards.map(c => c.backKey)
    expect(keys[0]).toBe(fixed.id)
    expect(keys[1]).toBe(fixed.id)                                       // the same key, so the same picture
    expect(keys[2]).toBe(`${named.id}:${a.cards[2].id}`)                 // its own picture
  })

  it('leaves out deleted cards', async () => {
    const { a } = await seeded()
    await invoke('cards:delete', [a.cards[1].id])
    expect((await decksOf([a.set.id]))[0].cards.map(c => c.name)).toEqual(['Fire', 'Wind'])
  })
})

describe('saved tables', () => {
  async function table() {
    const { a } = await seeded()
    const decks = await decksOf([a.set.id])
    let s = createTable({ decks, seats: 2, shuffle: true, seed: 5 })
    const id = Object.values(s.piles)[0].id
    s = reduce(s, drawAction(s, id, 1, 2))
    return { a, s }
  }

  it('saves into the project\'s tables folder, lists, loads and deletes', async () => {
    const { s } = await table()
    expect(await invoke('table:list')).toEqual([])
    const saved = await invoke('table:save', { name: 'Opening hand', state: s, log: [[{ type: 'seats', count: 2 }]] })
    expect(saved).toEqual({ id: 'opening-hand', name: 'Opening hand' })
    expect(existsSync(join(ctx.dir, 'tables', 'opening-hand.json'))).toBe(true)
    expect((await invoke('table:list'))).toEqual([expect.objectContaining({ id: 'opening-hand', name: 'Opening hand', cards: 3 })])
    const loaded = await invoke('table:load', 'opening-hand')
    expect(loaded.state).toEqual(s)
    expect(loaded).toMatchObject({ name: 'Opening hand', missingCards: [] })
    expect(loaded.log).toEqual([[{ type: 'seats', count: 2 }]])
    await invoke('table:delete', 'opening-hand')
    expect(await invoke('table:list')).toEqual([])
    await invoke('table:delete', 'opening-hand')                           // deleting what is not there is not an error
  })

  it('a second table with the same name is a file of its own; saving over one by id replaces it', async () => {
    const { s } = await table()
    const one = await invoke('table:save', { name: 'Game', state: s })
    const two = await invoke('table:save', { name: 'Game', state: s })
    expect([one.id, two.id]).toEqual(['game', 'game-2'])
    await invoke('table:save', { id: 'game', name: 'Game renamed', state: s })
    expect((await invoke('table:list')).map(t => t.name).sort()).toEqual(['Game', 'Game renamed'])
    expect(readdirSync(join(ctx.dir, 'tables'))).toHaveLength(2)
  })

  it('refuses a table with no name or one that is not a table', async () => {
    const { s } = await table()
    await expect(invoke('table:save', { name: '  ', state: s })).rejects.toThrow(/name/i)
    await expect(invoke('table:save', { name: 'x', state: { hello: 1 } })).rejects.toThrow(/cannot be read/)
    const lost = JSON.parse(JSON.stringify(s)); lost.hands[1].cards = []
    await expect(invoke('table:save', { name: 'x', state: lost })).rejects.toThrow(/cannot be read/)
  })

  it('refuses a file that was changed into nonsense, and ids that are paths', async () => {
    const { s } = await table()
    await invoke('table:save', { name: 'Game', state: s })
    const file = join(ctx.dir, 'tables', 'game.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')); raw.state.hands[1].cards.push('zzz')
    writeFileSync(file, JSON.stringify(raw))
    await expect(invoke('table:load', 'game')).rejects.toThrow(/cannot be read/)
    writeFileSync(file, 'not json')
    await expect(invoke('table:load', 'game')).rejects.toThrow(/cannot be read/)
    expect(await invoke('table:list')).toEqual([])
    await expect(invoke('table:load', '../project')).rejects.toThrow(/not found/)
    await expect(invoke('table:load', 'nope')).rejects.toThrow(/not found/)
    await invoke('table:delete', '../project')
    expect(existsSync(join(ctx.dir, 'project.db'))).toBe(true)
  })

  it('names the cards that were deleted since the table was saved, so it can still be opened', async () => {
    const { a, s } = await table()
    await invoke('table:save', { name: 'Game', state: s })
    await invoke('cards:delete', [a.cards[0].id])
    const loaded = await invoke('table:load', 'game')
    expect(loaded.missingCards).toEqual([a.cards[0].id])
    expect(Object.keys(loaded.state.cards)).toHaveLength(3)
  })
})
