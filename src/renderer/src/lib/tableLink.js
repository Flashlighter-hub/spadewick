/**
 * A shared table over a connection (PRD §22.0, steps 3 and 4): the conversation of shared/tableNet.js carried on channels, and the cards'
 * pictures sent by the host, so that a guest needs nothing but this application: not the project, not its images.
 *
 *   host   const link = createHostLink({ host: createHost({ state }), render })
 *          const { id, code } = await link.invite()        give the code to one guest
 *          await link.accept(id, answerCode)               the guest's answer, trading code for code
 *   guest  const link = createGuestLink({ name, onChange })
 *          const answer = await link.join(offerCode)       give the answer to the host
 *          link.act(action)                                a move, asked of the host
 *          await link.picture({ side: 'front', card })     the picture of a card, from the host
 *
 * Both work on *channels* (see rtcPeer.js), so a test can use channels that live in memory.
 *
 * Pictures. A guest asks for the picture of a card by the id the card has on the table; the host first asks `host.authorizePicture`, which
 * refuses the face of a card the guest may not see (in another hand, or face down), and then makes the picture with `render`:
 *   render.front(projectCardId, width) / render.back(projectCardId, width) / render.asset(assetId, width)
 *      each gives (a promise of) { mime, data } with data in base64, or null when there is no picture.
 * Pictures travel on a lane of their own, so a big one never holds up a move.
 */
import { createWire } from './wire.js'
import { openInvitation, answerInvitation } from './rtcPeer.js'
import { createGuest } from '../../../shared/tableNet.js'
import { LinkError } from './rtcCode.js'
import { tr } from '../../../shared/i18n.js'

const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_PICTURE_CHARS = 6 * 1024 * 1024
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PICTURE_TIMEOUT_MS = 20000
const CACHE_LIMIT = 300
const HELLO_NAME = 30

