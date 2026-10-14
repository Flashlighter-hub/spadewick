/**
 * The virtual table after the playtest round (UPDATES U2 to U7): groups of dice, colours, round picture tokens, the optional turn
 * order, and what the table does when the project says a card changed.
 */
import { describe, it, expect } from 'vitest'
import {
  prng, createTable, reduce, createSession, dispatch, dispatchAll, undo, readTable, refreshCards, refreshSession,
  diceTotal, droppedDie, inkFor, tokenColors, cleanColor, MAX_DICE, TOKEN_SIZES
} from '../../src/shared/table.js'
import { middlePan } from '../../src/renderer/src/lib/middlePan.js'

const table = (extra = {}) => createTable({
  decks: [{ id: 'A', name: 'A', size: { mmW: 63.5, mmH: 88.9 }, cards: [{ id: 'A-1', name: 'One', code: 'A-1', quantity: 1, backKey: 'b' }, { id: 'A-2', name: 'Two', code: 'A-2', quantity: 1, backKey: 'b' }] }],
  seats: 3, shuffle: false, ...extra
})
const withToken = (s, a) => { const next = reduce(s, { type: 'addToken', x: 0, y: 0, ...a }); return [next, Object.values(next.tokens).at(-1)] }

describe('groups of dice (U2)', () => {
  it('a die token has a number of dice, one value for each, and the total', () => {
    const [s, die] = withToken(table(), { kind: 'die', sides: 6, count: 3 })
    expect(die).toMatchObject({ kind: 'die', sides: 6, count: 3, values: [1, 1, 1], drop: 'none', value: 3 })
    expect(withToken(table(), { kind: 'die' })[1]).toMatchObject({ count: 1, values: [1] })
    expect(withToken(table(), { kind: 'die', count: 99 })[1].count).toBe(MAX_DICE)
    expect(withToken(table(), { kind: 'die', count: 0 })[1].count).toBe(1)
    expect(s.tokens[die.id]).toBe(die)
  })

  it('one roll rolls every die from the one seed, and the same seed gives the same dice', () => {
    const [s, die] = withToken(table(), { kind: 'die', sides: 6, count: 3 })
    const a = reduce(s, { type: 'roll', id: die.id, seed: 11 }).tokens[die.id]
    const b = reduce(s, { type: 'roll', id: die.id, seed: 11 }).tokens[die.id]
    expect(a.values).toEqual(b.values)
    const next = prng(11)
    expect(a.values).toEqual([0, 1, 2].map(() => 1 + Math.floor(next() * 6)))
    expect(a.value).toBe(a.values.reduce((x, y) => x + y, 0))
    for (let seed = 1; seed < 100; seed++) for (const v of reduce(s, { type: 'roll', id: die.id, seed }).tokens[die.id].values) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6) }
  })

  it('a single die rolls exactly as it did before dice came in groups', () => {
    const [s, die] = withToken(table(), { kind: 'die', sides: 20 })
    for (let seed = 1; seed < 50; seed++) expect(reduce(s, { type: 'roll', id: die.id, seed }).tokens[die.id].value).toBe(1 + Math.floor(prng(seed)() * 20))
  })

  it('the number of dice and the sides can be changed; the dice that stay keep their values', () => {
    let [s, die] = withToken(table(), { kind: 'die', sides: 6, count: 2 })
    s = reduce(s, { type: 'roll', id: die.id, seed: 5 })
    const [first] = s.tokens[die.id].values
    s = reduce(s, { type: 'setToken', id: die.id, count: 4 })
    expect(s.tokens[die.id].values).toHaveLength(4)
    expect(s.tokens[die.id].values[0]).toBe(first)
    expect(s.tokens[die.id].values[3]).toBe(1)
    s = reduce(s, { type: 'setToken', id: die.id, sides: 2 })
    expect(Math.max(...s.tokens[die.id].values)).toBeLessThanOrEqual(2)
    s = reduce(s, { type: 'setToken', id: die.id, count: 1, value: 2 })
    expect(s.tokens[die.id]).toMatchObject({ count: 1, values: [2], value: 2 })
  })

  it('the lowest or the highest die can be dropped from the total, and shown as dropped', () => {
    expect(diceTotal([3, 6, 2, 5], 'none')).toBe(16)
    expect(diceTotal([3, 6, 2, 5], 'low')).toBe(14)
    expect(diceTotal([3, 6, 2, 5], 'high')).toBe(10)
    expect(diceTotal([4], 'low')).toBe(4)                 // a single die is never dropped
    expect(droppedDie([3, 6, 2, 5], 'low')).toBe(2)
    expect(droppedDie([2, 6, 2], 'low')).toBe(0)          // the first of equal dice
    expect(droppedDie([3, 6], 'none')).toBe(-1)
    let [s, die] = withToken(table(), { kind: 'die', sides: 6, count: 4 })
    s = reduce(s, { type: 'roll', id: die.id, seed: 9 })
    const all = s.tokens[die.id].value
    s = reduce(s, { type: 'setToken', id: die.id, drop: 'low' })
    expect(s.tokens[die.id].value).toBe(all - Math.min(...s.tokens[die.id].values))
    expect(reduce(s, { type: 'setToken', id: die.id, drop: 'nonsense' }).tokens[die.id].drop).toBe('low')
  })

  it('several dice roll together as one step of undo', () => {
    let s = createSession(table())
    s = dispatch(s, { type: 'addToken', kind: 'die', sides: 6, count: 2, x: 0, y: 0 })
    s = dispatch(s, { type: 'addToken', kind: 'die', sides: 20, x: 0, y: 0 })
    const ids = Object.keys(s.state.tokens)
    const before = s.state
    s = dispatchAll(s, ids.map((id, i) => ({ type: 'roll', id, seed: 20 + i })))
    expect(s.log.at(-1)).toHaveLength(2)
    expect(s.state).not.toBe(before)
    s = undo(s)
    expect(s.state).toBe(before)
  })

  it('a table saved when a die had one value still reads, as a group of one', () => {
    const [s] = withToken(table(), { kind: 'die', sides: 6 })
    const old = JSON.parse(JSON.stringify(s))
    const id = Object.keys(old.tokens)[0]
    old.tokens[id] = { id, kind: 'die', x: 1, y: 2, sides: 8, value: 5, label: '' }
    const out = readTable(old)
    expect(out.tokens[id]).toMatchObject({ count: 1, values: [5], value: 5, sides: 8, drop: 'none', color: '', ink: '' })
    delete old.turn; delete old.turnDir; old.hands.forEach(h => delete h.name)
    expect(readTable(old)).toMatchObject({ turn: null, turnDir: 1 })
  })

  it('a group that is saved and read again is the same', () => {
    let [s, die] = withToken(table(), { kind: 'die', sides: 10, count: 3, color: '#ff0000' })
    s = reduce(s, { type: 'roll', id: die.id, seed: 3 })
    s = reduce(s, { type: 'setToken', id: die.id, drop: 'high' })
    expect(readTable(JSON.parse(JSON.stringify(s))).tokens[die.id]).toEqual(s.tokens[die.id])
  })
})

