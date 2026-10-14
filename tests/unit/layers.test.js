import { describe, it, expect } from 'vitest'
import { reorder, moveRelative, sameOrder, layerLabel } from '../../src/renderer/src/lib/layers.js'

// SVG order: first is at the back, last is on top
const ids = ['bg', 'art', 'title', 'badge']

describe('reorder (PRD §8.7.2)', () => {
  it('brings an element to the front and sends one to the back', () => {
    expect(reorder(ids, 'art', 'front')).toEqual(['bg', 'title', 'badge', 'art'])
    expect(reorder(ids, 'title', 'back')).toEqual(['title', 'bg', 'art', 'badge'])
  })

  it('moves one step forward or backward', () => {
    expect(reorder(ids, 'art', 'forward')).toEqual(['bg', 'title', 'art', 'badge'])
    expect(reorder(ids, 'title', 'backward')).toEqual(['bg', 'title', 'art', 'badge'])
  })

  it('does nothing at the ends', () => {
    expect(reorder(ids, 'badge', 'forward')).toEqual(ids)
    expect(reorder(ids, 'badge', 'front')).toEqual(ids)
    expect(reorder(ids, 'bg', 'backward')).toEqual(ids)
    expect(reorder(ids, 'bg', 'back')).toEqual(ids)
  })

  it('ignores an unknown id and does not change its input', () => {
    const copy = ids.slice()
    expect(reorder(ids, 'nope', 'front')).toEqual(ids)
    reorder(ids, 'art', 'front')
    expect(ids).toEqual(copy)
  })
})

describe('moveRelative', () => {
  it('puts an element directly in front of a target', () => {
    expect(moveRelative(ids, 'bg', 'title', 'front')).toEqual(['art', 'title', 'bg', 'badge'])
  })

  it('puts an element directly behind a target', () => {
    expect(moveRelative(ids, 'badge', 'art', 'behind')).toEqual(['bg', 'badge', 'art', 'title'])
  })

  it('is a no-op for the same element or a missing one', () => {
    expect(moveRelative(ids, 'art', 'art', 'front')).toEqual(ids)
    expect(moveRelative(ids, 'art', 'zzz', 'front')).toEqual(ids)
    expect(moveRelative(ids, 'zzz', 'art', 'front')).toEqual(ids)
  })

  it('reports whether anything changed', () => {
    expect(sameOrder(ids, moveRelative(ids, 'art', 'bg', 'front'))).toBe(true) // already directly in front of bg
    expect(sameOrder(ids, moveRelative(ids, 'bg', 'badge', 'front'))).toBe(false)
  })
})

describe('layerLabel', () => {
  it('prefers visible text, then the field, then the id', () => {
    expect(layerLabel({ text: ' Fire  Drake ', field: 'name', id: 'text_1' })).toBe('Fire Drake')
    expect(layerLabel({ text: '', field: 'art', id: 'image_1' })).toBe('art')
    expect(layerLabel({ text: '', field: '', id: 'rect_2' })).toBe('rect_2')
  })

  it('shortens long labels', () => {
    const l = layerLabel({ text: 'x'.repeat(60), id: 'a' }, 10)
    expect(l).toHaveLength(10)
    expect(l.endsWith('…')).toBe(true)
  })
})
