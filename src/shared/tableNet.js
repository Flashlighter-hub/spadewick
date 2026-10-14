/**
 * A table shared between players (PRD §22.0): the rules of the conversation, with no network in it.
 *
 * One player is the **host**. The host's table is the one that is right: it takes every move, checks it, gives it its place in the order
 * and tells everybody; the others (**guests**) only send the moves they want to make and show what the host says. Because a move is plain
 * data and `reduce` (shared/table.js) is a pure function, the same moves in the same order give the same table on every machine.
 *
 * Nothing here knows how messages travel. Every function takes a message in and gives the messages to send out, so a test passes them
 * from hand to hand in memory, and the real connection (WebRTC) only has to carry the same JSON.
 *
 *   host   createHost({ state })      join(peer, { name, seat }), leave(peer), receive(peer, message), act(action), …
 *   guest  createGuest()              receive(message), act(action), undo(), redo(), …
 *   viewFor(state, seat)              what one player may see of a table
 *
 * What a guest never gets:
 *  - **The other hands.** A hand is seen by its own player; the others are a number of cards.
 *  - **The faces of cards that lie face down.** A card's name is sent when it is turned up, or taken into the guest's own hand. The
 *    picture of a card's face is sent only to a player who may see the card (`authorizePicture`); the host sends it when asked.
 *  - **A say in chance.** The seed of a shuffle or a roll is chosen by the host, never by the player who asks, so nobody can try seeds.
 * What a guest can do is limited to what a player at a real table can: take cards from their own hand, never from another; the host alone
 * collects the table or changes the number of seats.
 *
 * Messages (all plain JSON):
 *   guest → host   { type: 'action', cid, action }   { type: 'batch', cid, actions }   { type: 'undo' }   { type: 'redo' }
 *                  { type: 'resync' }   { type: 'name', name }   { type: 'seat', seat }   { type: 'bye' }
 *                  (the guest also says { type: 'hello', name, seat?, ticket? } when the channel opens: see lib/tableLink.js)
 *                  { type: 'picture', rid, side, card, asset?, width? }   asks for a picture (answered by whoever carries the messages, see
 *                                                                          lib/tableLink.js, after the host has checked it with authorizePicture)
 *   host → guest   { type: 'welcome', you, rev, view, players, hostSeat }
 *                  { type: 'applied', rev, actions, origin, cid? }     the guest applies the same actions to its view
 *                  { type: 'state', rev, view, why, origin?, cid? }   the view as it now is (when the move touched what the guest may not see,
 *                                                                      after undo or redo, or when the guest asked)
 *                  { type: 'rejected', cid, reason }   { type: 'players', players }
 * `cid` is a number the guest chooses to recognise its own moves in the answers.
 */
import { reduce, createSession, dispatch, dispatchAll, undo as undoSession, redo as redoSession, refreshSession, MAX_SEATS, newSeed as randomSeed } from './table.js'

export const NET_VERSION = 1
export const MAX_ACTION_BYTES = 4000
export const MAX_BATCH = 50
export const MAX_NAME = 30
const HOST = 'host'

const TICKET = /^[A-Za-z0-9_-]{8,64}$/
const ID = { pile: /^p\d{1,9}$/, token: /^t\d{1,9}$/, card: /^c\d{1,9}$/ }
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v)
const isSeat = n => Number.isInteger(n) && n >= 0 && n < MAX_SEATS
const cleanName = v => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_NAME)

/** The same text for the same data, whatever the order of the keys. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

// ---------------------------------------------------------------------------
// What a player may see
// ---------------------------------------------------------------------------

/**
 * The table as one player may see it. `seat` is the player's hand (null: a spectator, who has none); `guest` is false for the host's own
 * view, which keeps the ids that cards have in the project.
 *  - the other hands are `{ cards: [], count, hidden: true, name }`;
 *  - `cards` (what each card is) tells a card only when it is face up on the table or in the player's own hand; a card face down on
 *    the table is `{ hidden: true, w, h, back }` (enough to draw the back); a card in somebody else's hand is not there;
 *  - `viewer` is the seat the view is for.
 * A view is a table as far as `reduce` is concerned: a move that does not touch what is hidden gives the next view when `reduce` is applied
 * to it, which is how a guest follows the host.
 */
