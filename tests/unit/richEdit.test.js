/**
 * What the rich text toolbar does to the text and the selection (PRD §16.7).
 */
import { describe, it, expect } from 'vitest'
import { toggleWrap, insertText, BOLD, ITALIC, UNDERLINE, colorWrap } from '../../src/renderer/src/lib/richEdit.js'
import { parseMarkup } from '../../src/shared/richText.js'

const sel = (value, start, end) => value.slice(start, end)

describe('wrapping the selection', () => {
  it('wraps the selected words and keeps them selected', () => {
    const r = toggleWrap('make this bold', 5, 9, BOLD)
    expect(r.value).toBe('make **this** bold')
    expect(sel(r.value, r.start, r.end)).toBe('this')
  })

  it('takes the markers off again, from outside the selection or from inside it', () => {
    const outside = toggleWrap('make **this** bold', 7, 11, BOLD)
    expect(outside.value).toBe('make this bold')
    expect(sel(outside.value, outside.start, outside.end)).toBe('this')
    const inside = toggleWrap('make **this** bold', 5, 13, BOLD)
    expect(inside.value).toBe('make this bold')
    expect(sel(inside.value, inside.start, inside.end)).toBe('this')
  })

  it('inserts a pair with the caret between when nothing is selected', () => {
    const r = toggleWrap('ab', 1, 1, ITALIC)
    expect(r.value).toBe('a**b')
    expect(r.start).toBe(2)
    expect(r.end).toBe(2)
    const pair = toggleWrap('', 0, 0, UNDERLINE)
    expect(pair.value).toBe('____')
    expect(pair.start).toBe(2)
  })

  it('does not mistake half of a bold pair for italic markers', () => {
    // Italic on bold text must add a pair, not strip one asterisk of each **
    const r = toggleWrap('**word**', 2, 6, ITALIC)
    expect(r.value).toBe('***word***')
    expect(parseMarkup(r.value).runs.map(x => [x.text, x.bold, x.italic])).toEqual([['word', true, true]])
    const back = toggleWrap(r.value, r.start, r.end, ITALIC)
    expect(back.value).toBe('**word**')
  })

  it('works for underline and for a colour', () => {
    expect(toggleWrap('x y', 0, 1, UNDERLINE).value).toBe('__x__ y')
    const c = colorWrap('#cc3333')
    const r = toggleWrap('red word', 0, 3, c.open, c.close)
    expect(r.value).toBe('{color:#cc3333}red{/color} word')
    expect(parseMarkup(r.value).runs[0].color).toBe('#cc3333')
    expect(toggleWrap(r.value, r.start, r.end, c.open, c.close).value).toBe('red word')
  })

  it('always produces markup the parser reads as formatting', () => {
    for (const [open, close] of [[BOLD, BOLD], [ITALIC, ITALIC], [UNDERLINE, UNDERLINE]]) {
      const r = toggleWrap('one two three', 4, 7, open, close)
      const runs = parseMarkup(r.value).runs
      expect(runs.some(x => x.bold || x.italic || x.underline)).toBe(true)
      expect(runs.map(x => x.text).join('')).toBe('one two three')
    }
  })
})

describe('inserting text', () => {
  it('replaces the selection and puts the caret after the new text', () => {
    const r = insertText('Tap  now', 4, 4, '{icon:fire}')
    expect(r.value).toBe('Tap {icon:fire} now')
    expect(r.start).toBe(15)
    expect(r.end).toBe(15)
    expect(insertText('abc', 0, 3, 'X').value).toBe('X')
  })
})
