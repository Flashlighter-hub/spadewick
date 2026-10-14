/**
 * A table shared between players (PRD §22.0), steps 1 and 2: the host-authoritative conversation and the hidden hands, tested with
 * players that talk in memory (tests/helpers/tableNet.js). No network is involved.
 */
import { describe, it, expect } from 'vitest'
import { createTable, allCardIds, prng, reduce } from '../../src/shared/table.js'
import { viewFor, canon, refusal, createHost, createGuest, MAX_ACTION_BYTES } from '../../src/shared/tableNet.js'
import { makeNetwork } from '../helpers/tableNet.js'

const NAMES = Array.from({ length: 20 }, (_, i) => `Secret${String(i + 1).padStart(2, '0')}`)
const table = (extra = {}) => createTable({
  decks: [{ id: 'A', name: 'Deck', size: { mmW: 63.5, mmH: 88.9 }, cards: NAMES.map((n, i) => ({ id: `A-${i + 1}`, name: n, code: `A-${i + 1}`, quantity: 1, backKey: 'b' })) }],
  seats: 2, shuffle: true, deal: 2, seed: 7, ...extra
})
const fixedSeeds = (...seeds) => { let i = 0; return () => seeds[i++ % seeds.length] }
const names = state => Object.fromEntries(Object.entries(state.cards).map(([id, c]) => [id, c.name]))
const pileOf = (state, index = 0) => Object.values(state.piles)[index]
const topOf = pile => pile.cards[pile.cards.length - 1]
const handOf = (state, seat) => state.hands[seat].cards
const mirror = net => { for (const [peer, g] of net.people) expect(canon(g.view), `the view of ${peer}`).toBe(canon(viewFor(net.host.state, g.you.seat))) }
const everything = log => JSON.stringify(log.map(l => l.msg))

describe('joining', () => {
  it('gives each guest a seat, shows them their own hand and the others as a number of cards', () => {
    const net = makeNetwork(table({ seats: 3 }), { guests: ['ann', 'bob'] })
    expect(net.people.get('ann').you).toMatchObject({ peer: 'ann', seat: 1 })
    expect(net.people.get('bob').you).toMatchObject({ seat: 2 })
    const ann = net.people.get('ann').view
    expect(ann.viewer).toBe(1)
    expect(ann.hands[1].cards).toEqual(handOf(net.host.state, 1))
    expect(ann.hands[0]).toEqual({ cards: [], count: 2, hidden: true, name: '' })
    expect(net.people.get('ann').players.map(p => [p.peer, p.name, p.seat])).toEqual([['host', 'Host', 0], ['ann', 'Guest', 1], ['bob', 'Guest', 2]])
    mirror(net)
  })

  it('takes the seat a guest asks for when it is free, and adds a hand to the table when every seat is taken', () => {
    const net = makeNetwork(table({ seats: 2 }))
    net.join('ann', { seat: 1 })
    expect(net.people.get('ann').you.seat).toBe(1)
    const bob = net.join('bob', { name: 'Bob', seat: 1 })              // taken: the table grows one hand
    expect(bob.you).toMatchObject({ seat: 2, name: 'Bob' })
    expect(net.host.state.seats).toBe(3)
    expect(net.people.get('ann').view.hands).toHaveLength(3)           // and the guest who was there is told
    mirror(net)
  })

  it('makes a spectator of a guest who comes when the table is full; a spectator sees no hand and cannot play from one', () => {
    const net = makeNetwork(table({ seats: 6, deal: 1 }))
    for (let i = 1; i < 6; i++) net.join(`p${i}`)
    const watcher = net.join('eve')
    expect(watcher.you.seat).toBe(null)
    expect(watcher.view.hands.every(h => h.hidden)).toBe(true)
    const card = handOf(net.host.state, 1)[0]
    net.guestAct('eve', { type: 'transfer', from: { hand: 1 }, cards: [card], to: { x: 1, y: 1 } })
    expect(net.people.get('eve').takeEvents()).toEqual([{ type: 'rejected', cid: 1, reason: 'notYourHand' }])
    mirror(net)
  })

  it('a guest that leaves frees the seat, and the cards in the hand stay; the next guest has that hand', () => {
    const net = makeNetwork(table(), { guests: ['ann'] })
    const held = handOf(net.host.state, 1)
    net.leave('ann')
    expect(handOf(net.host.state, 1)).toEqual(held)
    expect(net.join('bob').you.seat).toBe(1)
    expect(net.people.get('bob').view.hands[1].cards).toEqual(held)
  })

  it('tells the others who is at the table when someone arrives, renames or goes', () => {
    const net = makeNetwork(table({ seats: 3 }), { guests: ['ann'] })
    net.join('bob', { name: 'Bob' })
    expect(net.people.get('ann').players.map(p => p.name)).toEqual(['Host', 'Guest', 'Bob'])
    net.send('ann', net.people.get('ann').rename('  Ann\u0000the  great  '.repeat(5)))
    expect(net.people.get('bob').players[1].name.length).toBeLessThanOrEqual(30)
    net.leave('bob')
    expect(net.people.get('ann').players).toHaveLength(2)
  })
})

