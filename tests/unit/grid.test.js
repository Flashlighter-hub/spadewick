import { describe, it, expect } from 'vitest'
import { visibleRange, moveActive, applySelection, reorderIds, moveItem, clampWidth } from '../../src/renderer/src/lib/grid.js'

describe('visibleRange (virtual scrolling)', () => {
  it('renders only the rows in view plus overscan', () => {
    const r = visibleRange({ scrollTop: 3000, viewportHeight: 600, rowHeight: 30, total: 1000, overscan: 5 })
    expect(r).toEqual({ start: 95, end: 125 })
    expect(r.end - r.start).toBeLessThan(40)           // 1,000 rows, ~30 in the DOM
  })
  it('clamps at both ends', () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 300, rowHeight: 30, total: 1000 }).start).toBe(0)
    expect(visibleRange({ scrollTop: 29700, viewportHeight: 300, rowHeight: 30, total: 1000 }).end).toBe(1000)
  })
  it('handles tiny and empty tables', () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 600, rowHeight: 30, total: 3 })).toEqual({ start: 0, end: 3 })
    expect(visibleRange({ scrollTop: 0, viewportHeight: 600, rowHeight: 30, total: 0 })).toEqual({ start: 0, end: 0 })
  })
})

describe('moveActive (keyboard navigation)', () => {
  const dims = { rows: 3, cols: 4 }
  it('moves with the arrow keys and stays inside the grid', () => {
    expect(moveActive({ row: 1, col: 1 }, 'ArrowDown', {}, dims)).toEqual({ row: 2, col: 1 })
    expect(moveActive({ row: 2, col: 1 }, 'ArrowDown', {}, dims)).toEqual({ row: 2, col: 1 })
    expect(moveActive({ row: 0, col: 0 }, 'ArrowLeft', {}, dims)).toEqual({ row: 0, col: 0 })
    expect(moveActive({ row: 0, col: 3 }, 'ArrowRight', {}, dims)).toEqual({ row: 0, col: 3 })
  })
  it('Tab walks across the row, wraps to the next, and asks for a new row after the last cell', () => {
    expect(moveActive({ row: 0, col: 1 }, 'Tab', {}, dims)).toEqual({ row: 0, col: 2 })
    expect(moveActive({ row: 0, col: 3 }, 'Tab', {}, dims)).toEqual({ row: 1, col: 0 })
    expect(moveActive({ row: 2, col: 3 }, 'Tab', {}, dims)).toEqual({ row: 2, col: 3, addRow: true })
  })
  it('Shift-Tab goes backwards and stops at the first cell', () => {
    expect(moveActive({ row: 1, col: 0 }, 'Tab', { shift: true }, dims)).toEqual({ row: 0, col: 3 })
    expect(moveActive({ row: 0, col: 0 }, 'Tab', { shift: true }, dims)).toEqual({ row: 0, col: 0 })
  })
  it('Enter moves down and Shift-Enter moves up', () => {
    expect(moveActive({ row: 0, col: 2 }, 'Enter', {}, dims)).toEqual({ row: 1, col: 2 })
    expect(moveActive({ row: 1, col: 2 }, 'Enter', { shift: true }, dims)).toEqual({ row: 0, col: 2 })
    expect(moveActive({ row: 2, col: 2 }, 'Enter', {}, dims)).toEqual({ row: 2, col: 2 })
  })
  it('ignores keys it does not handle', () => {
    expect(moveActive({ row: 1, col: 1 }, 'x', {}, dims)).toEqual({ row: 1, col: 1 })
  })
})

describe('applySelection', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const base = { ids, selected: [], anchor: null }
  it('selects a single row on a plain click', () => {
    expect(applySelection({ ...base, selected: ['a', 'b'] }, 'c')).toEqual({ selected: ['c'], anchor: 'c' })
  })
  it('selects a range from the anchor on shift-click, in either direction', () => {
    expect(applySelection({ ids, selected: ['b'], anchor: 'b' }, 'd', { shift: true }).selected).toEqual(['b', 'c', 'd'])
    expect(applySelection({ ids, selected: ['d'], anchor: 'd' }, 'b', { shift: true }).selected).toEqual(['b', 'c', 'd'])
  })
  it('toggles on ctrl-click', () => {
    expect(applySelection({ ids, selected: ['a'], anchor: 'a' }, 'c', { ctrl: true }).selected).toEqual(['a', 'c'])
    expect(applySelection({ ids, selected: ['a', 'c'], anchor: 'c' }, 'a', { ctrl: true }).selected).toEqual(['c'])
  })
  it('treats shift-click with no anchor as a plain click', () => {
    expect(applySelection(base, 'c', { shift: true }).selected).toEqual(['c'])
  })
})

describe('reorderIds (row drag)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  it('moves a row before the target index', () => {
    expect(reorderIds(ids, ['d'], 1)).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(reorderIds(ids, ['a'], 4)).toEqual(['b', 'c', 'd', 'a', 'e'])
  })
  it('moves to the very end', () => {
    expect(reorderIds(ids, ['b'], 5)).toEqual(['a', 'c', 'd', 'e', 'b'])
  })
  it('moves several selected rows together, keeping their order', () => {
    expect(reorderIds(ids, ['e', 'b'], 3)).toEqual(['a', 'c', 'b', 'e', 'd'])
  })
  it('never loses or duplicates rows', () => {
    for (const target of [0, 1, 2, 3, 4, 5]) for (const mv of [['a'], ['c', 'd'], ['e', 'a']]) {
      expect([...reorderIds(ids, mv, target)].sort()).toEqual([...ids].sort())
    }
  })
  it('is a no-op for an unknown row', () => {
    expect(reorderIds(ids, ['zzz'], 2)).toEqual(ids)
  })
})

describe('moveItem and clampWidth', () => {
  it('reorders columns', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })
  it('keeps column widths in a usable range', () => {
    expect(clampWidth(10)).toBe(60); expect(clampWidth(5000)).toBe(800); expect(clampWidth(150.6)).toBe(151)
  })
})
