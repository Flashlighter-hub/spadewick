/** Manufacturer presets (PRD §18.5): every shipped preset passes the schema check, and the arithmetic of the format. */
import { describe, it, expect } from 'vitest'
import { SHIPPED } from '../../src/main/presets/shipped.js'
import { validatePreset, pixelsFor, isStale, ageDays, duplicate, deckProblem, PRESET_FORMAT } from '../../src/shared/presets.js'
import { CARD_SIZE_BY_ID } from '../../src/shared/cardSizes.js'

describe('the shipped presets', () => {
  it('are nine, with unique ids', () => {
    expect(SHIPPED).toHaveLength(9)
    expect(new Set(SHIPPED.map(p => p.id)).size).toBe(9)
  })

  it.each(SHIPPED.map(p => [p.id, p]))('%s passes the schema check', (_id, p) => {
    expect(validatePreset(p)).toEqual([])
  })

  it('state a pixel size that is the trim plus twice the bleed at the resolution (PRD §18.5)', () => {
    for (const p of SHIPPED.filter(x => x.pixels)) {
      expect(p.pixels.width).toBe(pixelsFor(p.pixels.forTrimMmW, p.bleedMm, p.dpi))
      expect(p.pixels.height).toBe(pixelsFor(p.pixels.forTrimMmH, p.bleedMm, p.dpi))
    }
    // the numbers the manufacturers state
    const by = id => SHIPPED.find(p => p.id === id).pixels
    expect(by('tgc-poker')).toMatchObject({ width: 825, height: 1125 })
    expect(by('mpc-poker')).toMatchObject({ width: 822, height: 1122 })
    expect(by('dtc-poker')).toMatchObject({ width: 825, height: 1125 })
  })

  it('name only sizes that exist, are all unproven, say when they were read, and mark what was not stated', () => {
    for (const p of SHIPPED) {
      for (const s of p.sizes ?? []) expect(CARD_SIZE_BY_ID[s]).toBeTruthy()
      expect(p.proofTested).toBe(false)
      expect(p.checkedOn).toBe('2026-10-02')
    }
    expect(SHIPPED.find(p => p.id === 'printninja').verify).toEqual(expect.arrayContaining(['bleed', 'safe']))
    expect(SHIPPED.find(p => p.id === 'generic-offset-metric').verify).toEqual([])
  })

  it('carry the rules the PRD gives: Panda wants pure K and its profile, Longpack a rich black, the generic ones 3 mm and 1/8 in', () => {
    const by = id => SHIPPED.find(p => p.id === id)
    expect(by('panda-cards')).toMatchObject({ bleedMm: 3, safeMm: 3, profileHint: 'U.S. Sheetfed Uncoated v2', rules: { pureBlackText: true, overprintBlack: true }, colour: 'cmyk' })
    expect(by('longpack-cards').rules.richBlack).toEqual({ c: 40, m: 0, y: 0, k: 100 })
    expect(by('generic-offset-metric')).toMatchObject({ bleedMm: 3, safeMm: 3, dpi: 300, standard: 'x4' })
    expect(by('generic-print-us')).toMatchObject({ bleedMm: 3.175, safeMm: 3.175, kind: 'both' })
  })
})

describe('the schema check', () => {
  const ok = SHIPPED[7]
  it('names what is wrong', () => {
    expect(validatePreset(null)).toEqual(['not an object'])
    const bad = { ...ok, format: 2, id: 'Bad Id', name: '', checkedOn: 'yesterday', kind: 'x', bleedMm: -1, safeMm: 21, dpi: 10, colour: 'lab', standard: 'x3', backLayout: 'x', die: { mode: 'x', radiusMm: 0 }, verify: ['nonsense'], proofTested: 'no', notes: 5 }
    expect(validatePreset(bad)).toEqual(expect.arrayContaining(['format', 'id', 'name', 'checkedOn', 'kind', 'bleedMm', 'safeMm', 'dpi', 'colour', 'standard', 'backLayout', 'die', 'verify', 'proofTested', 'notes']))
    expect(validatePreset({ ...ok, guideUrl: 'javascript:alert(1)' })).toContain('guideUrl')
    expect(validatePreset({ ...ok, rules: { inkLimit: 50 } })).toContain('rules')
    expect(validatePreset({ ...ok, imageFormat: 'gif' })).toContain('imageFormat')
  })

  it('refuses a pixel size that is not trim plus bleed at the dpi, and deck rules that contradict', () => {
    expect(validatePreset({ ...SHIPPED[0], pixels: { ...SHIPPED[0].pixels, width: 900 } })).toContain('pixelsMismatch')
    expect(validatePreset({ ...ok, deck: { min: 10, max: 5 } })).toContain('deck')
    expect(validatePreset({ ...ok, deck: { multiple: 0 } })).toContain('deck')
    expect(validatePreset({ ...ok, deck: { min: 18, max: 54, multiple: 9 } })).toEqual([])
  })
})

describe('arithmetic', () => {
  it('works out pixels, age and staleness (a preset older than 12 months says "re-check")', () => {
    expect(pixelsFor(63.5, 3.175, 300)).toBe(825)
    expect(pixelsFor(63.5, 0, 300)).toBe(750)
    expect(ageDays('2026-10-02', new Date('2026-10-12T12:00:00Z'))).toBe(10)
    expect(isStale('2026-10-02', new Date('2027-10-01T00:00:00Z'))).toBe(false)
    expect(isStale('2026-10-02', new Date('2027-10-04T00:00:00Z'))).toBe(true)
  })

  it('duplicates into a user preset that remembers what it came from', () => {
    const d = duplicate({ ...SHIPPED[0], shipped: true }, 'my-tgc', 'My TGC')
    expect(d).toMatchObject({ id: 'my-tgc', name: 'My TGC', shipped: false, basedOn: 'tgc-poker', format: PRESET_FORMAT })
    expect(duplicate(d, 'again', 'Again').basedOn).toBe('tgc-poker')                // the original, not the copy
    d.bleedMm = 9; expect(SHIPPED[0].bleedMm).toBe(3.175)                           // a real copy
  })

  it('says what is wrong with a deck size and what would fix it (PRD §17.7)', () => {
    const rule = { min: 18, max: 54, multiple: 9 }
    expect(deckProblem(null, 5)).toBeNull()
    expect(deckProblem(rule, 27)).toBeNull()
    expect(deckProblem(rule, 10)).toEqual({ problem: 'min', count: 10, min: 18, add: 8 })
    expect(deckProblem(rule, 60)).toEqual({ problem: 'max', count: 60, max: 54, remove: 6 })
    expect(deckProblem({ multiple: 9 }, 53)).toEqual({ problem: 'multiple', count: 53, multiple: 9, add: 1, remove: 8 })    // "add 1 or remove 8"
    expect(deckProblem({ multiple: 9 }, 54)).toBeNull()
  })
})
