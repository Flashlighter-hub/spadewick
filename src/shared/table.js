/**
 * The virtual table (PRD §7.9): the state of a game laid out for playtesting, and the few actions that change it.
 *
 * Everything here is plain data and pure functions, so the table can be saved as a file, undone and redone, replayed from its log,
 * and (later) shared between machines by sending the actions: `reduce(state, action)` returns the next state and never reads a clock or
 * a random number. Anything random (a shuffle, a roll) carries its own `seed`, made by whoever issues the action.
 *
 * The state:
 *   cards   instance id -> { id, name, code, deck, w, h, back }   what each physical card is (never changes once the table is made)
 *   piles   pile id -> { id, x, y, rot, faceUp, name, locked, cards: [instance ids, bottom to top] }
 *           a card on its own is a pile of one; a deck is a pile of many
 *   hands   [ { cards: [instance ids], name } ]                     one per seat; a hand is seen face up
 *   tokens  token id -> { id, kind: 'die' | 'counter' | 'token', x, y, label, color, ink, ... }
 *             die      { sides, count, values: [one per die], drop: 'none' | 'low' | 'high', value: the total }   (UPDATES U2)
 *             counter  { value }
 *             token    { asset, asset2, side: 0 | 1, size: 'small' | 'medium' | 'large', showNumber, value }     a round picture (UPDATES U4)
 *             color and ink are the colour of the body and of the number or pips, or '' for the usual ones     (UPDATES U3)
 *   turn    null, or the seat whose turn it is; turnDir 1 or -1, the way it goes round     (UPDATES U7: it restricts nothing)
 *   decks   [ { id, name, w, h } ]
 *
 * A card instance also has `missing` while the project no longer has the card it was made from (UPDATES U6); that is not saved.
 */

export const TABLE_VERSION = 1
export const CARD_WIDTH = 140            // table units (pixels at 100%) a card is wide
export const MAX_SEATS = 6
export const MAX_UNDO = 500
export const DIE_SIDES = [4, 6, 8, 10, 12, 20]
export const MAX_DICE = 10               // dice in one group, rolled together (3d6)
export const TOKEN_SIZES = { small: 56, medium: 84, large: 124 }   // table units a round token is wide
export const HAND_NAME_MAX = 30

const HEX = /^#[0-9a-f]{6}$/i
/** A colour as the table keeps it: '#rrggbb' in lower case, '' for "the usual one", or null when it is not a colour. */
export function cleanColor(v) {
  if (v === '' || v === null) return ''
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null
}

/** A readable colour for the number on a body of this colour: dark on a light body, light on a dark one. */
export function inkFor(color) {
  const c = cleanColor(color)
  if (!c) return '#212529'
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#212529' : '#ffffff'
}

/** The colours a token is drawn in: the chosen ones, else the usual for its kind; the ink is chosen to read on the body unless it was set. */
export function tokenColors(t) {
  const usual = t.kind === 'die' ? '#ffffff' : t.kind === 'counter' ? '#212529' : '#f1f3f5'
  const body = cleanColor(t.color) || usual
  return { body, ink: cleanColor(t.ink) || inkFor(body) }
}

/** What a group of dice adds up to (the die that is dropped does not count). */
export function diceTotal(values, drop = 'none') {
  if (!values.length) return 0
  const sum = values.reduce((a, b) => a + b, 0)
  if (drop === 'low' && values.length > 1) return sum - Math.min(...values)
  if (drop === 'high' && values.length > 1) return sum - Math.max(...values)
  return sum
}

/** The index of the die that is dropped from the total, or -1 (the first one when several share the value). */
export function droppedDie(values, drop = 'none') {
  if (values.length < 2 || (drop !== 'low' && drop !== 'high')) return -1
  const target = drop === 'low' ? Math.min(...values) : Math.max(...values)
  return values.indexOf(target)
}

