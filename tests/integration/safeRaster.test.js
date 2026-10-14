/**
 * Drawing a design must never be able to stop the application. resvg (the drawing engine) panics on some drawings, and a panic stops
 * the process it runs in; safeRaster.js draws in a helper process, tries a plainer form of a drawing that kills the helper, and only
 * then gives an error. Found with fantasy_rpg_teal_card_template.svg: after the import, opening the template in the editor with a
 * card whose long text runs off the card closed the whole application (a clipped group with drop shadows, one of them overflowing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { rasterize, limitFilterRegions, dropFilters } from '../../src/main/safeRaster.js'

const FIX = join(process.cwd(), 'tests/fixtures')
const OPTIONS = { fitTo: { mode: 'width', value: 200 } }
const isPng = b => Buffer.isBuffer(b) && b.subarray(1, 4).toString() === 'PNG'

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 750 1050"><defs><filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#111" flood-opacity=".35"/></filter><clipPath id="c"><rect width="750" height="1050" rx="42"/></clipPath></defs>'
const bar = (x0, x1, y) => `<path d="M${x0} ${y} L${x1} ${y} L${x1} ${y + 10} L${x0} ${y + 10}Z"/>`
/** Kills resvg as it is: a clipped group with two drop-shadow groups, the second running off the left edge. */
const SHADOWS = `${HEAD}<g clip-path="url(#c)"><g filter="url(#f)"><rect x="590" y="70" width="90" height="150"/></g><g filter="url(#f)">${bar(-657, 1400, 400)}</g></g></svg>`
/** Kills resvg even without filters: a half-transparent <use> of something far off the card. */
const UNSAVABLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 630 880" width="630" height="880"><defs><g id="g"><rect x="3000" y="3000" width="50" height="50" fill="red"/></g></defs><use href="#g" opacity="0.5"/></svg>'
const PLAIN = `${HEAD}<rect width="750" height="1050" fill="#abc"/></svg>`

describe('the drawing helper', () => {
  it('draws an ordinary design', async () => {
    expect(isPng(await rasterize(PLAIN, OPTIONS))).toBe(true)
  })

  it('survives a drawing that stops the drawing engine: it is drawn again with its shadows limited to the card', async () => {
    const report = {}
    const png = await rasterize(SHADOWS, OPTIONS, { report })
    expect(isPng(png)).toBe(true)
    expect(report.drawnPlainer).toBe(1)
    // the helper started again: the next, ordinary drawing works, and so does a repeat of the bad one (its level is remembered)
    expect(isPng(await rasterize(PLAIN, OPTIONS))).toBe(true)
    const again = {}
    expect(isPng(await rasterize(SHADOWS, OPTIONS, { report: again }))).toBe(true)
    expect(again.drawnPlainer).toBe(1)
  })

  it('answers with an error, not a stopped program, when no plainer form helps; the next drawing still works', async () => {
    await expect(rasterize(UNSAVABLE, OPTIONS)).rejects.toThrow(/could not be drawn/i)
    expect(isPng(await rasterize(PLAIN, OPTIONS))).toBe(true)
  })

  it('reports a drawing resvg refuses as an ordinary error, without treating it as a crash', async () => {
    await expect(rasterize('this is not an svg', OPTIONS)).rejects.toThrow()
    expect(isPng(await rasterize(PLAIN, OPTIONS))).toBe(true)
  })

  it('limits filter regions to the card and leaves filters that already have their own region alone', () => {
    const out = limitFilterRegions(SHADOWS)
    expect(out).toMatch(/<filter id="f" filterUnits="userSpaceOnUse" x="-750" y="-1050" width="2250" height="3150">/)
    const own = '<svg viewBox="0 0 10 10"><filter id="a" filterUnits="userSpaceOnUse" x="1" y="1" width="5" height="5"></filter></svg>'
    expect(limitFilterRegions(own)).toBe(own)
    expect(limitFilterRegions('<svg><filter id="a"></filter></svg>')).toBe('<svg><filter id="a"></filter></svg>')   // no viewBox: nothing to base a region on
    expect(dropFilters('<g filter="url(#f)" id="x"/><filter id="f" filterUnits="objectBoundingBox"/>')).toBe('<g id="x"/><filter id="f" filterUnits="objectBoundingBox"/>')
  })
})

describe('a design whose long text runs off the card (the teal template)', () => {
  let proj
  beforeEach(async () => { proj = await createTestProject('Teal') })
  afterEach(async () => { await proj.cleanup() })

  async function cardWith(effect) {
    const s = await seedSet({
      name: 'Skills', cardSize: 'poker',
      fields: ['character_name', 'skill_name', 'momentum_cost', 'effect_text'].map(slug => ({ name: slug, slug, type: 'text' }))
    })
    const t = await invoke('templates:create', { name: 'Teal', svgSource: readFileSync(join(FIX, 'rasterSafe/teal_bound_template.svg'), 'utf8'), cardSize: 'poker' })
    return invoke('cards:create', { setId: s.set.id, displayName: 'C', templateId: t.id, fields: { character_name: 'Corvin', skill_name: 'Seasoned Hunter', momentum_cost: '', effect_text: effect } })
  }
  const LONG = 'Level 1 - Permanent +1 Power first time a Creature is defeated by your attack roll. Level 2 - Activates one extra time.'

  it('renders the card instead of closing the application', async () => {
    const card = await cardWith(LONG)
    const png = Buffer.from(await invoke('templates:render', { cardId: card.id, width: 300 }), 'base64')
    expect(isPng(png)).toBe(true)
  })

  it('also gives the text report and a small picture', async () => {
    const card = await cardWith(LONG)
    await expect(invoke('templates:text-report', { cardId: card.id })).resolves.toBeTruthy()
    const png = Buffer.from(await invoke('templates:render', { cardId: card.id, width: 120 }), 'base64')
    expect(isPng(png)).toBe(true)
  })
})

describe('importing the teal design', () => {
  let proj, s
  beforeEach(async () => { proj = await createTestProject('Imp'); s = await seedSet({ name: 'Cards', cardSize: 'poker', fields: [{ name: 'Name', type: 'text' }] }) })
  afterEach(async () => { await proj.cleanup() })

  it('previews, imports and renders its template', async () => {
    const path = join(FIX, 'svgImport/fantasy_teal.svg')
    const a = await invoke('svgimport:analyze', { path, setId: s.set.id })
    expect(a.preview.length).toBeGreaterThan(1000)
    const out = await invoke('svgimport:apply', { path, setId: s.set.id, name: 'Teal', size: { cardSize: a.proposal.cardSize, cardMmW: a.proposal.cardMmW, cardMmH: a.proposal.cardMmH }, decisions: [] })
    const card = await invoke('cards:create', { setId: s.set.id, displayName: 'X', templateId: out.template.id, fields: {} })
    expect(isPng(Buffer.from(await invoke('templates:render', { cardId: card.id, width: 300 }), 'base64'))).toBe(true)
  })
})
