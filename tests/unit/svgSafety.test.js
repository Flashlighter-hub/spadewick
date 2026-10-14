import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from '../../src/shared/svgSafety.js'

describe('sanitizeSvg (PRD §14.7)', () => {
  it('removes scripts, embedded HTML and event handlers', () => {
    const out = sanitizeSvg('<svg onload="x()"><script>alert(1)</script><foreignObject><div/></foreignObject><rect onclick=\'y()\' width="1"/></svg>')
    expect(out).toBe('<svg><rect width="1"/></svg>')
  })
  it('blanks references to anything outside the file but keeps data URIs, # references and tokens', () => {
    const out = sanitizeSvg('<image href="http://evil/x.png"/><image xlink:href="file:///etc/passwd"/><image href="data:image/png;base64,AA=="/><use href="#a"/><image href="{{@asset.1}}"/><image href="//host/x"/>')
    expect(out).toContain('<image href=""/><image xlink:href=""/>')
    expect(out).toContain('href="data:image/png;base64,AA=="')
    expect(out).toContain('<use href="#a"/>')
    expect(out).toContain('href="{{@asset.1}}"')
    expect(out).toContain('<image href=""/>')
    expect(out).not.toMatch(/evil|passwd|host/)
  })
  it('removes network styles and javascript: URLs', () => {
    const out = sanitizeSvg('<style>@import url(http://x/y.css); .a{fill:url(https://x/z)} </style><a href="javascript:alert(1)"/>')
    expect(out).not.toMatch(/@import|https?:|javascript:/i)
  })
  it('leaves ordinary artwork and tokens untouched', () => {
    const s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="url(#g)" data-spadewick-show-if="a == 1"/><text>{{name}}</text></svg>'
    expect(sanitizeSvg(s)).toBe(s)
    expect(sanitizeSvg(undefined)).toBe('')
  })
})

describe('sanitizeSvg: harder cases', () => {
  it('removes handlers written after a slash or a quote, and leaves text alone', () => {
    expect(sanitizeSvg('<svg/onload=alert(1)>')).toBe('<svg/>')
    expect(sanitizeSvg('<rect fill="red"onclick="x()" width="1"/>')).toBe('<rect fill="red" width="1"/>')
    expect(sanitizeSvg('<text>once = 5 and onion=7</text>')).toBe('<text>once = 5 and onion=7</text>')
  })
})
