import { describe, it, expect } from 'vitest'
import { highlightSvg } from '../../src/renderer/src/lib/svgHighlight.js'

const textOf = html => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

describe('SVG source highlighting (PRD §8.6)', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" width="500">
  <!-- spadewick:slot="body" -->
  <text data-spadewick-id="t" x="10">{{name}} & more</text>
  <rect fill="{{@palette.brand}}" />
</svg>`

  it('never changes the visible text, so it can sit exactly under a textarea', () => {
    expect(textOf(highlightSvg(src))).toBe(src)
  })
  it('marks tags, attributes, strings, comments and tokens', () => {
    const html = highlightSvg(src)
    expect(html).toContain('<span class="hl-tag">svg</span>')
    expect(html).toContain('<span class="hl-attr">xmlns</span>')
    expect(html).toContain('<span class="hl-string">"http://www.w3.org/2000/svg"</span>')
    expect(html).toMatch(/<span class="hl-comment">&lt;!-- spadewick:slot="body" --&gt;<\/span>/)
    expect(html).toContain('<span class="hl-token">{{name}}</span>')
    expect(html).toContain('<span class="hl-token">{{@palette.brand}}</span>')
  })
  it('escapes markup so source can never inject HTML', () => {
    const html = highlightSvg('<text>&lt;script&gt;<script>alert(1)</script></text>')
    expect(html).not.toContain('<script>')
    expect(textOf(html)).toBe('<text>&lt;script&gt;<script>alert(1)</script></text>')
  })
  it('copes with broken and partial source', () => {
    for (const s of ['', '<', '<svg', '<svg attr="unterminated', '<<>>', '{{', 'plain text', '<a b=>']) expect(textOf(highlightSvg(s))).toBe(s)
  })
  it('is fast enough to run on every keystroke for a large template', () => {
    const big = '<g>' + '<text x="1" y="2">{{name}}</text>'.repeat(3000) + '</g>'
    const t = Date.now(); highlightSvg(big)
    expect(Date.now() - t).toBeLessThan(150)
  })
})
