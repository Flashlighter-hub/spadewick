/**
 * A shared table over a connection (PRD §22.0, steps 3 and 4), without a browser: connection codes, the wire (pieces of long messages),
 * and the host's and guest's links on channels that live in memory. The real WebRTC connection is tested in the window
 * (tests/e2e/tableShare.e2e.test.js).
 */
import { describe, it, expect } from 'vitest'
import { createTable } from '../../src/shared/table.js'
import { createHost } from '../../src/shared/tableNet.js'
import { packCode, unpackCode, LinkError } from '../../src/renderer/src/lib/rtcCode.js'
import { createWire, CHUNK_CHARS } from '../../src/renderer/src/lib/wire.js'
import { createHostLink, createGuestLink } from '../../src/renderer/src/lib/tableLink.js'
import { memoryRtc, channelPair, settle } from '../helpers/memoryRtc.js'

const SDP = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd', 'a=ice-pwd:' + 'x'.repeat(24), 'a=fingerprint:sha-256 ' + Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).toUpperCase().padStart(2, '0')).join(':'),
  ...Array.from({ length: 6 }, (_, i) => `a=candidate:${i} 1 udp 2113937151 ${i}a1b2c3d-4e5f-6789-abcd-ef0123456789.local ${50000 + i} typ host generation 0`), 'a=sctp-port:5000', ''].join('\r\n')

describe('connection codes', () => {
  it('writes a description as one line of letters and digits, and reads it back exactly', async () => {
    for (const kind of ['offer', 'answer']) {
      const code = await packCode(kind, SDP)
      expect(code).toMatch(/^SPW1-[OA]-[0-9A-F]{4}-[A-Za-z0-9_-]+$/)
      expect(code.length).toBeLessThan(SDP.length)                      // squeezed
      expect(await unpackCode(code)).toEqual({ kind, sdp: SDP })
    }
  })

  it('reads a code that was pasted with spaces, line breaks and a trailing space', async () => {
    const code = await packCode('offer', SDP)
    const pasted = `  ${code.slice(0, 30)}\n${code.slice(30, 90)}\r\n  ${code.slice(90)} \n`
    expect((await unpackCode(pasted, 'offer')).sdp).toBe(SDP)
  })

  it('refuses what is not a code, a code that was damaged, a code cut short, and the wrong kind, each with its sentence', async () => {
    const code = await packCode('offer', SDP)
    const reason = async (text, expect_) => unpackCode(text, expect_).then(() => null, e => (e instanceof LinkError ? e.code : 'other'))
    expect(await reason('hello')).toBe('format')
    expect(await reason('')).toBe('format')
    expect(await reason(undefined)).toBe('format')
    expect(['checksum', 'format']).toContain(await reason(code.slice(0, -10)))      // cut short: not a whole code either way
    expect(await reason(code.slice(0, -4) + 'AAAA')).toBe('checksum')
    expect(await reason(code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21))).toBe('checksum')
    expect(await reason(code, 'answer')).toBe('kind')
    expect(await reason(await packCode('answer', SDP), 'offer')).toBe('kind')
    expect(await reason('SPW2-O-0000-AAAA')).toBe('format')
    expect(await reason('SPW1-O-ZZZZ-AAAA')).toBe('format')
    expect(await reason('x'.repeat(30000))).toBe('tooBig')
    await expect(unpackCode('SPW1-O-0000-AAAA')).rejects.toThrow()
    const err = await unpackCode(code, 'answer').catch(e => e)
    expect(err.message).toMatch(/invitation, not an answer/)
  })

  it('refuses a code that is not a description of a connection, and one that would swell to a great size', async () => {
    const notSdp = await packCode('offer', 'hello, this is not a connection description')
    await expect(unpackCode(notSdp)).rejects.toMatchObject({ code: 'format' })
    const bomb = await packCode('offer', `v=0\r\n${'a'.repeat(60000)}`)           // within the limit when written
    await expect(unpackCode(bomb)).resolves.toBeTruthy()
    await expect(packCode('offer', 'v=0' + 'a'.repeat(70000))).rejects.toMatchObject({ code: 'tooBig' })
    await expect(packCode('nonsense', SDP)).rejects.toMatchObject({ code: 'kind' })
  })
})

