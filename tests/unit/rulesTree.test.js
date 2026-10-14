import { describe, it, expect } from 'vitest'
import { childrenOf, flatten, pathOf, isBelow, moveTargets, neighbourAfterRemoval, pageByTitle } from '../../src/renderer/src/lib/rulesTree.js'

const P = (id, parent, order, title = id) => ({ id, parent_id: parent, sort_order: order, title })
// A, B (B1, B2 (B2a)), C
const pages = [P('c', null, 2), P('b2a', 'b2', 0), P('a', null, 0), P('b', null, 1), P('b2', 'b', 1), P('b1', 'b', 0)]

describe('the tree of pages', () => {
  it('lists the pages of a level in order', () => {
    expect(childrenOf(pages, null).map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(childrenOf(pages, 'b').map(p => p.id)).toEqual(['b1', 'b2'])
    expect(childrenOf(pages, 'a')).toEqual([])
  })

  it('flattens with the depth, parents first, and leaves out what is below a collapsed page', () => {
    expect(flatten(pages).map(r => [r.page.id, r.depth])).toEqual([['a', 0], ['b', 0], ['b1', 1], ['b2', 1], ['b2a', 2], ['c', 0]])
    expect(flatten(pages).find(r => r.page.id === 'b')).toMatchObject({ hasChildren: true, expanded: true })
    expect(flatten(pages).find(r => r.page.id === 'a')).toMatchObject({ hasChildren: false })
    const folded = flatten(pages, new Set(['b']))
    expect(folded.map(r => r.page.id)).toEqual(['a', 'b', 'c'])
    expect(folded[1]).toMatchObject({ hasChildren: true, expanded: false })
    expect(flatten(pages, new Set(['b2'])).map(r => r.page.id)).toEqual(['a', 'b', 'b1', 'b2', 'c'])
  })

  it('knows the way down to a page and what is below what', () => {
    expect(pathOf(pages, 'b2a').map(p => p.id)).toEqual(['b', 'b2', 'b2a'])
    expect(pathOf(pages, 'nope')).toEqual([])
    expect(isBelow(pages, 'b2a', 'b')).toBe(true)
    expect(isBelow(pages, 'b', 'b')).toBe(false)
    expect(isBelow(pages, 'a', 'b')).toBe(false)
  })

  it('does not loop on pages that point at each other', () => {
    const loop = [P('x', 'y', 0), P('y', 'x', 0)]
    expect(pathOf(loop, 'x').length).toBeLessThanOrEqual(100)
    expect(flatten(loop)).toEqual([])
  })
})

describe('one step of moving', () => {
  it('up and down among the pages of the level', () => {
    expect(moveTargets(pages, 'b')).toMatchObject({ up: { parentId: null, index: 0 }, down: { parentId: null, index: 2 } })
    expect(moveTargets(pages, 'a').up).toBeNull()
    expect(moveTargets(pages, 'c').down).toBeNull()
    expect(moveTargets(pages, 'b2')).toMatchObject({ up: { parentId: 'b', index: 0 }, down: null })
  })

  it('in under the page above, at its end, and out after its parent', () => {
    expect(moveTargets(pages, 'b').indent).toEqual({ parentId: 'a', index: 0 })
    expect(moveTargets(pages, 'c').indent).toEqual({ parentId: 'b', index: 2 })
    expect(moveTargets(pages, 'a').indent).toBeNull()
    expect(moveTargets(pages, 'b2').outdent).toEqual({ parentId: null, index: 2 })
    expect(moveTargets(pages, 'b2a').outdent).toEqual({ parentId: 'b', index: 2 })
    expect(moveTargets(pages, 'a').outdent).toBeNull()
  })

  it('has no step for a page that is not there', () => {
    expect(moveTargets(pages, 'nope')).toEqual({ up: null, down: null, indent: null, outdent: null })
  })
})

describe('around the list', () => {
  it('picks the page to show when one goes: below it, else above it, else its parent', () => {
    expect(neighbourAfterRemoval(pages, 'a')).toBe('b')
    expect(neighbourAfterRemoval(pages, 'c')).toBe('b')
    expect(neighbourAfterRemoval(pages, 'b2a')).toBe('b2')
    expect(neighbourAfterRemoval([P('only', null, 0)], 'only')).toBeNull()
    expect(neighbourAfterRemoval(pages, 'nope')).toBeNull()
  })

  it('finds a page by its title in any case', () => {
    const named = [P('x', null, 0, 'Turn Order')]
    expect(pageByTitle(named, ' turn order ')?.id).toBe('x')
    expect(pageByTitle(named, 'other')).toBeNull()
  })
})
