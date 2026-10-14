import { describe, it, expect } from 'vitest'
import {
  prng, shuffled, createTable, reduce, allCardIds, drawAction, dealActions, createSession, dispatch, dispatchAll, undo, redo, readTable,
  CARD_WIDTH, MAX_SEATS
} from '../../src/shared/table.js'

const deck = (id, n, extra = {}) => ({
  id, name: `Deck ${id}`, size: { mmW: 63.5, mmH: 88.9 },
  cards: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i + 1}`, name: `Card ${i + 1}`, code: `${id}-${i + 1}`, quantity: 1, backKey: 'b', ...extra }))
})
const topOf = (s, pileId) => s.piles[pileId].cards[s.piles[pileId].cards.length - 1]
const firstPile = s => Object.values(s.piles)[0]

describe('the seeded generator', () => {
  it('gives the same sequence for the same seed and a different one for another', () => {
    const a = prng(7), b = prng(7), c = prng(8)
    const xs = [a(), a(), a()], ys = [b(), b(), b()]
    expect(xs).toEqual(ys)
    expect([c(), c(), c()]).not.toEqual(xs)
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true)
  })

  it('shuffles the same way for the same seed, keeps every card, and does not change the list it is given', () => {
    const list = Array.from({ length: 30 }, (_, i) => i)
    const a = shuffled(list, 5), b = shuffled(list, 5)
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(list)
    expect(a).not.toEqual(list)
    expect(shuffled(list, 6)).not.toEqual(a)
    expect(list[0]).toBe(0)
  })
})

describe('a new table', () => {
  it('makes a face-down pile for each deck, a card for each copy, and a hand for each seat', () => {
    const s = createTable({ decks: [deck('A', 5), { ...deck('B', 2), cards: [{ id: 'B-1', name: 'x', quantity: 3 }, { id: 'B-2', name: 'y', quantity: 0 }] }], seats: 2, shuffle: false })
    expect(Object.keys(s.piles)).toHaveLength(2)
    const [a, b] = Object.values(s.piles)
    expect(a.cards).toHaveLength(5)
    expect(b.cards).toHaveLength(3)                                   // quantity 3 → three copies; quantity 0 → none
    expect(a.faceUp).toBe(false)
    expect(s.hands).toHaveLength(2)
    expect(s.decks[0]).toMatchObject({ w: CARD_WIDTH, h: Math.round(CARD_WIDTH * 88.9 / 63.5) })
    expect(new Set(allCardIds(s)).size).toBe(8)
    expect(s.cards[a.cards[0]]).toMatchObject({ id: 'A-1', deck: 0, back: 'b' })
  })

  it('can ignore copies, shuffle, and deal to each seat', () => {
    const d = deck('A', 20, { quantity: 4 })
    expect(allCardIds(createTable({ decks: [d], copies: false, shuffle: false }))).toHaveLength(20)
    const shuffledTable = createTable({ decks: [d], shuffle: true, seed: 3 }), again = createTable({ decks: [d], shuffle: true, seed: 3 })
    expect(shuffledTable).toEqual(again)
    expect(firstPile(shuffledTable).cards).not.toEqual(firstPile(createTable({ decks: [d], shuffle: false })).cards)
    const dealt = createTable({ decks: [deck('A', 20)], seats: 3, deal: 4, shuffle: false })
    expect(dealt.hands.map(h => h.cards.length)).toEqual([4, 4, 4])
    expect(firstPile(dealt).cards).toHaveLength(8)
    expect(dealt.hands[0].cards).toEqual(['c20', 'c17', 'c14', 'c11'].map(x => x))   // one at a time round the table, from the top
  })

  it('limits the seats and leaves out a deck with no cards', () => {
    expect(createTable({ decks: [deck('A', 1)], seats: 99 }).hands).toHaveLength(MAX_SEATS)
    expect(createTable({ decks: [deck('A', 1)], seats: 0 }).hands).toHaveLength(1)
    expect(Object.keys(createTable({ decks: [{ ...deck('A', 0) }, deck('B', 1)] }).piles)).toHaveLength(1)
  })
})

describe('the actions', () => {
  const table = () => createTable({ decks: [deck('A', 10)], seats: 2, shuffle: false })

  it('moves, rotates, labels and locks a pile; a locked pile stays where it is', () => {
    let s = table(); const id = firstPile(s).id
    s = reduce(s, { type: 'move', pile: id, x: 500, y: 300 })
    expect(s.piles[id]).toMatchObject({ x: 500, y: 300 })
    s = reduce(s, { type: 'rotate', pile: id, rot: 450 })
    expect(s.piles[id].rot).toBe(90)
    s = reduce(s, { type: 'rotate', pile: id, rot: -90 })
    expect(s.piles[id].rot).toBe(270)
    s = reduce(s, { type: 'label', pile: id, name: 'Draw' })
    expect(s.piles[id].name).toBe('Draw')
    s = reduce(s, { type: 'lock', pile: id, locked: true })
    expect(reduce(s, { type: 'move', pile: id, x: 1, y: 1 })).toBe(s)
    expect(reduce(s, { type: 'flip', pile: id })).toBe(s)
  })

  it('does nothing, and returns the very same state, for an action that makes no sense', () => {
    const s = table()
    expect(reduce(s, { type: 'move', pile: 'nope', x: 1, y: 1 })).toBe(s)
    expect(reduce(s, { type: 'frobnicate' })).toBe(s)
    expect(reduce(s, null)).toBe(s)
    expect(reduce(s, { type: 'transfer', from: { pile: firstPile(s).id }, cards: ['zzz'], to: { hand: 0 } })).toBe(s)
    expect(reduce(s, { type: 'transfer', from: { pile: firstPile(s).id }, cards: [], to: { hand: 0 } })).toBe(s)
  })

  it('never changes the state it was given', () => {
    const s = table(); const before = JSON.stringify(s)
    reduce(s, { type: 'flip', pile: firstPile(s).id })
    reduce(s, { type: 'shuffle', pile: firstPile(s).id, seed: 4 })
    expect(JSON.stringify(s)).toBe(before)
  })

  it('turning a pile over reverses its order and its face', () => {
    let s = table(); const id = firstPile(s).id
    const order = [...s.piles[id].cards]
    s = reduce(s, { type: 'flip', pile: id })
    expect(s.piles[id].faceUp).toBe(true)
    expect(s.piles[id].cards).toEqual([...order].reverse())
    s = reduce(s, { type: 'flip', pile: id })
    expect(s.piles[id]).toMatchObject({ faceUp: false, cards: order })
  })

  it('shuffles with the seed it carries, so a replay gives the same pile', () => {
    const s = table(); const id = firstPile(s).id
    const a = reduce(s, { type: 'shuffle', pile: id, seed: 11 }), b = reduce(s, { type: 'shuffle', pile: id, seed: 11 })
    expect(a.piles[id].cards).toEqual(b.piles[id].cards)
    expect(a.piles[id].cards).not.toEqual(s.piles[id].cards)
    expect([...a.piles[id].cards].sort()).toEqual([...s.piles[id].cards].sort())
  })

  it('draws from the top into a hand, and a hand card goes back on the table face up', () => {
    let s = table(); const id = firstPile(s).id
    const top = topOf(s, id)
    s = reduce(s, drawAction(s, id, 1, 1))
    expect(s.hands[1].cards).toEqual([top])
    expect(s.piles[id].cards).toHaveLength(9)
    s = reduce(s, { type: 'transfer', from: { hand: 1 }, cards: [top], to: { x: 400, y: 400 } })
    const played = Object.values(s.piles).find(p => p.cards.includes(top))
    expect(played).toMatchObject({ x: 400, y: 400, faceUp: true, cards: [top] })
    expect(s.hands[1].cards).toEqual([])
  })

  it('draws several at once as if one by one: the top card is the first in the hand', () => {
    let s = table(); const id = firstPile(s).id
    const top3 = s.piles[id].cards.slice(-3)
    s = reduce(s, drawAction(s, id, 0, 3))
    expect(s.hands[0].cards).toEqual([...top3].reverse())
    expect(drawAction(reduce(s, { type: 'transfer', from: { pile: id }, cards: s.piles[id].cards, to: { hand: 0 } }), id, 0, 1)).toBeNull()   // the pile is gone
  })

  it('a pile with no cards left is gone', () => {
    let s = createTable({ decks: [deck('A', 2)], shuffle: false }); const id = firstPile(s).id
    s = reduce(s, { type: 'transfer', from: { pile: id }, cards: [...s.piles[id].cards], to: { hand: 0 } })
    expect(s.piles[id]).toBeUndefined()
    expect(s.hands[0].cards).toHaveLength(2)
  })

  it('deals one at a time round the table', () => {
    let s = createTable({ decks: [deck('A', 10)], seats: 3, shuffle: false }); const id = firstPile(s).id
    const acts = dealActions(s, id, 2)
    expect(acts).toHaveLength(6)
    for (const a of acts) s = reduce(s, a)
    expect(s.hands.map(h => h.cards.length)).toEqual([2, 2, 2])
    expect(s.hands[0].cards).toEqual(['c10', 'c7']); expect(s.hands[1].cards).toEqual(['c9', 'c6'])
    expect(dealActions(createTable({ decks: [deck('A', 2)], seats: 3, shuffle: false }), 'p3', 1)).toHaveLength(2)    // stops when the pile runs out
  })

  it('puts cards on another pile, on the top or the bottom, turning the stack over when the faces differ', () => {
    let s = createTable({ decks: [deck('A', 4), deck('B', 4)], shuffle: false })
    const [a, b] = Object.values(s.piles)
    const moved = a.cards.slice(-2)                                        // c3 c4, face down
    s = reduce(s, { type: 'transfer', from: { pile: a.id }, cards: moved, to: { pile: b.id } })
    expect(s.piles[b.id].cards).toEqual([...b.cards, ...moved])
    expect(s.piles[a.id].cards).toHaveLength(2)
    // onto the bottom
    s = reduce(s, { type: 'transfer', from: { pile: a.id }, cards: [a.cards[0]], to: { pile: b.id, where: 'bottom' } })
    expect(s.piles[b.id].cards[0]).toBe(a.cards[0])
    // a face-up pile onto a face-down one: the stack is turned over
    s = reduce(s, { type: 'transfer', from: { pile: b.id }, cards: [topOf(s, b.id)], to: { x: 900, y: 900, faceUp: true } })
    const up = Object.values(s.piles).find(p => p.faceUp)
    expect(up.cards).toHaveLength(1)
    const upTop = up.cards[0]
    s = reduce(s, { type: 'transfer', from: { pile: up.id }, cards: [upTop], to: { pile: b.id } })
    expect(topOf(s, b.id)).toBe(upTop)
    // a pile cannot be put on itself
    const same = reduce(s, { type: 'transfer', from: { pile: b.id }, cards: [topOf(s, b.id)], to: { pile: b.id } })
    expect(same).toBe(s)
  })

  it('puts a card in a hand at a place, and moves it within the hand', () => {
    let s = table(); const id = firstPile(s).id
    s = reduce(s, drawAction(s, id, 0, 3))                                 // c10 c9 c8 → [c8 c9 c10] in order they lay
    const [x, y, z] = s.hands[0].cards
    s = reduce(s, { type: 'transfer', from: { hand: 0 }, cards: [z], to: { hand: 0, index: 0 } })
    expect(s.hands[0].cards).toEqual([z, x, y])
    s = reduce(s, { type: 'transfer', from: { hand: 0 }, cards: [z], to: { hand: 1 } })
    expect(s.hands[1].cards).toEqual([z])
    expect(s.hands[0].cards).toEqual([x, y])
  })

  it('collects every card back onto one pile, face down', () => {
    let s = createTable({ decks: [deck('A', 6)], seats: 2, shuffle: false, deal: 1 }); const id = firstPile(s).id
    s = reduce(s, { type: 'transfer', from: { pile: id }, cards: [topOf(s, id)], to: { x: 300, y: 300, faceUp: true } })
    s = reduce(s, { type: 'collect', into: id })
    expect(Object.keys(s.piles)).toEqual([id])
    expect(s.piles[id].cards).toHaveLength(6)
    expect(s.piles[id].faceUp).toBe(false)
    expect(s.hands.every(h => h.cards.length === 0)).toBe(true)
    expect(new Set(s.piles[id].cards).size).toBe(6)
  })

  it('changes the number of seats; a seat that goes hands its cards to the first', () => {
    let s = createTable({ decks: [deck('A', 6)], seats: 3, shuffle: false, deal: 1 })
    s = reduce(s, { type: 'seats', count: 1 })
    expect(s.hands).toHaveLength(1)
    expect(s.hands[0].cards).toHaveLength(3)
    s = reduce(s, { type: 'seats', count: 4 })
    expect(s.hands).toHaveLength(4)
    expect(reduce(s, { type: 'seats', count: 4 })).toBe(s)
  })

  it('has dice and counters: they move, roll with their seed, and can be removed', () => {
    let s = table()
    s = reduce(s, { type: 'addToken', kind: 'die', x: 50, y: 60, sides: 20 })
    s = reduce(s, { type: 'addToken', kind: 'counter', x: 10, y: 10, label: 'Life' })
    const [die, counter] = Object.values(s.tokens)
    expect(die).toMatchObject({ kind: 'die', sides: 20, value: 1 })
    expect(counter).toMatchObject({ kind: 'counter', value: 0, label: 'Life' })
    const rolled = reduce(s, { type: 'roll', id: die.id, seed: 9 }), again = reduce(s, { type: 'roll', id: die.id, seed: 9 })
    expect(rolled.tokens[die.id].value).toBe(again.tokens[die.id].value)
    for (let seed = 1; seed < 200; seed++) { const v = reduce(s, { type: 'roll', id: die.id, seed }).tokens[die.id].value; expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(20) }
    expect(reduce(s, { type: 'roll', id: counter.id, seed: 1 })).toBe(s)
    s = reduce(s, { type: 'setToken', id: counter.id, value: -3 })
    expect(s.tokens[counter.id].value).toBe(-3)
    s = reduce(s, { type: 'setToken', id: die.id, value: 99 })
    expect(s.tokens[die.id].value).toBe(20)
    s = reduce(s, { type: 'setToken', id: die.id, sides: 6 })
    expect(s.tokens[die.id]).toMatchObject({ sides: 6, value: 6 })
    s = reduce(s, { type: 'moveToken', id: die.id, x: 5, y: 6 })
    expect(s.tokens[die.id]).toMatchObject({ x: 5, y: 6 })
    s = reduce(s, { type: 'removeToken', id: die.id })
    expect(Object.keys(s.tokens)).toEqual([counter.id])
  })

  it('keeps every card exactly once through any run of actions', () => {
    let s = createTable({ decks: [deck('A', 12), deck('B', 8)], seats: 3, shuffle: true, seed: 2 })
    const next = prng(1)
    const total = allCardIds(s).length
    for (let i = 0; i < 400; i++) {
      const piles = Object.values(s.piles)
      const pick = piles[Math.floor(next() * piles.length)]
      const r = next()
      if (!pick) break
      if (r < 0.2) s = reduce(s, { type: 'flip', pile: pick.id })
      else if (r < 0.35) s = reduce(s, { type: 'shuffle', pile: pick.id, seed: i + 1 })
      else if (r < 0.55) s = reduce(s, drawAction(s, pick.id, Math.floor(next() * 3), 1 + Math.floor(next() * 2)))
      else if (r < 0.7 && piles.length > 1) { const other = piles.find(p => p.id !== pick.id); s = reduce(s, { type: 'transfer', from: { pile: pick.id }, cards: [pick.cards[0]], to: { pile: other.id, where: next() < 0.5 ? 'top' : 'bottom' } }) }
      else if (r < 0.85) s = reduce(s, { type: 'transfer', from: { pile: pick.id }, cards: [topOf(s, pick.id)], to: { x: next() * 800, y: next() * 800, faceUp: next() < 0.5 } })
      else { const h = Math.floor(next() * 3); if (s.hands[h].cards.length) s = reduce(s, { type: 'transfer', from: { hand: h }, cards: [s.hands[h].cards[0]], to: { x: next() * 800, y: next() * 800 } }) }
      expect(allCardIds(s)).toHaveLength(total)
      expect(new Set(allCardIds(s)).size).toBe(total)
    }
  })
})

describe('undo, redo and the log', () => {
  const start = () => createSession(createTable({ decks: [deck('A', 6)], seats: 1, shuffle: false }))

  it('undoes and redoes one step at a time, and a new action clears what could be redone', () => {
    let s = start(); const id = firstPile(s.state).id
    s = dispatch(s, { type: 'move', pile: id, x: 10, y: 10 })
    s = dispatch(s, { type: 'move', pile: id, x: 20, y: 20 })
    expect(s.log).toHaveLength(2)
    s = undo(s)
    expect(s.state.piles[id]).toMatchObject({ x: 10, y: 10 })
    expect(s.log).toHaveLength(1)
    s = redo(s)
    expect(s.state.piles[id]).toMatchObject({ x: 20, y: 20 })
    expect(s.log).toHaveLength(2)
    s = undo(undo(s))
    s = dispatch(s, { type: 'move', pile: id, x: 99, y: 99 })
    expect(redo(s)).toBe(s)
    expect(undo(undo(undo(s))).state.piles[id].x).toBe(160)
  })

  it('does not record an action that changed nothing', () => {
    const s = start()
    expect(dispatch(s, { type: 'move', pile: 'nope', x: 1, y: 1 })).toBe(s)
    expect(undo(s)).toBe(s)
    expect(redo(s)).toBe(s)
  })

  it('several actions are one step of undo', () => {
    let s = createSession(createTable({ decks: [deck('A', 10)], seats: 2, shuffle: false })); const id = firstPile(s.state).id
    s = dispatchAll(s, dealActions(s.state, id, 2))
    expect(s.state.hands.map(h => h.cards.length)).toEqual([2, 2])
    expect(s.log).toHaveLength(1)
    s = undo(s)
    expect(s.state.hands.map(h => h.cards.length)).toEqual([0, 0])
    s = redo(s)
    expect(s.state.hands.map(h => h.cards.length)).toEqual([2, 2])
    expect(dispatchAll(s, [])).toBe(s)
  })

  it('replaying the log from the first state gives the last one', () => {
    let s = createSession(createTable({ decks: [deck('A', 12)], seats: 2, shuffle: false })); const id = firstPile(s.state).id
    s = dispatch(s, { type: 'shuffle', pile: id, seed: 5 })
    s = dispatchAll(s, dealActions(s.state, id, 2))
    s = dispatch(s, { type: 'flip', pile: id })
    s = dispatch(s, { type: 'addToken', kind: 'die', x: 1, y: 1, sides: 6 })
    s = dispatch(s, { type: 'roll', id: Object.keys(s.state.tokens)[0], seed: 3 })
    let replay = s.initial
    for (const step of s.log) for (const a of step) replay = reduce(replay, a)
    expect(replay).toEqual(s.state)
  })
})

describe('reading a saved table', () => {
  const sample = () => createTable({ decks: [deck('A', 6)], seats: 2, shuffle: true, seed: 4, deal: 1 })

  it('accepts a table as it was saved, and a copy that went through JSON', () => {
    const s = sample()
    expect(readTable(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('refuses what is not a table, or loses or doubles a card', () => {
    const s = JSON.parse(JSON.stringify(sample()))
    expect(readTable(null).error).toBeTruthy()
    expect(readTable([]).error).toBeTruthy()
    expect(readTable({ ...s, version: 99 }).error).toBe('version')
    const lost = JSON.parse(JSON.stringify(s)); lost.hands[0].cards = []
    expect(readTable(lost).error).toBe('lost cards')
    const doubled = JSON.parse(JSON.stringify(s)); doubled.hands[0].cards.push(Object.values(doubled.piles)[0].cards[0])
    expect(readTable(doubled).error).toBe('hand')
    const unknown = JSON.parse(JSON.stringify(s)); Object.values(unknown.piles)[0].cards.push('zzz')
    expect(readTable(unknown).error).toBe('pile')
    const emptyPile = JSON.parse(JSON.stringify(s)); emptyPile.piles.px = { id: 'px', cards: [] }
    expect(readTable(emptyPile).error).toBe('pile')
  })

  it('makes the numbers and the text safe', () => {
    const s = JSON.parse(JSON.stringify(sample()))
    const pile = Object.values(s.piles)[0]
    pile.x = 'wide'; pile.rot = 725; pile.name = 'x'.repeat(500)
    s.tokens = { t1: { kind: 'die', x: 1, y: 1, sides: 6, value: 99, label: 'y'.repeat(100) } }
    const out = readTable(s)
    expect(out.piles[pile.id]).toMatchObject({ x: 0, rot: 5 })
    expect(out.piles[pile.id].name).toHaveLength(60)
    expect(out.tokens.t1).toMatchObject({ value: 6 })
    expect(out.tokens.t1.label).toHaveLength(30)
  })
})
