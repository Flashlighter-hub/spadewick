import { describe, it, expect } from 'vitest'
import { styleAttrs, styleFromAttrs } from '../../src/renderer/src/lib/textStyleApply.js'
import { normalizeStyleProps } from '../../src/shared/textStyleProps.js'

describe('a text style as the attributes of a text element', () => {
  it('sets only what the style defines', () => {
    expect(styleAttrs({ bold: true, color: '#aa0000' })).toEqual({ 'font-weight': 'bold', fill: '#aa0000' })
    expect(styleAttrs({})).toEqual({})
  })

  it('maps every property to its attribute', () => {
    const attrs = styleAttrs({ fontFamily: 'Liberation Serif', bold: true, italic: true, color: '#112233', tracking: 50, smallCaps: true, outlineWidth: 0.05, outlineColor: '#000000', shadowX: 0.04, shadowY: 0.06, shadowColor: '#333333' })
    expect(attrs).toEqual({
      'font-family': 'Liberation Serif', 'font-weight': 'bold', 'font-style': 'italic', fill: '#112233', 'letter-spacing': '0.05em',
      'data-spadewick-text-transform': 'small-caps', 'data-spadewick-outline': '0.05em #000000', 'data-spadewick-shadow': '0.04em 0.06em #333333'
    })
  })

  it('a tracking of zero takes the letter spacing away', () => {
    expect(styleAttrs({ tracking: 0 })).toEqual({ 'letter-spacing': '' })
  })

  it('a style made from an element applies back to the same attributes, and the style it makes is a valid one', () => {
    const el = { 'font-family': 'Liberation Sans', 'font-weight': 'bold', 'font-style': 'italic', fill: '#445566', 'letter-spacing': '0.02em', 'data-spadewick-outline': '0.03em #ffffff', 'data-spadewick-shadow': '0.05em 0.05em #00000000'.replace('00000000', '111111') }
    const props = styleFromAttrs(n => el[n] ?? '')
    expect(props).toMatchObject({ fontFamily: 'Liberation Sans', bold: true, italic: true, color: '#445566', tracking: 20, outlineWidth: 0.03, outlineColor: '#ffffff', shadowX: 0.05, shadowY: 0.05, shadowColor: '#111111' })
    expect(normalizeStyleProps(props).rejected).toEqual([])
    expect(styleAttrs(props)).toMatchObject({ 'font-weight': 'bold', fill: '#445566', 'letter-spacing': '0.02em' })
  })

  it('ignores attributes that are not part of a style (a token fill, a unit it cannot read)', () => {
    const el = { fill: '{{color}}', 'letter-spacing': '2px', 'font-weight': '400', 'data-spadewick-outline': '2 #000000' }
    expect(styleFromAttrs(n => el[n] ?? '')).toEqual({})
  })
})
