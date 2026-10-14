import { describe, it, expect } from 'vitest'
import { inlineLegacyPalette, sizeOfManifest } from '../../src/main/templateLibrary.js'

describe('packages made before the palette was removed', () => {
  const palette = [{ name: 'frame', label: 'Frame', value: '#3b2f2f' }, { name: 'gold', label: 'Gold', value: '#e8c15a' }]

  it('write the colours into the template', () => {
    const svg = '<rect fill="{{@palette.frame}}"/><g data-spadewick-show-if="eq(tint, palette(\'gold\'))"/><rect stroke="{{ @palette.gold }}"/>'
    expect(inlineLegacyPalette(svg, palette)).toBe('<rect fill="#3b2f2f"/><g data-spadewick-show-if="eq(tint, "#e8c15a")"/><rect stroke="#e8c15a"/>')
  })

  it('leave an unknown colour empty, and a template without palette tokens untouched', () => {
    expect(inlineLegacyPalette('<rect fill="{{@palette.nope}}"/>', palette)).toBe('<rect fill=""/>')
    const plain = '<rect fill="#ffffff"/>'
    expect(inlineLegacyPalette(plain, palette)).toBe(plain)
    expect(inlineLegacyPalette(plain)).toBe(plain)
  })
})

describe('the card size a package declares (PRD §10.6)', () => {
  it('is the preset it names, a custom size from its millimetres, or Poker', () => {
    expect(sizeOfManifest({ cardSize: { id: 'tarot', mmW: 1, mmH: 1 } })).toMatchObject({ id: 'tarot', mmW: 70, mmH: 120 })
    expect(sizeOfManifest({ cardSize: { id: 'custom', mmW: 50, mmH: 90 } })).toMatchObject({ id: 'custom', mmW: 50, mmH: 90 })
    expect(sizeOfManifest({ cardSize: { mmW: 50, mmH: 90 } })).toMatchObject({ id: 'custom', mmW: 50, mmH: 90 })
    expect(sizeOfManifest({})).toMatchObject({ id: 'poker' })
  })
})