/** A small, fast, seedable generator: the same seed always gives the same sequence (mulberry32). */
export function prng(seed) {
  let a = (Number(seed) >>> 0) || 1
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The list in a random order (Fisher-Yates), the same for the same seed. */
export function shuffled(list, seed) {
  const out = [...list]
  const next = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A seed for an action, made where the action is issued. */
export const newSeed = () => (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0) || 1

const clone = v => structuredClone(v)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/**
 * A new table.
 * @param {object} opts
 * @param {{ id: string, name: string, size: { mmW: number, mmH: number }, cards: { id: string, name: string, code?: string, quantity?: number, backKey?: string|null }[] }[]} opts.decks one per set
 * @param {number} [opts.seats] hands, 1 to 6
 * @param {boolean} [opts.shuffle] shuffle each deck
 * @param {boolean} [opts.copies] a card appears as many times as its quantity (else once)
 * @param {number} [opts.deal] cards dealt from the first deck to every seat
 * @param {number} [opts.seed]
 */
export function createTable({ decks, seats = 1, shuffle = true, copies = true, deal = 0, seed = 1 }) {
  const state = { version: TABLE_VERSION, seq: 0, seats: clamp(Math.round(num(seats, 1)), 1, MAX_SEATS), cards: {}, piles: {}, hands: [], tokens: {}, turn: null, turnDir: 1, decks: [] }
  for (let i = 0; i < state.seats; i++) state.hands.push({ cards: [], name: '' })
  decks.forEach((deck, di) => {
    const w = CARD_WIDTH, h = Math.round(CARD_WIDTH * (deck.size?.mmH ?? 88.9) / (deck.size?.mmW ?? 63.5))
    state.decks.push({ id: deck.id, name: deck.name, w, h })
    const ids = []
    for (const card of deck.cards) {
      const n = copies ? Math.max(0, Math.round(num(card.quantity, 1))) : Math.min(1, Math.max(0, Math.round(num(card.quantity, 1))))
      for (let c = 0; c < n; c++) {
        const id = `c${++state.seq}`
        state.cards[id] = { id: card.id, name: card.name ?? '', code: card.code ?? '', deck: di, w, h, back: card.backKey ?? null }
        ids.push(id)
      }
    }
    if (!ids.length) return
    const pid = `p${++state.seq}`
    state.piles[pid] = { id: pid, x: 160 + di * (w + 90), y: 160, rot: 0, faceUp: false, name: deck.name, locked: false, cards: shuffle ? shuffled(ids, num(seed, 1) + di) : ids }
  })
  const first = Object.values(state.piles)[0]
  if (first && deal > 0) {
    let next = state
    for (let round = 0; round < deal; round++) for (let seat = 0; seat < state.seats; seat++) {
      const pile = next.piles[first.id]
      if (!pile) break
      next = reduce(next, { type: 'transfer', from: { pile: first.id }, cards: [pile.cards[pile.cards.length - 1]], to: { hand: seat } })
    }
    return next
  }
  return state
}

/** Every instance id on the table, in piles and in hands. */
export function allCardIds(state) {
  return [...Object.values(state.piles).flatMap(p => p.cards), ...state.hands.flatMap(h => h.cards)]
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * The state after one action. An action that does not make sense for the state (a pile that is not there, a card that is not in it)
 * changes nothing and returns the same state.
 *
 *   move       { pile, x, y }
 *   rotate     { pile, rot }                         degrees
 *   flip       { pile }                              turns the pile over: the order is reversed, as a stack of cards is
 *   shuffle    { pile, seed }
 *   transfer   { from: { pile } | { hand }, cards: [ids], to: { pile, where? } | { hand, index? } | { x, y, faceUp?, rot? } }
 *   label      { pile, name }
 *   lock       { pile, locked }
 *   seats      { count }
 *   collect    { into }                              every other card goes back, face down, on this pile
 *   addToken   { kind, x, y, sides?, count?, label?, color?, ink?, asset?, asset2?, size? }   a die (or a group of dice), a counter, a round picture
 *   moveToken  { id, x, y }
 *   setToken   { id, value?, label?, sides?, count?, drop?, color?, ink?, asset?, asset2?, side?, size?, showNumber? }
 *   roll       { id, seed }                           every die of the group, from the one seed
 *   removeToken{ id }
 *   turn       { seat }                               start the turn order at a seat, or stop it with null
 *   nextTurn   {}                                     the turn goes to the next seat the way it goes round
 *   turnDirection { dir? }                            1 or -1; without dir it is turned round
 *   nameHand   { seat, name }
 */
export function reduce(state, action) {
  const run = ACTIONS[action?.type]
  if (!run) return state
  const next = clone(state)
  const changed = run(next, action)
  return changed === false ? state : next
}

const pileOf = (s, id) => (typeof id === 'string' && Object.hasOwn(s.piles, id) ? s.piles[id] : null)
const tokenOf = (s, id) => (typeof id === 'string' && Object.hasOwn(s.tokens, id) ? s.tokens[id] : null)

const ACTIONS = {
  move(s, a) {
    const p = pileOf(s, a.pile)
    if (!p || p.locked) return false
    p.x = num(a.x, p.x); p.y = num(a.y, p.y)
  },

  rotate(s, a) {
    const p = pileOf(s, a.pile)
    if (!p) return false
    p.rot = ((Math.round(num(a.rot, 0)) % 360) + 360) % 360
  },

  flip(s, a) {
    const p = pileOf(s, a.pile)
    if (!p || p.locked) return false
    p.cards.reverse()
    p.faceUp = !p.faceUp
  },

  shuffle(s, a) {
    const p = pileOf(s, a.pile)
    if (!p || p.locked || p.cards.length < 2) return false
    p.cards = shuffled(p.cards, a.seed)
  },

  transfer(s, a) {
    const ids = a.cards
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return false
    const from = a.from ?? {}, to = a.to ?? {}
    let sourcePile = null, source, sourceFaceUp
    if (from.pile != null) {
      sourcePile = pileOf(s, from.pile)
      if (!sourcePile || sourcePile.locked) return false
      source = sourcePile.cards; sourceFaceUp = sourcePile.faceUp
    } else if (from.hand != null && s.hands[from.hand]) {
      source = s.hands[from.hand].cards; sourceFaceUp = true
    } else return false
    const present = new Set(source)
    if (!ids.every(id => present.has(id))) return false
    const take = new Set(ids)
    const moved = source.filter(id => take.has(id))                      // in the order they lie in the source
    const remaining = source.filter(id => !take.has(id))

    if (to.pile != null) {
      const dest = pileOf(s, to.pile)
      if (!dest || to.pile === from.pile || dest.locked) return false
      if (sourcePile) { if (remaining.length) sourcePile.cards = remaining; else delete s.piles[from.pile] } else s.hands[from.hand].cards = remaining
      const oriented = sourceFaceUp === dest.faceUp ? moved : [...moved].reverse()
      dest.cards = to.where === 'bottom' ? [...oriented, ...dest.cards] : [...dest.cards, ...oriented]
    } else if (to.hand != null && s.hands[to.hand]) {
      const hand = s.hands[to.hand]
      if (sourcePile) { if (remaining.length) sourcePile.cards = remaining; else delete s.piles[from.pile] } else s.hands[from.hand].cards = remaining
      const index = clamp(Math.round(num(to.index, hand.cards.length)), 0, hand.cards.length)
      hand.cards.splice(index, 0, ...(sourceFaceUp ? moved : [...moved].reverse()))
    } else if (Number.isFinite(Number(to.x)) && Number.isFinite(Number(to.y))) {
      if (sourcePile) { if (remaining.length) sourcePile.cards = remaining; else delete s.piles[from.pile] } else s.hands[from.hand].cards = remaining
      const faceUp = to.faceUp ?? sourceFaceUp
      const id = `p${++s.seq}`
      s.piles[id] = { id, x: num(to.x), y: num(to.y), rot: ((Math.round(num(to.rot, 0)) % 360) + 360) % 360, faceUp: !!faceUp, name: '', locked: false, cards: faceUp === sourceFaceUp ? moved : [...moved].reverse() }
    } else return false
  },

  label(s, a) {
    const p = pileOf(s, a.pile)
    if (!p) return false
    p.name = String(a.name ?? '').slice(0, 60)
  },

  lock(s, a) {
    const p = pileOf(s, a.pile)
    if (!p) return false
    p.locked = !!a.locked
  },

  seats(s, a) {
    const count = clamp(Math.round(num(a.count, s.seats)), 1, MAX_SEATS)
    if (count === s.seats) return false
    while (s.hands.length < count) s.hands.push({ cards: [], name: '' })
    while (s.hands.length > count) s.hands[0].cards.push(...s.hands.pop().cards)      // a hand that goes keeps its cards, in the first hand
    s.seats = count
    if (s.turn !== null && s.turn >= count) s.turn = 0
  },

  collect(s, a) {
    const into = pileOf(s, a.into)
    if (!into) return false
    const gathered = []
    for (const p of Object.values(s.piles)) {
      if (p.id === into.id) continue
      gathered.push(...(p.faceUp ? [...p.cards].reverse() : p.cards))
      delete s.piles[p.id]
    }
    for (const h of s.hands) { gathered.push(...h.cards); h.cards = [] }
    into.cards = into.faceUp ? [...into.cards].reverse() : into.cards
    into.faceUp = false
    into.rot = 0
    into.cards = [...into.cards, ...gathered]
  },

  addToken(s, a) {
    const kind = a.kind === 'counter' ? 'counter' : a.kind === 'token' ? 'token' : 'die'
    const id = `t${++s.seq}`
    const t = { id, kind, x: num(a.x), y: num(a.y), label: String(a.label ?? '').slice(0, 30), color: cleanColor(a.color) ?? '', ink: cleanColor(a.ink) ?? '' }
    if (kind === 'die') {
      t.sides = clamp(Math.round(num(a.sides, 6)), 2, 100)
      t.count = clamp(Math.round(num(a.count, 1)), 1, MAX_DICE)
      t.values = Array(t.count).fill(1)
      t.drop = 'none'
      t.value = t.count
    } else if (kind === 'counter') { t.sides = 0; t.value = 0 } else {
      t.asset = a.asset ? String(a.asset).slice(0, 80) : null
      t.asset2 = a.asset2 ? String(a.asset2).slice(0, 80) : null
      t.side = 0
      t.size = TOKEN_SIZES[a.size] ? a.size : 'medium'
      t.showNumber = false
      t.value = 0
    }
    s.tokens[id] = t
  },

  moveToken(s, a) {
    const t = tokenOf(s, a.id)
    if (!t) return false
    t.x = num(a.x, t.x); t.y = num(a.y, t.y)
  },

  setToken(s, a) {
    const t = tokenOf(s, a.id)
    if (!t) return false
    if (t.kind === 'die') {
      if (a.sides !== undefined) { t.sides = clamp(Math.round(num(a.sides, t.sides)), 2, 100); t.values = t.values.map(v => clamp(v, 1, t.sides)) }
      if (a.count !== undefined) {
        const count = clamp(Math.round(num(a.count, t.count)), 1, MAX_DICE)
        t.values = Array.from({ length: count }, (_, i) => t.values[i] ?? 1)
        t.count = count
      }
      if (a.drop !== undefined && ['none', 'low', 'high'].includes(a.drop)) t.drop = a.drop
      if (a.value !== undefined && t.count === 1) t.values = [clamp(Math.round(num(a.value, t.values[0])), 1, t.sides)]   // a single die can be set by hand
      t.value = diceTotal(t.values, t.drop)
    } else if (a.value !== undefined) t.value = Math.round(num(a.value, t.value))
    if (a.label !== undefined) t.label = String(a.label).slice(0, 30)
    if (a.color !== undefined) t.color = cleanColor(a.color) ?? t.color
    if (a.ink !== undefined) t.ink = cleanColor(a.ink) ?? t.ink
    if (t.kind === 'token') {
      if (a.asset !== undefined) t.asset = a.asset ? String(a.asset).slice(0, 80) : null
      if (a.asset2 !== undefined) { t.asset2 = a.asset2 ? String(a.asset2).slice(0, 80) : null; if (!t.asset2) t.side = 0 }
      if (a.side !== undefined) t.side = a.side === 1 && t.asset2 ? 1 : 0
      if (a.size !== undefined && TOKEN_SIZES[a.size]) t.size = a.size
      if (a.showNumber !== undefined) t.showNumber = !!a.showNumber
    }
  },

  roll(s, a) {
    const t = tokenOf(s, a.id)
    if (!t || t.kind !== 'die') return false
    const next = prng(a.seed)   // every die of the group comes from the one seed, in order: a single die rolls as it always did
    t.values = Array.from({ length: t.count }, () => 1 + Math.floor(next() * t.sides))
    t.value = diceTotal(t.values, t.drop)
  },

  removeToken(s, a) {
    if (!tokenOf(s, a.id)) return false
    delete s.tokens[a.id]
  },

  turn(s, a) {
    const seat = a.seat === null || a.seat === undefined ? null : Math.round(num(a.seat, -1))
    if (seat !== null && (seat < 0 || seat >= s.seats)) return false
    if (seat === s.turn) return false
    s.turn = seat
  },

  nextTurn(s) {
    if (s.turn === null || s.turn === undefined) return false
    s.turn = (s.turn + (s.turnDir === -1 ? -1 : 1) + s.seats) % s.seats
  },

  turnDirection(s, a) {
    const dir = a.dir === undefined ? -(s.turnDir ?? 1) : a.dir === -1 ? -1 : 1
    if (dir === (s.turnDir ?? 1)) return false
    s.turnDir = dir
  },

  nameHand(s, a) {
    const hand = s.hands[Math.round(num(a.seat, -1))]
    if (!hand) return false
    const name = String(a.name ?? '').slice(0, HAND_NAME_MAX)
    if (name === (hand.name ?? '')) return false
    hand.name = name
  }
}

// ---------------------------------------------------------------------------
// Helpers that make actions (the interface and the tests build them the same way)
// ---------------------------------------------------------------------------

/** Draw `count` cards from the top of a pile into a seat's hand: one action. */
export function drawAction(state, pileId, seat, count = 1) {
  const pile = state.piles[pileId]
  if (!pile || !pile.cards.length) return null
  const cards = pile.cards.slice(-Math.max(1, count))
  return { type: 'transfer', from: { pile: pileId }, cards, to: { hand: seat } }
}

/** Deal `count` cards from the top of a pile to every seat, one at a time round the table: the actions, in order. */
export function dealActions(state, pileId, count = 1) {
  const pile = state.piles[pileId]
  if (!pile) return []
  const actions = []
  const stack = [...pile.cards]
  for (let round = 0; round < count; round++) for (let seat = 0; seat < state.seats; seat++) {
    const top = stack.pop()
    if (top === undefined) return actions
    actions.push({ type: 'transfer', from: { pile: pileId }, cards: [top], to: { hand: seat } })
  }
  return actions
}

/** Where the next pile is put when it comes off another one (a little to the side, so it can be seen). */
export const besides = pile => ({ x: pile.x + CARD_WIDTH + 24, y: pile.y })

// ---------------------------------------------------------------------------
// What the project says about the cards (UPDATES U6)
// ---------------------------------------------------------------------------

/**
 * The state with what the project now says about some cards: `info` is { project card id: { name, code, backKey, missing } }. Every card
 * of the table that was made from one of those cards takes the name, ID and back, and is marked when the card is gone from the project.
 * Returns the same state when nothing differs.
 */
export function refreshCards(state, info) {
  let next = null
  for (const [id, c] of Object.entries(state.cards)) {
    const i = info[c.id]
    if (!i) continue
    const back = i.backKey ?? null
    if (c.name === i.name && c.code === i.code && c.back === back && !!c.missing === !!i.missing) continue
    next = next ?? clone(state)
    Object.assign(next.cards[id], { name: i.name, code: i.code, back, missing: !!i.missing })
    if (!i.missing) delete next.cards[id].missing
  }
  return next ?? state
}

/** The same, for a whole session: the present, and every state that undo and redo can still bring back (so they do not bring back an old name). */
export function refreshSession(session, info) {
  const state = refreshCards(session.state, info)
  const past = session.past.map(p => refreshCards(p, info))
  const future = session.future.map(f => ({ ...f, state: refreshCards(f.state, info) }))
  const changed = state !== session.state || past.some((p, i) => p !== session.past[i]) || future.some((f, i) => f.state !== session.future[i].state)
  return changed ? { ...session, state, past, future } : session
}

// ---------------------------------------------------------------------------
// A session: the state with its undo and redo, and the log of what was done
// ---------------------------------------------------------------------------

export function createSession(state) {
  return { initial: clone(state), state, past: [], future: [], log: [] }
}

/** A step of the session: the actions that made it (one, or several as one step of undo). `past` holds the state before each step. */
function step(session, state, actions) {
  const past = [...session.past, session.state]
  if (past.length > MAX_UNDO) past.shift()
  return { ...session, state, past, future: [], log: [...session.log, actions] }
}

/** The session after an action; an action that changes nothing is not recorded. */
export function dispatch(session, action) {
  const next = reduce(session.state, action)
  return next === session.state ? session : step(session, next, [action])
}

/** Several actions as one step of undo. */
export function dispatchAll(session, actions) {
  let state = session.state
  const done = []
  for (const a of actions) { const next = reduce(state, a); if (next !== state) { state = next; done.push(a) } }
  return done.length ? step(session, state, done) : session
}

export function undo(session) {
  if (!session.past.length) return session
  return {
    ...session, state: session.past[session.past.length - 1], past: session.past.slice(0, -1),
    future: [{ state: session.state, step: session.log[session.log.length - 1] }, ...session.future], log: session.log.slice(0, -1)
  }
}

export function redo(session) {
  if (!session.future.length) return session
  const [next, ...rest] = session.future
  return { ...session, state: next.state, past: [...session.past, session.state], future: rest, log: [...session.log, next.step] }
}

// ---------------------------------------------------------------------------
// Reading a saved table
// ---------------------------------------------------------------------------

/**
 * Whether a state read from a file can be used: the right shape, and every card exactly once. Returns the state made safe (numbers
 * checked, text cut), or `{ error }`.
 */
export function readTable(raw) {
  const bad = reason => ({ error: reason })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('not a table')
  if (raw.version !== TABLE_VERSION) return bad('version')
  const s = { version: TABLE_VERSION, seq: Math.max(0, Math.round(num(raw.seq, 0))), seats: clamp(Math.round(num(raw.seats, 1)), 1, MAX_SEATS), cards: {}, piles: {}, hands: [], tokens: {}, turn: null, turnDir: raw.turnDir === -1 ? -1 : 1, decks: [] }
  if (!raw.cards || typeof raw.cards !== 'object' || !raw.piles || typeof raw.piles !== 'object' || !Array.isArray(raw.hands) || !Array.isArray(raw.decks)) return bad('shape')
  for (const d of raw.decks) s.decks.push({ id: String(d?.id ?? ''), name: String(d?.name ?? '').slice(0, 100), w: clamp(num(d?.w, CARD_WIDTH), 20, 1000), h: clamp(num(d?.h, 196), 20, 1500) })
  for (const [id, c] of Object.entries(raw.cards)) {
    if (!c || typeof c !== 'object') return bad('card')
    const deck = Math.round(num(c.deck, 0))
    if (deck < 0 || deck >= s.decks.length) return bad('deck')
    s.cards[id] = { id: String(c.id ?? ''), name: String(c.name ?? '').slice(0, 200), code: String(c.code ?? '').slice(0, 60), deck, w: s.decks[deck].w, h: s.decks[deck].h, back: c.back == null ? null : String(c.back) }
  }
  const seen = new Set()
  const take = list => {
    if (!Array.isArray(list)) return null
    for (const id of list) { if (!(id in s.cards) || seen.has(id)) return null; seen.add(id) }
    return [...list]
  }
  for (const [id, p] of Object.entries(raw.piles)) {
    const cards = take(p?.cards)
    if (!cards || !cards.length) return bad('pile')
    s.piles[id] = { id, x: num(p.x), y: num(p.y), rot: ((Math.round(num(p.rot, 0)) % 360) + 360) % 360, faceUp: !!p.faceUp, name: String(p.name ?? '').slice(0, 60), locked: !!p.locked, cards }
  }
  for (let i = 0; i < s.seats; i++) {
    const cards = take(raw.hands[i]?.cards ?? [])
    if (!cards) return bad('hand')
    s.hands.push({ cards, name: String(raw.hands[i]?.name ?? '').slice(0, HAND_NAME_MAX) })
  }
  if (raw.turn !== null && raw.turn !== undefined) { const t = Math.round(num(raw.turn, -1)); if (t >= 0 && t < s.seats) s.turn = t }
  if (raw.hands.length > s.seats) return bad('hands')
  if (seen.size !== Object.keys(s.cards).length) return bad('lost cards')
  for (const [id, t] of Object.entries(raw.tokens ?? {})) {
    const kind = t?.kind === 'counter' ? 'counter' : t?.kind === 'token' ? 'token' : 'die'
    const out = { id, kind, x: num(t.x), y: num(t.y), label: String(t.label ?? '').slice(0, 30), color: cleanColor(t.color) ?? '', ink: cleanColor(t.ink) ?? '' }
    if (kind === 'die') {
      out.sides = clamp(Math.round(num(t.sides, 6)), 2, 100)
      // a table saved before dice came in groups has one die with one value
      const values = Array.isArray(t.values) && t.values.length ? t.values.slice(0, MAX_DICE) : [t.value]
      out.values = values.map(v => clamp(Math.round(num(v, 1)), 1, out.sides))
      out.count = out.values.length
      out.drop = ['low', 'high'].includes(t.drop) ? t.drop : 'none'
      out.value = diceTotal(out.values, out.drop)
    } else if (kind === 'counter') { out.sides = 0; out.value = Math.round(num(t.value, 0)) } else {
      out.asset = t.asset ? String(t.asset).slice(0, 80) : null
      out.asset2 = t.asset2 ? String(t.asset2).slice(0, 80) : null
      out.side = t.side === 1 && out.asset2 ? 1 : 0
      out.size = TOKEN_SIZES[t.size] ? t.size : 'medium'
      out.showNumber = !!t.showNumber
      out.value = Math.round(num(t.value, 0))
    }
    s.tokens[id] = out
  }
  return s
}
