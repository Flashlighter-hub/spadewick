import { describe, it, expect } from 'vitest'
import { SNAP_PX, buildTargets, cardTargets, elementTargets, snapRect, guidesFor, linesOf, gapsFor } from '../../src/renderer/src/lib/snap.js'

const CARD = { w: 500, h: 700 }

describe('snap targets (PRD §8.7.4)', () => {
  it('offers the card edges and centre lines', () => {
    const t = cardTargets(CARD)
    expect(t.filter(x => x.axis === 'x').map(x => x.pos)).toEqual([0, 250, 500])
    expect(t.filter(x => x.axis === 'y').map(x => x.pos)).toEqual([0, 350, 700])
  })

  it('offers three vertical and three horizontal lines of another element', () => {
    const t = elementTargets({ x: 100, y: 200, w: 60, h: 40 })
    expect(t.filter(x => x.axis === 'x').map(x => x.pos)).toEqual([100, 130, 160])
    expect(t.filter(x => x.axis === 'y').map(x => x.pos)).toEqual([200, 220, 240])
  })

  it('lists the lines of a rectangle', () => {
    expect(linesOf({ x: 10, y: 20, w: 100, h: 50 })).toEqual({ x: [10, 60, 110], y: [20, 45, 70] })
  })
})

describe('snapRect: moving', () => {
  const targets = buildTargets(CARD, [{ x: 100, y: 300, w: 80, h: 40 }])

  it('snaps an edge to the card edge within the threshold', () => {
    const r = snapRect({ x: 4, y: 100, w: 50, h: 50 }, targets, 6)
    expect(r.rect.x).toBe(0)
    expect(r.snappedX).toBe(true)
    expect(r.guides.some(g => g.axis === 'x' && g.pos === 0)).toBe(true)
  })

  it('does not snap beyond the threshold', () => {
    const r = snapRect({ x: 20, y: 100, w: 50, h: 50 }, targets, 6)
    expect(r.rect.x).toBe(20)
    expect(r.snappedX).toBe(false)
  })

  it('snaps the centre of the moving element to the card centre', () => {
    const r = snapRect({ x: 223, y: 100, w: 50, h: 50 }, targets, 6) // centre 248 -> 250
    expect(r.rect.x).toBe(225)
    expect(r.snappedX).toBe(true)
  })

  it('snaps to another element and draws the guide across both', () => {
    const r = snapRect({ x: 97, y: 100, w: 30, h: 30 }, targets, 6) // left edge -> 100 (the other element's left)
    expect(r.rect.x).toBe(100)
    const g = r.guides.find(g => g.axis === 'x' && g.pos === 100)
    expect(g).toBeTruthy()
    expect(g.from).toBeLessThanOrEqual(100)       // from the moving element
    expect(g.to).toBeGreaterThanOrEqual(340)      // to the bottom of the element it lines up with
  })

  it('snaps both axes independently', () => {
    const r = snapRect({ x: 3, y: 697 - 50, w: 50, h: 50 }, targets, 6)
    expect(r.rect.x).toBe(0)
    expect(r.rect.y).toBe(650)
    expect(r.snappedX && r.snappedY).toBe(true)
  })

  it('picks the closest target when several are in range', () => {
    const t = [{ axis: 'x', pos: 10, from: 0, to: 1 }, { axis: 'x', pos: 13, from: 0, to: 1 }]
    expect(snapRect({ x: 12, y: 0, w: 10, h: 10 }, t, 6).rect.x).toBe(13)
  })

  it('works at any zoom because the threshold is given in card units', () => {
    const px = SNAP_PX
    const near = snapRect({ x: 2, y: 50, w: 10, h: 10 }, targets, px / 4)   // zoomed in 4x: 1.5 card units
    expect(near.snappedX).toBe(false)
    const zoomedOut = snapRect({ x: 2, y: 50, w: 10, h: 10 }, targets, px / 0.25)  // zoomed out 4x: 24 units
    expect(zoomedOut.snappedX).toBe(true)
  })
})

