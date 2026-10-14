import { describe, it, expect } from 'vitest'
import { evaluateFormula, detectCircularFormulas } from '../../src/main/formula.js'

const ev = (expr, fields = {}) => evaluateFormula(expr, fields)

describe('formula language (PRD §5.4)', () => {
  it('concatenates strings and field references', () => {
    expect(ev('concat(name, " (", type, ")")', { name: 'Orc', type: 'Beast' })).toBe('Orc (Beast)')
  })
  it('does arithmetic', () => {
    expect(ev('add(2, 3)')).toBe('5')
    expect(ev('sub(10, 4)')).toBe('6')
    expect(ev('mul(3, 4)')).toBe('12')
    expect(ev('div(9, 2)')).toBe('4.5')
    expect(ev('round(2.5)')).toBe('3')
    expect(ev('floor(2.9)')).toBe('2')
    expect(ev('ceil(2.1)')).toBe('3')
  })
  it('does not throw on division by zero', () => {
    expect(ev('div(1, 0)')).toBe('0')
  })
  it('supports nested expressions with numeric fields stored as strings', () => {
    expect(ev('concat(to_string(round(mul(cost, 1.5))), " gold")', { cost: '3' })).toBe('5 gold')
  })
  it('evaluates conditionals', () => {
    const f = { attack: '7' }
    expect(ev('if(gt(attack, 5), "#FF0000", "#000000")', f)).toBe('#FF0000')
    expect(ev('if(gt(attack, 9), "#FF0000", "#000000")', f)).toBe('#000000')
  })
  it('compares', () => {
    expect(ev('eq("a", "a")')).toBe('true')
    expect(ev('neq("a", "b")')).toBe('true')
    expect(ev('gte(5, 5)')).toBe('true')
    expect(ev('lt(5, 5)')).toBe('false')
    expect(ev('lte(4, 5)')).toBe('true')
  })
  it('has string functions', () => {
    expect(ev('upper("abc")')).toBe('ABC')
    expect(ev('lower("ABC")')).toBe('abc')
    expect(ev('trim("  x ")')).toBe('x')
    expect(ev('length("hello")')).toBe('5')
    expect(ev('substr("hello", 1, 3)')).toBe('el')
  })
  it('treats missing fields as empty', () => {
    expect(ev('concat("a", missing, "b")')).toBe('ab')
  })
  it('returns an error string rather than throwing', () => {
    expect(() => ev('concat(')).not.toThrow()
    expect(ev('')).toBe('')
  })
  it('does not execute JavaScript (sandboxed)', () => {
    expect(ev('process.exit(1)')).not.toBe(undefined)
    expect(ev('constructor')).toBe('')
  })
  it('does not leak object prototype properties as field values', () => {
    expect(ev('toString', {})).toBe('')
    expect(ev('__proto__', {})).toBe('')
  })
})

describe('circular formula detection', () => {
  const f = (slug, formula) => ({ slug, type: 'formula', formula })
  it('accepts independent formulas', () => {
    expect(detectCircularFormulas([f('a', 'concat(x, y)'), f('b', 'upper(a)')])).toBe(false)
  })
  it('detects direct and indirect cycles', () => {
    expect(detectCircularFormulas([f('a', 'upper(a)')])).toBe(true)
    expect(detectCircularFormulas([f('a', 'upper(b)'), f('b', 'upper(c)'), f('c', 'upper(a)')])).toBe(true)
  })
  it('ignores non-formula fields', () => {
    expect(detectCircularFormulas([{ slug: 'a', type: 'text' }, f('b', 'upper(a)')])).toBe(false)
  })
})

describe('infix comparisons in conditions (PRD §7.3)', () => {
  const f = { type: 'Creature', legendary: 'false', attack: '7' }
  it('evaluates == and != as in the PRD examples', () => {
    expect(ev("type == 'Creature'", f)).toBe('true')
    expect(ev("type == 'Spell'", f)).toBe('false')
    expect(ev("legendary == 'false'", f)).toBe('true')
    expect(ev("type != 'Spell'", f)).toBe('true')
  })
  it('evaluates numeric comparisons', () => {
    expect(ev('attack > 5', f)).toBe('true')
    expect(ev('attack < 5', f)).toBe('false')
    expect(ev('attack >= 7', f)).toBe('true')
    expect(ev('attack <= 6', f)).toBe('false')
  })
  it('works inside function arguments', () => {
    expect(ev("if(type == 'Creature', 'yes', 'no')", f)).toBe('yes')
  })
  it('still evaluates a bare field reference', () => {
    expect(ev('type', f)).toBe('Creature')
  })
})

describe('extractSlugs: built-in names', () => {
  it('counts a built-in name as a field when it is not called', async () => {
    const { extractSlugs } = await import('../../src/main/formula.js')
    expect(extractSlugs('add(card_count, 1)')).toEqual(['card_count'])
    expect(extractSlugs('concat(length, card_number())')).toEqual(['length'])
    expect(extractSlugs('upper (name)')).toEqual(['name'])
  })
})