describe('colours of tokens (U3)', () => {
  it('a colour is #rrggbb in lower case, or empty for the usual one; anything else is refused', () => {
    expect(cleanColor('#FFAA00')).toBe('#ffaa00')
    expect(cleanColor('')).toBe('')
    expect(cleanColor('red')).toBe(null)
    expect(cleanColor('#fff')).toBe(null)
    expect(cleanColor(12)).toBe(null)
  })

  it('the number is dark on a light body and light on a dark one, unless a colour is chosen for it', () => {
    expect(inkFor('#ffffff')).toBe('#212529')
    expect(inkFor('#ffd43b')).toBe('#212529')
    expect(inkFor('#000000')).toBe('#ffffff')
    expect(inkFor('#1b2a6b')).toBe('#ffffff')
    expect(tokenColors({ kind: 'die', color: '', ink: '' })).toEqual({ body: '#ffffff', ink: '#212529' })
    expect(tokenColors({ kind: 'counter', color: '', ink: '' })).toEqual({ body: '#212529', ink: '#ffffff' })
    expect(tokenColors({ kind: 'die', color: '#102030', ink: '' }).ink).toBe('#ffffff')
    expect(tokenColors({ kind: 'die', color: '#102030', ink: '#ff0000' }).ink).toBe('#ff0000')
  })

  it('dice, counters and tokens can be recoloured and reset; a bad colour changes nothing', () => {
    for (const kind of ['die', 'counter', 'token']) {
      let [s, t] = withToken(table(), { kind })
      s = reduce(s, { type: 'setToken', id: t.id, color: '#336699', ink: '#ffeeaa' })
      expect(s.tokens[t.id]).toMatchObject({ color: '#336699', ink: '#ffeeaa' })
      const same = reduce(s, { type: 'setToken', id: t.id, color: 'blue' })
      expect(same.tokens[t.id].color).toBe('#336699')
      s = reduce(s, { type: 'setToken', id: t.id, color: '', ink: '' })
      expect(s.tokens[t.id]).toMatchObject({ color: '', ink: '' })
    }
  })

  it('the colours are kept with the saved table, and a damaged colour is dropped', () => {
    let [s, t] = withToken(table(), { kind: 'counter', color: '#aa0000' })
    s = reduce(s, { type: 'setToken', id: t.id, ink: '#00ff00' })
    expect(readTable(JSON.parse(JSON.stringify(s))).tokens[t.id]).toMatchObject({ color: '#aa0000', ink: '#00ff00' })
    const bad = JSON.parse(JSON.stringify(s)); bad.tokens[t.id].color = 'javascript:alert(1)'
    expect(readTable(bad).tokens[t.id].color).toBe('')
  })
})

