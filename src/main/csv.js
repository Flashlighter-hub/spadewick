/** Minimal RFC 4180 CSV parser/serializer — PRD §5.5 */

export function parseCsv(text) {
  return parseCsvDetailed(text).rows
}

/**
 * The same parse, plus the places where the file breaks the CSV rules and so may not have been read as its author meant. A parser that
 * forgives these loses cards without a word: a stray quote makes a field run on and swallow the rows after it. Each issue is
 * { line, kind } with the line of the file (the first is 1), and for 'columns' also { found, expected }.
 *   strayQuote  a quote that closes a quoted field is followed by more text (an inner quote that is not written as two quotes)
 *   midQuote    a quote opens in the middle of a field that did not start with one
 *   unclosed    a quoted field that is never closed (the rest of the file is part of it)
 *   columns     a row with more or fewer columns than the header (extra empty cells at the end are let go)
 * The rows are exactly what parseCsv has always given; only the issues are new.
 */
export function parseCsvDetailed(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  const rowLines = []   // the line each row starts on
  const issues = []
  let row = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let rowStart = 1
  let quoteLine = 1
  const quoteIssue = (kind) => { if (!issues.some(x => x.kind !== 'columns' && x.rowStart === rowStart)) issues.push({ line, kind, rowStart }) }
  const endRow = () => { row.push(cell); cell = ''; rows.push(row); rowLines.push(rowStart); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else {
          inQuotes = false
          const next = text[i + 1]
          if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') quoteIssue('strayQuote')
        }
      } else { if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++; cell += c }
    } else if (c === '"') {
      if (cell !== '') quoteIssue('midQuote')
      inQuotes = true
      quoteLine = line
    } else if (c === ',') {
      row.push(cell); cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow(); line++; rowStart = line
    } else cell += c
  }
  if (inQuotes) issues.push({ line: quoteLine, kind: 'unclosed', rowStart })
  if (cell !== '' || row.length) endRow()
  const kept = []
  const keptLines = []
  rows.forEach((r, i) => { if (!(r.length === 1 && r[0] === '')) { kept.push(r); keptLines.push(rowLines[i]) } })
  const expected = kept[0]?.length ?? 0
  kept.forEach((r, i) => {
    if (i === 0 || r.length === expected) return
    if (r.length > expected && r.slice(expected).every(v => v === '')) return   // a trailing comma or empty cells: nothing is lost
    issues.push({ line: keptLines[i], kind: 'columns', found: r.length, expected })
  })
  issues.sort((a, b) => a.line - b.line)
  return { rows: kept, issues: issues.map(({ rowStart, ...rest }) => rest) }
}

export function toCsv(rows) {
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n'
}
