import { describe, it, expect } from 'vitest'
import { parseAspect, fitImage } from '../../src/renderer/src/lib/liveFit.js'

describe('parseAspect (PRD §8.7.3)', () => {
  it('defaults to xMidYMid meet', () => {
    expect(parseAspect(undefined)).toEqual({ none: false, slice: false, ax: 0.5, ay: 0.5 })
    expect(parseAspect('garbage')).toEqual({ none: false, slice: false, ax: 0.5, ay: 0.5 })
  })

  it('reads alignment and meet or slice', () => {
    expect(parseAspect('xMinYMax slice')).toEqual({ none: false, slice: true, ax: 0, ay: 1 })
    expect(parseAspect('defer xMaxYMin meet')).toEqual({ none: false, slice: false, ax: 1, ay: 0 })
  })

  it('reads none', () => {
    expect(parseAspect('none').none).toBe(true)
  })
})

describe('fitImage', () => {
  const box = { x: 10, y: 20, w: 200, h: 100 }
  const square = { w: 400, h: 400 }

  it('meet: fits inside the box and centres', () => {
    expect(fitImage(box, square, 'xMidYMid meet')).toEqual({ x: 60, y: 20, w: 100, h: 100 })
  })

  it('slice: covers the box, overflowing on the short side', () => {
    expect(fitImage(box, square, 'xMidYMid slice')).toEqual({ x: 10, y: -30, w: 200, h: 200 })
  })

  it('none: stretches to the box', () => {
    expect(fitImage(box, square, 'none')).toEqual(box)
  })

  it('honours alignment', () => {
    expect(fitImage(box, square, 'xMinYMid meet').x).toBe(10)
    expect(fitImage(box, square, 'xMaxYMid meet').x).toBe(110)
  })

  it('falls back to the box when the picture has no size', () => {
    expect(fitImage(box, { w: 0, h: 0 }, 'xMidYMid meet')).toEqual(box)
  })

  it('keeps the picture proportional while the box changes shape', () => {
    const wide = fitImage({ x: 0, y: 0, w: 400, h: 100 }, { w: 200, h: 100 }, 'xMidYMid meet')
    expect(wide.w / wide.h).toBeCloseTo(2)
  })
})
