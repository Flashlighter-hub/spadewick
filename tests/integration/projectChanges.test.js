/**
 * The project's change signal (UPDATES U6): one event that says what changed, whoever changed it, and what the table asks of the project
 * when it hears it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { onProjectChange, flushProjectChanges, announce, changeOfRows } from '../../src/main/core/changes.js'

let ctx, heard, stop
beforeEach(async () => {
  ctx = await createTestProject()
  heard = []
  stop = onProjectChange(c => heard.push(c))
})
afterEach(async () => { stop(); await ctx.cleanup() })

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#336699"/><text x="20" y="60" font-size="40">{{title}}</text></svg>'
const heardNow = () => { flushProjectChanges(); const out = heard; heard = []; return out }

async function seeded() {
  const s = await seedSet({ name: 'Heroes', fields: [{ name: 'Title', type: 'text' }], template: { svg }, cards: [{ name: 'Fire', fields: { title: 'Fire' } }, { name: 'Ice', fields: { title: 'Ice' } }] })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  heardNow()
  return s
}

describe('what is said when the project changes', () => {
  it('a card edit names the card, and nothing else', async () => {
    const { cards } = await seeded()
    await invoke('cards:update', { id: cards[0].id, fields: { title: 'Flame' } })
    expect(heardNow()).toEqual([{ all: false, cards: [cards[0].id] }])
  })

  it('a bulk edit, an import or a delete names every card it touched, once', async () => {
    const { cards } = await seeded()
    await invoke('cards:batch-update', { cardIds: [cards[0].id, cards[1].id], fields: { title: 'X' } })
    await invoke('cards:delete', [cards[1].id])
    const events = heardNow()
    expect(events).toHaveLength(1)                                   // made in quick succession: one signal
    expect(events[0].all).toBe(false)
    expect(events[0].cards.sort()).toEqual([cards[0].id, cards[1].id].sort())
  })

  it('a template, a field, a set setting or a font changes how every card looks', async () => {
    const { template, fields, set } = await seeded()
    await invoke('templates:update', { id: template.id, svgSource: svg.replace('#336699', '#993366') })
    expect(heardNow()).toEqual([{ all: true, cards: [] }])
    await invoke('fields:update', { id: fields[0].id, name: 'Heading' })
    expect(heardNow()).toEqual([{ all: true, cards: [] }])
    await invoke('sets:update', { id: set.id, name: 'Champions' })
    expect(heardNow()).toEqual([{ all: true, cards: [] }])
  })

  it('an undo and a redo say what they changed, as an edit does', async () => {
    const { cards } = await seeded()
    await invoke('cards:update', { id: cards[0].id, fields: { title: 'Flame' } })
    heardNow()
    await invoke('history:undo')
    expect(heardNow()).toEqual([{ all: false, cards: [cards[0].id] }])
    await invoke('history:redo')
    expect(heardNow()).toEqual([{ all: false, cards: [cards[0].id] }])
  })

  it('a change of something that is never drawn on a card (the rules) says nothing', async () => {
    await seeded()
    await invoke('rules:create', { title: 'Setup', body: 'Deal five.' })
    expect(heardNow()).toEqual([])
  })

  it('a restored snapshot changes everything', async () => {
    await seeded()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    heardNow()
    await invoke('snapshots:restore', snap.id)
    expect(heardNow()).toEqual([{ all: true, cards: [] }])
  })

  it('joins what is said in quick succession: "everything" wins over cards, and a listener that fails does not stop the others', () => {
    const second = []
    const stopFirst = onProjectChange(() => { throw new Error('a broken listener') })
    const stopSecond = onProjectChange(c => second.push(c))
    announce({ cards: ['a'] }); announce({ cards: ['b', 'a'] })
    flushProjectChanges()
    expect(second.pop()).toEqual({ all: false, cards: ['a', 'b'] })
    announce({ cards: ['a'] }); announce({ all: true })
    flushProjectChanges()
    expect(second.pop()).toEqual({ all: true, cards: [] })
    announce({ cards: [] })
    flushProjectChanges()
    expect(second).toEqual([])
    stopFirst(); stopSecond()
  })

  it('reads recorded row changes: cards by id, any other drawn table as everything, the rest as nothing', () => {
    expect(changeOfRows([{ table: 'cards', before: null, after: { id: 'c1' } }, { table: 'cards', before: { id: 'c2' }, after: null }])).toEqual({ all: false, cards: ['c1', 'c2'] })
    expect(changeOfRows([{ table: 'icons', before: null, after: { id: 'i' } }])).toEqual({ all: true, cards: [] })
    expect(changeOfRows([{ table: 'rules_pages', before: null, after: { id: 'r' } }, { table: 'print_colors', before: null, after: { id: 'p' } }])).toEqual({ all: false, cards: [] })
  })
})

describe('what the table asks of the project when it hears (table:card-info)', () => {
  it('gives the current name, ID and back of the cards, and says which are gone', async () => {
    const { cards, set } = await seeded()
    const back = await invoke('templates:create-back', { setId: set.id, name: 'Back', design: 'solid', primary: '#223344', accent: '#ffcc00' }).catch(() => null)
    await invoke('cards:update', { id: cards[0].id, displayName: 'Flame' })
    await invoke('cards:delete', [cards[1].id])
    const info = await invoke('table:card-info', { ids: [cards[0].id, cards[1].id, 'no-such-card'] })
    expect(info[cards[0].id]).toMatchObject({ name: 'Flame', code: cards[0].card_code, missing: false })
    expect(info[cards[1].id]).toMatchObject({ missing: true, backKey: null })
    expect(info['no-such-card']).toMatchObject({ missing: true })
    if (back) expect(info[cards[0].id].backKey).toBeTruthy()
  })

  it('a card with no name shows its ID, and a back that shows the card\'s own data is a key of its own', async () => {
    const { cards, set } = await seeded()
    await invoke('sets:update', { id: set.id, displayField: null })
    const info = await invoke('table:card-info', { ids: [cards[0].id] })
    expect(info[cards[0].id].name).toBe(cards[0].card_code)
    const dynamic = await invoke('templates:create', { name: 'Back with text', svgSource: svg })
    await invoke('sets:update', { id: set.id, defaultBackTemplateId: dynamic.id })
    const again = await invoke('table:card-info', { ids: [cards[0].id] })
    expect(again[cards[0].id].backKey).toBe(`${dynamic.id}:${cards[0].id}`)
    const deck = (await invoke('table:cards', {}))[0]
    expect(deck.cards[0].backKey).toBe(again[cards[0].id].backKey)         // the same key the table was made with
  })
})