export function viewFor(state, seat, { guest = true } = {}) {
  const view = structuredClone(state)
  const seen = new Set()
  for (const p of Object.values(view.piles)) if (p.faceUp) for (const id of p.cards) seen.add(id)
  if (seat !== null && view.hands[seat]) for (const id of view.hands[seat].cards) seen.add(id)
  // A card that may not be seen is what everybody can see of it: its size and its back. A guest does not have the project, so a card
  // there is called by its place on the table (the id that the host's pictures are asked for by), never by the id it has in the project.
  const onTable = new Set()
  for (const p of Object.values(view.piles)) for (const id of p.cards) onTable.add(id)
  view.cards = Object.fromEntries(Object.entries(view.cards).flatMap(([id, c]) => {
    if (seen.has(id)) return [[id, guest ? { ...c, id } : c]]
    // a card in somebody else's hand is not there at all; one face down on the table is its back
    return onTable.has(id) ? [[id, { id: guest ? id : c.id, name: '', code: '', deck: c.deck, w: c.w, h: c.h, back: c.back, hidden: true }]] : []
  }))
  view.hands = view.hands.map((h, i) => (i === seat ? h : { cards: [], count: h.cards.length, hidden: true, name: h.name ?? '' }))
  view.viewer = seat
  return view
}

// ---------------------------------------------------------------------------
// What a player may do
// ---------------------------------------------------------------------------

/**
 * Why a move may not be made by this player, or null when it may. Everything that comes from another machine is checked here before it
 * reaches `reduce`: the shape, the ids (a pile called "__proto__" is refused), the size, and the right of the player to the cards named.
 */