describe('following the host', () => {
  it('a guest\'s move is made by the host and told to everybody, in order, and every view is what the host would show that player', () => {
    const net = makeNetwork(table({ seats: 3 }), { guests: ['ann', 'bob'] })
    const pile = pileOf(net.host.state)
    net.guestAct('ann', { type: 'move', pile: pile.id, x: 500, y: 400 })
    expect(net.host.state.piles[pile.id]).toMatchObject({ x: 500, y: 400 })
    expect(net.people.get('bob').view.piles[pile.id]).toMatchObject({ x: 500, y: 400 })
    expect(net.people.get('ann').pending.size).toBe(0)
    net.hostAct({ type: 'rotate', pile: pile.id, rot: 90 })
    net.guestAct('bob', { type: 'label', pile: pile.id, name: 'Draw pile' })
    expect(net.host.rev).toBe(3)
    expect(net.people.get('ann').rev).toBe(3)
    mirror(net)
  })

  it('answers the player who moved with the same message everybody gets, plus their own number', () => {
    const net = makeNetwork(table({ seats: 3 }), { guests: ['ann', 'bob'] })
    const pile = pileOf(net.host.state)
    const from = net.log.length
    net.guestAct('ann', { type: 'move', pile: pile.id, x: 1, y: 2 })
    expect(net.downTo('ann', from)[0]).toMatchObject({ type: 'applied', rev: 1, origin: 'ann', cid: 1 })
    expect(net.downTo('bob', from)[0]).toMatchObject({ type: 'applied', rev: 1, origin: 'ann' })
    expect(net.downTo('bob', from)[0].cid).toBeUndefined()
  })

  it('a move that changes nothing is refused, with the reason', () => {
    const net = makeNetwork(table(), { guests: ['ann'] })
    net.guestAct('ann', { type: 'move', pile: 'p999', x: 1, y: 1 })
    expect(net.people.get('ann').takeEvents()).toEqual([{ type: 'rejected', cid: 1, reason: 'noEffect' }])
    expect(net.host.rev).toBe(0)
  })

  it('several moves are one step, and undo takes them back together', () => {
    const net = makeNetwork(table(), { guests: ['ann'] })
    net.hostActAll([{ type: 'addToken', kind: 'die', sides: 6, count: 2, x: 0, y: 0 }, { type: 'addToken', kind: 'die', sides: 20, x: 0, y: 0 }])
    const ids = Object.keys(net.host.state.tokens)
    net.guestActAll('ann', ids.map(id => ({ type: 'roll', id, seed: 1 })))
    expect(net.host.session.log.at(-1)).toHaveLength(2)
    net.send('ann', net.people.get('ann').undo())
    expect(net.host.session.log).toHaveLength(1)
    mirror(net)
  })

  it('draws, deals and plays from the hand work through the host for guests and host alike', () => {
    const net = makeNetwork(table({ seats: 2, deal: 0 }), { guests: ['ann'] })
    const pile = pileOf(net.host.state)
    net.guestAct('ann', { type: 'transfer', from: { pile: pile.id }, cards: [topOf(pile)], to: { hand: 1 } })
    net.hostAct({ type: 'transfer', from: { pile: pile.id }, cards: [topOf(net.host.state.piles[pile.id])], to: { hand: 0 } })
    expect(handOf(net.host.state, 1)).toHaveLength(1)
    expect(handOf(net.host.state, 0)).toHaveLength(1)
    const mine = handOf(net.host.state, 1)[0]
    net.guestAct('ann', { type: 'transfer', from: { hand: 1 }, cards: [mine], to: { x: 40, y: 50, faceUp: true } })
    expect(handOf(net.host.state, 1)).toHaveLength(0)
    const played = Object.values(net.people.get('ann').view.piles).find(p => p.cards.includes(mine))
    expect(played).toMatchObject({ x: 40, y: 50, faceUp: true })
    expect(net.people.get('ann').view.cards[mine].name).toMatch(/^Secret/)
    mirror(net)
  })
})

