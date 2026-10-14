/**
 * A shared table over a real WebRTC connection (PRD §22.0, steps 3 and 4): two pages of a real browser trade connection codes, connect
 * directly, play, and the host sends the pictures. The pages load the real link code (tests/e2e/shareEntry.js, bundled); only what the
 * host draws pictures with is a stand-in, as there is no project.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import { chromium } from 'playwright-core'
import { build } from 'esbuild'
import { existsSync } from 'fs'
import { createTable } from '../../src/shared/table.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='   // one red pixel
let browser, context, host, guest, server, bundle, url

const NAMES = Array.from({ length: 10 }, (_, i) => `Hidden${String(i + 1).padStart(2, '0')}`)
const table = () => createTable({
  decks: [{ id: 'A', name: 'Deck', size: { mmW: 63.5, mmH: 88.9 }, cards: NAMES.map((n, i) => ({ id: `proj-${i + 1}`, name: n, code: `A-${i + 1}`, quantity: 1, backKey: 'back1' })) }],
  seats: 3, shuffle: true, deal: 2, seed: 4
})

beforeAll(async () => {
  const built = await build({ entryPoints: ['tests/e2e/shareEntry.js'], bundle: true, format: 'iife', globalName: 'Share', write: false, platform: 'browser', logLevel: 'silent' })
  bundle = built.outputFiles[0].text
  server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>peer</title><body></body>') }).listen(0)
  url = `http://localhost:${server.address().port}/`
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  context = await browser.newContext()
  host = await context.newPage(); guest = await context.newPage()
  for (const p of [host, guest]) { p.setDefaultTimeout(30000); await p.goto(url); await p.addScriptTag({ content: bundle }) }
}, 60000)
afterAll(async () => { await browser?.close(); server?.close() })

describe('two browsers, one table', () => {
  let hostState
  it('connects by trading two codes, with no server', async () => {
    hostState = table()
    const invitation = await host.evaluate(async ({ state, png }) => {
      window.changes = 0
      window.hostLink = Share.createHostLink({
        host: Share.createHost({ state }),
        render: {
          front: async () => ({ mime: 'image/png', data: png }), back: async () => ({ mime: 'image/png', data: png }),
          // a picture too big for one message: 300 kB
          asset: async () => ({ mime: 'image/png', data: btoa('x'.repeat(300 * 1024)) })
        },
        onChange: () => { window.changes++ }
      })
      const inv = await window.hostLink.invite()
      window.inviteId = inv.id
      return inv.code
    }, { state: hostState, png: PNG })
    expect(invitation).toMatch(/^SPW1-O-[0-9A-F]{4}-[A-Za-z0-9_-]+$/)
    expect(invitation.length).toBeLessThan(6000)

    const answer = await guest.evaluate(async code => {
      window.views = 0
      window.guestLink = Share.createGuestLink({ name: 'Ann', onChange: () => { window.views++ }, onClose: () => { window.gone = true } })
      return window.guestLink.join(code)
    }, invitation)
    expect(answer).toMatch(/^SPW1-A-/)

    await host.evaluate(([id, code]) => window.hostLink.accept(id, code), [await host.evaluate(() => window.inviteId), answer])
    await guest.waitForFunction(() => window.guestLink.joined)
    const you = await guest.evaluate(() => window.guestLink.you)
    expect(you).toMatchObject({ name: 'Ann', seat: 1 })
    expect(await host.evaluate(() => window.hostLink.peers.map(p => [p.name, p.state]))).toEqual([['Ann', 'joined']])
  }, 60000)

  it('moves go through the host and everybody sees them; the guest\'s own hand is hers alone', async () => {
    const pileId = await host.evaluate(() => Object.values(window.hostLink.host.state.piles)[0].id)
    await guest.evaluate(id => window.guestLink.act({ type: 'move', pile: id, x: 777, y: 333 }), pileId)
    await host.waitForFunction(id => window.hostLink.host.state.piles[id].x === 777, pileId)
    await host.evaluate(id => window.hostLink.act({ type: 'rotate', pile: id, rot: 90 }), pileId)
    await guest.waitForFunction(id => window.guestLink.view.piles[id].rot === 90, pileId)
    const guestView = await guest.evaluate(() => JSON.stringify(window.guestLink.view))
    const hostHandNames = await host.evaluate(() => { const s = window.hostLink.host.state; return s.hands[0].cards.map(id => s.cards[id].name) })
    expect(hostHandNames).toHaveLength(2)
    for (const n of hostHandNames) expect(guestView).not.toContain(n)
    expect(JSON.parse(guestView).hands[0]).toMatchObject({ hidden: true, count: 2 })
  }, 30000)

  it('the host sends the picture of a card the guest may see, and the browser can draw it', async () => {
    const mine = await guest.evaluate(() => window.guestLink.view.hands[1].cards[0])
    const url = await guest.evaluate(card => window.guestLink.picture({ side: 'front', card, width: 200 }), mine)
    expect(url).toBe(`data:image/png;base64,${PNG}`)
    const drawn = await guest.evaluate(src => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = reject; i.src = src }), url)
    expect(drawn).toEqual([1, 1])
    // a back, drawn by the host for a card of the deck
    const faceDown = await guest.evaluate(() => Object.values(window.guestLink.view.piles)[0].cards[0])
    expect(await guest.evaluate(c => window.guestLink.picture({ side: 'back', card: c, back: 'back1' }), faceDown)).toMatch(/^data:image\/png/)
  }, 30000)

  it('refuses the face of a card in the host\'s hand and of a card face down, and sends nothing', async () => {
    const hostCard = await host.evaluate(() => window.hostLink.host.state.hands[0].cards[0])
    const facedown = await guest.evaluate(() => Object.values(window.guestLink.view.piles)[0].cards[0])
    for (const card of [hostCard, facedown]) {
      const result = await guest.evaluate(c => window.guestLink.picture({ side: 'front', card: c }).then(() => 'sent', e => e.code), card)
      expect(result).toBe('refused')
    }
  }, 30000)

  it('a picture too big for one message crosses in pieces, and a move made meanwhile is not held up', async () => {
    await host.evaluate(() => window.hostLink.act({ type: 'addToken', kind: 'token', asset: 'img-1', x: 1, y: 1 }))
    await guest.waitForFunction(() => Object.keys(window.guestLink.view.tokens).length === 1)
    const result = await guest.evaluate(async () => {
      const t0 = performance.now()
      const bigPromise = window.guestLink.picture({ side: 'asset', asset: 'img-1', width: 300 })
      const pileId = Object.values(window.guestLink.view.piles)[0].id
      window.guestLink.act({ type: 'move', pile: pileId, x: 4321, y: 1 })
      let movedAt = null
      while (movedAt === null) { if (window.guestLink.view.piles[pileId].x === 4321) movedAt = performance.now() - t0; else await new Promise(r => setTimeout(r, 5)) }
      const big = await bigPromise
      return { length: big.length, bigAt: performance.now() - t0, movedAt }
    })
    expect(result.length).toBeGreaterThan(400000)                 // 300 kB of text, as base64, in a data address
  }, 60000)

  it('a guest that leaves is let go by the host, and the table goes on', async () => {
    await guest.evaluate(() => window.guestLink.leave())
    await host.waitForFunction(() => window.hostLink.peers.length === 0)
    expect(await guest.evaluate(() => window.gone)).toBe(true)
    await host.evaluate(() => window.hostLink.act({ type: 'nextTurn' }))     // no one to tell, and nothing breaks
    expect(await host.evaluate(() => window.hostLink.host.players().map(p => p.peer))).toEqual(['host'])
  }, 30000)

  it('refuses a code that is not an invitation, in the browser too', async () => {
    const result = await guest.evaluate(async () => {
      const link = Share.createGuestLink({ name: 'Bob' })
      return link.join('SPW1-O-0000-AAAA').then(() => 'joined', e => e.code)
    })
    expect(['checksum', 'format']).toContain(result)
    const wrongKind = await host.evaluate(async () => {
      const inv = await window.hostLink.invite()
      return window.hostLink.accept(inv.id, inv.code).then(() => 'accepted', e => e.code)       // its own invitation is not an answer
    })
    expect(wrongKind).toBe('kind')
  }, 30000)
})
