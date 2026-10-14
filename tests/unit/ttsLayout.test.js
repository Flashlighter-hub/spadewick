import { describe, it, expect } from 'vitest'
import { sheetLayout, rowsFor, deckScale, placeDecks } from '../../src/main/ttsLayout.js'
import { applyCloudLinks, ttsImageFiles, linkFileName } from '../../src/main/ttsCloud.js'

describe('TTS sheet layout (PRD §10.2.2)', () => {
  it('gives poker cards the 8 × 6 grid of 512 px cells that Dextrous writes', () => {
    expect(sheetLayout(750, 1050)).toMatchObject({ cols: 8, rows: 6, cellW: 512, cellH: 717, perSheet: 47 })
  })
  it('gives tall cards 7 columns and fewer rows', () => {
    expect(sheetLayout(700, 1200)).toMatchObject({ cols: 7, rows: 4, cellW: 585 })
  })
  it('never scales a card up, and keeps its shape', () => {
    expect(sheetLayout(50, 70)).toMatchObject({ cols: 8, cellW: 50, cellH: 70, rows: 7, perSheet: 55 })
  })
  it('keeps every sheet inside the width and height limits', () => {
    for (const [w, h] of [[750, 1050], [700, 1200], [1000, 1000], [1400, 900], [300, 1500]]) {
      const l = sheetLayout(w, h)
      expect(l.cols * l.cellW).toBeLessThanOrEqual(4096)
      expect(l.rows).toBeLessThanOrEqual(7)
      expect(l.rows * l.cellH <= 4400 || l.rows === 1).toBe(true)
    }
  })
  it('uses only the rows a sheet needs, keeping the last slot for the back', () => {
    const l = sheetLayout(750, 1050)
    expect(rowsFor(l, 3)).toBe(1)
    expect(rowsFor(l, 7)).toBe(1)      // 7 cards + the back fill 8 slots
    expect(rowsFor(l, 8)).toBe(2)
    expect(rowsFor(l, 47)).toBe(6)
  })
  it('scales a deck to its physical height: poker is 1.13636, tarot 1.534 (as in Dextrous decks)', () => {
    expect(deckScale(88.9)).toBe(1.13636363636)
    expect(deckScale(120)).toBeCloseTo(1.5339, 3)
    expect(deckScale(127)).toBeCloseTo(1.623, 3)
  })
  it('puts decks side by side, then in a new row, without overlap', () => {
    const sizes = Array.from({ length: 12 }, () => ({ scale: 1.13636, aspect: 0.714 }))
    const places = placeDecks(sizes)
    expect(places).toHaveLength(12)
    expect(places[1].x).toBeGreaterThan(places[0].x)
    expect(new Set(places.map(p => p.z)).size).toBeGreaterThan(1)
    expect(new Set(places.map(p => `${p.x},${p.z}`)).size).toBe(12)
  })
})

describe('Steam Cloud links (PRD §10.2.4)', () => {
  const sheet = () => ({ FaceURL: 'file:///C:/My Game/a_face.png', BackURL: 'file:///C:/My Game/a_back.png' })
  const doc = () => ({ ObjectStates: [{ Name: 'Deck', CustomDeck: { 1: sheet() }, ContainedObjects: [{ CustomDeck: { 1: sheet() } }] }] })

  it('reads the file name out of a link, undoing the three escapes', () => {
    expect(linkFileName('file:///C:/x/a%25b%23c%3Fd.png')).toBe('a%b#c?d.png')
    expect(linkFileName('plain.png')).toBe('plain.png')
  })
  it('lists each picture to upload once', () => { expect(ttsImageFiles(doc())).toEqual(['a_face.png', 'a_back.png']) })
  it('replaces every link to a picture, in the deck and in its cards, and leaves the original alone', () => {
    const d = doc()
    const { doc: out, replaced, missing } = applyCloudLinks(d, { 'a_face.png': 'http://cloud-3.steamusercontent.com/ugc/1/AA/', 'a_back.png': ' https://cloud.example/b ' })
    expect(replaced).toBe(4)
    expect(missing).toEqual([])
    expect(out.ObjectStates[0].CustomDeck[1]).toEqual({ FaceURL: 'http://cloud-3.steamusercontent.com/ugc/1/AA/', BackURL: 'https://cloud.example/b' })
    expect(out.ObjectStates[0].ContainedObjects[0].CustomDeck[1].FaceURL).toBe('http://cloud-3.steamusercontent.com/ugc/1/AA/')
    expect(d.ObjectStates[0].CustomDeck[1].FaceURL).toMatch(/^file:/)
  })
  it('reports pictures that were given no address, and rejects an address that is not a web address', () => {
    expect(applyCloudLinks(doc(), { 'a_face.png': 'http://x/y' }).missing).toEqual(['a_back.png'])
    expect(() => applyCloudLinks(doc(), { 'a_face.png': 'C:\\nope.png' })).toThrow(/a_face\.png/)
  })
})
