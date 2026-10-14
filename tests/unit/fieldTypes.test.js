import { describe, it, expect } from 'vitest'
import { validateValue } from '../../src/shared/validate.js'
import { splitTags, joinTags, closestOption, optionsOf, lookupOf, isComputed, validStatus, validArtStatus } from '../../src/shared/fieldTypes.js'

/** UPDATES U23: Choice, Tags and Lookup fields, and the lists they keep their values in. */

const choice = options => ({ type: 'choice', validation: JSON.stringify({ options }) })
const tags = options => ({ type: 'tags', validation: JSON.stringify({ options }) })

describe('a Choice field', () => {
  const field = choice(['Active', 'Passive', 'Support'])

  it('accepts a value of the list, in any case, and stores it as the list writes it', () => {
    expect(validateValue(field, 'Active')).toEqual({ value: 'Active' })
    expect(validateValue(field, 'support')).toEqual({ value: 'Support' })
    expect(validateValue(field, ' PASSIVE ')).toEqual({ value: 'Passive' })
  })

  it('refuses a typing mistake and says which value was probably meant', () => {
    const r = validateValue(field, 'Suport')
    expect(r.error).toMatch(/"Suport" is not one of the allowed values/)
    expect(r.error).toMatch(/Did you mean "Support"\?/)
  })

  it('refuses a value that is nothing like the list without guessing', () => {
    const r = validateValue(field, 'Banana')
    expect(r.error).toMatch(/not one of the allowed values: Active, Passive, Support/)
    expect(r.error).not.toMatch(/Did you mean/)
  })

  it('allows a blank value, and anything at all while the list is empty', () => {
    expect(validateValue(field, '')).toEqual({ value: '' })
    expect(validateValue(choice([]), 'whatever')).toEqual({ value: 'whatever' })
    expect(validateValue({ type: 'choice', validation: null }, 'whatever')).toEqual({ value: 'whatever' })
  })
})

describe('a Tags field', () => {
  const field = tags(['Fire', 'Flying', 'Water'])

  it('keeps the tags of the list once each, in the order written, joined by ", "', () => {
    expect(validateValue(field, 'flying,  fire')).toEqual({ value: 'Flying, Fire' })
    expect(validateValue(field, 'Fire; Fire\nWater')).toEqual({ value: 'Fire, Water' })
  })

  it('refuses the first tag that is not in the list', () => {
    expect(validateValue(field, 'Fire, Flyng').error).toMatch(/"Flyng".*Did you mean "Flying"\?/)
  })

  it('splits and joins tags the way they are stored', () => {
    expect(splitTags(' a, b ,,a;c ')).toEqual(['a', 'b', 'c'])
    expect(joinTags(['a', 'b'])).toBe('a, b')
    expect(splitTags('')).toEqual([])
  })
})

describe('the settings of a field', () => {
  it('reads the list of a Choice field, ignoring blanks', () => {
    expect(optionsOf(choice(['A', ' ', 'B']))).toEqual(['A', 'B'])
    expect(optionsOf({ validation: 'not json' })).toEqual([])
  })

  it('reads a Lookup: the key field, the set, the matching column and the column shown', () => {
    expect(lookupOf({ validation: JSON.stringify({ from: 'hunter', set: 's1', match: 'name', show: 'colour' }) })).toEqual({ from: 'hunter', set: 's1', match: 'name', show: 'colour' })
    expect(lookupOf({ validation: null })).toEqual({ from: '', set: '', match: '', show: '' })
  })

  it('says which types are worked out and so never typed or imported', () => {
    expect(isComputed('formula')).toBe(true)
    expect(isComputed('lookup')).toBe(true)
    expect(isComputed('choice')).toBe(false)
  })

  it('a lookup is never validated as typed text', () => {
    expect(validateValue({ type: 'lookup' }, 'anything')).toEqual({ value: 'anything' })
  })

  it('finds the nearest value of a list for a typo, and none for a stranger', () => {
    expect(closestOption('Suport', ['Support', 'Active'])).toBe('Support')
    expect(closestOption('acitve', ['Support', 'Active'])).toBe('Active')
    expect(closestOption('xyz', ['Support', 'Active'])).toBe(null)
  })

  it('knows the statuses', () => {
    expect(validStatus('final')).toBe(true)
    expect(validStatus('done')).toBe(false)
    expect(validStatus(null)).toBe(true)
    expect(validArtStatus('needs_art')).toBe(true)
    expect(validArtStatus('idea')).toBe(false)
  })
})
