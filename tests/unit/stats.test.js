import { describe, it, expect } from 'vitest'
import { distribution, numberStats, summarize, findWarnings, kindOf, MAX_WARNINGS } from '../../src/shared/stats.js'

/** UPDATES U22: counts by any field, the summary of every field, and the warnings. */

const row = (id, values, quantity = 1) => ({ id, name: values.name ?? id, quantity, values })
const F = (slug, type = 'text', validation = null) => ({ slug, name: slug[0].toUpperCase() + slug.slice(1), type, validation: validation ? JSON.stringify(validation) : null })

const cards = [
  row('a', { name: 'Ember', cost: '1', faction: 'Red', tags: 'Fire, Flying' }, 3),
  row('b', { name: 'Gale', cost: '3', faction: 'Blue', tags: 'Flying' }, 2),
  row('c', { name: 'Tide', cost: '3', faction: 'Blue', tags: '' }),
  row('d', { name: 'Blaze', cost: '5', faction: 'Red', tags: 'Fire' }),
  row('e', { name: 'Mist', cost: '', faction: '', tags: 'Water' })
]

describe('counting by a field', () => {
  it('counts a number field along a whole-number scale and shows the gap where no card has a value', () => {
    const d = distribution(cards, F('cost', 'number'))
    expect(d.kind).toBe('number')
    expect(d.buckets.map(b => [b.key, b.count])).toEqual([['1', 1], ['2', 0], ['3', 2], ['4', 0], ['5', 1], ['', 1]])
    expect(d.total).toBe(5)
  })

  it('counts a text field by value, the most used first, and a blank value last', () => {
    const d = distribution(cards, F('faction'))
    expect(d.kind).toBe('category')
    expect(d.buckets.map(b => [b.label, b.count])).toEqual([['Blue', 2], ['Red', 2], ['', 1]])
  })

  it('puts a Choice field in the order of its list', () => {
    const d = distribution([row('1', { r: 'rare' }), row('2', { r: 'common' }), row('3', { r: 'common' })], F('r', 'choice', { options: ['common', 'uncommon', 'rare'] }))
    expect(d.buckets.map(b => b.label)).toEqual(['common', 'rare'])
  })

  it('counts a card once for each of its tags', () => {
    const d = distribution(cards, F('tags', 'tags', { options: ['Fire', 'Flying', 'Water'] }))
    expect(Object.fromEntries(d.buckets.map(b => [b.label, b.count]))).toEqual({ Fire: 2, Flying: 2, Water: 1, '': 1 })
  })

  it('counts copies instead of cards when asked, and leaves out a card with no copies', () => {
    const d = distribution([...cards, row('f', { name: 'Spare', cost: '1', faction: 'Red' }, 0)], F('faction'), { copies: true })
    expect(Object.fromEntries(d.buckets.map(b => [b.label, b.count]))).toEqual({ Red: 4, Blue: 3, '': 1 })
  })

  it('splits each group by a second field', () => {
    const d = distribution(cards, F('cost', 'number'), { split: F('faction') })
    const three = d.buckets.find(b => b.key === '3')
    expect(three.parts).toEqual({ Blue: 2 })
    expect(d.splitKeys).toEqual(['Blue', 'Red', ''])
  })

  it('groups many different numbers into ranges', () => {
    const many = Array.from({ length: 100 }, (_, i) => row(String(i), { x: String(i * 7.3) }))
    const d = distribution(many, F('x', 'number'))
    expect(d.buckets.length).toBeLessThanOrEqual(12)
    expect(d.buckets.reduce((n, b) => n + b.count, 0)).toBe(100)
    expect(d.buckets[0].label).toMatch(/–/)
  })

  it('reads a Formula or Lookup field whose values are all numbers as numbers', () => {
    expect(kindOf(F('f', 'formula'), [row('1', { f: '4' }), row('2', { f: '' })])).toBe('number')
    expect(kindOf(F('f', 'formula'), [row('1', { f: 'x' })])).toBe('category')
  })
})