export function refusal(state, seat, isHost, action, { maxTokens = 200 } = {}) {
  if (!isPlain(action) || typeof action.type !== 'string') return 'malformed'
  let size
  try { size = JSON.stringify(action).length } catch { return 'malformed' }
  if (size > MAX_ACTION_BYTES) return 'tooBig'
  const ok = (re, v) => typeof v === 'string' && re.test(v)
  switch (action.type) {
    case 'move': case 'rotate': case 'flip': case 'shuffle': case 'label': case 'lock':
      return ok(ID.pile, action.pile) ? null : 'malformed'
    case 'transfer': {
      const { from, to, cards } = action
      if (!Array.isArray(cards) || !cards.length || cards.length > 300 || !cards.every(c => ok(ID.card, c))) return 'malformed'
      if (!isPlain(from) || !isPlain(to)) return 'malformed'
      if (from.pile !== undefined && from.pile !== null) { if (!ok(ID.pile, from.pile)) return 'malformed' }
      else if (from.hand !== undefined && from.hand !== null) {
        if (!isSeat(from.hand)) return 'malformed'
        if (from.hand !== seat) return 'notYourHand'              // a hand is taken from by its own player only
      } else return 'malformed'
      if (to.pile !== undefined && to.pile !== null) { if (!ok(ID.pile, to.pile)) return 'malformed' }
      else if (to.hand !== undefined && to.hand !== null) { if (!isSeat(to.hand)) return 'malformed' }
      else if (!Number.isFinite(Number(to.x)) || !Number.isFinite(Number(to.y))) return 'malformed'
      return null
    }
    case 'collect': return !isHost ? 'hostOnly' : ok(ID.pile, action.into) ? null : 'malformed'
    case 'seats': return isHost ? null : 'hostOnly'
    case 'addToken': return Object.keys(state.tokens).length >= maxTokens ? 'tooMany' : null
    case 'moveToken': case 'setToken': case 'roll': case 'removeToken':
      return ok(ID.token, action.id) ? null : 'malformed'
    case 'turn': case 'nextTurn': case 'turnDirection': return null       // the turn order restricts nothing
    case 'nameHand':
      if (!isSeat(action.seat)) return 'malformed'
      return isHost || action.seat === seat ? null : 'notYourHand'
    default: return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/**
 * The host of a shared table.
 * @param {object} opts
 * @param {object} opts.state       the table (shared/table.js)
 * @param {object} [opts.session]   the table with its history, to go on from (a table that was being played alone)
 * @param {number} [opts.hostSeat]  the hand of the host, or null to host without playing
 * @param {string} [opts.name]
 * @param {() => number} [opts.newSeed]   where the seeds of shuffles and rolls come from (tests give a fixed one)
 * @param {() => number} [opts.now]       the clock, for the limit on how fast a player may send
 * @param {number} [opts.maxPerSecond]
 * @param {number} [opts.maxTokens]
 */
export function createHost({ state, session: begun = null, hostSeat = 0, name = 'Host', newSeed = randomSeed, now = () => Date.now(), maxPerSecond = 30, maxTokens = 200, maxPicturesPerSecond = 40 }) {
  let session = begun ?? createSession(state)
  let rev = 0
  let origins = session.log.map(() => HOST)   // who made each step of the session's log, for undo
  let futureOrigins = []
  const players = new Map()   // peer -> { peer, name, seat, ticket, allow, stamp }
  const reservations = new Map()   // ticket -> { ticket, name, seat }: the seat of a guest who has dropped, kept for them
  const hostName = cleanName(name) || 'Host'

  const publicPlayers = () => [
    ...(hostSeat === null ? [] : [{ peer: HOST, name: hostName, seat: hostSeat }]),
    ...[...players.values()].map(p => ({ peer: p.peer, name: p.name, seat: p.seat })),
    ...[...reservations.values()].map(r => ({ peer: null, name: r.name, seat: r.seat, away: true }))
  ]
  const toAll = msg => [...players.values()].map(p => ({ to: p.peer, msg }))
  const reject = (peer, cid, reason) => (peer === null ? [] : [{ to: peer, msg: { type: 'rejected', cid: cid ?? null, reason } }])
  const seatOf = peer => (peer === null ? hostSeat : players.get(peer)?.seat ?? null)
  /** Whether a seat has somebody at it, or is kept for somebody who dropped (other than the one with `ticket`). */
  const taken = (seat, ticket = null) => seat === hostSeat || [...players.values()].some(p => p.seat === seat) || [...reservations.values()].some(r => r.seat === seat && r.ticket !== ticket)

  /** What to tell one player about a step: the moves themselves when applying them to the player's view gives the new view, else the view. */
  function tell(p, before, after, actions, origin, cid) {
    const viewBefore = viewFor(before, p.seat)
    const viewAfter = viewFor(after, p.seat)
    const predicted = actions.reduce((v, a) => reduce(v, a), viewBefore)
    const mine = origin === p.peer ? { cid } : {}
    if (canon(predicted) === canon(viewAfter)) return { type: 'applied', rev, actions, origin, ...mine }
    return { type: 'state', rev, view: viewAfter, why: 'hidden', origin, ...mine }
  }

  /** Make the moves as one step, if they change anything; the messages for everybody. */
  function commit(actions, origin, cid) {
    const before = session.state
    const next = actions.length === 1 ? dispatch(session, actions[0]) : dispatchAll(session, actions)
    if (next === session) return null
    session = next
    origins.push(origin); futureOrigins = []
    rev++
    // fewer hands: a player whose hand is gone watches from now on (their cards were put in the first hand)
    const lost = [...players.values()].filter(p => p.seat !== null && p.seat >= session.state.seats)
    for (const p of lost) p.seat = null
    for (const [t, r] of reservations) if (r.seat >= session.state.seats) reservations.delete(t)
    const out = [...players.values()].map(p => ({
      to: p.peer,
      msg: lost.includes(p)
        ? { type: 'state', rev, view: viewFor(session.state, null), why: 'seat', you: { peer: p.peer, name: p.name, seat: null }, origin, ...(origin === p.peer ? { cid } : {}) }
        : tell(p, before, session.state, actions, origin, cid)
    }))
    if (lost.length) out.push(...toAll({ type: 'players', players: publicPlayers() }))
    return out
  }

  /** Check, put the seeds in, and make the moves of one player (peer: null for the host). */
  function submit(peer, actions, cid) {
    const isHost = peer === null
    if (!Array.isArray(actions) || !actions.length || actions.length > MAX_BATCH) return reject(peer, cid, 'malformed')
    const seat = seatOf(peer)
    const clean = []
    for (const a of actions) {
      const why = refusal(session.state, seat, isHost, a, { maxTokens })
      if (why) return reject(peer, cid, why)
      // chance belongs to the host: the player's own seed is thrown away
      clean.push(a.type === 'shuffle' || a.type === 'roll' ? { ...structuredClone(a), seed: newSeed() } : structuredClone(a))
    }
    const out = commit(clean, isHost ? HOST : peer, cid)
    return out ?? reject(peer, cid, 'noEffect')
  }

  function history(kind, peer) {
    const isHost = peer === null
    if (kind === 'undo') {
      if (!session.past.length) return reject(peer, null, 'nothing')
      const last = origins[origins.length - 1]
      if (!isHost && last !== peer) return reject(peer, null, 'notYours')   // a player takes back their own latest move, and nobody else's
      session = undoSession(session)
      futureOrigins.unshift(origins.pop())
    } else {
      if (!session.future.length) return reject(peer, null, 'nothing')
      if (!isHost && futureOrigins[0] !== peer) return reject(peer, null, 'notYours')
      session = redoSession(session)
      origins.push(futureOrigins.shift())
    }
    rev++
    return toAllViews(kind, isHost ? HOST : peer)
  }

  const toAllViews = (why, origin) => [...players.values()].map(p => ({ to: p.peer, msg: { type: 'state', rev, view: viewFor(session.state, p.seat), why, origin } }))

  function allowed(p) {
    const t = now()
    p.allow = Math.min(maxPerSecond, p.allow + ((t - p.stamp) / 1000) * maxPerSecond)
    p.stamp = t
    if (p.allow < 1) return false
    p.allow -= 1
    return true
  }
  function allowedPicture(p) {
    const t = now()
    p.pics = Math.min(maxPicturesPerSecond, p.pics + ((t - p.picStamp) / 1000) * maxPicturesPerSecond)
    p.picStamp = t
    if (p.pics < 1) return false
    p.pics -= 1
    return true
  }

  const api = {
    get state() { return session.state },
    get rev() { return rev },
    get session() { return session },
    get hostSeat() { return hostSeat },
    players: publicPlayers,
    /** What the host sees of the table: their own hand, and nothing of the others. */
    hostView: () => viewFor(session.state, hostSeat, { guest: false }),
    view: peer => viewFor(session.state, seatOf(peer)),

    /** A guest arrives (or arrives again): the seat they take, and the messages to send. */
    join(peer, { name: guestName = 'Guest', seat = null, ticket: asked = null } = {}) {
      if (typeof peer !== 'string' || !peer || peer === HOST) return []
      const out = []
      const ticket = typeof asked === 'string' && TICKET.test(asked) ? asked : null
      // the same guest again (a connection that broke without being noticed is let go first)
      const stale = ticket ? [...players.values()].find(q => q.ticket === ticket && q.peer !== peer) : null
      if (stale) out.push(...api.leave(stale.peer))
      let p = players.get(peer)
      if (!p) {
        const kept = ticket ? reservations.get(ticket) : null
        let mine = null
        if (kept && kept.seat < session.state.seats && !taken(kept.seat, ticket)) mine = kept.seat          // the seat that was kept for them
        if (ticket) reservations.delete(ticket)
        if (mine === null && Number.isInteger(seat) && seat >= 0 && seat < session.state.seats && !taken(seat, ticket)) mine = seat
        if (mine === null) for (let i = 0; i < session.state.seats; i++) if (!taken(i)) { mine = i; break }
        if (mine === null && session.state.seats < MAX_SEATS) {          // everybody has a seat: the table grows one hand
          out.push(...(commit([{ type: 'seats', count: session.state.seats + 1 }], HOST) ?? []))
          mine = session.state.seats - 1
        }
        p = { peer, ticket, name: cleanName(asked && kept && (!guestName || guestName === 'Guest') ? kept.name : guestName) || 'Guest', seat: mine, allow: maxPerSecond, stamp: now(), pics: maxPicturesPerSecond, picStamp: now() }   // no seat left: a spectator
        players.set(peer, p)
      }
      out.push({ to: peer, msg: { type: 'welcome', version: NET_VERSION, you: { peer, name: p.name, seat: p.seat }, rev, view: viewFor(session.state, p.seat), players: publicPlayers(), hostSeat } })
      for (const o of toAll({ type: 'players', players: publicPlayers() })) if (o.to !== peer) out.push(o)
      return out
    },

    /**
     * A guest has gone; the cards in their hand stay where they are. A guest who gave a ticket and did not say goodbye (the connection
     * broke) has their seat kept, to take again when they come back with the same ticket; others' seats are free at once.
     */
    leave(peer, { keep = true } = {}) {
      const p = players.get(peer)
      if (!p) return []
      players.delete(peer)
      if (keep && p.ticket && p.seat !== null) reservations.set(p.ticket, { ticket: p.ticket, name: p.name, seat: p.seat })
      return toAll({ type: 'players', players: publicPlayers() })
    },

    /** The host lets go of the seat kept for a guest who dropped, so another can have it. */
    release(seat) {
      let found = false
      for (const [t, r] of reservations) if (r.seat === seat) { reservations.delete(t); found = true }
      return found ? toAll({ type: 'players', players: publicPlayers() }) : []
    },

    /** The seats that nobody has and none is kept for. */
    freeSeats: () => Array.from({ length: session.state.seats }, (_, i) => i).filter(i => !taken(i)),

    /** A message from a guest: the messages to send in answer. */
    receive(peer, msg) {
      const p = players.get(peer)
      if (!p) return []
      if (!isPlain(msg) || typeof msg.type !== 'string') return reject(peer, null, 'malformed')
      const cid = Number.isSafeInteger(msg.cid) ? msg.cid : null
      switch (msg.type) {
        case 'resync': return [{ to: peer, msg: { type: 'state', rev, view: viewFor(session.state, p.seat), why: 'asked' } }]
        case 'bye': return api.leave(peer, { keep: false })
        case 'seat': {                                       // a guest takes another free seat, or goes to watch
          if (!allowed(p)) return reject(peer, cid, 'rate')
          const want = msg.seat === null ? null : msg.seat
          if (want !== null && (!isSeat(want) || want >= session.state.seats)) return reject(peer, cid, 'malformed')
          if (want !== null && taken(want, p.ticket) && want !== p.seat) return reject(peer, cid, 'seatTaken')
          if (want === p.seat) return []
          p.seat = want
          return [{ to: peer, msg: { type: 'state', rev, view: viewFor(session.state, p.seat), why: 'seat', you: { peer, name: p.name, seat: p.seat } } }, ...toAll({ type: 'players', players: publicPlayers() }).filter(o => o.to !== peer)]
        }
        case 'name': {
          p.name = cleanName(msg.name) || p.name
          return toAll({ type: 'players', players: publicPlayers() })
        }
        case 'action': case 'batch': case 'undo': case 'redo':
          if (!allowed(p)) return reject(peer, cid, 'rate')
          if (msg.type === 'undo' || msg.type === 'redo') return history(msg.type, peer)
          return submit(peer, msg.type === 'action' ? [msg.action] : msg.actions, cid)
        default: return reject(peer, cid, 'unknown')
      }
    },

    /**
     * Whether a guest may be sent a picture, and what it is a picture of. `msg` is { rid, side: 'front' | 'back' | 'asset', card, asset, width }
     * with `card` the id the card has on the table. A face is only for a player who may see the card (face up, or in their own hand); a back is
     * for any card on the table (it is what everybody sees); an image of the library only if a token on the table shows it.
     * @returns {{ ok: true, side, projectCard?, back?, asset?, width } | { ok: false, reason }}
     */
    authorizePicture(peer, msg) {
      const p = players.get(peer)
      if (!p) return { ok: false, reason: 'unknown' }
      if (!isPlain(msg) || !['front', 'back', 'asset'].includes(msg.side)) return { ok: false, reason: 'malformed' }
      if (!allowedPicture(p)) return { ok: false, reason: 'rate' }
      const width = Math.min(600, Math.max(40, Math.round(Number(msg.width) || 300)))
      const state = session.state
      if (msg.side === 'asset') {
        if (typeof msg.asset !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(msg.asset)) return { ok: false, reason: 'malformed' }
        const shown = Object.values(state.tokens).some(t => t.kind === 'token' && (t.asset === msg.asset || t.asset2 === msg.asset))
        return shown ? { ok: true, side: 'asset', asset: msg.asset, width } : { ok: false, reason: 'hidden' }
      }
      if (typeof msg.card !== 'string' || !ID.card.test(msg.card) || !Object.hasOwn(state.cards, msg.card)) return { ok: false, reason: 'malformed' }
      const card = state.cards[msg.card]
      if (msg.side === 'back') return { ok: true, side: 'back', projectCard: card.id, back: card.back, width }
      const seen = viewFor(state, p.seat).cards[msg.card]
      if (!seen || seen.hidden) return { ok: false, reason: 'hidden' }
      return { ok: true, side: 'front', projectCard: card.id, width }
    },

    /** The host's own moves, taken through the same checks as everybody's. */
    act: action => submit(null, [action], null),
    actAll: actions => submit(null, actions, null),
    undo: () => history('undo', null),
    redo: () => history('redo', null),

    /** What the project says now about the cards (names, backs, cards gone): told to everybody as the view. */
    refresh(info) {
      const next = refreshSession(session, info)
      if (next === session) return []
      session = next
      rev++
      return toAllViews('refresh', HOST)
    }
  }
  return api
}

// ---------------------------------------------------------------------------
// A guest
// ---------------------------------------------------------------------------

/**
 * A guest's side. It holds the view the host last described and applies what the host says in order; a gap in the order (a lost message)
 * makes it ask for the view again. It makes no move of its own until the host has said it was made.
 */
export function createGuest() {
  let view = null
  let rev = 0
  let you = null
  let players = []
  let hostSeat = null
  let nextCid = 1
  let waiting = false              // asked for the view again: moves that come meanwhile are of no use
  const pending = new Set()        // cids of moves sent and not yet answered
  const events = []                // what happened that the person should hear of: { type: 'rejected', cid, reason }

  return {
    get view() { return view },
    get rev() { return rev },
    get you() { return you },
    get players() { return players },
    get hostSeat() { return hostSeat },
    get pending() { return pending },
    get joined() { return view !== null },
    /** What has happened since this was last asked, once. */
    takeEvents: () => events.splice(0),

    /** A message from the host: { send: [messages for the host], changed: whether the view is different now }. */
    receive(msg) {
      const out = { send: [], changed: false }
      if (!isPlain(msg) || typeof msg.type !== 'string') return out
      switch (msg.type) {
        case 'welcome':
          if (msg.version !== NET_VERSION) { events.push({ type: 'version', version: msg.version }); return out }
          view = msg.view; rev = msg.rev; you = msg.you; players = msg.players; hostSeat = msg.hostSeat ?? null; waiting = false
          out.changed = true
          break
        case 'players': players = msg.players; break
        case 'state':
          if (view === null || msg.rev < rev) break
          view = msg.view; rev = msg.rev; waiting = false
          if (isPlain(msg.you)) you = msg.you                       // the seat changed under the guest
          if (msg.cid !== undefined) pending.delete(msg.cid)
          out.changed = true
          break
        case 'applied':
          if (view === null || waiting || msg.rev <= rev) break
          if (msg.rev !== rev + 1) { waiting = true; out.send.push({ type: 'resync' }); break }   // a message was lost
          view = msg.actions.reduce((v, a) => reduce(v, a), view)
          rev = msg.rev
          if (msg.cid !== undefined) pending.delete(msg.cid)
          out.changed = true
          break
        case 'rejected':
          if (msg.cid !== null && msg.cid !== undefined) pending.delete(msg.cid)
          events.push({ type: 'rejected', cid: msg.cid ?? null, reason: String(msg.reason ?? '') })
          break
        default: break
      }
      return out
    },

    /** Ask the host for a move: the message to send. */
    act(action) { const cid = nextCid++; pending.add(cid); return { type: 'action', cid, action } },
    actAll(actions) { const cid = nextCid++; pending.add(cid); return { type: 'batch', cid, actions } },
    undo: () => ({ type: 'undo' }),
    redo: () => ({ type: 'redo' }),
    rename: name => ({ type: 'name', name }),
    takeSeat: seat => ({ type: 'seat', seat }),
    bye: () => ({ type: 'bye' })
  }
}
