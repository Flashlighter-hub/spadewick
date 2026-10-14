import { describe, it, expect } from 'vitest'
import { diffInstance, applyInstance, checkPatch, readPatch } from '../../src/main/instance.js'
import { parseXml, serialize } from '../../src/main/svgImport/xml.js'

/** UPDATES U29: a card's own instance of a template is a small patch of the template, not a copy. */

const BASE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280">
<!-- spadewick:slot="art" -->
<g id="trim">
<rect data-spadewick-id="bg" width="200" height="280" fill="#112233"/>
<g data-spadewick-id="art-slot"><rect data-spadewick-id="window" x="10" y="10" width="180" height="120" fill="none" data-spadewick-show-if="a > b"/></g>
<text data-spadewick-id="name" x="10" y="160" font-size="20" fill="#ffffff">{{name}}</text>
<path d="M0 0L10 10" fill="#ff0000"/>
<circle data-spadewick-id="dot" cx="5" cy="5" r="3"/>
</g>
</svg>`

/** The edited source: the way the canvas editor hands it back (re-serialized by a browser, so spacing and comments differ). */
const reserialize = s => serialize(parseXml(s).root)
const edit = (source, fn) => { const doc = parseXml(source); fn(doc.root); return serialize(doc.root) }
const find = (root, id) => { const out = []; const walk = e => { if ((e.attrs['data-spadewick-id'] ?? e.attrs.id) === id) out.push(e); (e.children ?? []).forEach(c => c.tag && walk(c)) }; walk(root); return out[0] }

describe('the patch of an instance', () => {
  it('is nothing when the edited source is the template itself, however it is written', () => {
    expect(diffInstance(BASE, reserialize(BASE))).toBe(null)
  })

  it('keeps a changed attribute and applies it to the template text, leaving everything else (comments, other elements) as it was', () => {
    const edited = edit(BASE, root => { find(root, 'bg').attrs.fill = '#aa0000' })
    const patch = diffInstance(BASE, edited)
    expect(patch).toEqual({ v: 1, set: [{ t: 'bg', a: { fill: '#aa0000' } }] })
    const out = applyInstance(BASE, patch)
    expect(out).toContain('fill="#aa0000"')
    expect(out).not.toContain('#112233')
    expect(out).toContain('<!-- spadewick:slot="art" -->')
    expect(out).toContain('data-spadewick-show-if="a > b"')      // a > inside a quoted value does not end a tag
    expect(out.replace('#aa0000', '#112233')).toBe(BASE)
  })

  it('keeps removed attributes, new attributes and the words of a text element', () => {
    const edited = edit(BASE, root => {
      const t = find(root, 'name')
      delete t.attrs['font-size']
      t.attrs['letter-spacing'] = '3'
      t.children = [{ text: 'Custom &amp; own' }]
    })
    const patch = diffInstance(BASE, edited)
    expect(patch.set).toEqual([{ t: 'name', a: { 'font-size': null, 'letter-spacing': '3' }, inner: 'Custom &amp; own' }])
    const out = applyInstance(BASE, patch)
    expect(out).toMatch(/<text[^>]*letter-spacing="3"[^>]*>Custom &amp; own<\/text>/)
    expect(out).not.toContain('font-size="20"')
    expect(out).not.toContain('{{name}}')
  })

  it('keeps an element added to the card (its art) in the place it was added, and one taken away', () => {
    const edited = edit(BASE, root => {
      const slot = find(root, 'art-slot')
      slot.children.push({ tag: 'image', attrs: { 'data-spadewick-id': 'art_1', href: 'data:image/png;base64,AAAA', x: '10', y: '10', width: '180', height: '120' }, children: [] })
      const trim = find(root, 'trim')
      trim.children = trim.children.filter(c => !(c.tag && c.attrs['data-spadewick-id'] === 'dot'))
    })
    const patch = diffInstance(BASE, edited)
    expect(patch.remove).toEqual(['dot'])
    expect(patch.add).toHaveLength(1)
    expect(patch.add[0]).toMatchObject({ parent: 'art-slot', before: null })
    const out = applyInstance(BASE, patch)
    expect(out).toMatch(/<g data-spadewick-id="art-slot">[\s\S]*<image[^>]*art_1[^>]*\/>\s*<\/g>/)
    expect(out).not.toContain('data-spadewick-id="dot"')
  })

  it('names an element that has no id by its place in the template', () => {
    const edited = edit(BASE, root => { const trim = find(root, 'trim'); trim.children.filter(c => c.tag).find(c => c.tag === 'path').attrs.fill = '#00ff00' })
    const patch = diffInstance(BASE, edited)
    expect(patch.set).toEqual([{ t: [0, 3], a: { fill: '#00ff00' } }])
    expect(applyInstance(BASE, patch)).toContain('<path d="M0 0L10 10" fill="#00ff00"/>')
  })

  it('treats an element the editor gave an id to, which the template had none, as the same element and not as a new one', () => {
    const edited = edit(BASE, root => { const p = find(root, 'trim').children.find(c => c.tag === 'path'); p.attrs['data-spadewick-id'] = 'path_1'; p.attrs.fill = '#0000ff' })
    const patch = diffInstance(BASE, edited)
    expect(patch.add).toBeUndefined()
    expect(patch.remove).toBeUndefined()
    expect(applyInstance(BASE, patch)).toContain('fill="#0000ff"')
  })

  it('skips a change to an element the template no longer has, and still draws', () => {
    const patch = { v: 1, set: [{ t: 'gone', a: { fill: 'red' } }, { t: 'bg', a: { fill: 'blue' } }], remove: ['also-gone'], add: [{ parent: 'nowhere', before: null, xml: '<g/>' }] }
    const out = applyInstance(BASE, patch)
    expect(out).toContain('fill="blue"')
    expect(out.endsWith('</svg>')).toBe(true)
  })

  it('does not apply changes inside an element that was removed', () => {
    const out = applyInstance(BASE, { v: 1, remove: ['art-slot'], set: [{ t: 'window', a: { fill: 'red' } }] })
    expect(out).not.toContain('art-slot')
    expect(out).not.toContain('window')
    expect(out).toContain('data-spadewick-id="name"')
  })

  it('refuses a patch that carries something that runs, or is far too big', () => {
    expect(() => checkPatch({ v: 1, add: [{ parent: null, before: null, xml: '<script>alert(1)</script>' }] })).toThrow()
    expect(() => checkPatch({ v: 1, set: [{ t: 'bg', a: { onclick: 'x' }, inner: '<a onload="x()"/>' }] })).toThrow()
    expect(() => checkPatch({ v: 1, add: [{ parent: null, before: null, xml: 'x'.repeat(500000) }] })).toThrow(/too big|too large/i)
  })

  it('reads a stored patch, and nothing from a broken or foreign one', () => {
    expect(readPatch(JSON.stringify({ v: 1, set: [] }))).toEqual({ v: 1, set: [] })
    expect(readPatch('not json')).toBe(null)
    expect(readPatch(JSON.stringify({ v: 2 }))).toBe(null)
    expect(readPatch(null)).toBe(null)
  })
})
