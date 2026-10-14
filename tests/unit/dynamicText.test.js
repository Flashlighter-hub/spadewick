import { describe, it, expect } from 'vitest'
import { wrapLines, measureWidth, layoutText, applyDynamicText } from '../../src/main/dynamicText.js'

describe('wrapLines', () => {
  it('keeps short text on one line', () => {
    expect(wrapLines('Hello world', 500, 14)).toEqual(['Hello world'])
  })
  it('wraps at word boundaries and never exceeds the width', () => {
    const lines = wrapLines('the quick brown fox jumps over the lazy dog', 100, 14)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(measureWidth(l, 14)).toBeLessThanOrEqual(100)
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog')
  })
  it('honours explicit newlines, including blank lines', () => {
    expect(wrapLines('a\n\nb', 500, 14)).toEqual(['a', '', 'b'])
    expect(wrapLines('a\r\nb', 500, 14)).toEqual(['a', 'b'])
  })
  it('breaks a word wider than the box', () => {
    const lines = wrapLines('Supercalifragilisticexpialidocious', 60, 14)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious')
  })
  it('does not wrap when width is unlimited', () => {
    expect(wrapLines('a b c d e f g', Infinity, 14)).toEqual(['a b c d e f g'])
  })
  it('handles empty text and runs of spaces without hanging', () => {
    expect(wrapLines('', 100, 14)).toEqual([''])
    expect(wrapLines('a    b', 100, 14)).toEqual(['a b'])
  })
  it('never loops forever on a box narrower than one character', () => {
    expect(wrapLines('abc', 1, 14).join('')).toBe('abc')
  })
})

describe('layoutText fit modes', () => {
  const body = 'Deal 3 damage to target creature. Then draw a card. If you control a Wizard draw two instead.'
  const base = { boxWidth: 150, boxHeight: 40, fontSize: 14, maxSize: 14, minSize: 6, lineHeight: 1.2, bold: false }

  it('wrap shows everything', () => {
    const r = layoutText(body, { ...base, fit: 'wrap' })
    expect(r.lines.join(' ')).toBe(body)
    expect(r.fontSize).toBe(14)
  })
  it('shrink reduces the size until the lines fit the box height', () => {
    const r = layoutText(body, { ...base, fit: 'shrink' })
    expect(r.fontSize).toBeLessThan(14)
    expect(r.lines.length * r.fontSize * 1.2).toBeLessThanOrEqual(40 + 0.01)
  })
  it('shrink stops at the minimum size', () => {
    const r = layoutText(body.repeat(10), { ...base, fit: 'shrink' })
    expect(r.fontSize).toBe(6)
  })
  it('truncate ends the last visible line with an ellipsis', () => {
    const r = layoutText(body, { ...base, fit: 'truncate' })
    expect(r.lines.length).toBe(Math.floor(40 / (14 * 1.2)))
    expect(r.lines.at(-1).endsWith('…')).toBe(true)
  })
  it('overflow returns the remainder for the overflow target', () => {
    const r = layoutText(body, { ...base, fit: 'overflow' })
    expect(r.overflow.length).toBeGreaterThan(0)
    expect((r.lines.join(' ') + ' ' + r.overflow).replace(/\s+/g, ' ')).toBe(body)
  })
})

describe('applyDynamicText', () => {
  const svg = attrs => `<svg xmlns="http://www.w3.org/2000/svg"><text ${attrs}>{{body}}</text></svg>`

  it('leaves text without data-spadewick-field untouched', () => {
    const s = svg('x="1" y="2"')
    expect(applyDynamicText(s, { body: 'hi' })).toBe(s)
  })
  it('emits one tspan per line and strips the data attributes', () => {
    const out = applyDynamicText(svg('data-spadewick-field="body" x="10" y="20" width="60" height="100" font-size="14"'), { body: 'one two three four five six' })
    expect(out.match(/<tspan/g).length).toBeGreaterThan(1)
    expect(out).not.toMatch(/data-spadewick/)
  })
  it('treats y as the box top when a box is set and as the baseline otherwise', () => {
    const boxed = applyDynamicText(svg('data-spadewick-field="body" x="0" y="100" width="200" height="50" font-size="20"'), { body: 'hi' })
    expect(Number(boxed.match(/<tspan x="0" y="([\d.]+)"/)[1])).toBeCloseTo(100 + 20 * 0.85, 1)
    const loose = applyDynamicText(svg('data-spadewick-field="body" x="0" y="100" font-size="20"'), { body: 'hi' })
    expect(loose).toMatch(/<tspan x="0" y="100">hi<\/tspan>/)
  })
  it('aligns lines to the box for text-anchor middle/end', () => {
    const mid = applyDynamicText(svg('data-spadewick-field="body" x="10" y="0" width="100" height="50" text-anchor="middle" font-size="12"'), { body: 'hi' })
    expect(mid).toMatch(/<tspan x="60"/)
    const end = applyDynamicText(svg('data-spadewick-field="body" x="10" y="0" width="100" height="50" text-anchor="end" font-size="12"'), { body: 'hi' })
    expect(end).toMatch(/<tspan x="110"/)
  })
  it('supports self-closing text elements', () => {
    const out = applyDynamicText('<svg><text data-spadewick-field="body" x="0" y="0" width="100" height="40" font-size="12"/></svg>', { body: 'hello' })
    expect(out).toMatch(/<text[^>]*><tspan[^>]*>hello<\/tspan><\/text>/)
  })
  it('escapes XML special characters in field values', () => {
    const out = applyDynamicText(svg('data-spadewick-field="body" x="0" y="0" font-size="12"'), { body: 'A & B <c> "d"' })
    expect(out).toContain('A &amp; B &lt;c&gt; &quot;d&quot;')
  })
  it('spaces lines using data-spadewick-line-height', () => {
    const out = applyDynamicText(svg('data-spadewick-field="body" x="0" y="0" width="200" height="200" font-size="10" data-spadewick-line-height="2"'), { body: 'a\nb' })
    const ys = [...out.matchAll(/y="([\d.]+)"/g)].map(m => Number(m[1]))
    expect(ys[1] - ys[0]).toBeCloseTo(20, 1)
  })
  it('writes the overflow marker only when text overflowed', () => {
    const attrs = 'data-spadewick-field="body" data-spadewick-text-fit="overflow" data-spadewick-overflow-target="more" x="0" y="0" width="80" height="20" font-size="14"'
    expect(applyDynamicText(svg(attrs), { body: 'this is quite a long body of text that overflows' })).toMatch(/spadewick:overflow-content id="more"/)
    expect(applyDynamicText(svg(attrs), { body: 'hi' })).not.toMatch(/overflow-content/)
  })
  it('handles a missing field value', () => {
    expect(() => applyDynamicText(svg('data-spadewick-field="nope" x="0" y="0" width="50" height="20" font-size="12"'), {})).not.toThrow()
  })
})
