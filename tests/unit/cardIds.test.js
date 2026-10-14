import { describe, it, expect } from 'vitest'
import { parsePattern, formatCardId, patternRegex, deriveSetCode, isReservedFieldName, normalizeSetCode, isValidSetCode, randomAuthorCode, DEFAULT_PATTERN } from '../../src/shared/cardIds.js'

describe('card ID patterns (PRD §5.8)', () => {
  it('formats the default pattern with zero padding', () => {
    expect(DEFAULT_PATTERN).toBe('{set}-{n:4}')
    expect(formatCardId(DEFAULT_PATTERN, { set: 'FIRE', n: 42 })).toBe('FIRE-0042')
    expect(formatCardId(DEFAULT_PATTERN, { set: 'FIRE', n: 12345 })).toBe('FIRE-12345')
  })
  it('supports {author}, unpadded numbers and literal text', () => {
    expect(formatCardId('{set}-{author}-{n:4}', { set: 'FIRE', n: 43, author: 'K7' })).toBe('FIRE-K7-0043')
    expect(formatCardId('C{n}', { n: 7 })).toBe('C7')
  })
  it('rejects patterns that cannot give unique, safe IDs', () => {
    expect(parsePattern('').error).toBe('patternEmpty')
    expect(parsePattern('{set}-X').error).toBe('patternNeedsNumber')
    expect(parsePattern('{set}-{n:99}').error).toBe('patternBadPadding')
    expect(parsePattern('{set}-{set:2}-{n}').error).toBe('patternBadPadding')
    expect(parsePattern('{foo}-{n}').error).toBe('patternUnknownToken')
    expect(parsePattern('{n}/x').error).toBe('patternBadCharacter')
    expect(parsePattern('{set}-{n:4}').parts).toHaveLength(3)
  })
  it('builds a regular expression that finds the number', () => {
    const rx = patternRegex('{set}-{author}-{n:4}')
    expect(rx.exec('FIRE-K7-0043')[1]).toBe('0043')
    expect(rx.exec('other')).toBeNull()
    expect(patternRegex('a.b-{n}').test('axb-1')).toBe(false)   // literals are escaped
  })
  it('derives set codes from names and avoids clashes', () => {
    expect(deriveSetCode('Fire Creatures')).toBe('FIRE')
    expect(deriveSetCode('Base Set')).toBe('BASE')
    expect(deriveSetCode('X')).toBe('XSE')
    expect(deriveSetCode('???')).toBe('SET')
    expect(deriveSetCode('Fire Spells', new Set(['FIRE']))).toBe('FIRE2')
    expect(deriveSetCode('Fire Spells', new Set(['FIRE', 'FIRE2']))).toBe('FIRE3')
    for (const name of ['Fire', 'a', 'Ünïcode', '12345678', '']) expect(isValidSetCode(deriveSetCode(name))).toBe(true)
  })
  it('recognises the reserved field name however it is written', () => {
    for (const n of ['card_id', 'Card ID', 'CARD-ID', ' card id ']) expect(isReservedFieldName(n)).toBe(true)
    for (const n of ['card_idx', 'id', 'Card Identifier']) expect(isReservedFieldName(n)).toBe(false)
  })
  it('normalises set and author codes', () => {
    expect(normalizeSetCode(' fi-re ')).toBe('FIRE')
    expect(randomAuthorCode(() => 0)).toMatch(/^[A-Z0-9]{2}$/)
    expect(randomAuthorCode()).toMatch(/^[A-Z0-9]{2}$/)
  })
})