describe('round tokens with a picture (U4)', () => {
  it('a token has a picture of the library, a size, a label and, if wanted, a number', () => {
    let [s, t] = withToken(table(), { kind: 'token', asset: 'img1', size: 'large', label: 'Goblin' })
    expect(t).toMatchObject({ kind: 'token', asset: 'img1', asset2: null, side: 0, size: 'large', label: 'Goblin', showNumber: false, value: 0 })
    expect(TOKEN_SIZES.small).toBeLessThan(TOKEN_SIZES.medium)
    expect(TOKEN_SIZES.medium).toBeLessThan(TOKEN_SIZES.large)
    expect(withToken(table(), { kind: 'token', asset: 'x', size: 'huge' })[1].size).toBe('medium')
    s = reduce(s, { type: 'setToken', id: t.id, showNumber: true, value: 4 })
    s = reduce(s, { type: 'setToken', id: t.id, size: 'small' })
    expect(s.tokens[t.id]).toMatchObject({ showNumber: true, value: 4, size: 'small' })
  })

  it('a second picture makes it two-sided; it turns over only when it has one', () => {
    let [s, t] = withToken(table(), { kind: 'token', asset: 'front' })
    expect(reduce(s, { type: 'setToken', id: t.id, side: 1 }).tokens[t.id].side).toBe(0)
    s = reduce(s, { type: 'setToken', id: t.id, asset2: 'back' })
    s = reduce(s, { type: 'setToken', id: t.id, side: 1 })
    expect(s.tokens[t.id]).toMatchObject({ asset: 'front', asset2: 'back', side: 1 })
    s = reduce(s, { type: 'setToken', id: t.id, asset2: null })
    expect(s.tokens[t.id]).toMatchObject({ asset2: null, side: 0 })
  })

  it('is saved and read again; a token with no picture is still a token (a plain disc)', () => {
    let [s, t] = withToken(table(), { kind: 'token', asset: 'img1' })
    s = reduce(s, { type: 'setToken', id: t.id, asset2: 'img2' })
    s = reduce(s, { type: 'setToken', id: t.id, side: 1 })
    expect(readTable(JSON.parse(JSON.stringify(s))).tokens[t.id]).toEqual(s.tokens[t.id])
    const [bare, b] = withToken(table(), { kind: 'token' })
    expect(readTable(JSON.parse(JSON.stringify(bare))).tokens[b.id]).toMatchObject({ kind: 'token', asset: null })
  })
})

