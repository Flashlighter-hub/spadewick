import { describe, it, expect, beforeAll } from 'vitest'
import { DOMParser as XmlParser, XMLSerializer as XmlSerializer } from '@xmldom/xmldom'
import { groupElements, ungroupElement, cloneElements, serializeElements, pasteElements, offsetElement, topLevel, findById, childElements, uniqueId, layerize, descendants, removeElements } from '../../src/renderer/src/lib/docEdit.js'

// The editor runs in a browser; here the same code runs on a small DOM
beforeAll(() => { globalThis.DOMParser = XmlParser; globalThis.XMLSerializer = XmlSerializer })

const SRC = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700">'
  + '<rect data-spadewick-id="a" x="10" y="20" width="40" height="30" fill="#f00"/>'
  + '<text data-spadewick-id="b" x="100" y="60">Hi</text>'
  + '<circle data-spadewick-id="c" cx="200" cy="200" r="20"/>'
  + '<g data-spadewick-id="grp" transform="translate(5 5)" fill="#00f"><rect data-spadewick-id="in1" x="0" y="0" width="10" height="10"/><rect data-spadewick-id="in2" x="20" y="0" width="10" height="10" transform="rotate(10)"/></g>'
  + '</svg>'
const load = () => new XmlParser().parseFromString(SRC, 'image/svg+xml')
const ids = doc => childElements(doc.documentElement).map(e => e.getAttribute('data-spadewick-id'))

describe('grouping', () => {
  it('puts the elements into a group where the front-most was, in their own order', () => {
    const doc = load()
    const r = groupElements(doc, ['c', 'a'])
    expect(r.id).toBe('group_1')
    expect(ids(doc)).toEqual(['b', 'group_1', 'grp'])
    expect(childElements(findById(doc, 'group_1')).map(e => e.getAttribute('data-spadewick-id'))).toEqual(['a', 'c'])
  })

  it('refuses a single element, and elements that are not side by side', () => {
    const doc = load()
    expect(groupElements(doc, ['a']).error).toBe('tooFew')
    expect(groupElements(doc, ['a', 'in1']).error).toBe('differentParents')
    expect(ids(doc)).toEqual(['a', 'b', 'c', 'grp'])           // nothing changed
  })

  it('takes a group apart: the children keep their place, the transform and what they inherit', () => {
    const doc = load()
    const r = ungroupElement(doc, 'grp')
    expect(r.ids).toEqual(['in1', 'in2'])
    expect(ids(doc)).toEqual(['a', 'b', 'c', 'in1', 'in2'])
    expect(findById(doc, 'in1').getAttribute('transform')).toBe('translate(5 5)')
    expect(findById(doc, 'in2').getAttribute('transform')).toBe('translate(5 5) rotate(10)')
    expect(findById(doc, 'in1').getAttribute('fill')).toBe('#00f')
  })

  it('will not take apart a group that has opacity, an effect or a condition, and says which', () => {
    const doc = load()
    findById(doc, 'grp').setAttribute('opacity', '0.5')
    expect(ungroupElement(doc, 'grp')).toEqual({ error: 'effects', attribute: 'opacity' })
    expect(ids(doc)).toContain('grp')
    expect(ungroupElement(doc, 'a').error).toBe('notGroup')
  })

  it('topLevel drops what sits inside another selected element', () => {
    const doc = load()
    expect(topLevel(doc, ['grp', 'in1', 'a'])).toEqual(['grp', 'a'])
  })
})

describe('moving by an offset', () => {
  it('shifts plain elements by their own coordinates', () => {
    const doc = load()
    offsetElement(findById(doc, 'a'), 5, -3)
    expect([findById(doc, 'a').getAttribute('x'), findById(doc, 'a').getAttribute('y')]).toEqual(['15', '17'])
    offsetElement(findById(doc, 'c'), 1, 2)
    expect([findById(doc, 'c').getAttribute('cx'), findById(doc, 'c').getAttribute('cy')]).toEqual(['201', '202'])
    offsetElement(findById(doc, 'b'), 10, 10)
    expect(findById(doc, 'b').getAttribute('x')).toBe('110')
  })

  it('puts a translate in front of an element that has a transform or no coordinates of its own', () => {
    const doc = load()
    offsetElement(findById(doc, 'in2'), 7, 0)
    expect(findById(doc, 'in2').getAttribute('transform')).toBe('translate(7 0) rotate(10)')
    offsetElement(findById(doc, 'grp'), 0, 4)
    expect(findById(doc, 'grp').getAttribute('transform')).toBe('translate(0 4) translate(5 5)')
  })
})

