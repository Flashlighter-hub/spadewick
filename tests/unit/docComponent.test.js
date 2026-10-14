import { describe, it, expect, beforeAll } from 'vitest'
import { DOMParser as XmlParser, XMLSerializer as XmlSerializer } from '@xmldom/xmldom'
import { findById, childElements, descendants, findByPlainId } from '../../src/renderer/src/lib/docEdit.js'
import {
  instantiate, updateInstance, setOverride, readOverrides, componentInfo, isInstance, partsOf, detach, packElements, packInstance, markAsInstance,
  frameOf, localBounds, refsIn, COMPONENT, PART
} from '../../src/renderer/src/lib/docComponent.js'

beforeAll(() => { globalThis.DOMParser = XmlParser; globalThis.XMLSerializer = XmlSerializer })

const doc = inner => new XmlParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`, 'image/svg+xml')
const ID = 'data-spadewick-id'
const ids = d => [...descendants(d.documentElement)].map(e => e.getAttribute(ID)).filter(Boolean)
const text = d => new XmlSerializer().serializeToString(d)

const BADGE = {
  id: '11111111-1111-1111-1111-111111111111', name: 'Cost badge', version: 1, refWidth: 500, bounds: { x: 0, y: 0, w: 60, h: 60 },
  defs: ['<linearGradient xmlns="http://www.w3.org/2000/svg" id="grad_badge"><stop offset="0%" stop-color="#ff0000"/><stop offset="100%" stop-color="#880000"/></linearGradient>'],
  xml: [
    '<circle xmlns="http://www.w3.org/2000/svg" data-spadewick-id="badge" cx="30" cy="30" r="30" fill="url(#grad_badge)" stroke="#ffffff"/>',
    '<text xmlns="http://www.w3.org/2000/svg" data-spadewick-id="label" x="30" y="40" text-anchor="middle" fill="#ffffff">3</text>',
    '<text xmlns="http://www.w3.org/2000/svg" data-spadewick-id="cost" x="30" y="52" fill="#000">{{cost}}</text>'
  ]
}

describe('putting a component into a template', () => {
  it('makes a group that points to the library, with the parts copied inside, centred where asked', () => {
    const d = doc('')
    const id = instantiate(d, BADGE, { at: { x: 100, y: 200 } })
    const g = findById(d, id)
    expect(id).toBe('cost_badge_1')
    expect(isInstance(g)).toBe(true)
    expect(componentInfo(g)).toEqual({ id: BADGE.id, name: 'Cost badge', version: 1, overrides: {} })
    expect(g.getAttribute('transform')).toBe('translate(70 170)')               // its middle (30, 30) lands on (100, 200)
    expect(childElements(g).map(e => e.getAttribute(ID))).toEqual(['badge', 'label', 'cost'])
    expect(childElements(g).every(e => e.getAttribute(PART) === e.getAttribute(ID))).toBe(true)
    expect(findByPlainId(d, 'grad_badge')).toBeTruthy()                          // its gradient came along
    expect(childElements(g)[0].getAttribute('fill')).toBe('url(#grad_badge)')
  })

  it('puts it in the middle of the card when no place is given, and scales it for a canvas of another width', () => {
    const wide = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1400"></svg>', 'image/svg+xml')
    const id = instantiate(wide, BADGE)
    expect(findById(wide, id).getAttribute('transform')).toBe('translate(440 640) scale(2)')
    const same = doc('')
    expect(findById(same, instantiate(same, BADGE)).getAttribute('transform')).toBe('translate(220 320)')
  })

  it('a second copy gets names of its own, and its own gradient, so changing one never changes the other', () => {
    const d = doc('')
    const a = instantiate(d, BADGE), b = instantiate(d, BADGE)
    expect([a, b]).toEqual(['cost_badge_1', 'cost_badge_2'])
    expect(new Set(ids(d)).size).toBe(ids(d).length)
    const second = childElements(findById(d, b))
    expect(second.map(e => e.getAttribute(PART))).toEqual(['badge', 'label', 'cost'])
    expect(second[0].getAttribute(ID)).not.toBe('badge')
    expect(second[0].getAttribute('fill')).toBe('url(#grad_badge_2)')
    expect(findByPlainId(d, 'grad_badge_2')).toBeTruthy()
    const plain = [...descendants(d.documentElement)].map(e => e.getAttribute('id')).filter(Boolean)
    expect(new Set(plain).size).toBe(plain.length)
  })

  it('does not take a name that is taken: a template that already has a "badge" keeps it', () => {
    const d = doc('<rect data-spadewick-id="badge" x="0" y="0" width="5" height="5"/>')
    instantiate(d, BADGE)
    expect(new Set(ids(d)).size).toBe(ids(d).length)
    expect(findById(d, 'badge').localName).toBe('rect')
  })
})

describe('changing a colour or the words', () => {
  const setup = () => { const d = doc(''); const id = instantiate(d, BADGE); return { d, id, g: findById(d, id) } }

  it('lists what can be changed: colours and words, and shows a field as a field', () => {
    const { g } = setup()
    const parts = partsOf(g)
    expect(parts.map(p => p.part)).toEqual(['badge', 'label', 'cost'])
    expect(parts[0]).toMatchObject({ tag: 'circle', fill: null, stroke: '#ffffff', text: null })     // a gradient is not a colour to change here
    expect(parts[1]).toMatchObject({ tag: 'text', fill: '#ffffff', text: '3', tokens: null })
    expect(parts[2]).toMatchObject({ text: null, tokens: '{{cost}}' })
  })

  it('writes the change on the part and remembers it as an override', () => {
    const { d, id, g } = setup()
    expect(setOverride(d, id, 'badge', 'stroke', '#00ff00')).toBe(true)
    expect(setOverride(d, id, 'label', 'text', '7')).toBe(true)
    expect(setOverride(d, id, 'label', 'fill', '#112233')).toBe(true)
    expect(childElements(g)[0].getAttribute('stroke')).toBe('#00ff00')
    expect(childElements(g)[1].textContent).toBe('7')
    expect(readOverrides(g)).toEqual({ badge: { stroke: '#00ff00' }, label: { text: '7', fill: '#112233' } })
    expect(partsOf(g)[1]).toMatchObject({ changed: true, text: '7' })
    expect(setOverride(d, id, 'label', 'colour', 'x')).toBe(false)
    expect(setOverride(d, 'nope', 'label', 'text', 'x')).toBe(false)
    // clearing the last override leaves no attribute
    setOverride(d, id, 'badge', 'stroke', null)
    setOverride(d, id, 'label', 'text', null)
    setOverride(d, id, 'label', 'fill', null)
    expect(g.hasAttribute('data-spadewick-overrides')).toBe(false)
  })

  it('survives being written and read again as XML', () => {
    const { d, id } = setup()
    setOverride(d, id, 'badge', 'stroke', '#00ff00')
    const again = new XmlParser().parseFromString(text(d), 'image/svg+xml')
    expect(readOverrides(findById(again, id))).toEqual({ badge: { stroke: '#00ff00' } })
  })

  it('ignores an overrides attribute that is not ours', () => {
    const d = doc('<g data-spadewick-id="x" data-spadewick-component="c" data-spadewick-overrides="{nonsense"></g>')
    expect(readOverrides(findById(d, 'x'))).toEqual({})
    const e = doc('<g data-spadewick-id="x" data-spadewick-component="c" data-spadewick-overrides=\'{"a":{"fill":"#fff","evil":"x"},"b":5}\'></g>')
    expect(readOverrides(findById(e, 'x'))).toEqual({ a: { fill: '#fff' } })
  })
})

describe('updating from the library', () => {
  const v2 = {
    ...BADGE, version: 2, defs: ['<linearGradient xmlns="http://www.w3.org/2000/svg" id="grad_badge"><stop offset="0%" stop-color="#0000ff"/></linearGradient>'],
    xml: [
      '<rect xmlns="http://www.w3.org/2000/svg" data-spadewick-id="badge" x="0" y="0" width="60" height="60" rx="12" fill="url(#grad_badge)" stroke="#ffffff"/>',
      '<text xmlns="http://www.w3.org/2000/svg" data-spadewick-id="label" x="30" y="40" fill="#ffffff">3</text>'
    ]
  }

  it('replaces the parts by the new ones, keeps the place, and puts the changes back on the parts that are still there', () => {
    const d = doc('<rect data-spadewick-id="other" x="1" y="1" width="2" height="2"/>')
    const id = instantiate(d, BADGE, { at: { x: 100, y: 100 } })
    setOverride(d, id, 'badge', 'stroke', '#00ff00')
    setOverride(d, id, 'label', 'text', '9')
    setOverride(d, id, 'cost', 'fill', '#abcdef')                                // a part version 2 no longer has
    const transform = findById(d, id).getAttribute('transform')
    expect(updateInstance(d, id, v2)).toBe(true)
    const g = findById(d, id)
    expect(componentInfo(g)).toMatchObject({ version: 2, overrides: { badge: { stroke: '#00ff00' }, label: { text: '9' } } })
    expect(g.getAttribute('transform')).toBe(transform)
    const kids = childElements(g)
    expect(kids.map(e => e.localName)).toEqual(['rect', 'text'])
    expect(kids[0].getAttribute('stroke')).toBe('#00ff00')
    expect(kids[1].textContent).toBe('9')
    expect(findById(d, 'other')).toBeTruthy()
    // the old gradient is gone, the new one is the only one
    const grads = [...descendants(d.documentElement)].filter(e => e.localName === 'linearGradient')
    expect(grads).toHaveLength(1)
    expect(grads[0].getElementsByTagName('stop')[0].getAttribute('stop-color')).toBe('#0000ff')
  })

  it('can drop the changes and take the library\'s version as it is', () => {
    const d = doc('')
    const id = instantiate(d, BADGE)
    setOverride(d, id, 'label', 'text', '9')
    updateInstance(d, id, v2, { keepOverrides: false })
    expect(componentInfo(findById(d, id)).overrides).toEqual({})
    expect(childElements(findById(d, id))[1].textContent).toBe('3')
  })

  it('leaves a definition that something else still uses', () => {
    const d = doc('<rect data-spadewick-id="x" x="0" y="0" width="5" height="5" fill="url(#grad_badge)"/>')
    const id = instantiate(d, BADGE)                                            // takes grad_badge_2 as grad_badge is taken (by nothing yet: not defined)
    expect(updateInstance(d, id, v2)).toBe(true)
    expect(findById(d, 'x').getAttribute('fill')).toBe('url(#grad_badge)')
  })

  it('refuses what is not an instance', () => {
    const d = doc('<g data-spadewick-id="plain"><rect data-spadewick-id="r" x="0" y="0" width="1" height="1"/></g>')
    expect(updateInstance(d, 'plain', v2)).toBe(false)
    expect(updateInstance(d, 'nope', v2)).toBe(false)
  })
})

describe('letting go', () => {
  it('detach makes a plain group with plain parts, and the group can be taken apart then', () => {
    const d = doc('')
    const id = instantiate(d, BADGE)
    setOverride(d, id, 'badge', 'stroke', '#00ff00')
    expect(detach(d, id)).toBe(true)
    const g = findById(d, id)
    expect(isInstance(g)).toBe(false)
    expect(g.hasAttribute('data-spadewick-overrides')).toBe(false)
    expect([...descendants(g)].some(e => e.hasAttribute(PART))).toBe(false)
    expect(childElements(g)[0].getAttribute('stroke')).toBe('#00ff00')              // what was changed stays
    expect(detach(d, id)).toBe(false)
  })
})

describe('making a component', () => {
  const SRC = '<defs><linearGradient id="grad_a"><stop offset="0%" stop-color="#fff"/></linearGradient><filter id="fx_a"><feGaussianBlur stdDeviation="2"/></filter><linearGradient id="grad_unused"/></defs>'
    + '<rect data-spadewick-id="a" x="10" y="10" width="40" height="40" fill="url(#grad_a)" filter="url(#fx_a)"/>'
    + '<text data-spadewick-id="b" x="20" y="30">Hi {{name}}</text>'
    + '<circle cx="5" cy="5" r="2"/>'

  it('packs the parts as source with the definitions they use, and every named part is its own name', () => {
    const d = doc(SRC)
    const packed = packElements(d, [findById(d, 'a'), findById(d, 'b')])
    expect(packed.xml).toHaveLength(2)
    expect(packed.xml[0]).toContain('data-spadewick-part="a"')
    expect(packed.defs.map(s => /id="([^"]+)"/.exec(s)[1]).sort()).toEqual(['fx_a', 'grad_a'])    // not the one nothing uses
    expect(findById(d, 'a').hasAttribute(PART)).toBe(false)                                         // the template itself is not touched
  })

  it('what is packed can be put into another template and looks the same there', () => {
    const d = doc(SRC)
    const packed = packElements(d, [findById(d, 'a'), findById(d, 'b')])
    const other = doc('')
    const id = instantiate(other, { id: 'c', name: 'Pair', version: 1, refWidth: 500, bounds: { x: 10, y: 10, w: 40, h: 40 }, ...packed }, { at: { x: 30, y: 30 } })
    const g = findById(other, id)
    expect(findById(other, id).getAttribute('transform')).toBe('translate(0 0)')
    expect(childElements(g).map(e => e.localName)).toEqual(['rect', 'text'])
    expect(childElements(g)[0].getAttribute('filter')).toBe('url(#fx_a)')
    expect(findByPlainId(other, 'fx_a')).toBeTruthy()
    expect(childElements(g)[1].textContent).toBe('Hi {{name}}')
  })

  it('an instance packs back as it is now, parts named as the library knows them', () => {
    const d = doc('')
    const id = instantiate(d, BADGE)
    instantiate(d, BADGE)
    setOverride(d, id, 'label', 'text', '9')
    const second = instantiate(d, BADGE)
    const packed = packInstance(d, second)
    expect(packed.xml.map(s => /data-spadewick-id="([^"]+)"/.exec(s)[1])).toEqual(['badge', 'label', 'cost'])
    const baked = packInstance(d, id)
    expect(baked.xml[1]).toContain('>9<')
    expect(packInstance(d, 'nope')).toBeNull()
  })

  it('makes a selection into an instance: a group is used as it is, several elements are grouped', () => {
    const d = doc(SRC)
    const comp = { id: 'abc', name: 'Pair', version: 1 }
    const id = markAsInstance(d, ['a', 'b'], comp)
    expect(id).toBe('pair_1')
    const g = findById(d, id)
    expect(componentInfo(g)).toMatchObject({ id: 'abc', name: 'Pair', version: 1 })
    expect(childElements(g).map(e => e.getAttribute(ID))).toEqual(['a', 'b'])
    expect(childElements(g)[0].getAttribute(PART)).toBe('a')
    const e = doc('<g data-spadewick-id="grp"><rect data-spadewick-id="r" x="0" y="0" width="1" height="1"/></g>')
    expect(markAsInstance(e, ['grp'], comp)).toBe('grp')
    expect(findById(e, 'grp').getAttribute(COMPONENT)).toBe('abc')
    expect(markAsInstance(e, ['nope'], comp)).toBeNull()
  })

  it('finds the references of a part', () => {
    const d = doc(SRC)
    expect([...refsIn(findById(d, 'a'))].sort()).toEqual(['fx_a', 'grad_a'])
    expect([...refsIn(findById(d, 'b'))]).toEqual([])
  })
})

describe('where an instance sits', () => {
  it('reads the move and the scale it was made with, and turns a box on the card into a box inside it', () => {
    const d = doc('')
    const wide = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1400"></svg>', 'image/svg+xml')
    const id = instantiate(wide, BADGE, { at: { x: 500, y: 700 } })
    const g = findById(wide, id)
    expect(frameOf(g)).toEqual({ x: 440, y: 640, scale: 2 })
    expect(localBounds(g, { x: 440, y: 640, w: 120, h: 120 })).toEqual({ x: 0, y: 0, w: 60, h: 60 })
    expect(frameOf(findById(d, instantiate(d, BADGE)))).toMatchObject({ scale: 1 })
  })
})
