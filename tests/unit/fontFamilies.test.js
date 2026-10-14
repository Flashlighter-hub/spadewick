import { describe, it, expect } from 'vitest'
import { mapGenericFonts } from '../../src/main/fontFiles.js'

describe('mapGenericFonts', () => {
  it('rewrites generic families in attributes and CSS', () => {
    expect(mapGenericFonts('<text font-family="serif">x</text>')).toContain("font-family=\"'Liberation Serif'\"")
    expect(mapGenericFonts('<text font-family="monospace">x</text>')).toContain("'Liberation Mono'")
    expect(mapGenericFonts('<text style="font-family: sans-serif; fill: red">x</text>')).toContain("font-family: 'Liberation Sans'; fill: red")
    expect(mapGenericFonts('<style>.a { font-family: serif; }</style>')).toContain("font-family: 'Liberation Serif'; }")
  })
  it('keeps real family names and fallback order', () => {
    expect(mapGenericFonts(`<text font-family="'Cinzel', Georgia, serif">x</text>`)).toContain(`'Cinzel', Georgia, 'Liberation Serif'`)
  })
  it('does not confuse sans-serif with serif', () => {
    expect(mapGenericFonts('<text font-family="sans-serif">x</text>')).toContain('Liberation Sans')
  })
  it('leaves other attributes alone', () => {
    const s = '<text font-size="12" fill="serif">serif</text>'
    expect(mapGenericFonts(s)).toBe(s)
  })
})