describe('copying', () => {
  it('copies in place with new names, right behind the original, moved a little', () => {
    const doc = load()
    const out = cloneElements(doc, ['a', 'grp'], { dx: 10, dy: 10 })
    expect(out).toEqual(['a_copy', 'grp_copy'])
    expect(ids(doc)).toEqual(['a', 'a_copy', 'b', 'c', 'grp', 'grp_copy'])
    expect(findById(doc, 'a_copy').getAttribute('x')).toBe('20')
    const inner = childElements(findById(doc, 'grp_copy')).map(e => e.getAttribute('data-spadewick-id'))
    expect(inner).toEqual(['in1_copy', 'in2_copy'])                      // the names inside are new too
    expect(uniqueId(doc, 'a')).toBe('a_copy2')
    expect(uniqueId(doc, 'a_copy')).toBe('a_copy2')
  })

  it('a copy of a copy is numbered, not a growing tail', () => {
    const doc = load()
    cloneElements(doc, ['a'])
    cloneElements(doc, ['a_copy'])
    expect(ids(doc)).toContain('a_copy2')
    expect(ids(doc).some(i => /_copy_copy/.test(i))).toBe(false)
  })

  it('copies to text and pastes it, into the same or another document, on top, with free names', () => {
    const doc = load()
    const text = serializeElements(doc, ['a', 'c'])
    const out = pasteElements(doc, text, { dx: 12, dy: 12 })
    expect(out).toEqual(['a_copy', 'c_copy'])
    expect(ids(doc).slice(-2)).toEqual(['a_copy', 'c_copy'])
    const other = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><rect data-spadewick-id="a" x="0" y="0" width="1" height="1"/></svg>', 'image/svg+xml')
    expect(pasteElements(other, text, { dx: 0, dy: 0 })).toEqual(['a_copy', 'c'])   // a is taken there, c is free
    expect(pasteElements(doc, 'not ours')).toBeNull()
    expect(pasteElements(doc, JSON.stringify({ spadewick: 2 }))).toBeNull()
  })

  it('removes elements, and not twice what is inside another removed one', () => {
    const doc = load()
    removeElements(doc, ['grp', 'in1', 'a'])
    expect(ids(doc)).toEqual(['b', 'c'])
  })
})

describe('making every element a layer', () => {
  const DESIGN = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">'
    + '<defs><linearGradient id="g1"><stop offset="0" stop-color="#000"/></linearGradient><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs>'
    + '<g id="trim" transform="translate(37.5 37.5)"><rect id="rect123" width="400" height="600" fill="#123"/><path id="frame" d="M0 0L10 10"/><path d="M5 5L9 9"/>'
    + '<g id="sigil"><circle cx="5" cy="5" r="4"/><text x="1" y="2">Hi<tspan x="3">there</tspan></text></g></g>'
    + '<title>x</title></svg>'
  const idsOfAll = doc => [...descendants(doc.documentElement)].map(e => [e.localName, e.getAttribute('data-spadewick-id')])

  it('gives every drawn element, at any depth, an id of its own; definitions, titles and the parts of a text are left alone', () => {
    const doc = new XmlParser().parseFromString(DESIGN, 'image/svg+xml')
    const r = layerize(doc)
    const got = idsOfAll(doc)
    expect(r).toEqual({ added: 7, limited: false })
    expect(got.filter(([tag, id]) => id).map(([tag, id]) => `${tag}:${id}`)).toEqual(['g:trim', 'rect:rect', 'path:frame', 'path:path', 'g:sigil', 'circle:circle', 'text:text'])
    for (const [tag, id] of got) if (['linearGradient', 'stop', 'clipPath', 'title', 'tspan'].includes(tag)) expect(id || null).toBeNull()
  })

  it('names layers after a real name the element has, and by their kind otherwise, with free numbers', () => {
    const doc = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><path id="Gold Frame" d="M0 0"/><path d="M1 1"/><path d="M2 2"/><path id="path42" d="M3 3"/><rect data-spadewick-id="path" width="1" height="1"/></svg>', 'image/svg+xml')
    layerize(doc)
    expect(idsOfAll(doc).map(([, id]) => id)).toEqual(['Gold_Frame', 'path_2', 'path_3', 'path_4', 'path'])
  })

  it('keeps the ids that are there, does nothing twice, and stops at the limit', () => {
    const doc = new XmlParser().parseFromString(DESIGN.replace('<g id="sigil">', '<g id="sigil" data-spadewick-id="mine">'), 'image/svg+xml')
    layerize(doc)
    expect(findById(doc, 'mine')).toBeTruthy()
    expect(layerize(doc)).toEqual({ added: 0, limited: false })
    const big = new XmlParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + '<rect width="1" height="1"/>'.repeat(30) + '</svg>', 'image/svg+xml')
    expect(layerize(big, 10)).toEqual({ added: 10, limited: true })
    expect(idsOfAll(big).filter(([, id]) => id)).toHaveLength(10)
  })
})
