/**
 * Preparing an imported SVG as an icon (PRD §16.4).
 */
import { describe, it, expect } from 'vitest'
import { normalizeIconSvg, iconSvgParts, MAX_ICON_SVG_BYTES } from '../../src/shared/iconSvg.js'

const wrap = (inner, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`

describe('reading an icon SVG', () => {
  it('reads the view box, or the width and height when there is none', () => {
    expect(normalizeIconSvg(wrap('<path d="M0 0h10v10z"/>')).viewBox).toEqual([0, 0, 24, 24])
    expect(normalizeIconSvg(wrap('<path d="M0 0h10v10z"/>', 'viewBox="2 3 40 20"')).aspect).toBeCloseTo(2)
    expect(normalizeIconSvg(wrap('<path d="M0 0h10v10z"/>', 'width="30" height="15"')).viewBox).toEqual([0, 0, 30, 15])
  })

  it('refuses what is not an SVG, has no size, or is too big', () => {
    expect(normalizeIconSvg('hello')).toEqual({ error: 'notSvg' })
    expect(normalizeIconSvg('')).toEqual({ error: 'notSvg' })
    expect(normalizeIconSvg(wrap('<path d="M0 0"/>', ''))).toEqual({ error: 'noSize' })
    expect(normalizeIconSvg(wrap('x'.repeat(MAX_ICON_SVG_BYTES + 10)))).toEqual({ error: 'tooBig' })
  })

  it('removes scripts, event handlers, external references, metadata and comments', () => {
    const r = normalizeIconSvg(wrap('<title>t</title><!-- c --><script>alert(1)</script><path onclick="x()" d="M0 0h5v5z" fill="#000"/><image href="http://evil/x.png"/>'))
    expect(r.svg).not.toMatch(/script|onclick|evil|title|<!--/i)
    expect(r.svg).toContain('d="M0 0h5v5z"')
  })
})

describe('one colour or several', () => {
  it('treats an icon with one colour (or none stated) as single-colour and makes it follow the text', () => {
    const black = normalizeIconSvg(wrap('<path d="M0 0h5v5z" fill="#000"/><path d="M6 6h5v5z" fill="#000000"/>'))
    expect(black.single).toBe(true)
    expect(black.colors).toEqual(['#000000'])
    expect(black.svg).toContain('fill="currentColor"')
    expect(black.svg).toContain('color="#000000"') // its own colour is remembered on the root
    expect(black.svg).not.toMatch(/fill="#0/)
    const none = normalizeIconSvg(wrap('<path d="M0 0h5v5z"/>'))
    expect(none.single).toBe(true)
    expect(none.svg).toMatch(/^<svg[^>]* fill="currentColor"/)
    const stroked = normalizeIconSvg(wrap('<path d="M0 0L5 5" fill="none" stroke="#123"/>'))
    expect(stroked.single).toBe(true)
    expect(stroked.svg).toContain('fill="none"')
    expect(stroked.svg).toContain('stroke="currentColor"')
    const css = normalizeIconSvg(wrap('<path d="M0 0h5v5z" style="fill:#abc;stroke:none"/>'))
    expect(css.single).toBe(true)
    expect(css.svg).toContain('fill:currentColor')
    expect(css.svg).toContain('stroke:none')
  })

  it('keeps the colours of an icon with several, and of one with gradients, patterns, images or a style block', () => {
    const two = normalizeIconSvg(wrap('<path d="M0 0h5v5z" fill="#f00"/><path d="M6 6h5v5z" fill="#00f"/>'))
    expect(two.single).toBe(false)
    expect(two.svg).toContain('#f00')
    expect(two.svg).not.toMatch(/^<svg[^>]* fill="currentColor"/)
    expect(normalizeIconSvg(wrap('<defs><linearGradient id="g"/></defs><path d="M0 0h5v5z" fill="url(#g)"/>')).single).toBe(false)
    expect(normalizeIconSvg(wrap('<style>.a{fill:red}</style><path class="a" d="M0 0h5v5z"/>')).single).toBe(false)
  })

  it('counts #abc and #aabbcc as the same colour', () => {
    expect(normalizeIconSvg(wrap('<path fill="#abc" d="M0 0"/><path fill="#AABBCC" d="M1 1"/>')).single).toBe(true)
  })
})

describe('using a stored icon', () => {
  it('gives the inner markup and view box back', () => {
    const r = normalizeIconSvg(wrap('<path d="M0 0h5v5z"/>', 'viewBox="0 0 10 20"'))
    const parts = iconSvgParts(r.svg)
    expect(parts.viewBox).toEqual([0, 0, 10, 20])
    expect(parts.inner).toBe('<path d="M0 0h5v5z"/>')
    expect(parts.single).toBe(true)
    expect(parts.ownColor).toBe('#000000')
    expect(iconSvgParts('not svg')).toBeNull()
  })
})
