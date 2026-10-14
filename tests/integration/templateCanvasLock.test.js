import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

/** The canvas of a template is the card: its size is fixed when the template is made, and elements may spill past it. */
describe('the canvas of a template is locked to the card (elements may spill past it)', () => {
  const doc = (vb, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="${vb}"><rect width="500" height="700" fill="#fff"/>${inner}</svg>`
  let proj
  beforeEach(async () => { proj = await createTestProject('Lock') })
  afterEach(async () => { await proj.cleanup() })

  it('saves a template whose elements lie past the edge, and refuses a changed view box, width or height', async () => {
    const s = await seedSet({ name: 'S', cardSize: 'poker', template: { name: 'T', svg: doc('0 0 500 700', '') } })
    const id = s.template.id
    const spilled = doc('0 0 500 700', '<rect x="-300" y="-200" width="1200" height="400" fill="#c00"/><circle cx="900" cy="900" r="80"/>')
    await invoke('templates:update', { id, svgSource: spilled })
    expect((await invoke('templates:get', id)).svg_source).toBe(spilled)                       // spilling is allowed and kept as it is

    for (const bad of [doc('0 0 600 700', ''), doc('10 0 500 700', ''), doc('0 0 500 700', '').replace('width="500"', 'width="600"'), doc('0 0 500 700', '').replace(/ viewBox="[^"]*"/, ' viewBox="0 0 500 600"')]) {
      await expect(invoke('templates:update', { id, svgSource: bad })).rejects.toThrow(/canvas is 500 × 700 units and is locked/)
    }
    expect((await invoke('templates:get', id)).svg_source).toBe(spilled)                       // nothing was written by a refused save
  })

  it('still allows the explicit bleed action, a rename, and a name change together with the same canvas', async () => {
    const s = await seedSet({ name: 'S', cardSize: 'poker', template: { name: 'T', svg: doc('0 0 500 700', '') } })
    const id = s.template.id
    await invoke('templates:update', { id, name: 'Renamed' })
    expect((await invoke('templates:get', id)).name).toBe('Renamed')
    await invoke('templates:add-bleed', { id, bleedMm: 3 })                                    // the one deliberate way the canvas changes
    expect((await invoke('templates:get', id)).svg_source).toMatch(/viewBox="0 0 /)
  })
})