describe('hidden hands (step 2)', () => {
  it('never sends what is in another player\'s hand: not in the first view, not in any move that follows', () => {
    const net = makeNetwork(table({ seats: 3, deal: 3 }), { guests: ['ann', 'bob'] })
    const bobsCards = handOf(net.host.state, 2).map(id => net.host.state.cards[id].name)
    const bobsIds = handOf(net.host.state, 2)
    expect(bobsCards).toHaveLength(3)
    // others move things about, and a card goes into Bob's hand from the table
    const pile = pileOf(net.host.state)
    net.hostAct({ type: 'transfer', from: { pile: pile.id }, cards: [topOf(pile)], to: { hand: 2 } })
    net.guestAct('ann', { type: 'move', pile: pile.id, x: 9, y: 9 })
    const seenByAnn = JSON.stringify(net.downTo('ann'))
    for (const n of bobsCards) expect(seenByAnn).not.toContain(n)
    for (const id of bobsIds) expect(seenByAnn).not.toContain(`"${id}"`)
    const ann = net.people.get('ann').view
    expect(ann.hands[2]).toMatchObject({ cards: [], count: 4, hidden: true })
    expect(Object.keys(ann.cards).some(id => bobsIds.includes(id))).toBe(false)
    // and Bob's own hand is shown to Bob
    expect(net.people.get('bob').view.hands[2].cards).toEqual(handOf(net.host.state, 2))
    mirror(net)
  })

  it('the host sees their own hand only', () => {
    const net = makeNetwork(table({ seats: 3, deal: 2 }), { guests: ['ann'] })
    const view = net.host.hostView()
    expect(view.hands[0].cards).toHaveLength(2)
    expect(view.hands[1].hidden).toBe(true)
    expect(JSON.stringify(view)).not.toContain(net.host.state.cards[handOf(net.host.state, 1)[0]].name)
  })

  it('a card is a name only when it is face up or in your own hand: a face-down pile is ids, and turning it over shows them', () => {
    const net = makeNetwork(table({ deal: 0 }), { guests: ['ann'] })
    const pile = pileOf(net.host.state)
    const ann = net.people.get('ann')
    expect(Object.values(ann.view.cards).every(c => c.hidden && c.name === '' && c.back === 'b')).toBe(true)   // a face-down card is its back, and nothing else
    expect(ann.view.piles[pile.id].cards).toHaveLength(20)           // the pile is there, with its count and its cards as ids
    expect(JSON.stringify(net.downTo('ann'))).not.toContain('Secret')
    net.hostAct({ type: 'flip', pile: pile.id })
    expect(Object.values(ann.view.cards).filter(c => !c.hidden)).toHaveLength(20)
    expect(net.downTo('ann').at(-1).type).toBe('state')              // the move showed what the guest may not have had: the host sent the view
    net.hostAct({ type: 'flip', pile: pile.id })
    expect(Object.values(ann.view.cards).filter(c => !c.hidden)).toHaveLength(0)   // face down again: forgotten
    mirror(net)
  })

  it('a card drawn from a face-down pile into your hand is shown to you, and to nobody else', () => {
    const net = makeNetwork(table({ seats: 3, deal: 0 }), { guests: ['ann', 'bob'] })
    const pile = pileOf(net.host.state)
    const card = topOf(pile)
    const name = net.host.state.cards[card].name
    net.guestAct('ann', { type: 'transfer', from: { pile: pile.id }, cards: [card], to: { hand: 1 } })
    expect(net.people.get('ann').view.cards[card].name).toBe(name)
    expect(JSON.stringify(net.downTo('bob'))).not.toContain(name)
    expect(net.people.get('bob').view.hands[1]).toMatchObject({ hidden: true, count: 1 })
    mirror(net)
  })

  it('a hand can be taken from by its own player only', () => {
    const net = makeNetwork(table({ seats: 3, deal: 2 }), { guests: ['ann', 'bob'] })
    const bobsCard = handOf(net.host.state, 2)[0]
    net.guestAct('ann', { type: 'transfer', from: { hand: 2 }, cards: [bobsCard], to: { hand: 1 } })
    expect(net.people.get('ann').takeEvents()[0].reason).toBe('notYourHand')
    expect(handOf(net.host.state, 2)).toContain(bobsCard)
    // the host plays from their own hand only
    net.hostAct({ type: 'transfer', from: { hand: 2 }, cards: [bobsCard], to: { hand: 0 } })
    expect(handOf(net.host.state, 2)).toContain(bobsCard)
    // but a card can be passed to another player's hand
    const mine = handOf(net.host.state, 1)[0]
    net.guestAct('ann', { type: 'transfer', from: { hand: 1 }, cards: [mine], to: { hand: 2 } })
    expect(handOf(net.host.state, 2)).toContain(mine)
    expect(net.people.get('bob').view.cards[mine].name).toMatch(/^Secret/)
    expect(net.people.get('ann').view.cards[mine]).toBeUndefined()    // Ann no longer has it
    mirror(net)
  })

  it('a card played from a hand face up is seen by everybody; played face down, only as a card', () => {
    const net = makeNetwork(table({ seats: 3, deal: 2 }), { guests: ['ann', 'bob'] })
    const [up, down] = handOf(net.host.state, 1)
    net.guestAct('ann', { type: 'transfer', from: { hand: 1 }, cards: [up], to: { x: 10, y: 10, faceUp: true } })
    net.guestAct('ann', { type: 'transfer', from: { hand: 1 }, cards: [down], to: { x: 90, y: 10, faceUp: false } })
    const bob = net.people.get('bob').view
    expect(bob.cards[up].name).toMatch(/^Secret/)
    expect(bob.cards[down]).toMatchObject({ hidden: true, name: '' })
    expect(net.people.get('ann').view.cards[down]).toMatchObject({ hidden: true, name: '' })   // face down on the table: known to nobody, the player who played it included
  })
})

