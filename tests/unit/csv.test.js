import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvDetailed, toCsv } from '../../src/main/csv.js'

/**
 * A CSV that breaks the rules must not be read silently: a stray quote makes a field run on and swallow the rows after it, so a file of 18
 * cards gave 7 (found with a skills file whose text had inner quotes). parseCsvDetailed gives the same rows as parseCsv and the problems.
 */
describe('parseCsvDetailed: files that break the CSV rules', () => {
  const kinds = text => parseCsvDetailed(text).issues.map(i => `${i.kind}@${i.line}`)

  it('has no issues in a clean file, one with quoted commas, doubled quotes and line breaks, a BOM, CRLF or a trailing comma', () => {
    expect(parseCsvDetailed('a,b\n1,2\n').issues).toEqual([])
    expect(parseCsvDetailed('n,t\n"Smith, J","say ""hi""\nbye"\n').issues).toEqual([])
    expect(parseCsvDetailed('﻿a,b\r\n1,2\r\n3,4').issues).toEqual([])
    expect(parseCsvDetailed('a,b\n1,2,\n').issues).toEqual([])   // an empty cell past the header loses nothing
    expect(parseCsvDetailed('a,b\n1,2\n\n3,4\n').issues).toEqual([])   // a blank line is not a row
  })

  it('gives exactly the rows parseCsv gives', () => {
    const text = 'a,b,c\n1,"x ""y"" z",3\n"p\nq",5,6\n'
    expect(parseCsvDetailed(text).rows).toEqual(parseCsv(text))
  })

  it('finds a quote that closes a field and is followed by more text, at its line', () => {
    const text = 'id,a,b\n1,"Level 1 - "On a hit.","Level 2.",x\n2,"p","q",y\n3,"p","q",y\n'
    const found = parseCsvDetailed(text)
    expect(found.issues[0]).toEqual({ line: 2, kind: 'strayQuote' })
    expect(found.rows.length).toBeLessThan(4)   // the rows really are lost, which is why it has to be said
  })

  it('finds a field that ends in two quotes, which keeps it open and swallows the lines after it', () => {
    const text = 'id,a,b\n1,"one","two.""\n2,"p","q"\n3,"p","q"\n4,"p","q"\n'
    const found = parseCsvDetailed(text)
    expect(found.issues.length).toBeGreaterThan(0)
    expect(found.rows.length).toBeLessThan(5)
  })

  it('finds a quoted field that is never closed, at the line where it began', () => {
    expect(kinds('a,b\n1,"never closed\n2,3\n')).toEqual(['unclosed@2'])
  })

  it('finds a quote that opens in the middle of a field', () => {
    expect(kinds('a,b\n1,ab"cd",x\n')).toContain('midQuote@2')
  })

  it('finds a row with more or fewer columns than the header, counting a multi-line field in the lines', () => {
    expect(parseCsvDetailed('a,b,c\n1,2\n3,4,5\n').issues).toEqual([{ line: 2, kind: 'columns', found: 2, expected: 3 }])
    expect(parseCsvDetailed('a,b\n1,"x\ny"\n2\n3,4,5\n').issues).toEqual([{ line: 4, kind: 'columns', found: 1, expected: 2 }, { line: 5, kind: 'columns', found: 3, expected: 2 }])
    expect(parseCsvDetailed('a,b\r\n1,2,3,4\r\n').issues).toEqual([{ line: 2, kind: 'columns', found: 4, expected: 2 }])
  })

  it('names one quote problem for a row, not one for every quote that follows it', () => {
    const text = 'id,a,b\n1,"Level 1 - "On a hit. Heal "A" now.","Level 2",x\n'
    expect(parseCsvDetailed(text).issues.filter(i => i.kind === 'strayQuote' || i.kind === 'midQuote')).toHaveLength(1)
  })
})

describe('parseCsv', () => {
  it('parses a simple table', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('handles CRLF, CR and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
    expect(parseCsv('a\r1')).toEqual([['a'], ['1']])
  })
  it('handles quoted fields with commas, quotes and newlines', () => {
    expect(parseCsv('n,t\n"Smith, J","say ""hi""\nbye"\n')).toEqual([['n', 't'], ['Smith, J', 'say "hi"\nbye']])
  })
  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿name,cost\nOrc,3')[0]).toEqual(['name', 'cost'])
  })
  it('keeps empty cells and drops blank lines', () => {
    expect(parseCsv('a,b,c\n1,,3\n\n,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['', '', '']])
  })
  it('preserves unicode', () => {
    expect(parseCsv('名前,攻撃\nドラゴン,9')[1]).toEqual(['ドラゴン', '9'])
  })
  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('toCsv', () => {
  it('quotes only when needed', () => {
    expect(toCsv([['a', 'b,c', 'd"e', 'f\ng', '']])).toBe('a,"b,c","d""e","f\ng",\r\n')
  })
  it('round-trips through parseCsv', () => {
    const rows = [['name', 'text'], ['A, B', 'line1\nline2'], ['"quoted"', ''], ['日本', 'x']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
  it('writes null/undefined as empty', () => {
    expect(toCsv([[null, undefined, 0]])).toBe(',,0\r\n')
  })
})
