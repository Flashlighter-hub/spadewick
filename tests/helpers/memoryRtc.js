import { LinkError } from '../../src/renderer/src/lib/rtcCode.js'

/**
 * Connections that live in memory, for testing the table's link (src/renderer/src/lib/tableLink.js) without a browser: the same shape as
 * rtcPeer.js gives (invitations and answers, and channels), with the codes being plain labels.
 */

/** Two channels joined to each other; what is sent on one arrives (a moment later, in order) on the other. `traffic` keeps every text sent. */
export function channelPair() {
  const make = () => ({ onmessage: null, onclose: null, bufferedAmount: 0, closed: false, sent: [], peer: null })
  const a = make(), b = make()
  const wire = (from, to) => {
    from.peer = to
    from.send = text => {
      if (from.closed) throw new Error('closed')
      from.sent.push(text)
      queueMicrotask(() => to.onmessage?.(text))              // what was sent before a close still arrives, as it does on a real channel
    }
    from.close = () => {
      if (from.closed) return
      from.closed = true; to.closed = true
      queueMicrotask(() => { from.onclose?.(); to.onclose?.() })
    }
  }
  wire(a, b); wire(b, a)
  return [a, b]
}

export function memoryRtc() {
  const invitations = new Map()        // code -> { host: channel, guest: channel, answered: bool }
  let n = 0
  return {
    invitations,
    host: {
      async openInvitation() {
        const code = `SPW1-O-TEST-${++n}`
        const [host, guest] = channelPair()
        const entry = { host, guest, answer: null, resolve: null }
        invitations.set(code, entry)
        return {
          code,
          accept: async answerCode => {
            if (answerCode !== `SPW1-A-TEST-${code.split('-').pop()}`) throw new LinkError('format', 'not the answer')
            return host
          },
          cancel() { invitations.delete(code) }
        }
      }
    },
    guest: {
      async answerInvitation(offerCode) {
        const entry = invitations.get(offerCode)
        if (!entry) throw new LinkError('format', 'not an invitation')
        return { code: `SPW1-A-TEST-${offerCode.split('-').pop()}`, connected: Promise.resolve(entry.guest), cancel() {} }
      }
    }
  }
}

/** Wait until the messages in flight have all arrived (the microtasks and the timers a send leaves behind). */
export const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)) }
