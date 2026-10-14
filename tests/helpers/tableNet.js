/**
 * Players of a shared table (shared/tableNet.js) that talk to each other in memory: messages go from hand to hand in the order they were
 * sent, the way a WebRTC data channel carries them, and the test can drop one to see what a guest does about a gap.
 */
import { createHost, createGuest } from '../../src/shared/tableNet.js'

export function makeNetwork(state, { guests = [], hostSeat = 0, newSeed, now, maxPerSecond } = {}) {
  const host = createHost({ state, hostSeat, newSeed, now, maxPerSecond })
  const people = new Map()               // peer -> guest
  const log = []                         // every message: { dir: 'down' | 'up', peer, msg }
  const queue = []                       // [{ to: peer | 'host', from?, msg }]
  let drop = null                        // (entry) => true to lose the message

  const sendDown = outs => { for (const o of outs) queue.push({ to: o.to, msg: o.msg }) }
  const pump = () => {
    while (queue.length) {
      const e = queue.shift()
      if (drop?.(e)) continue
      if (e.to === 'host') { log.push({ dir: 'up', peer: e.from, msg: e.msg }); sendDown(host.receive(e.from, e.msg)); continue }
      log.push({ dir: 'down', peer: e.to, msg: e.msg })
      const g = people.get(e.to)
      if (!g) continue
      const r = g.receive(e.msg)
      for (const m of r.send) queue.push({ to: 'host', from: e.to, msg: m })
    }
  }
  const net = {
    host, people, log, pump,
    /** A guest comes in. */
    join(peer, opts = {}) { const g = createGuest(); people.set(peer, g); sendDown(host.join(peer, opts)); pump(); return g },
    leave(peer) { sendDown(host.leave(peer)); people.delete(peer); pump() },
    /** A guest sends a move; everything that follows is delivered. */
    guestAct(peer, action) { queue.push({ to: 'host', from: peer, msg: people.get(peer).act(action) }); pump() },
    guestActAll(peer, actions) { queue.push({ to: 'host', from: peer, msg: people.get(peer).actAll(actions) }); pump() },
    send(peer, msg) { queue.push({ to: 'host', from: peer, msg }); pump() },
    hostAct(action) { sendDown(host.act(action)); pump() },
    hostActAll(actions) { sendDown(host.actAll(actions)); pump() },
    hostUndo() { sendDown(host.undo()); pump() },
    hostRedo() { sendDown(host.redo()); pump() },
    dropWhen(fn) { drop = fn },
    /** Messages sent down to one guest since `from`. */
    downTo(peer, from = 0) { return log.slice(from).filter(l => l.dir === 'down' && l.peer === peer).map(l => l.msg) }
  }
  for (const g of guests) net.join(g)
  return net
}