describe('what a guest may do', () => {
  const net1 = () => makeNetwork(table({ seats: 2 }), { guests: ['ann'] })
  const reasonOf = (net, action) => { net.guestAct('ann', action); return net.people.get('ann').takeEvents().at(-1)?.reason }

  it('only the host collects the table or changes the number of seats', () => {
    const net = net1()
    const pile = pileOf(net.host.state)
    expect(reasonOf(net, { type: 'collect', into: pile.id })).toBe('hostOnly')
    expect(reasonOf(net, { type: 'seats', count: 4 })).toBe('hostOnly')
    net.hostAct({ type: 'seats', count: 3 })
    expect(net.host.state.seats).toBe(3)
    expect(net.people.get('ann').view.hands).toHaveLength(3)
  })

  it('names her own hand, not another one', () => {
    const net = net1()
    expect(reasonOf(net, { type: 'nameHand', seat: 0, name: 'Mine now' })).toBe('notYourHand')
    net.guestAct('ann', { type: 'nameHand', seat: 1, name: 'Ann' })
    expect(net.host.state.hands[1].name).toBe('Ann')
    expect(net.people.get('ann').view.hands[1].name).toBe('Ann')
    mirror(net)
  })

  it('refuses what is not a move, what is badly made, and what is too big', () => {
    const net = net1()
    expect(reasonOf(net, { type: 'rm -rf' })).toBe('unknown')
    expect(reasonOf(net, 'move')).toBe('malformed')
    expect(reasonOf(net, { type: 'move' })).toBe('malformed')
    expect(reasonOf(net, { type: 'transfer', cards: 'c1', from: {}, to: {} })).toBe('malformed')
    expect(reasonOf(net, { type: 'transfer', cards: ['c1'], from: { hand: 9 }, to: { hand: 0 } })).toBe('malformed')
    expect(reasonOf(net, { type: 'label', pile: 'p1', name: 'x'.repeat(MAX_ACTION_BYTES) })).toBe('tooBig')
    net.send('ann', { type: 'launch' })
    expect(net.people.get('ann').takeEvents().at(-1).reason).toBe('unknown')
    net.send('ann', 'hello')
    expect(net.people.get('ann').takeEvents().at(-1).reason).toBe('malformed')
    expect(net.host.rev).toBe(0)
  })

  it('names that could reach into the table\'s own machinery are not ids: a pile called __proto__ moves nothing', () => {
    const net = net1()
    const before = Object.getOwnPropertyNames(Object.prototype).sort()
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(reasonOf(net, { type: 'move', pile: id, x: 5, y: 5 })).toBe('malformed')
      expect(reasonOf(net, { type: 'setToken', id, value: 3 })).toBe('malformed')
    }
    // and the table itself does not trust an id either, whoever sent it
    const state = table()
    for (const id of ['__proto__', 'constructor']) expect(reduce(state, { type: 'move', pile: id, x: 5, y: 5 })).toBe(state)
    expect(reduce(state, { type: 'removeToken', id: 'toString' })).toBe(state)
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before)
    expect({}.x).toBeUndefined()
  })

  it('limits the tokens one table can have, and how fast a guest can send', () => {
    const net = makeNetwork(table(), { guests: ['ann'], maxPerSecond: 5, now: (() => { let t = 0; return () => t })() })
    for (let i = 0; i < 5; i++) net.guestAct('ann', { type: 'addToken', kind: 'counter', x: i, y: 0 })
    expect(Object.keys(net.host.state.tokens)).toHaveLength(5)
    net.guestAct('ann', { type: 'addToken', kind: 'counter', x: 9, y: 0 })
    expect(net.people.get('ann').takeEvents().at(-1).reason).toBe('rate')
    expect(refusal(table(), 0, false, { type: 'addToken', kind: 'die' }, { maxTokens: 0 })).toBe('tooMany')
  })

  it('the rate comes back as time passes', () => {
    let t = 0
    const net = makeNetwork(table(), { guests: ['ann'], maxPerSecond: 2, now: () => t })
    const pile = pileOf(net.host.state)
    for (let i = 0; i < 3; i++) net.guestAct('ann', { type: 'move', pile: pile.id, x: i + 1, y: 0 })
    expect(net.people.get('ann').takeEvents().at(-1).reason).toBe('rate')
    t = 1000
    net.guestAct('ann', { type: 'move', pile: pile.id, x: 50, y: 0 })
    expect(net.host.state.piles[pile.id].x).toBe(50)
  })

  it('ignores a message from somebody who has not joined', () => {
    const net = makeNetwork(table())
    expect(net.host.receive('stranger', { type: 'action', cid: 1, action: { type: 'nextTurn' } })).toEqual([])
    expect(net.host.rev).toBe(0)
  })
})

