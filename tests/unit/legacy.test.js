import { describe, it, expect } from 'vitest'
import { upgradeLegacyMarkup } from '../../src/shared/legacy.js'

describe('legacy markup (PRD §24.2, rename)', () => {
  it('rewrites data-cardexy-* attributes and cardexy: comment markers', () => {
    const out = upgradeLegacyMarkup('<g data-cardexy-show-if="a == 1" data-cardexy-id="x"><!-- cardexy:slot="body" --></g><!--cardexy:parent="b"-->')
    expect(out).toBe('<g data-spadewick-show-if="a == 1" data-spadewick-id="x"><!-- spadewick:slot="body" --></g><!--spadewick:parent="b"-->')
  })
  it('leaves current markup and ordinary text alone', () => {
    const s = '<text data-spadewick-id="t">cardexy is a name</text>'
    expect(upgradeLegacyMarkup(s)).toBe(s)
    expect(upgradeLegacyMarkup('')).toBe('')
    expect(upgradeLegacyMarkup(undefined)).toBe(undefined)
  })
})