describe('the optional turn order (U7)', () => {
  it('is off to begin with, starts at a seat, and goes round the way it is set', () => {
    let s = table()
    expect(s).toMatchObject({ turn: null, turnDir: 1 })
    expect(reduce(s, { type: 'nextTurn' })).toBe(s)                  // nothing to pass while it is off
    s = reduce(s, { type: 'turn', seat: 0 })
    expect(s.turn).toBe(0)
    s = reduce(s, { type: 'nextTurn' }); s = reduce(s, { type: 'nextTurn' })
    expect(s.turn).toBe(2)
    s = reduce(s, { type: 'nextTurn' })
    expect(s.turn).toBe(0)                                           // round to the first again
    s = reduce(s, { type: 'turnDirection' })
    expect(s.turnDir).toBe(-1)
    s = reduce(s, { type: 'nextTurn' })
    expect(s.turn).toBe(2)
    expect(reduce(s, { type: 'turnDirection', dir: -1 })).toBe(s)
    s = reduce(s, { type: 'turn', seat: null })
    expect(s.turn).toBe(null)
  })

  it('restricts nothing: any hand can still be played from while it is somebody else\'s turn', () => {
    let s = table({ deal: 1 })
    s = reduce(s, { type: 'turn', seat: 1 })
    const card = s.hands[0].cards[0]
    const played = reduce(s, { type: 'transfer', from: { hand: 0 }, cards: [card], to: { x: 10, y: 10 } })
    expect(played).not.toBe(s)
    expect(played.hands[0].cards).toEqual([])
    expect(played.turn).toBe(1)
  })

  it('refuses a seat that is not there, and keeps the turn on a seat that is when the hands are fewer', () => {
    let s = reduce(table(), { type: 'turn', seat: 7 })
    expect(s.turn).toBe(null)
    s = reduce(table(), { type: 'turn', seat: 2 })
    s = reduce(s, { type: 'seats', count: 2 })
    expect(s.turn).toBe(0)
  })

  it('hands can be named; the names and the turn are saved with the table', () => {
    let s = reduce(table(), { type: 'nameHand', seat: 1, name: 'Mira' })
    expect(s.hands[1].name).toBe('Mira')
    expect(reduce(s, { type: 'nameHand', seat: 1, name: 'Mira' })).toBe(s)
    expect(reduce(s, { type: 'nameHand', seat: 9, name: 'x' })).toBe(s)
    expect(reduce(s, { type: 'nameHand', seat: 0, name: 'y'.repeat(100) }).hands[0].name).toHaveLength(30)
    s = reduce(s, { type: 'turn', seat: 1 }); s = reduce(s, { type: 'turnDirection' })
    const back = readTable(JSON.parse(JSON.stringify(s)))
    expect(back).toMatchObject({ turn: 1, turnDir: -1 })
    expect(back.hands.map(h => h.name)).toEqual(['', 'Mira', ''])
    const bad = JSON.parse(JSON.stringify(s)); bad.turn = 9
    expect(readTable(bad).turn).toBe(null)
  })

  it('every step is an undoable action made of plain data, so it can be sent to another player', () => {
    let s = createSession(table())
    s = dispatch(s, { type: 'turn', seat: 0 })
    s = dispatch(s, { type: 'nextTurn' })
    expect(s.state.turn).toBe(1)
    expect(JSON.parse(JSON.stringify(s.log))).toEqual(s.log)
    s = undo(s)
    expect(s.state.turn).toBe(0)
  })
})