describe('chance belongs to the host', () => {
  it('a guest\'s seed is never used: the host\'s is, and everybody sees the same roll and the same shuffle', () => {
    const net = makeNetwork(table({ deal: 0 }), { guests: ['ann', 'bob'], newSeed: fixedSeeds(4242, 99) })
    net.hostAct({ type: 'addToken', kind: 'die', sides: 20, count: 3, x: 0, y: 0 })
    const id = Object.keys(net.host.state.tokens)[0]
    net.guestAct('ann', { type: 'roll', id, seed: 1 })
    const expected = reduce(net.people.get('bob').view, { type: 'roll', id, seed: 4242 }).tokens[id].values
    expect(net.host.state.tokens[id].values).toEqual(expected)
    expect(net.people.get('bob').view.tokens[id].values).toEqual(expected)
    expect(net.downTo('bob').find(m => m.actions?.[0].type === 'roll').actions[0].seed).toBe(4242)
    const pile = pileOf(net.host.state)
    net.guestAct('bob', { type: 'shuffle', pile: pile.id, seed: 5 })
    const again = reduce(table({ deal: 0 }), { type: 'shuffle', pile: pile.id, seed: 99 })
    expect(net.host.state.piles[pile.id].cards).toEqual(pileOf(again).cards)
    mirror(net)
  })
})

describe('undo and redo', () => {
  it('a player takes back their own latest move, and nobody else\'s; the host can take back any', () => {
    const net = makeNetwork(table({ seats: 3 }), { guests: ['ann', 'bob'] })
    const pile = pileOf(net.host.state)
    net.guestAct('ann', { type: 'move', pile: pile.id, x: 100, y: 100 })
    net.guestAct('bob', { type: 'move', pile: pile.id, x: 200, y: 200 })
    net.send('ann', net.people.get('ann').undo())
    expect(net.people.get('ann').takeEvents().at(-1).reason).toBe('notYours')       // Bob moved last
    net.send('bob', net.people.get('bob').undo())
    expect(net.host.state.piles[pile.id]).toMatchObject({ x: 100, y: 100 })
    mirror(net)
    net.send('ann', net.people.get('ann').redo())                                    // Bob's step is the one to put back
    expect(net.people.get('ann').takeEvents().at(-1).reason).toBe('notYours')
    net.send('bob', net.people.get('bob').redo())
    expect(net.host.state.piles[pile.id]).toMatchObject({ x: 200, y: 200 })
    net.hostUndo(); net.hostUndo()
    expect(net.host.state.piles[pile.id].x).not.toBe(100)
    expect(net.host.session.past).toHaveLength(0)
    net.hostUndo()                                                                    // nothing left
    mirror(net)
  })

  it('an undo that brings a hidden card back is told as a view, and hides what must be hidden', () => {
    const net = makeNetwork(table({ seats: 3, deal: 0 }), { guests: ['ann', 'bob'] })
    const pile = pileOf(net.host.state)
    const card = topOf(pile)
    net.guestAct('ann', { type: 'transfer', from: { pile: pile.id }, cards: [card], to: { hand: 1 } })
    net.send('ann', net.people.get('ann').undo())
    expect(net.people.get('ann').view.hands[1].cards).toEqual([])
    expect(net.people.get('ann').view.cards[card]).toMatchObject({ hidden: true, name: '' })
    expect(net.people.get('bob').view.hands[1].count).toBe(0)
    mirror(net)
  })
})

describe('when a message is lost', () => {
  it('a guest that sees a gap asks for the table again, and has it', () => {
    const net = makeNetwork(table({ seats: 3 }), { guests: ['ann', 'bob'] })
    const pile = pileOf(net.host.state)
    net.dropWhen(e => e.to === 'bob' && e.msg.type === 'applied' && e.msg.rev === 1)
    net.hostAct({ type: 'move', pile: pile.id, x: 11, y: 11 })
    expect(net.people.get('bob').rev).toBe(0)
    net.dropWhen(null)
    net.hostAct({ type: 'move', pile: pile.id, x: 22, y: 22 })
    expect(net.people.get('bob').rev).toBe(2)                    // it noticed rev 2 followed nothing, asked, and was given the table as it is
    expect(net.people.get('bob').view.piles[pile.id]).toMatchObject({ x: 22, y: 22 })
    mirror(net)
  })

  it('a message that comes twice is applied once', () => {
    const net = makeNetwork(table(), { guests: ['ann'] })
    const pile = pileOf(net.host.state)
    net.hostAct({ type: 'rotate', pile: pile.id, rot: 90 })
    const again = net.downTo('ann').find(m => m.type === 'applied')
    net.people.get('ann').receive(again)
    expect(net.people.get('ann').view.piles[pile.id].rot).toBe(90)
    expect(net.people.get('ann').rev).toBe(1)
  })

  it('a guest can ask for the table at any time', () => {
    const net = makeNetwork(table(), { guests: ['ann'] })
    net.send('ann', { type: 'resync' })
    expect(net.downTo('ann').at(-1)).toMatchObject({ type: 'state', why: 'asked', rev: 0 })
  })

  it('a guest built for another version of the conversation says so and does not take part', () => {
    const g = createGuest()
    g.receive({ type: 'welcome', version: 99, you: { peer: 'x', seat: 0 }, rev: 0, view: {}, players: [] })
    expect(g.joined).toBe(false)
    expect(g.takeEvents()).toEqual([{ type: 'version', version: 99 }])
  })
})

