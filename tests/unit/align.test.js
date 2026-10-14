import { describe, it, expect } from 'vitest'
import { alignOffsets, distributeOffsets, boundsOf, moved } from '../../src/renderer/src/lib/align.js'

const A = { id: 'a', x: 10, y: 20, w: 40, h: 30 }
const B = { id: 'b', x: 100, y: 60, w: 20, h: 50 }
const C = { id: 'c', x: 200, y: 10, w: 60, h: 10 }

describe('boundsOf', () => {
  it('is the box that holds every box, or null', () => {
    expect(boundsOf([A, B, C])).toEqual({ x: 10, y: 10, w: 250, h: 100 })
    expect(boundsOf([])).toBeNull()
  })
})

describe('alignOffsets', () => {
  it('lines up on the left, right and centre of the selection', () => {
    expect(alignOffsets([A, B, C], 'left')).toEqual(new Map([['b', { dx: -90, dy: 0 }], ['c', { dx: -190, dy: 0 }]]))
    const right = alignOffsets([A, B, C], 'right')            // the right edge is 260
    expect(right.get('a')).toEqual({ dx: 210, dy: 0 })
    expect(right.get('b')).toEqual({ dx: 140, dy: 0 })
    expect(right.has('c')).toBe(false)                        // already there
    const centre = alignOffsets([A, B, C], 'hcenter')          // the middle is 135
    expect(moved([A, B, C], centre).map(b => b.x + b.w / 2)).toEqual([135, 135, 135])
  })

  it('lines up on the top, bottom and middle', () => {
    expect(moved([A, B, C], alignOffsets([A, B, C], 'top')).map(b => b.y)).toEqual([10, 10, 10])
    expect(moved([A, B, C], alignOffsets([A, B, C], 'bottom')).map(b => b.y + b.h)).toEqual([110, 110, 110])
    expect(moved([A, B, C], alignOffsets([A, B, C], 'vcenter')).map(b => b.y + b.h / 2)).toEqual([60, 60, 60])
  })

  it('aligns one element to the card when it is given as the target', () => {
    const card = { x: 0, y: 0, w: 500, h: 700 }
    expect(alignOffsets([A], 'hcenter', card).get('a')).toEqual({ dx: 220, dy: 0 })
    expect(alignOffsets([A], 'bottom', card).get('a')).toEqual({ dx: 0, dy: 650 })
    expect(alignOffsets([A], 'left', card).get('a')).toEqual({ dx: -10, dy: 0 })
  })

  it('ignores an unknown mode and an empty selection', () => {
    expect(alignOffsets([A, B], 'sideways').size).toBe(0)
    expect(alignOffsets([], 'left').size).toBe(0)
  })
})

describe('distributeOffsets', () => {
  it('makes the gaps between a row equal, keeping the outer two where they are', () => {
    const row = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 15, y: 0, w: 20, h: 10 }, { id: 'c', x: 90, y: 0, w: 10, h: 10 }]
    const out = distributeOffsets(row, 'x')
    expect([...out.keys()]).toEqual(['b'])
    const after = moved(row, out)
    expect(after[1].x - (after[0].x + after[0].w)).toBe(after[2].x - (after[1].x + after[1].w))   // 30 and 30
    expect(after[1].x).toBe(40)
  })

  it('works on a column and in any order of the list', () => {
    const col = [{ id: 'c', x: 0, y: 100, w: 10, h: 20 }, { id: 'a', x: 0, y: 0, w: 10, h: 20 }, { id: 'b', x: 0, y: 30, w: 10, h: 20 }]
    const after = moved(col, distributeOffsets(col, 'y'))
    const ys = after.map(b => b.y).sort((p, q) => p - q)
    expect(ys[1] - (ys[0] + 20)).toBe(ys[2] - (ys[1] + 20))
  })

  it('needs three elements', () => {
    expect(distributeOffsets([A, B], 'x').size).toBe(0)
    expect(distributeOffsets([A, B, C], 'z').size).toBe(0)
  })
})
