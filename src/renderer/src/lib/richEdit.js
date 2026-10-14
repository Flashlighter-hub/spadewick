/**
 * Editing rich text markup in a text box (PRD §16.7): what the toolbar buttons and Ctrl+B / Ctrl+I do to the text and the
 * selection. Pure, so it can be tested without a browser. Each function returns { value, start, end }.
 */

/**
 * Put `open` and `close` around the selection, or take them off when they are already there. With nothing selected,
 * the pair is inserted and the caret goes between them.
 */
export function toggleWrap(value, start, end, open, close = open) {
  const before = value.slice(0, start), sel = value.slice(start, end), after = value.slice(end)
  if (start === end) {
    return { value: before + open + close + after, start: start + open.length, end: start + open.length }
  }
  // A single-character marker (italic) is on when an ODD number of that character touches the selection on both sides:
  // one is italic, two are half of a bold pair, three are bold italic.
  const single = open.length === 1 && close.length === 1
  const run = (text, ch, atEnd) => { let n = 0; for (let i = atEnd ? text.length - 1 : 0; atEnd ? i >= 0 : i < text.length; i += atEnd ? -1 : 1) { if (text[i] !== ch) break; n++ } return n }
  const nBefore = run(before, open, true), nAfter = run(after, close, false)
  const wrapped = single ? nBefore % 2 === 1 && nAfter % 2 === 1 : before.endsWith(open) && after.startsWith(close)
  if (wrapped) {
    return { value: before.slice(0, -open.length) + sel + after.slice(close.length), start: start - open.length, end: end - open.length }
  }
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    const inner = sel.slice(open.length, sel.length - close.length)
    return { value: before + inner + after, start, end: start + inner.length }
  }
  return { value: before + open + sel + close + after, start: start + open.length, end: end + open.length }
}

/** Replace the selection by `text`, with the caret after it. */
export function insertText(value, start, end, text) {
  const caret = start + text.length
  return { value: value.slice(0, start) + text + value.slice(end), start: caret, end: caret }
}

export const BOLD = '**', ITALIC = '*', UNDERLINE = '__'
export const colorWrap = hex => ({ open: `{color:${hex}}`, close: '{/color}' })
