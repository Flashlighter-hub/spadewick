import { describe, it, expect } from 'vitest'
import { validateValue } from '../../src/shared/validate.js'

describe('validateValue (shared by the table editor and import)', () => {
  it('accepts empty values for every type', () => {
    for (const type of ['text', 'number', 'boolean', 'color', 'image_ref']) expect(validateValue({ type }, '')).toEqual({ value: '' })
  })
  it('validates numbers with min/max', () => {
    const f = { type: 'number', validation: '{"min":0,"max":10}' }
    expect(validateValue(f, '5')).toEqual({ value: '5' })
    expect(validateValue(f, '-1').error).toMatch(/minimum/)
    expect(validateValue(f, '11').error).toMatch(/maximum/)
    expect(validateValue(f, 'x').error).toMatch(/not a number/)
    expect(validateValue({ type: 'number' }, '1e3')).toEqual({ value: '1e3' })
  })
  it('normalises booleans', () => {
    expect(validateValue({ type: 'boolean' }, 'Yes').value).toBe('true')
    expect(validateValue({ type: 'boolean' }, '0').value).toBe('false')
    expect(validateValue({ type: 'boolean' }, 'maybe').error).toBeTruthy()
  })
  it('requires hex colors', () => {
    expect(validateValue({ type: 'color' }, '#abc').value).toBe('#abc')
    expect(validateValue({ type: 'color' }, 'red').error).toBeTruthy()
  })
  it('applies regex rules to text, and ignores a broken rule rather than blocking input', () => {
    expect(validateValue({ type: 'text', validation: { regex: '^[A-Z]{2}$' } }, 'ab').error).toBeTruthy()
    expect(validateValue({ type: 'text', validation: { regex: '^[A-Z]{2}$' } }, 'AB').value).toBe('AB')
    expect(validateValue({ type: 'text', validation: '{"regex":"("}' }, 'anything').value).toBe('anything')
    expect(validateValue({ type: 'text', validation: 'not json' }, 'ok').value).toBe('ok')
  })
})
