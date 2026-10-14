import { describe, it, expect, beforeAll } from 'vitest'
import { DOMParser as XmlParser, XMLSerializer as XmlSerializer } from '@xmldom/xmldom'
import { readGradient, writeGradient, readEffects, writeEffects, getStyleProp, setStyleProp, documentColours, normalizeHex } from '../../src/renderer/src/lib/docPaint.js'
import { findById, childElements, serializeElements, pasteElements, cloneElements } from '../../src/renderer/src/lib/docEdit.js'

beforeAll(() => { globalThis.DOMParser = XmlParser; globalThis.XMLSerializer = XmlSerializer })

const SRC = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700">'
  + '<rect data-spadewick-id="a" x="10" y="20" width="40" height="30" fill="#FF0000" stroke="#00f"/>'
  + '<rect data-spadewick-id="b" x="100" y="20" width="40" height="30" fill="{{color}}"/>'
  + '</svg>'
const load = () => new XmlParser().parseFromString(SRC, 'image/svg+xml')
const defs = doc => childElements(doc.documentElement).filter(e => e.localName === 'defs')

describe('colours', () => {
  it('normalises hex colours and refuses everything else', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHex('#aabbccdd')).toBe('#aabbcc')
    expect(['red', '{{c}}', 'url(#g)', 'none', '#12', ''].map(normalizeHex)).toEqual([null, null, null, null, null, null])
  })

  it('lists the colours a template uses, once each, in order', () => {
    const doc = load()
    expect(documentColours(doc)).toEqual(['#ff0000', '#0000ff'])        // the token is not a colour
  })
})

describe('gradients', () => {
  const G = { type: 'linear', angle: 90, stops: [{ offset: 100, color: '#0000ff' }, { offset: 0, color: '#FF0000' }] }

  it('fills an element with a gradient of its own, stops in order, and reads it back', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeGradient(doc, a, G)
    expect(a.getAttribute('fill')).toBe('url(#grad_a)')
    expect(defs(doc)).toHaveLength(1)
    const back = readGradient(doc, a)
    expect(back).toMatchObject({ type: 'linear', angle: 90, complex: false })
    expect(back.stops).toEqual([{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 100, color: '#0000ff', opacity: 1 }])
  })

  it('keeps the position of a stop in the middle (a percentage, not a fraction)', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeGradient(doc, a, { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 35, color: '#00ff00' }, { offset: 100, color: '#0000ff' }] })
    expect(readGradient(doc, a).stops.map(s => s.offset)).toEqual([0, 35, 100])
  })

  it('a radial gradient and a stop with opacity survive a round trip', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeGradient(doc, a, { type: 'radial', angle: 0, stops: [{ offset: 0, color: '#ffffff', opacity: 0.5 }, { offset: 100, color: '#000000' }] })
    const back = readGradient(doc, a)
    expect(back.type).toBe('radial')
    expect(back.stops[0].opacity).toBe(0.5)
  })

  it('editing again replaces the gradient instead of piling up definitions; null lets go and cleans up', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeGradient(doc, a, G)
    writeGradient(doc, a, { ...G, type: 'radial' })
    expect(childElements(defs(doc)[0])).toHaveLength(1)
    writeGradient(doc, a, null)
    expect(childElements(defs(doc)[0])).toHaveLength(0)
    expect(readGradient(doc, a)).toBeNull()
  })

  it('the angle is stored as a direction in the element\'s own box', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeGradient(doc, a, { ...G, angle: 0 })
    const g = childElements(defs(doc)[0])[0]
    expect([g.getAttribute('x1'), g.getAttribute('y1'), g.getAttribute('x2'), g.getAttribute('y2')]).toEqual(['0', '0.5', '1', '0.5'])
  })

  it('a copy points at the original gradient until it is edited, then gets its own', () => {
    const doc = load()
    writeGradient(doc, findById(doc, 'a'), G)
    const [copyId] = cloneElements(doc, ['a'])
    const copy = findById(doc, copyId)
    expect(copy.getAttribute('fill')).toBe('url(#grad_a)')                 // shared for now
    writeGradient(doc, copy, { ...G, angle: 0 })
    expect(copy.getAttribute('fill')).toBe(`url(#grad_${copyId})`)
    expect(findById(doc, 'a').getAttribute('fill')).toBe('url(#grad_a)')    // the original is untouched
    expect(childElements(defs(doc)[0])).toHaveLength(2)
  })

  it('a copied element takes its gradient into another template', () => {
    const doc = load()
    writeGradient(doc, findById(doc, 'a'), G)
    const text = serializeElements(doc, ['a'])
    const other = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', 'image/svg+xml')
    const [id] = pasteElements(other, text, { dx: 0, dy: 0 })
    expect(readGradient(other, findById(other, id))?.stops).toHaveLength(2)
  })
})

describe('effects', () => {
  it('writes a shadow and a blur through one filter, and reads them back', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeEffects(doc, a, { blur: 3, shadow: { dx: 4, dy: 5, blur: 2, color: '#112233', opacity: 0.4 } })
    expect(a.getAttribute('filter')).toBe('url(#fx_a)')
    expect(readEffects(doc, a)).toEqual({ blur: 3, shadow: { dx: 4, dy: 5, blur: 2, color: '#112233', opacity: 0.4 }, foreign: false })
  })

  it('a shadow alone, a blur alone, and none: the filter goes when nothing is left', () => {
    const doc = load()
    const a = findById(doc, 'a')
    writeEffects(doc, a, { blur: 0, shadow: { dx: 1, dy: 1, blur: 0, color: '#000000', opacity: 1 } })
    expect(readEffects(doc, a).blur).toBe(0)
    writeEffects(doc, a, { blur: 2, shadow: null })
    expect(readEffects(doc, a)).toMatchObject({ blur: 2, shadow: null })
    writeEffects(doc, a, { blur: 0, shadow: null })
    expect(a.hasAttribute('filter')).toBe(false)
    expect(childElements(defs(doc)[0])).toHaveLength(0)
  })

  it('says when a filter was made somewhere else', () => {
    const doc = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="f"><feColorMatrix type="saturate" values="0"/></filter></defs><rect data-spadewick-id="a" filter="url(#f)"/></svg>', 'image/svg+xml')
    expect(readEffects(doc, findById(doc, 'a')).foreign).toBe(true)
  })
})

describe('style properties', () => {
  it('reads, sets and removes one property and keeps the rest', () => {
    const doc = load()
    const a = findById(doc, 'a')
    a.setAttribute('style', 'stroke-linejoin:round; mix-blend-mode : multiply')
    expect(getStyleProp(a, 'mix-blend-mode')).toBe('multiply')
    setStyleProp(a, 'mix-blend-mode', 'screen')
    expect(a.getAttribute('style')).toBe('stroke-linejoin:round;mix-blend-mode:screen')
    setStyleProp(a, 'mix-blend-mode', '')
    expect(a.getAttribute('style')).toBe('stroke-linejoin:round')
    setStyleProp(a, 'stroke-linejoin', '')
    expect(a.hasAttribute('style')).toBe(false)
    expect(getStyleProp(a, 'x')).toBe('')
  })
})