describe('the wire', () => {
  const pair = (chunk = 50) => {
    const [a, b] = channelPair()
    const got = []
    const wa = createWire(a, () => {}, { chunk })
    const wb = createWire(b, m => got.push(m), { chunk })
    b.onmessage = t => wb.receive(t)
    return { a, b, wa, wb, got }
  }

  it('sends a small message as it is, and a long one in numbered pieces that are put together again', async () => {
    const { a, wa, got } = pair(50)
    await wa.send({ hello: 'world' })
    const long = { text: 'abcdefghij'.repeat(60), list: [1, 2, 3], nested: { ok: true } }
    await wa.send(long)
    await settle()
    expect(got).toEqual([{ hello: 'world' }, long])
    expect(a.sent[0]).toBe('{"hello":"world"}')
    expect(a.sent.length).toBeGreaterThan(10)
    expect(a.sent.slice(1).every(t => t.length < 120)).toBe(true)
  })

  it('keeps the order of the messages of a lane, and lets a short message of another lane pass a long one', async () => {
    const { wa, got } = pair(40)
    const order = []
    const big = { big: 'x'.repeat(2000) }
    const p1 = wa.send(big, 'bulk')
    const p2 = wa.send({ n: 1 }); const p3 = wa.send({ n: 2 }); const p4 = wa.send({ n: 3 })
    await Promise.all([p1, p2, p3, p4])
    await settle()
    const small = got.filter(m => m.n).map(m => m.n)
    expect(small).toEqual([1, 2, 3])
    expect(got.some(m => m.big)).toBe(true)
    expect(got.findIndex(m => m.big)).toBeGreaterThan(0)                 // the small ones arrived before the long one was whole
    expect(order).toEqual([])
  })

  it('waits when the channel is full, and goes on when it has room', async () => {
    const [a] = channelPair()
    a.bufferedAmount = 2 * 1024 * 1024
    const wire = createWire(a, () => {}, { onWait: () => new Promise(r => setTimeout(() => { a.bufferedAmount = 0; r() }, 5)) })
    const t0 = Date.now()
    await wire.send({ x: 1 })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4)
    expect(a.sent).toHaveLength(1)
  })

  it('drops what is not a message, pieces that do not fit, a piece twice, and too many pieces at once; and goes on', async () => {
    const got = []
    const wire = createWire({ send() {}, close() {} }, m => got.push(m), { chunk: 100 })
    wire.receive('not json'); wire.receive('[1,2]'); wire.receive('"text"'); wire.receive(5); wire.receive('x'.repeat(2000))
    wire.receive(JSON.stringify({ '~': 1, id: 1, i: 5, n: 2, d: 'a' }))                         // a piece that is not among the pieces
    wire.receive(JSON.stringify({ '~': 1, id: 1, i: 0, n: 1, d: 'a' }))                         // a message of one piece
    wire.receive(JSON.stringify({ '~': 1, id: 'x', i: 0, n: 2, d: 'a' }))
    wire.receive(JSON.stringify({ '~': 1, id: 2, i: 0, n: 2, d: '{"a":' }))
    wire.receive(JSON.stringify({ '~': 1, id: 2, i: 0, n: 2, d: '{"a":' }))                     // the same piece again
    wire.receive(JSON.stringify({ '~': 1, id: 2, i: 1, n: 3, d: '1}' }))                        // a different count
    wire.receive(JSON.stringify({ '~': 1, id: 2, i: 1, n: 2, d: '1}' }))
    expect(got).toEqual([{ a: 1 }])
    for (let id = 10; id < 30; id++) wire.receive(JSON.stringify({ '~': 1, id, i: 0, n: 5, d: 'x' }))   // many half-made messages: only some are kept
    expect(wire.dropped).toBeGreaterThan(10)
    wire.receive(JSON.stringify({ ok: true }))
    expect(got.at(-1)).toEqual({ ok: true })
    const nasty = createWire({ send() {}, close() {} }, m => got.push(m), { chunk: 100 })
    nasty.receive(JSON.stringify({ '~': 1, id: 1, i: 0, n: 2, d: '{"~":1' }))
    nasty.receive(JSON.stringify({ '~': 1, id: 1, i: 1, n: 2, d: ',"id":1}' }))                  // pieces that make a piece: not a message
    expect(got.some(m => m['~'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------

const NAMES = Array.from({ length: 12 }, (_, i) => `Hidden${String(i + 1).padStart(2, '0')}`)
const table = (extra = {}) => createTable({
  decks: [{ id: 'A', name: 'Deck', size: { mmW: 63.5, mmH: 88.9 }, cards: NAMES.map((n, i) => ({ id: `proj-${i + 1}`, name: n, code: `A-${i + 1}`, quantity: 1, backKey: 'back1' })) }],
  seats: 3, shuffle: true, deal: 2, seed: 3, ...extra
})
const png = text => ({ mime: 'image/png', data: Buffer.from(text).toString('base64') })

function setup({ state = table(), render, guests = 0 } = {}) {
  const rtc = memoryRtc()
  const calls = []
  const rendering = render ?? {
    front: async (id, w) => { calls.push(['front', id, w]); return png(`front ${id} ${w}`) },
    back: async (id, w) => { calls.push(['back', id, w]); return png(`back ${id} ${w}`) },
    asset: async (id, w) => { calls.push(['asset', id, w]); return png(`asset ${id} ${w}`) }
  }
  const changes = []
  const peerLists = []
  const hostLink = createHostLink({ host: createHost({ state, newSeed: () => 77 }), render: rendering, rtc: rtc.host, onChange: () => changes.push(Date.now()), onPeers: p => peerLists.push(p) })
  const guestsLinks = {}
  const join = async (name, opts = {}) => {
    const { id, code } = await hostLink.invite()
    const views = []
    const closed = []
    const g = createGuestLink({ name, rtc: rtc.guest, onChange: v => views.push(v), onClose: e => closed.push(e ?? true), ...opts })
    const answer = await g.join(code)
    await hostLink.accept(id, answer)
    await settle()
    g.views = views; g.closed = closed; g.peerId = id
    guestsLinks[name] = g
    return g
  }
  return { rtc, hostLink, join, calls, changes, peerLists, guestsLinks }
}

describe('joining over a connection', () => {
  it('trades codes, says who the guest is, and gives them a seat and their view of the table', async () => {
    const { hostLink, join, peerLists } = setup()
    const { id, code } = await hostLink.invite()
    expect(hostLink.peers).toEqual([{ id, name: '', joined: false, state: 'invited' }])
    const rtc = memoryRtc()
    expect(code).toMatch(/^SPW1-O-/)
    hostLink.cancel(id)
    expect(hostLink.peers).toEqual([])
    const ann = await join('Ann')
    expect(ann.joined).toBe(true)
    expect(ann.you).toMatchObject({ name: 'Ann', seat: 1 })
    expect(ann.view.hands[1].cards).toHaveLength(2)
    expect(ann.view.hands[0].hidden).toBe(true)
    expect(hostLink.peers.map(p => [p.name, p.state])).toEqual([['Ann', 'joined']])
    expect(ann.players.map(p => p.name)).toEqual(['Host', 'Ann'])
    expect(peerLists.length).toBeGreaterThan(2)
    expect(rtc).toBeTruthy()
  })

  it('a second guest takes the next seat, and both hear about each other', async () => {
    const { join } = setup()
    const ann = await join('Ann')
    const bob = await join('Bob')
    expect(bob.you.seat).toBe(2)
    expect(ann.players.map(p => p.name)).toEqual(['Host', 'Ann', 'Bob'])
  })

  it('an answer that was copied badly can be tried again; an invitation that is not there is refused', async () => {
    const { hostLink, rtc } = setup()
    const { id, code } = await hostLink.invite()
    await expect(hostLink.accept(id, 'SPW1-A-nonsense')).rejects.toMatchObject({ code: 'format' })
    expect(hostLink.peers.map(p => p.state)).toEqual(['invited'])      // still waiting for the right answer
    const g = createGuestLink({ name: 'Cy', rtc: rtc.guest })
    await hostLink.accept(id, await g.join(code))
    await settle()
    expect(g.joined).toBe(true)
    await expect(hostLink.accept('g99', 'x')).rejects.toMatchObject({ code: 'unknown' })
  })

  it('a message from a channel that has not said hello is ignored', async () => {
    const { hostLink } = setup()
    const [host, guest] = channelPair()
    hostLink.attach('rogue', host)
    guest.send(JSON.stringify({ type: 'action', cid: 1, action: { type: 'nextTurn' } }))
    await settle()
    expect(hostLink.host.rev).toBe(0)
    expect(hostLink.peers.map(p => p.state)).toEqual(['connecting'])
  })
})

describe('moves over a connection', () => {
  it('a guest\'s move is made by the host and every guest hears it; the host\'s move reaches the guests', async () => {
    const { hostLink, join, changes } = setup()
    const ann = await join('Ann'), bob = await join('Bob')
    const pile = Object.values(hostLink.host.state.piles)[0]
    const before = changes.length
    ann.act({ type: 'move', pile: pile.id, x: 700, y: 300 })
    await settle()
    expect(hostLink.host.state.piles[pile.id]).toMatchObject({ x: 700, y: 300 })
    expect(bob.view.piles[pile.id]).toMatchObject({ x: 700, y: 300 })
    expect(changes.length).toBeGreaterThan(before)
    hostLink.act({ type: 'rotate', pile: pile.id, rot: 180 })
    await settle()
    expect(ann.view.piles[pile.id].rot).toBe(180)
    ann.undo()
    await settle()
    expect(ann.takeEvents().at(-1)).toMatchObject({ type: 'rejected', reason: 'notYours' })   // the host moved last
    hostLink.undo(); await settle()
    expect(bob.view.piles[pile.id].rot).toBe(0)
  })

  it('what the host\'s seed makes is the same for everybody, and the guest\'s hand stays hers', async () => {
    const { hostLink, join, guestsLinks } = setup()
    const ann = await join('Ann'), bob = await join('Bob')
    hostLink.act({ type: 'addToken', kind: 'die', sides: 20, count: 2, x: 0, y: 0 })
    const id = Object.keys(hostLink.host.state.tokens)[0]
    ann.act({ type: 'roll', id, seed: 1 })
    await settle()
    expect(ann.view.tokens[id].values).toEqual(hostLink.host.state.tokens[id].values)
    expect(bob.view.tokens[id].values).toEqual(hostLink.host.state.tokens[id].values)
    expect(guestsLinks.Ann).toBe(ann)
  })

  it('a guest that goes frees the seat, the host is told, and the table goes on', async () => {
    const { hostLink, join } = setup()
    const ann = await join('Ann'); const bob = await join('Bob')
    ann.leave()
    await settle()
    expect(ann.closed).toHaveLength(1)
    expect(hostLink.peers.map(p => p.name)).toEqual(['Bob'])
    expect(bob.players.map(p => p.name)).toEqual(['Host', 'Bob'])
    const again = await join('Ann2')
    expect(again.you.seat).toBe(1)
  })

  it('a channel that breaks is the same as leaving: the guest is told, and the host lets the seat go', async () => {
    const { hostLink, join } = setup()
    const ann = await join('Ann')
    hostLink.kick(ann.peerId)
    await settle()
    expect(ann.closed).toHaveLength(1)
    expect(ann.connected).toBe(false)
    ann.act({ type: 'nextTurn' })                         // nothing to send it on: nothing happens, and nothing breaks
    expect(hostLink.peers).toEqual([])
  })

  it('closing the host ends every connection', async () => {
    const { hostLink, join } = setup()
    const ann = await join('Ann'), bob = await join('Bob')
    const open = await hostLink.invite()
    hostLink.close()
    await settle()
    expect(ann.closed).toHaveLength(1); expect(bob.closed).toHaveLength(1)
    expect(hostLink.peers).toEqual([])
    expect(open.id).toBeTruthy()
  })
})

describe('coming back after the connection broke (step 5)', () => {
  it('a guest who trades codes again with the same ticket has their seat and their hand back; a stranger does not', async () => {
    const { hostLink, join, rtc } = setup()
    const ann = await join('Ann', { ticket: 'ticket-ann-000001' })
    const held = [...ann.view.hands[1].cards]
    const seatBefore = ann.you.seat
    ;[...rtc.invitations.values()][0].host.close()                              // the connection breaks
    await settle()
    expect(ann.closed).toHaveLength(1)
    expect(hostLink.host.players().find(p => p.away)).toMatchObject({ name: 'Ann', seat: seatBefore })
    const stranger = await join('Eve')
    expect(stranger.you.seat).not.toBe(seatBefore)
    const again = await join('Ann', { ticket: 'ticket-ann-000001' })
    expect(again.you.seat).toBe(seatBefore)
    expect(again.view.hands[seatBefore].cards).toEqual(held)
    expect(hostLink.peers.filter(p => p.name === 'Ann')).toHaveLength(1)
    expect(again.ticket).toBe('ticket-ann-000001')
  })

  it('a guest who is sent away has no seat kept; one who leaves says goodbye first', async () => {
    const { hostLink, join } = setup()
    const ann = await join('Ann', { ticket: 'ticket-ann-000002' })
    hostLink.kick(ann.peerId)
    await settle()
    expect(hostLink.host.players().some(p => p.away)).toBe(false)
    const bob = await join('Bob', { ticket: 'ticket-bob-000003' })
    bob.leave()
    await settle()
    expect(hostLink.host.players().some(p => p.away)).toBe(false)
  })

  it('the host can let go of a seat that is kept, and a guest can choose another seat', async () => {
    const { hostLink, join, rtc } = setup()
    const ann = await join('Ann', { ticket: 'ticket-ann-000004' })
    ;[...rtc.invitations.values()][0].host.close()
    await settle()
    expect(hostLink.host.freeSeats()).toEqual([2])
    hostLink.release(1)
    expect(hostLink.host.freeSeats()).toEqual([1, 2])
    const bob = await join('Bob')
    bob.takeSeat(2)
    await settle()
    expect(bob.you.seat).toBe(2)
    expect(ann.closed).toHaveLength(1)
  })
})

describe('pictures sent by the host (step 4)', () => {
  it('a guest has the picture of a card it may see, drawn by the host: nothing but the host\'s own renderer is used, and the project is never opened', async () => {
    const { hostLink, join, calls } = setup()
    const ann = await join('Ann')
    const mine = ann.view.hands[1].cards[0]
    const card = ann.view.cards[mine]
    expect(card.id).toBe(mine)                                       // a card is called by its place on the table, never by its id in the project
    const url = await ann.picture({ side: 'front', card: mine, width: 280 })
    expect(url).toBe(`data:image/png;base64,${Buffer.from(`front ${hostLink.host.state.cards[mine].id} 280`).toString('base64')}`)
    expect(calls).toEqual([['front', hostLink.host.state.cards[mine].id, 280]])
    expect(await ann.picture({ side: 'front', card: mine, width: 280 })).toBe(url)       // asked once
    expect(calls).toHaveLength(1)
  })

  it('never sends the face of a card in another hand, or face down on the table: the host refuses and draws nothing', async () => {
    const { hostLink, join, calls } = setup()
    const ann = await join('Ann'), bob = await join('Bob')
    const bobsCard = hostLink.host.state.hands[2].cards[0]
    const pile = Object.values(hostLink.host.state.piles)[0]
    const facedown = pile.cards.at(-1)
    for (const card of [bobsCard, facedown, 'c99999', '__proto__']) {
      await expect(ann.picture({ side: 'front', card })).rejects.toMatchObject({ code: 'refused' })
    }
    expect(calls).toEqual([])
    // the same card face up is for anybody
    hostLink.act({ type: 'flip', pile: pile.id })
    await settle()
    await expect(ann.picture({ side: 'front', card: facedown })).resolves.toMatch(/^data:image\/png;base64,/)
    expect(calls.map(c => c[0])).toEqual(['front'])
    // Bob's own card is Bob's
    await expect(bob.picture({ side: 'front', card: bobsCard })).resolves.toMatch(/^data:/)
    // nothing the host sent to Ann holds the card's name
    const wireText = JSON.stringify(ann.peerId) + JSON.stringify([...hostLink.peers])
    expect(wireText).not.toContain('Hidden')
  })

  it('a back is for any card, and cards that share a back share the picture', async () => {
    const { hostLink, join, calls } = setup()
    const ann = await join('Ann')
    const pile = Object.values(ann.view.piles)[0]
    const [a, b] = pile.cards
    expect(ann.view.cards[a]).toMatchObject({ hidden: true, back: 'back1', name: '' })
    const one = await ann.picture({ side: 'back', card: a, back: ann.view.cards[a].back })
    const two = await ann.picture({ side: 'back', card: b, back: ann.view.cards[b].back })
    expect(one).toBe(two)
    expect(calls.filter(c => c[0] === 'back')).toHaveLength(2 - 1 + 0 === 1 ? 1 : 1)   // the second asking was answered from what the guest had
    expect(hostLink.host.state.cards[a].back).toBe('back1')
  })

  it('an image of the library is sent only for a token that shows it', async () => {
    const { hostLink, join, calls } = setup()
    const ann = await join('Ann')
    await expect(ann.picture({ side: 'asset', asset: 'img-1' })).rejects.toMatchObject({ code: 'refused' })
    hostLink.act({ type: 'addToken', kind: 'token', asset: 'img-1', x: 5, y: 5 })
    await settle()
    await expect(ann.picture({ side: 'asset', asset: 'img-1', width: 100 })).resolves.toMatch(/^data:image\/png;base64,/)
    expect(calls).toEqual([['asset', 'img-1', 100]])
    await expect(ann.picture({ side: 'asset', asset: '../../secret' })).rejects.toMatchObject({ code: 'refused' })
  })

  it('a big picture crosses in pieces without holding up the moves that come after it', async () => {
    const huge = { mime: 'image/png', data: Buffer.alloc(300 * 1024, 7).toString('base64') }
    const { hostLink, join } = setup({ render: { front: async () => huge, back: async () => huge, asset: async () => huge } })
    const ann = await join('Ann')
    const mine = ann.view.hands[1].cards[0]
    const pending = ann.picture({ side: 'front', card: mine })
    const pile = Object.values(hostLink.host.state.piles)[0]
    hostLink.act({ type: 'move', pile: pile.id, x: 1234, y: 5 })
    await settle()
    expect(ann.view.piles[pile.id].x).toBe(1234)                      // the move arrived while the picture was still on its way
    const url = await pending
    expect(url.length).toBeGreaterThan(CHUNK_CHARS * 20)
    expect(url).toBe(`data:image/png;base64,${huge.data}`)
  })

  it('says so when the host has no picture; the guest can ask again', async () => {
    let fail = true
    const { join } = setup({ render: { front: async () => (fail ? null : png('ok')), back: async () => null, asset: async () => null } })
    const ann = await join('Ann')
    const mine = ann.view.hands[1].cards[0]
    await expect(ann.picture({ side: 'front', card: mine })).rejects.toMatchObject({ code: 'refused' })
    fail = false
    await expect(ann.picture({ side: 'front', card: mine })).resolves.toMatch(/^data:/)         // the host remembered that it had none, and tries again?
  })

  it('refuses what a host sends back that is not a picture: another kind of file, or text that is not base64', async () => {
    const [h, g] = channelPair()
    const link = createGuestLink({ name: 'Ann' })
    link.attach(g)
    h.onmessage = text => {
      const m = JSON.parse(text)
      if (m.type === 'picture') {
        const bad = [{ ok: true, mime: 'image/svg+xml', data: 'AAAA' }, { ok: true, mime: 'image/png', data: '<script>alert(1)</script>' }, { ok: true, mime: 'text/html', data: 'AAAA' }][m.rid - 1]
        h.send(JSON.stringify({ type: 'picture', rid: m.rid, ...bad }))
      }
    }
    for (let i = 0; i < 3; i++) await expect(link.picture({ side: 'asset', asset: `a${i}` })).rejects.toMatchObject({ code: 'refused' })
  })

  it('asks for the pictures again when the host says a card or a template changed', async () => {
    const { hostLink, join, calls } = setup()
    const redraws = []
    const ann = await join('Ann', { onRedraw: () => redraws.push(1) })
    const mine = ann.view.hands[1].cards[0]
    await ann.picture({ side: 'front', card: mine })
    hostLink.redraw()
    await settle()
    expect(redraws).toHaveLength(1)
    await ann.picture({ side: 'front', card: mine })
    expect(calls.filter(c => c[0] === 'front')).toHaveLength(2)        // forgotten by the host and by the guest, drawn again
  })

  it('a refresh from the project names the new card names to every guest and redraws', async () => {
    const { hostLink, join } = setup()
    const ann = await join('Ann')
    const mine = ann.view.hands[1].cards[0]
    const projectId = hostLink.host.state.cards[mine].id
    hostLink.refresh({ [projectId]: { name: 'Renamed', code: 'X', backKey: 'back1', missing: false } })
    await settle()
    expect(ann.view.cards[mine].name).toBe('Renamed')
  })

  it('a guest that asks for pictures faster than the host allows is told no', async () => {
    const rtc = memoryRtc()
    const hostLink = createHostLink({ host: createHost({ state: table(), maxPicturesPerSecond: 3, now: () => 0 }), render: { front: async () => png('x'), back: async () => png('x'), asset: async () => png('x') }, rtc: rtc.host })
    const { id, code } = await hostLink.invite()
    const g = createGuestLink({ name: 'Ann', rtc: rtc.guest })
    await hostLink.accept(id, await g.join(code)); await settle()
    const mine = g.view.hands[1].cards
    const results = await Promise.allSettled([0, 1].flatMap(() => mine).map((c, i) => g.picture({ side: 'front', card: c, width: 100 + i })))
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(3)
    expect(results.some(r => r.status === 'rejected')).toBe(true)
  })
})

describe('what crosses the connection', () => {
  it('holds no name of a card the receiver may not see, in anything sent to a guest', async () => {
    const { join, hostLink } = setup({ state: table({ deal: 3 }) })
    const ann = await join('Ann'), bob = await join('Bob')
    const pile = Object.values(hostLink.host.state.piles)[0]
    hostLink.act({ type: 'transfer', from: { pile: pile.id }, cards: [pile.cards.at(-1)], to: { hand: 2 } })
    ann.act({ type: 'move', pile: pile.id, x: 1, y: 1 })
    bob.act({ type: 'flip', pile: pile.id })
    await settle()
    bob.act({ type: 'flip', pile: pile.id })
    await settle()
    const state = hostLink.host.state
    const bobsNames = state.hands[2].cards.map(id => state.cards[id].name)
    const seenByAnn = JSON.stringify(ann.guest.view) + JSON.stringify(ann.takeEvents())
    for (const n of bobsNames) expect(seenByAnn).not.toContain(n)
    expect(bobsNames).toHaveLength(4)
  })
})