describe('numbers', () => {
  it('gives the lowest, highest, average, middle and total of a field', () => {
    expect(numberStats(cards, F('cost', 'number'))).toEqual({ count: 4, min: 1, max: 5, sum: 12, mean: 3, median: 3 })
  })

  it('weights by copies when asked', () => {
    const s = numberStats(cards, F('cost', 'number'), true)
    expect(s.count).toBe(3 + 2 + 1 + 1)
    expect(s.sum).toBe(3 * 1 + 2 * 3 + 3 + 5)
  })

  it('has nothing to say about a field with no number', () => {
    expect(numberStats(cards, F('faction'))).toBe(null)
  })
})

describe('the summary of every field', () => {
  it('counts the cards that fill a field, the blanks and the different values; a number field also gives its range', () => {
    const s = summarize(cards, [F('cost', 'number'), F('faction'), F('tags', 'tags')])
    expect(s[0]).toMatchObject({ slug: 'cost', filled: 4, empty: 1, distinct: 3, min: 1, max: 5, mean: 3 })
    expect(s[1]).toMatchObject({ slug: 'faction', filled: 4, empty: 1, distinct: 2 })
    expect(s[2]).toMatchObject({ slug: 'tags', filled: 4, distinct: 3 })
  })
})

describe('the warnings', () => {
  it('reports a name used twice on every card that has it', () => {
    const rows = [row('1', { name: 'Orc' }), row('2', { name: ' orc ' }), row('3', { name: 'Elf' })]
    const w = findWarnings(rows, [F('name')], { unique: ['name'] })
    expect(w.count).toBe(2)
    expect(w.warnings.map(x => x.cardId)).toEqual(['1', '2'])
    expect(w.warnings[0]).toMatchObject({ kind: 'duplicate', field: 'Name' })
    expect(w.warnings[0].message).toMatch(/also used by 1 other card/)
  })

  it('reports a required field left empty, but not an optional one', () => {
    const fields = [F('name', 'text', { required: true }), F('flavour')]
    const w = findWarnings([row('1', { name: '', flavour: '' }), row('2', { name: 'Elf', flavour: '' })], fields)
    expect(w.warnings.map(x => [x.cardId, x.kind, x.field])).toEqual([['1', 'empty', 'Name']])
  })

  it('reports a number out of its range, a value outside a list, and text where a number belongs', () => {
    const fields = [F('cost', 'number', { min: 0, max: 10 }), F('type', 'choice', { options: ['Hunter', 'Skill'] })]
    const w = findWarnings([row('1', { cost: '12', type: 'Hunter' }), row('2', { cost: '-1', type: 'Skil' }), row('3', { cost: 'abc', type: 'Skill' })], fields)
    expect(w.warnings.map(x => [x.cardId, x.kind])).toEqual([['1', 'range'], ['2', 'range'], ['2', 'range'], ['3', 'range']])
    expect(w.warnings[0].message).toMatch(/above the maximum of 10/)
    expect(w.warnings[2].message).toMatch(/Did you mean "Skill"\?/)
  })

  it('reports a lookup whose key finds nothing, but not one with no key', () => {
    const fields = [F('hunter'), F('colour', 'lookup', { from: 'hunter', set: 's', show: 'colour' })]
    const w = findWarnings([row('1', { hunter: 'Pelt', colour: 'Red' }), row('2', { hunter: 'Nobody', colour: '' }), row('3', { hunter: '', colour: '' })], fields)
    expect(w.warnings.map(x => [x.cardId, x.kind])).toEqual([['2', 'lookup']])
  })

  it('lists no more than the limit but counts them all', () => {
    const rows = Array.from({ length: MAX_WARNINGS + 50 }, (_, i) => row(String(i), { cost: '99' }))
    const w = findWarnings(rows, [F('cost', 'number', { max: 10 })])
    expect(w.warnings).toHaveLength(MAX_WARNINGS)
    expect(w.count).toBe(MAX_WARNINGS + 50)
  })
})