/** A secret a guest keeps for the length of a game, so that the host can give them their seat back when they come again after the connection broke. */
export function newTicket() {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// The host's side
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {object} opts.host        a host of shared/tableNet.js
 * @param {object} opts.render      makes the pictures (see above)
 * @param {() => void} [opts.onChange]   the table changed (a guest moved, arrived, went)
 * @param {(peers: object[]) => void} [opts.onPeers]   who is at the table, or has been invited
 * @param {object} [opts.rtc]       { openInvitation }: the way connections are made (tests give their own)
 * @param {object[]} [opts.iceServers]
 */
export function createHostLink({ host, render, onChange = () => {}, onPeers = () => {}, rtc = { openInvitation }, iceServers = [] }) {
  const peers = new Map()           // id -> { id, wire, channel, joined, name }
  const invites = new Map()         // id -> invitation
  const cache = new Map()           // picture key -> promise of { mime, data } | null
  let counter = 0
  let closed = false

  const list = () => [
    ...[...peers.values()].map(p => ({ id: p.id, name: p.name, joined: p.joined, state: p.joined ? 'joined' : 'connecting' })),
    ...[...invites.keys()].map(id => ({ id, name: '', joined: false, state: 'invited' }))
  ]
  const announce = () => onPeers(list())
  const swallow = () => { /* a channel that has just closed: the close handler tells the table */ }

  function send(outs) {
    for (const o of outs ?? []) peers.get(o.to)?.wire.send(o.msg).catch(swallow)
  }

  /** A guest is gone. Their seat is kept for them (they can come back with their ticket) unless they were sent away. */
  function drop(id, keep = true) {
    const p = peers.get(id)
    if (!p) return
    peers.delete(id)
    try { p.channel.close() } catch { /* already closed */ }
    if (p.joined) { send(host.leave(id, { keep })); onChange() }
    announce()
  }

  function attach(id, channel) {
    const peer = { id, channel, joined: false, name: '', ticket: null, wire: null }
    peer.wire = createWire(channel, msg => handle(peer, msg))
    peers.set(id, peer)
    channel.onmessage = text => peer.wire.receive(text)
    channel.onclose = () => drop(id)
    announce()
  }

  function handle(peer, msg) {
    if (closed || !peers.has(peer.id)) return
    if (!peer.joined) {                                         // the first thing a guest says is who they are
      if (msg.type !== 'hello') return
      // a guest who comes again with their ticket replaces the connection that broke without being noticed
      if (typeof msg.ticket === 'string') for (const other of [...peers.values()]) if (other !== peer && other.ticket === msg.ticket) drop(other.id)
      peer.joined = true
      peer.ticket = typeof msg.ticket === 'string' ? msg.ticket : null
      peer.name = String(msg.name ?? '').slice(0, HELLO_NAME)
      send(host.join(peer.id, { name: msg.name, seat: Number.isInteger(msg.seat) ? msg.seat : null, ticket: peer.ticket }))
      announce(); onChange()
      return
    }
    if (msg.type === 'picture') { servePicture(peer, msg); return }
    const before = host.rev
    send(host.receive(peer.id, msg))
    if (host.rev !== before) onChange()
  }

  // ---- pictures ----

  function remember(key, make) {
    if (!cache.has(key)) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
      // a picture that could not be made is not remembered: the next asking tries again
      const made = Promise.resolve().then(make).catch(() => null).then(found => { if (!found && cache.get(key) === made) cache.delete(key); return found })
      cache.set(key, made)
    }
    return cache.get(key)
  }

  async function servePicture(peer, msg) {
    if (!Number.isSafeInteger(msg.rid)) return
    const reply = body => peers.has(peer.id) && peer.wire.send({ type: 'picture', rid: msg.rid, ...body }, 'bulk').catch(swallow)
    const auth = host.authorizePicture(peer.id, msg)
    if (!auth.ok) { reply({ ok: false, reason: auth.reason }); return }
    let found
    if (auth.side === 'front') found = await remember(`f:${auth.projectCard}:${auth.width}`, () => render.front(auth.projectCard, auth.width))
    else if (auth.side === 'back') found = await remember(`b:${auth.back ?? auth.projectCard}:${auth.width}`, () => render.back(auth.projectCard, auth.width))
    else found = await remember(`a:${auth.asset}:${auth.width}`, () => render.asset(auth.asset, auth.width))
    if (!found || !PICTURE_TYPES.has(found.mime) || typeof found.data !== 'string') { reply({ ok: false, reason: 'failed' }); return }
    reply({ ok: true, mime: found.mime, data: found.data })
  }

  const link = {
    host,
    get peers() { return list() },

    /** An invitation for one guest: the code to give them. */
    async invite() {
      const id = `g${++counter}`
      const invitation = await rtc.openInvitation({ iceServers })
      invites.set(id, invitation)
      announce()
      return { id, code: invitation.code }
    },
    /** The guest's answer to an invitation: connects, and the guest says who they are when the channel is open. */
    async accept(id, answerCode) {
      const invitation = invites.get(id)
      if (!invitation) throw new LinkError('unknown', tr('shareLink.noInvitation'))
      try {
        const channel = await invitation.accept(answerCode)
        invites.delete(id)
        if (closed) { channel.close(); return }
        attach(id, channel)
      } catch (err) {
        if (!(err instanceof LinkError) || err.code !== 'format') invites.delete(id)   // a code that was copied badly can be tried again
        announce()
        throw err
      }
    },
    /** Take back an invitation that was not used. */
    cancel(id) { invites.get(id)?.cancel(); invites.delete(id); announce() },
    /** Send a guest away: their seat is free at once. */
    kick: id => drop(id, false),
    /** Let go of the seat kept for a guest who dropped. */
    release(seat) { send(host.release(seat)); announce(); onChange() },
    /** Tell guests to draw the pictures again (a card or a template changed): what was made for them is forgotten. */
    redraw() { cache.clear(); send([...peers.values()].filter(p => p.joined).map(p => ({ to: p.id, msg: { type: 'redraw' } }))) },
    /** Attach a channel that is already open (tests, or a different way of connecting). */
    attach,

    // the host's own moves
    act(action) { send(host.act(action)); onChange() },
    actAll(actions) { send(host.actAll(actions)); onChange() },
    undo() { send(host.undo()); onChange() },
    redo() { send(host.redo()); onChange() },
    refresh(info) { send(host.refresh(info)); link.redraw(); onChange() },

    close() {
      closed = true
      for (const i of invites.values()) i.cancel()
      invites.clear()
      for (const p of [...peers.values()]) { try { p.channel.close() } catch { /* already closed */ } }
      peers.clear()
      announce()
    }
  }
  return link
}

// ---------------------------------------------------------------------------
// The guest's side
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {number|null} [opts.seat]     the hand wanted (a hand that is free); else the first free one
 * @param {string} [opts.ticket]        the guest's secret for this game; give the same one again to be given the same seat back
 * @param {(view: object) => void} [opts.onChange]   the table is different
 * @param {(players: object[]) => void} [opts.onPlayers]   who is at the table changed
 * @param {(error?: Error) => void} [opts.onClose]   the connection ended, or could not be made
 * @param {() => void} [opts.onRedraw]  the host says to ask for the pictures again
 * @param {object} [opts.rtc]           { answerInvitation }
 */
