/**
 * Messages over a data channel (PRD §22.0). A channel carries text of a limited size and may not take everything at once; the table sends
 * pictures, which are large. A message is JSON; one that is too long is cut into numbered pieces, and put together on the other side.
 *
 *   const wire = createWire(channel, message => …)      channel: { send(text), bufferedAmount?, close() }
 *   await wire.send(object)                              resolves when it has been handed to the channel
 *   wire.receive(text)                                   called with each piece of text the channel delivers
 *
 * What arrives is untrusted: the number and size of pieces and of messages put together is limited, and a piece that does not fit is
 * dropped (and counted in `wire.dropped`).
 */
export const CHUNK_CHARS = 12000                   // a piece, in characters: at most about 36 kB of UTF-8, below the 64 kB a channel is sure to take
export const MAX_MESSAGE_CHARS = 8 * 1024 * 1024
const MAX_PIECES = Math.ceil(MAX_MESSAGE_CHARS / CHUNK_CHARS) + 1
const MAX_OPEN = 8
const HIGH_WATER = 1024 * 1024                     // wait to send more when this much is queued in the channel

export function createWire(channel, onMessage, { chunk = CHUNK_CHARS, onWait = null } = {}) {
  let nextId = 1
  const open = new Map()            // id -> { n, pieces: [], size }
  const lanes = new Map()           // lane -> the promise of the last message put in it
  async function put(obj) {
    const text = JSON.stringify(obj)
    if (text.length > MAX_MESSAGE_CHARS) return false
    if (text.length <= chunk) { await ready(); channel.send(text); return true }
    const id = nextId++
    const n = Math.ceil(text.length / chunk)
    for (let i = 0; i < n; i++) {
      await ready()
      channel.send(JSON.stringify({ '~': 1, id, i, n, d: text.slice(i * chunk, (i + 1) * chunk) }))
    }
    return true
  }
  const wire = {
    dropped: 0,

    /** Send a message. The messages of a lane arrive in the order they were sent; a long one (a picture, in the 'bulk' lane) does not hold up the others. */
    send(obj, lane = 'control') {
      const done = (lanes.get(lane) ?? Promise.resolve()).then(() => put(obj))
      const tail = done.catch(() => {})
      lanes.set(lane, tail)
      tail.then(() => { if (lanes.get(lane) === tail) lanes.delete(lane) })
      return done
    },

    receive(text) {
      if (typeof text !== 'string' || text.length > chunk * 4) { wire.dropped++; return }
      let obj
      try { obj = JSON.parse(text) } catch { wire.dropped++; return }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { wire.dropped++; return }
      if (obj['~'] !== 1) { onMessage(obj); return }
      const { id, i, n, d } = obj
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(i) || !Number.isSafeInteger(n) || typeof d !== 'string' || n < 2 || n > MAX_PIECES || i < 0 || i >= n) { wire.dropped++; return }
      let m = open.get(id)
      if (!m) {
        if (open.size >= MAX_OPEN) { wire.dropped++; return }
        m = { n, pieces: new Array(n), count: 0, size: 0 }
        open.set(id, m)
      }
      if (m.n !== n || m.pieces[i] !== undefined) { wire.dropped++; return }
      m.size += d.length
      if (m.size > MAX_MESSAGE_CHARS) { open.delete(id); wire.dropped++; return }
      m.pieces[i] = d; m.count++
      if (m.count < m.n) return
      open.delete(id)
      let whole
      try { whole = JSON.parse(m.pieces.join('')) } catch { wire.dropped++; return }
      if (whole && typeof whole === 'object' && !Array.isArray(whole) && whole['~'] !== 1) onMessage(whole); else wire.dropped++
    }
  }

  /** Let the channel empty a little before more is put in it. */
  async function ready() {
    while ((channel.bufferedAmount ?? 0) > HIGH_WATER) await (onWait ? onWait() : new Promise(r => setTimeout(r, 20)))
  }
  return wire
}