describe('the project says a card changed', () => {
  it('the host\'s table takes the new name and everybody is told, showing only what each may see', () => {
    const net = makeNetwork(table({ seats: 2, deal: 0 }), { guests: ['ann'] })
    const pile = pileOf(net.host.state)
    net.hostAct({ type: 'flip', pile: pile.id })
    const out = net.host.refresh({ 'A-1': { name: 'Renamed', code: 'A-1', backKey: 'b', missing: false } })
    for (const o of out) net.people.get(o.to).receive(o.msg)
    const id = Object.entries(net.host.state.cards).find(([, c]) => c.id === 'A-1')[0]
    expect(net.host.state.cards[id].name).toBe('Renamed')
    expect(net.people.get('ann').view.cards[id].name).toBe('Renamed')
    expect(net.host.refresh({ 'A-1': { name: 'Renamed', code: 'A-1', backKey: 'b', missing: false } })).toEqual([])
  })
})

describe('any game, played by anybody: views stay equal to what the host would show, and nothing hidden leaks', () => {
  it('survives thousands of random moves from the host and three guests, some of them not allowed', () => {
    const rnd = prng(2024)
    const pick = list => list[Math.floor(rnd() * list.length)]
    const net = makeNetwork(table({ seats: 4, deal: 2, seed: 5 }), { guests: ['ann', 'bob', 'cy'], newSeed: () => Math.floor(rnd() * 1e9) + 1, maxPerSecond: 1e9 })
    const peers = ['host', 'ann', 'bob', 'cy']
    const seatOf = new Proxy({}, { get: (_, peer) => (peer === 'host' ? 0 : net.people.get(peer)?.you.seat ?? null) })   // a guest whose hand went has none
    let steps = 0, applied = 0
    const cardCount = allCardIds(net.host.state).length
    const hiddenNow = peer => {                      // names that this peer must not have been sent: other hands, and face-down piles
      const s = net.host.state, mine = new Set(seatOf[peer] === null ? [] : s.hands[seatOf[peer]].cards)
      const secret = new Set()
      for (let i = 0; i < s.seats; i++) if (i !== seatOf[peer]) for (const id of s.hands[i].cards) secret.add(id)
      for (const p of Object.values(s.piles)) if (!p.faceUp) for (const id of p.cards) if (!mine.has(id)) secret.add(id)
      return secret
    }

    for (let n = 0; n < 1500; n++) {
      const s = net.host.state
      const peer = pick(peers)
      const seat = seatOf[peer]
      const piles = Object.values(s.piles), tokens = Object.values(s.tokens)
      const anyHand = Math.floor(rnd() * s.seats)
      const handCards = seat === null ? [] : s.hands[seat].cards
      const ownOrNot = rnd() < 0.8 ? seat : anyHand
      const choices = [
        () => piles.length && { type: 'move', pile: pick(piles).id, x: Math.floor(rnd() * 900), y: Math.floor(rnd() * 900) },
        () => piles.length && { type: 'flip', pile: pick(piles).id },
        () => piles.length && { type: 'shuffle', pile: pick(piles).id, seed: 1 },
        () => piles.length && { type: 'rotate', pile: pick(piles).id, rot: 90 * Math.floor(rnd() * 4) },
        () => { const p = piles.length && pick(piles); return p && { type: 'transfer', from: { pile: p.id }, cards: [topOf(p)], to: { hand: Math.floor(rnd() * s.seats) } } },
        () => { const p = piles.length && pick(piles); return p && { type: 'transfer', from: { pile: p.id }, cards: p.cards.slice(-2), to: { x: Math.floor(rnd() * 800), y: 50, faceUp: rnd() < 0.5 } } },
        () => { const p = piles.length > 1 && pick(piles), q = piles.length > 1 && pick(piles); return p && q && p !== q && { type: 'transfer', from: { pile: p.id }, cards: [topOf(p)], to: { pile: q.id } } },
        () => handCards.length && { type: 'transfer', from: { hand: ownOrNot }, cards: [pick(s.hands[ownOrNot]?.cards.length ? s.hands[ownOrNot].cards : handCards)], to: rnd() < 0.5 ? { x: 30, y: 30, faceUp: rnd() < 0.5 } : { hand: Math.floor(rnd() * s.seats) } },
        () => handCards.length && { type: 'transfer', from: { hand: ownOrNot }, cards: [pick(s.hands[ownOrNot]?.cards.length ? s.hands[ownOrNot].cards : handCards)], to: piles.length ? { pile: pick(piles).id } : { x: 5, y: 5 } },
        () => ({ type: 'addToken', kind: pick(['die', 'counter', 'token']), count: 1 + Math.floor(rnd() * 4), x: 3, y: 3 }),
        () => tokens.length && { type: 'roll', id: pick(tokens).id, seed: 3 },
        () => tokens.length && { type: 'setToken', id: pick(tokens).id, count: 1 + Math.floor(rnd() * 5), color: '#336699' },
        () => tokens.length && { type: 'removeToken', id: pick(tokens).id },
        () => ({ type: 'turn', seat: Math.floor(rnd() * 5) - 1 }),
        () => ({ type: 'nextTurn' }),
        () => ({ type: 'nameHand', seat: Math.floor(rnd() * s.seats), name: pick(['', 'Ann', 'Bob']) }),
        () => (rnd() < 0.15 ? { type: 'seats', count: 2 + Math.floor(rnd() * 5) } : { type: 'nextTurn' }),
        () => ({ type: 'rejoin' }),
        () => piles.length && { type: 'collect', into: pick(piles).id },
        () => ({ type: 'undo' }), () => ({ type: 'redo' }), () => ({ type: 'bogus' })
      ]
      const action = pick(choices)()
      if (!action) continue
      steps++
      const before = net.host.rev
      const from = net.log.length
      if (action.type === 'rejoin') {                          // a guest goes and comes back, and takes the seat there is
        if (peer === 'host') continue
        net.leave(peer); net.join(peer)
      } else if (peer === 'host') {
        if (action.type === 'undo') net.hostUndo(); else if (action.type === 'redo') net.hostRedo(); else net.hostAct(action)
      } else if (action.type === 'undo' || action.type === 'redo') net.send(peer, net.people.get(peer)[action.type]())
      else net.guestAct(peer, action)
      applied += net.host.rev - before
      if (action.type === 'rejoin') continue

      // the invariants, after every step
      expect(allCardIds(net.host.state).length).toBe(cardCount)
      for (const [name, g] of net.people) {
        const expectView = viewFor(net.host.state, g.you.seat)
        if (canon(g.view) !== canon(expectView)) throw new Error(`step ${n} (${peer}: ${JSON.stringify(action)}): the view of ${name} is not what the host would show`)
        expect(g.rev).toBe(net.host.rev)
        const secret = hiddenNow(name)
        const sent = JSON.stringify(net.downTo(name, from))
        for (const id of secret) {
          const card = net.host.state.cards[id]
          if (sent.includes(card.name)) throw new Error(`step ${n}: ${name} was sent the name of a card they must not see (${card.name}) by ${JSON.stringify(action)}`)
        }
        // the view itself never holds a hidden name
        const text = JSON.stringify(g.view)
        for (const id of secret) if (text.includes(net.host.state.cards[id].name)) throw new Error(`step ${n}: the view of ${name} holds ${net.host.state.cards[id].name}`)
      }
    }
    expect(steps).toBeGreaterThan(1000)
    expect(applied).toBeGreaterThan(300)                                   // the game really went on
    expect({}.x).toBeUndefined()
  })
})

