/** PRD §10.2.2–§10.2.4: a deck per set in the game, the size of the real card, and Steam Cloud links. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const template = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#336699"/><text x="20" y="80" font-size="48" fill="#ffffff">{{name}}</text></svg>'
const cards = (n, p) => Array.from({ length: n }, (_, i) => ({ name: `${p}${i + 1}`, fields: { name: `${p}${i + 1}` } }))
const make = (name, n, extra = {}) => seedSet({ name, fields: [{ name: 'Name', type: 'text' }], cards: cards(n, name[0]), template: { svg: template }, ...extra })
const out = () => join(ctx.root, 'out')
const docOf = file => JSON.parse(readFileSync(join(out(), file), 'utf8'))

describe('decks in the game', () => {
  it('makes a face-down deck for each set, as wide as the real card, side by side', async () => {
    const a = await make('Alpha', 3), b = await make('Beta', 4)
    const res = await invoke('export:tts', { setIds: [a.set.id, b.set.id], outputDir: out() })
    expect(res.deckCount).toBe(2)
    const states = docOf('alpha_beta.json').ObjectStates
    expect(states.map(s => s.Name)).toEqual(['Deck', 'Deck'])
    expect(states.map(s => s.Nickname)).toEqual(['Alpha', 'Beta'])
    expect(states.map(s => s.DeckIDs.length)).toEqual([3, 4])
    for (const s of states) {
      expect(s.Transform).toMatchObject({ rotY: 180, rotZ: 180, scaleX: 1.13636363636, scaleZ: 1.13636363636 })
      expect(s.ContainedObjects.every(c => c.Transform.rotZ === 180)).toBe(true)
      expect(s).toMatchObject({ Description: '', LuaScript: '' })
    }
    expect(states[0].Transform.posX).not.toBe(states[1].Transform.posX)
    // each deck's cards are drawn from sheets of its own
    expect(Object.keys(states[0].CustomDeck)).not.toEqual(Object.keys(states[1].CustomDeck))
  })

  it('scales a deck of bigger cards up, and writes a sheet that fits the grid it says', async () => {
    const t = await make('Tall', 2, { cardSize: 'tarot' })
    const res = await invoke('export:tts', { setIds: [t.set.id], outputDir: out() })
    const deck = docOf('tall.json').ObjectStates[0]
    expect(deck.Transform.scaleX).toBeCloseTo(120 / 78.232, 5)        // the game fixes a card's height, so the scale follows the height
    const sheet = deck.CustomDeck['1']
    const meta = await sharp(join(out(), 'tall_face.png')).metadata()
    expect(meta.width % sheet.NumWidth).toBe(0)
    expect(meta.height % sheet.NumHeight).toBe(0)
    expect(meta.width).toBeLessThanOrEqual(4096)
    expect(res.grid.cols).toBe(sheet.NumWidth)
  })

  it('gives every set the shape of its own cards when sets of two sizes are exported together', async () => {
    const tall = await make('Tall', 2, { cardSize: 'tarot' })      // the first set is the tall one: it must not decide for the others
    const small = await make('Small', 3)
    await invoke('export:tts', { setIds: [tall.set.id, small.set.id], outputDir: out() })
    const states = docOf('tall_small.json').ObjectStates
    const [t, p] = states
    expect(t.Transform.scaleX).toBeCloseTo(120 / 78.232, 5)
    expect(p.Transform.scaleX).toBeCloseTo(88.9 / 78.232, 5)         // poker is poker-tall (1.13636), tarot is taller (1.534)
    expect(t.Transform.scaleX).toBeGreaterThan(p.Transform.scaleX)
    for (const [deck, aspect] of [[t, 70 / 120], [p, 63.5 / 88.9]]) {
      const [num, sheet] = Object.entries(deck.CustomDeck)[0]
      const file = decodeURI(sheet.FaceURL.slice('file:///'.length))
      const meta = await sharp(file).metadata()
      const cell = (meta.width / sheet.NumWidth) / (meta.height / sheet.NumHeight)
      expect(cell, 'deck ' + num).toBeCloseTo(aspect, 2)             // the game shapes the card like this cell
    }
    // no bars: the corner of the first poker card is the card's own colour
    const pf = decodeURI(Object.values(p.CustomDeck)[0].FaceURL.slice('file:///'.length))
    const { data, info } = await sharp(pf).raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 3)]).toEqual([0x33, 0x66, 0x99])
    expect(info.width).toBeGreaterThan(0)
  })

  it('writes a deck of one card as a card', async () => {
    const s = await make('Solo', 1)
    await invoke('export:tts', { setIds: [s.set.id], outputDir: out() })
    const obj = docOf('solo.json').ObjectStates[0]
    expect(obj).toMatchObject({ Name: 'Card', CardID: 100 })
    expect(obj.CustomDeck['1'].FaceURL).toMatch(/^file:/)
    expect(obj.DeckIDs).toBeUndefined()
  })

  it('gives every card id a distinct sheet position and no two sets share a deck number', async () => {
    const a = await make('Alpha', 60), b = await make('Beta', 5)
    await invoke('export:tts', { setIds: [a.set.id, b.set.id], outputDir: out() })
    const states = docOf('alpha_beta.json').ObjectStates
    const ids = states.flatMap(s => s.DeckIDs ?? [s.CardID])
    expect(new Set(ids).size).toBe(ids.length)
    const decks = states.flatMap(s => Object.keys(s.CustomDeck))
    expect(new Set(decks).size).toBe(decks.length)
  })
})

describe('Steam Cloud links', () => {
  it('lists the pictures to upload and keeps the first JSON loadable on this computer', async () => {
    const s = await make('Base', 3)
    const res = await invoke('export:tts', { setIds: [s.set.id], outputDir: out(), imageLinks: 'cloud' })
    expect(res.imageLinks).toBe('cloud')
    expect([...res.cloudFiles].sort()).toEqual(['base_back.png', 'base_face.png'])
    expect(docOf('base.json').ObjectStates[0].CustomDeck['1'].FaceURL).toMatch(/^file:/)
    expect([...(await invoke('export:tts-cloud-files', { jsonFile: res.jsonFile }))].sort()).toEqual(['base_back.png', 'base_face.png'])
  })

  it('writes the pasted addresses into a _cloud copy and can be done again', async () => {
    const s = await make('Base', 3)
    const res = await invoke('export:tts', { setIds: [s.set.id], outputDir: out(), imageLinks: 'cloud' })
    const first = await invoke('export:tts-cloud-links', { jsonFile: res.jsonFile, links: { 'base_face.png': 'http://cloud/f1' } })
    expect(first.file).toBe(join(out(), 'base_cloud.json'))
    expect(first.missing).toEqual(['base_back.png'])
    const second = await invoke('export:tts-cloud-links', { jsonFile: res.jsonFile, links: { 'base_face.png': 'http://cloud/f2', 'base_back.png': 'http://cloud/b2' } })
    expect(second.missing).toEqual([])
    const deck = docOf('base_cloud.json').ObjectStates[0]
    expect(deck.CustomDeck['1']).toMatchObject({ FaceURL: 'http://cloud/f2', BackURL: 'http://cloud/b2' })
    expect(deck.ContainedObjects[0].CustomDeck['1'].FaceURL).toBe('http://cloud/f2')
    expect(docOf('base.json').ObjectStates[0].CustomDeck['1'].FaceURL).toMatch(/^file:/)   // the export itself is untouched
    expect(existsSync(join(out(), 'base_face.png'))).toBe(true)
  })

  it('refuses nothing-to-write, a bad address and a missing file', async () => {
    const s = await make('Base', 3)
    const res = await invoke('export:tts', { setIds: [s.set.id], outputDir: out(), imageLinks: 'cloud' })
    await expect(invoke('export:tts-cloud-links', { jsonFile: res.jsonFile, links: {} })).rejects.toThrow(/at least one/)
    await expect(invoke('export:tts-cloud-links', { jsonFile: res.jsonFile, links: { 'base_face.png': 'not a link' } })).rejects.toThrow(/web address/)
    await expect(invoke('export:tts-cloud-links', { jsonFile: join(out(), 'nope.json'), links: {} })).rejects.toThrow(/not found/)
  })
})