export function createGuestLink({ name = 'Guest', seat = null, ticket = newTicket(), onChange = () => {}, onPlayers = () => {}, onClose = () => {}, onRedraw = () => {}, rtc = { answerInvitation }, iceServers = [] } = {}) {
  const guest = createGuest()
  let wire = null
  let channel = null
  let closed = false
  let rid = 0
  const waiting = new Map()          // rid -> { resolve, reject, timer }
  const pictures = new Map()         // key -> promise of a data URL

  const failAll = () => { for (const [, w] of waiting) { clearTimeout(w.timer); w.reject(new LinkError('closed', tr('shareLink.closed'))) } waiting.clear() }
  const ended = err => { if (closed) return; closed = true; failAll(); onClose(err) }
  const swallow = () => { /* the channel has closed: onclose tells the person */ }

  function handle(msg) {
    if (msg.type === 'picture') {
      const w = Number.isSafeInteger(msg.rid) ? waiting.get(msg.rid) : null
      if (!w) return
      waiting.delete(msg.rid); clearTimeout(w.timer)
      if (msg.ok === true && PICTURE_TYPES.has(msg.mime) && typeof msg.data === 'string' && msg.data.length <= MAX_PICTURE_CHARS && BASE64.test(msg.data)) w.resolve(`data:${msg.mime};base64,${msg.data}`)
      else w.reject(new LinkError('refused', tr('shareLink.pictureFailed')))
      return
    }
    if (msg.type === 'redraw') { pictures.clear(); onRedraw(); return }
    const r = guest.receive(msg)
    for (const m of r.send) wire.send(m).catch(swallow)
    if (r.changed) onChange(guest.view)
    if (msg.type === 'players' || r.changed) onPlayers(guest.players)
  }

  function attach(ch) {
    channel = ch
    wire = createWire(ch, handle)
    ch.onmessage = text => wire.receive(text)
    ch.onclose = () => ended()
    wire.send({ type: 'hello', name, seat, ticket }).catch(swallow)
  }

  const link = {
    guest,
    get view() { return guest.view },
    get you() { return guest.you },
    get players() { return guest.players },
    get joined() { return guest.joined },
    get ticket() { return ticket },
    get connected() { return !!channel && !closed },
    takeEvents: () => guest.takeEvents(),
    attach,

    /** Answer an invitation: the code to give back to the host. The table arrives (`onChange`) when the host has accepted it. */
    async join(offerCode) {
      const answer = await rtc.answerInvitation(offerCode, { iceServers })
      answer.connected.then(attach, ended)
      return answer.code
    },

    act(action) { if (wire && !closed) wire.send(guest.act(action)).catch(swallow) },
    actAll(actions) { if (wire && !closed) wire.send(guest.actAll(actions)).catch(swallow) },
    undo() { if (wire && !closed) wire.send(guest.undo()).catch(swallow) },
    redo() { if (wire && !closed) wire.send(guest.redo()).catch(swallow) },
    /** Take another seat that is free (a number), or go to watch (null). */
    takeSeat(wanted) { if (wire && !closed) wire.send(guest.takeSeat(wanted)).catch(swallow) },
    rename(newName) { if (wire && !closed) wire.send(guest.rename(newName)).catch(swallow) },

    /**
     * A picture from the host, as a data address for an image. Asked once for each picture: the same asking again gives the same promise.
     * @param {{ side: 'front'|'back'|'asset', card?: string, back?: string, asset?: string, width?: number }} what
     *   `card` is the id the card has on the table (in the guest's view); `back` is the card's back key, so cards that share a back share it
     */
    picture({ side, card, back, asset, width = 300 }) {
      const key = side === 'asset' ? `a:${asset}:${width}` : side === 'back' ? `b:${back ?? card}:${width}` : `f:${card}:${width}`
      if (!pictures.has(key)) {
        const p = new Promise((resolve, reject) => {
          if (!wire || closed) return reject(new LinkError('closed', tr('shareLink.closed')))
          const id = ++rid
          const timer = setTimeout(() => { waiting.delete(id); reject(new LinkError('timeout', tr('shareLink.pictureFailed'))) }, PICTURE_TIMEOUT_MS)
          waiting.set(id, { resolve, reject, timer })
          wire.send({ type: 'picture', rid: id, side, card, asset, width }).catch(swallow)
        })
        pictures.set(key, p)
        p.catch(() => pictures.delete(key))       // a picture that failed can be asked for again
      }
      return pictures.get(key)
    },

    /** Leave the table. */
    leave() {
      const close = () => { try { channel?.close() } catch { /* already closed */ } }
      // goodbye first, then the channel: the host must hear it to let the seat go, and not keep it for a guest who dropped
      if (wire && !closed) wire.send(guest.bye()).catch(swallow).then(() => setTimeout(close, 50)); else close()
      ended()
    }
  }
  return link
}