describe('coming back, and the choice of seat (step 5)', () => {
  const ticket = 'ticket-ann-0001'

  it('the seat of a guest whose connection broke is kept: another guest does not get it, and the one who comes back has it, with their hand', () => {
    const net = makeNetwork(table({ seats: 3, deal: 2 }), { guests: [] })
    net.join('ann1', { name: 'Ann', ticket })
    expect(net.people.get('ann1').you.seat).toBe(1)
    const held = handOf(net.host.state, 1)
    net.leave('ann1')                                                       // the connection broke: no goodbye
    expect(net.host.players().find(p => p.away)).toEqual({ peer: null, name: 'Ann', seat: 1, away: true })
    expect(net.host.freeSeats()).toEqual([2])
    const bob = net.join('bob')
    expect(bob.you.seat).toBe(2)                                           // not Ann's
    net.join('ann2', { ticket })                                           // a new connection, the same ticket
    const ann = net.people.get('ann2')
    expect(ann.you).toMatchObject({ seat: 1, name: 'Ann' })
    expect(ann.view.hands[1].cards).toEqual(held)
    expect(net.host.players().some(p => p.away)).toBe(false)
    expect(bob.players.some(p => p.away)).toBe(false)
    mirror(net)
  })

  it('a table that is full lets nobody take a seat that is kept; the host can let it go', () => {
    const net = makeNetwork(table({ seats: 2, deal: 1 }))
    net.join('ann1', { ticket })
    net.leave('ann1')
    const eve = net.join('eve')                                            // the table grows a hand instead of taking Ann's
    expect(eve.you.seat).toBe(2)
    net.send('eve', eve.takeSeat(1))
    expect(eve.takeEvents().at(-1).reason).toBe('seatTaken')
    net.host.release(1).forEach(() => {})
    expect(net.host.players().some(p => p.away)).toBe(false)
    net.send('eve', eve.takeSeat(1))
    expect(eve.you.seat).toBe(1)
    expect(net.people.get('eve').view.viewer).toBe(1)
  })

  it('goodbye gives the seat up at once; a ticket that is not a ticket keeps nothing', () => {
    const net = makeNetwork(table({ seats: 3 }))
    net.join('ann1', { ticket })
    net.send('ann1', { type: 'bye' })
    expect(net.host.players().some(p => p.away)).toBe(false)
    net.join('bob', { ticket: 'short' })
    net.leave('bob')
    expect(net.host.players().some(p => p.away)).toBe(false)
    net.join('cy', { ticket: '../../etc/passwd' })
    net.leave('cy')
    expect(net.host.players().some(p => p.away)).toBe(false)
  })

  it('a guest who comes again while the old connection is still there replaces it', () => {
    const net = makeNetwork(table({ seats: 3 }))
    net.join('ann1', { ticket })
    net.join('ann2', { ticket })
    expect(net.host.players().filter(p => p.name === 'Guest').map(p => p.peer)).toEqual(['ann2'])
    expect(net.people.get('ann2').you.seat).toBe(1)
  })

  it('a guest can move to a free seat, or go to watch, and the others are told; a seat that is not there is refused', () => {
    const net = makeNetwork(table({ seats: 4, deal: 2 }), { guests: ['ann', 'bob'] })
    const ann = net.people.get('ann')
    net.send('ann', ann.takeSeat(3))
    expect(ann.you.seat).toBe(3)
    expect(ann.view.hands[3].cards).toEqual(handOf(net.host.state, 3))
    expect(net.people.get('bob').players.find(p => p.name === 'Guest' && p.seat === 3)).toBeTruthy()
    net.send('ann', ann.takeSeat(2))                                       // Bob's
    expect(ann.takeEvents().at(-1).reason).toBe('seatTaken')
    net.send('ann', ann.takeSeat(9))
    expect(ann.takeEvents().at(-1).reason).toBe('malformed')
    net.send('ann', ann.takeSeat(null))
    expect(ann.you.seat).toBe(null)
    expect(ann.view.hands.every(h => h.hidden)).toBe(true)
    expect(net.host.freeSeats()).toEqual([1, 3])
    mirror(net)
  })

  it('fewer hands let go of the seats that are kept beyond them', () => {
    const net = makeNetwork(table({ seats: 4 }), { guests: [] })
    net.join('ann1', { ticket }); net.join('bob'); net.join('cy')
    net.leave('cy')
    net.send('ann1', { type: 'bye' })
    net.join('dee', { ticket: 'ticket-dee-0001' }); net.leave('dee')
    expect(net.host.players().filter(p => p.away).length).toBeGreaterThan(0)
    net.hostAct({ type: 'seats', count: 2 })
    expect(net.host.players().filter(p => p.away).every(p => p.seat < 2)).toBe(true)
  })
})

