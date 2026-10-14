import { describe, it, expect } from 'vitest'
import { LIMITS, clampTo, sanitizeLayout } from '../../src/renderer/src/stores/layout.js'

describe('panel layout (PRD §12.5)', () => {
  it('keeps every value within its range, so a panel can never be dragged out of reach', () => {
    expect(clampTo('sidebar', 10)).toBe(LIMITS.sidebar.min)
    expect(clampTo('sidebar', 5000)).toBe(LIMITS.sidebar.max)
    expect(clampTo('sidebar', 300)).toBe(300)
    expect(clampTo('propsSplit', 0.01)).toBe(LIMITS.propsSplit.min)
    expect(clampTo('propsSplit', 0.99)).toBe(LIMITS.propsSplit.max)
  })

  it('uses the original size for something that is not a number', () => {
    expect(clampTo('props', 'wide')).toBe(LIMITS.props.reset)
    expect(clampTo('props', undefined)).toBe(LIMITS.props.reset)
  })

  it('reads a saved layout, putting back anything missing, damaged or out of range', () => {
    expect(sanitizeLayout(undefined)).toMatchObject({ sidebar: LIMITS.sidebar.reset, templateListOpen: true, propsSplit: 0.5 })
    expect(sanitizeLayout('nonsense')).toMatchObject({ props: LIMITS.props.reset })
    const out = sanitizeLayout({ sidebar: 9999, templateList: 200, templateListOpen: false, propsSplit: 'x', unknown: 1 })
    expect(out).toMatchObject({ sidebar: LIMITS.sidebar.max, templateList: 200, templateListOpen: false, propsSplit: LIMITS.propsSplit.reset })
    expect(out.unknown).toBeUndefined()
  })

  it('has a sensible range for every panel: the minimum is below the original size, which is below the maximum', () => {
    for (const [key, l] of Object.entries(LIMITS)) expect(l.min, key).toBeLessThan(l.reset), expect(l.reset, key).toBeLessThan(l.max)
  })
})