describe('snapRect: resizing', () => {
  const targets = buildTargets(CARD, [])

  it('snaps only the edges being moved', () => {
    // the left edge is at 4 (near 0) but only the right edge is being dragged
    const r = snapRect({ x: 4, y: 100, w: 244, h: 50 }, targets, 6, { right: true }) // right edge 248 -> 250
    expect(r.rect.x).toBe(4)
    expect(r.rect.w).toBe(246)
  })

  it('moves the origin and the size together for a left edge', () => {
    const r = snapRect({ x: 3, y: 100, w: 100, h: 50 }, targets, 6, { left: true })
    expect(r.rect.x).toBe(0)
    expect(r.rect.w).toBe(103)
    expect(r.rect.x + r.rect.w).toBe(103) // the right edge did not move
  })

  it('handles top and bottom edges', () => {
    const top = snapRect({ x: 10, y: 5, w: 50, h: 100 }, targets, 6, { top: true })
    expect(top.rect.y).toBe(0)
    expect(top.rect.y + top.rect.h).toBe(105)
    const bottom = snapRect({ x: 10, y: 600, w: 50, h: 97 }, targets, 6, { bottom: true })
    expect(bottom.rect.y + bottom.rect.h).toBe(700)
  })

  it('leaves the rectangle alone when nothing is in range', () => {
    const r = snapRect({ x: 100, y: 100, w: 100, h: 100 }, targets, 6, { right: true, bottom: true })
    expect(r.rect).toEqual({ x: 100, y: 100, w: 100, h: 100 })
    expect(r.guides).toEqual([])
  })
})

describe('guidesFor', () => {
  it('reports one guide per aligned position', () => {
    const t = [{ axis: 'x', pos: 50, from: 0, to: 100 }, { axis: 'x', pos: 50, from: 200, to: 300 }]
    const g = guidesFor({ x: 50, y: 120, w: 20, h: 20 }, t)
    expect(g).toHaveLength(1)
    expect(g[0]).toEqual({ axis: 'x', pos: 50, from: 0, to: 300 })
  })
})

describe('gapsFor (distance labels)', () => {
  const me = { x: 100, y: 100, w: 50, h: 50 }

  it('measures the gap to the nearest element on each side', () => {
    const g = gapsFor(me, [{ x: 20, y: 90, w: 60, h: 80 }, { x: 200, y: 110, w: 40, h: 20 }, { x: 90, y: 20, w: 80, h: 50 }, { x: 110, y: 300, w: 10, h: 10 }])
    const by = (axis, size) => g.find(x => x.axis === axis && Math.abs(x.size - size) < 0.01)
    expect(by('x', 20)).toMatchObject({ from: 80, to: 100 })     // left neighbour ends at 80
    expect(by('x', 50)).toMatchObject({ from: 150, to: 200 })    // right neighbour starts at 200
    expect(by('y', 30)).toMatchObject({ from: 70, to: 100 })     // above ends at 70
    expect(by('y', 150)).toMatchObject({ from: 150, to: 300 })   // below starts at 300
  })

  it('draws each gap in the middle of the overlap between the two elements', () => {
    const [g] = gapsFor(me, [{ x: 20, y: 120, w: 60, h: 100 }])   // overlaps y 120..150
    expect(g.at).toBe(135)
  })

  it('ignores elements that do not face the rectangle, and elements that touch it', () => {
    expect(gapsFor(me, [{ x: 20, y: 300, w: 60, h: 20 }])).toEqual([])        // diagonal: no shared row or column
    expect(gapsFor(me, [{ x: 50, y: 90, w: 50, h: 80 }])).toEqual([])        // touching on the left (gap 0)
  })

  it('takes the nearest of several elements on one side', () => {
    const g = gapsFor(me, [{ x: 0, y: 100, w: 10, h: 50 }, { x: 60, y: 100, w: 10, h: 50 }])
    expect(g).toHaveLength(1)
    expect(g[0].size).toBe(30)
  })

  it('marks equal gaps on both sides', () => {
    const g = gapsFor(me, [{ x: 20, y: 100, w: 30, h: 50 }, { x: 200, y: 100, w: 30, h: 50 }])   // 50 and 50
    expect(g).toHaveLength(2)
    expect(g.every(x => x.equal)).toBe(true)
    const unequal = gapsFor(me, [{ x: 20, y: 100, w: 30, h: 50 }, { x: 210, y: 100, w: 30, h: 50 }])
    expect(unequal.some(x => x.equal)).toBe(false)
  })
})
