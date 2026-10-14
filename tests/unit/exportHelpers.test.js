import { describe, it, expect } from 'vitest'
import { parseHex, cellPositions } from '../../src/main/core/export.js'

describe('parseHex', () => {
  it('keeps zero channels (a pure red/black must not fall back to defaults)', () => {
    expect(parseHex('#ff0000')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseHex('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseHex('00ff00')).toEqual({ r: 0, g: 255, b: 0 })
  })
  it('expands short hex', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })
  it('falls back only for malformed input', () => {
    expect(parseHex('red', { r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 })
    expect(parseHex(undefined)).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseHex('#12345')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('cellPositions (duplex alignment)', () => {
  it('lays fronts out left-to-right, top-to-bottom', () => {
    expect(cellPositions(4, 3)).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }])
  })
  it('mirrors columns for backs so each back sits behind its front', () => {
    const fronts = cellPositions(5, 3), backs = cellPositions(5, 3, true)
    fronts.forEach((f, i) => { expect(backs[i].row).toBe(f.row); expect(backs[i].col).toBe(2 - f.col) })
  })
  it('a partly filled row keeps backs at the mirrored columns (not shifted left)', () => {
    expect(cellPositions(2, 3, true)).toEqual([{ row: 0, col: 2 }, { row: 0, col: 1 }])
  })
})