describe('fewer hands', () => {
  it('a player whose hand goes watches from then on, is told so, and the cards they held are in the first hand', () => {
    const net = makeNetwork(table({ seats: 4, deal: 2 }), { guests: ['ann', 'bob', 'cy'] })
    const held = handOf(net.host.state, 3)
    net.hostAct({ type: 'seats', count: 2 })
    expect(net.people.get('cy').you.seat).toBe(null)
    expect(net.people.get('cy').view.viewer).toBe(null)
    expect(net.people.get('ann').players.find(p => p.peer === 'cy').seat).toBe(null)
    for (const id of held) expect(handOf(net.host.state, 0)).toContain(id)
    net.guestAct('cy', { type: 'nextTurn' })                           // a watcher can still pass the turn: it restricts nothing
    mirror(net)
  })
})

describe('the host without a seat', () => {
  it('can run a table for others without playing: no hand of their own, every hand hidden from them', () => {
    const host = createHost({ state: table({ seats: 2, deal: 2 }), hostSeat: null })
    const view = host.hostView()
    expect(view.hands.every(h => h.hidden)).toBe(true)
    const out = host.join('ann')
    expect(out[0].msg.you.seat).toBe(0)
    expect(host.players().map(p => p.peer)).toEqual(['ann'])
  })
})