describe('what the project says about the cards (U6)', () => {
  const info = { 'A-1': { name: 'Uno', code: 'A-1', backKey: 'other', missing: false }, 'A-2': { name: '', code: '', backKey: null, missing: true } }

  it('a card of the table takes the new name and back, and is marked when the project no longer has it', () => {
    const s = table()
    const next = refreshCards(s, info)
    const one = Object.values(next.cards).find(c => c.id === 'A-1'), two = Object.values(next.cards).find(c => c.id === 'A-2')
    expect(one).toMatchObject({ name: 'Uno', back: 'other' })
    expect(one.missing).toBeUndefined()
    expect(two).toMatchObject({ missing: true })
    expect(Object.values(s.cards).find(c => c.id === 'A-1').name).toBe('One')   // the state it was given is not changed
  })

  it('returns the very same state when nothing differs, and ignores cards that are not on the table', () => {
    const s = table()
    expect(refreshCards(s, { 'A-1': { name: 'One', code: 'A-1', backKey: 'b', missing: false } })).toBe(s)
    expect(refreshCards(s, { other: { name: 'x', code: '', backKey: null, missing: false } })).toBe(s)
  })

  it('a card that came back is no longer marked', () => {
    const gone = refreshCards(table(), info)
    const back = refreshCards(gone, { 'A-2': { name: 'Two', code: 'A-2', backKey: 'b', missing: false } })
    expect(Object.values(back.cards).find(c => c.id === 'A-2').missing).toBeUndefined()
  })

  it('the names are also kept right in what undo and redo bring back, and the log is not touched', () => {
    let s = createSession(table({ deal: 1 }))
    s = dispatch(s, { type: 'seats', count: 2 })
    const log = s.log
    s = refreshSession(s, info)
    expect(s.log).toBe(log)
    const nameIn = state => Object.values(state.cards).find(c => c.id === 'A-1').name
    expect(nameIn(s.state)).toBe('Uno')
    expect(nameIn(s.past[0])).toBe('Uno')
    s = undo(s)
    expect(nameIn(s.state)).toBe('Uno')
    expect(refreshSession(s, info)).toBe(s)
  })

  it('the mark is not saved: a table opened later is checked against the project again', () => {
    const marked = refreshCards(table(), info)
    const read = readTable(JSON.parse(JSON.stringify(marked)))
    expect(Object.values(read.cards).every(c => c.missing === undefined)).toBe(true)
  })
})

describe('panning with the middle button (U5)', () => {
  /** A stand-in for an element: it records its listeners and can be sent events. */
  function fakeNode() {
    const listeners = {}
    return {
      scrollLeft: 100, scrollTop: 200, dataset: {},
      addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn) },
      removeEventListener: (t, fn) => { listeners[t] = (listeners[t] ?? []).filter(f => f !== fn) },
      setPointerCapture() {}, releasePointerCapture() {},
      send(type, e) { const ev = { button: 0, clientX: 0, clientY: 0, pointerId: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...e }; for (const fn of listeners[type] ?? []) fn(ev); return ev },
      count: () => Object.values(listeners).flat().length
    }
  }

  it('dragging with the middle button moves the area the other way, and the press and click of that button do nothing else', () => {
    const node = fakeNode()
    middlePan(node)
    expect(node.send('mousedown', { button: 1 }).defaultPrevented).toBe(true)     // no autoscroll
    expect(node.send('auxclick', { button: 1 }).defaultPrevented).toBe(true)
    expect(node.send('mousedown', { button: 0 }).defaultPrevented).toBe(false)
    expect(node.send('pointerdown', { button: 1, clientX: 50, clientY: 60 }).defaultPrevented).toBe(true)
    expect(node.dataset.panning).toBe('true')
    node.send('pointermove', { clientX: 30, clientY: 90 })
    expect([node.scrollLeft, node.scrollTop]).toEqual([120, 170])
    node.send('pointerup', {})
    expect(node.dataset.panning).toBeUndefined()
    node.send('pointermove', { clientX: 0, clientY: 0 })
    expect([node.scrollLeft, node.scrollTop]).toEqual([120, 170])                  // after the button is let go, moving does nothing
  })

  it('the left button does not pan, and everything is taken off when the area goes', () => {
    const node = fakeNode()
    const action = middlePan(node)
    node.send('pointerdown', { button: 0, clientX: 5, clientY: 5 })
    node.send('pointermove', { clientX: 90, clientY: 90 })
    expect([node.scrollLeft, node.scrollTop]).toEqual([100, 200])
    action.destroy()
    expect(node.count()).toBe(0)
  })
})
