/**
 * Excel workbooks (.xlsx), read and written without a library (UPDATES U27). An .xlsx file is a zip of XML parts; this reads the parts a card
 * table needs (the sheets, their cells, the shared strings, the date formats) and writes a plain workbook (one sheet per set, a bold frozen
 * header row, real numbers and booleans).
 *
 * Reading is deliberately forgiving about what Excel and other tools write and strict about size: a workbook is refused when it declares more
 * than the limits below. Only values are read: a formula cell gives the value Excel last calculated, and nothing in a workbook is ever run.
 * Writing never produces a formula: a text that starts with "=" is stored as text, so a card called "=1+1" stays a card.
 */
import { readZipEntries, zipBuffer } from './zip.js'
import { tr } from '../shared/i18n.js'

export const MAX_ROWS = 100_000
export const MAX_COLUMNS = 1_000
const MAX_CELL_LENGTH = 32_767
const MAX_SHEET_NAME = 31

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Text of an XML node with its entities resolved, and Excel's _xHHHH_ escapes of control characters. */
function unescapeXml(text) {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)
  return m ? unescapeXml(m[2] ?? m[3]) : null
}

/** The text of a run of <t> elements inside one <si> or <is>, leaving out phonetic hints. */
function textOf(xml) {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of cleaned.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] ?? '')
  return out
}

function readSharedStrings(xml) {
  if (!xml) return []
  const out = []
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(textOf(m[1] ?? ''))
  return out
}

// number formats that mean a date or a time (the built-in ids), and the words a custom format uses for one
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
const isDateFormat = code => /[dmyhs]/i.test(String(code).replace(/\[[^\]]*\]|"[^"]*"|\\./g, ''))

/** The indexes (the s attribute of a cell) of the cell formats that show a date. */
function dateStyles(xml) {
  const custom = new Map()
  for (const m of (xml ?? '').matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'))
    if (Number.isInteger(id)) custom.set(id, attr(m[0], 'formatCode') ?? '')
  }
  const section = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml ?? '')?.[1] ?? ''
  const dates = new Set()
  let i = 0
  for (const m of section.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const id = Number(attr(m[0], 'numFmtId'))
    if (DATE_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)))) dates.add(i)
    i++
  }
  return dates
}

/** An Excel date serial as text: 2026-10-10, or 2026-10-10 14:30 when it has a time. */
function serialToText(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000)   // 25569 days from 1899-12-30 to 1970-01-01
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const pad = n => String(n).padStart(2, '0')
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return serial % 1 === 0 ? day : `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** A cell reference such as "AB12" as a zero-based column index and row index. */
function refToIndex(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref ?? '')
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number(m[2]) - 1 }
}

function readSheet(xml, strings, dates) {
  const rows = []
  let nextRow = 0
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1], 'r'))
    const rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : nextRow
    nextRow = rowIndex + 1
    if (rowIndex >= MAX_ROWS) throw new Error(tr('xlsx.tooManyRows', { max: MAX_ROWS }))
    const cells = []
    let nextCol = 0
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = refToIndex(attr(cm[1], 'r'))
      const col = at ? at.col : nextCol
      nextCol = col + 1
      if (col >= MAX_COLUMNS) throw new Error(tr('xlsx.tooManyColumns', { max: MAX_COLUMNS }))
      const type = attr(cm[1], 't') ?? 'n'
      const inner = cm[2] ?? ''
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let value = ''
      if (type === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '')
      else if (raw === undefined) value = ''
      else if (type === 's') value = strings[Number(raw)] ?? ''
      else if (type === 'str') value = unescapeXml(raw)
      else if (type === 'b') value = raw.trim() === '1' ? 'true' : 'false'
      else if (type === 'e') value = ''
      else if (type === 'd') value = unescapeXml(raw).slice(0, 10)
      else {
        const n = Number(raw)
        if (!Number.isFinite(n)) value = unescapeXml(raw)
        else value = dates.has(Number(attr(cm[1], 's'))) ? serialToText(n) : String(n)
      }
      cells[col] = value
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    rows[rowIndex] = cells
  }
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = []
  while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop()   // blank rows at the end are formatting, not cards
  return rows
}

/**
 * The sheets of a workbook: [{ name, rows: string[][] }], in the order of the workbook. Every value is text, the way a CSV is read:
 * a number as it is written, a date as YYYY-MM-DD, a boolean as true or false, an error as blank.
 */
export function readXlsx(path) {
  let parts
  try {
    parts = readZipEntries(path, name => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/i.test(name))
  } catch (err) {
    throw new Error(tr('xlsx.notWorkbook', { reason: err.message }))
  }
  const text = name => (parts.has(name) ? parts.get(name).toString('utf8') : null)
  const workbook = text('xl/workbook.xml')
  if (!workbook) throw new Error(tr('xlsx.notWorkbook', { reason: 'xl/workbook.xml' }))

  const rels = new Map()
  for (const m of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const strings = readSharedStrings(text('xl/sharedStrings.xml'))
  const dates = dateStyles(text('xl/styles.xml'))

  const sheets = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`
    const target = rels.get(attr(m[0], 'r:id') ?? '') ?? `xl/worksheets/sheet${sheets.length + 1}.xml`
    const xml = text(target.replace(/^xl\/\.\.\//, ''))
    if (xml === null) continue   // a chart sheet or a sheet whose part is missing has no cells
    sheets.push({ name, rows: readSheet(xml, strings, dates) })
  }
  if (!sheets.length) throw new Error(tr('xlsx.noSheets'))
  return sheets
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const escapeXml = s => String(s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')   // characters XML cannot hold
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const columnName = i => { let n = i + 1, s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\, not blank, and not the same as another (letters of any case). */
export function sheetNames(names) {
  const used = new Set()
  return names.map((raw, i) => {
    let base = String(raw ?? '').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, MAX_SHEET_NAME) || `Sheet${i + 1}`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, MAX_SHEET_NAME - String(n).length - 1)} ${n}`
    used.add(name.toLowerCase())
    return name
  })
}

function sheetXml(rows) {
  const widths = []
  const lines = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${columnName(c)}${r + 1}`
      const style = r === 0 ? ' s="1"' : ''
      if (v === '' || v == null) return r === 0 ? `<c r="${ref}"${style}/>` : ''
      widths[c] = Math.max(widths[c] ?? 0, Math.min(60, String(v).length + 2))
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`
      if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`
      const text = String(v).slice(0, MAX_CELL_LENGTH)
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  })
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, w || 8)}" customWidth="1"/>`).join('')}</cols>` : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' + cols + `<sheetData>${lines.join('')}</sheetData></worksheet>`
}

/**
 * A workbook as bytes. `sheets` is [{ name, rows: (string | number | boolean | null)[][] }]; the first row of each is its header.
 * Numbers and booleans are stored as such, so Excel can add them up; everything else is text.
 */
export function writeXlsx(sheets) {
  if (!sheets.length) throw new Error(tr('xlsx.noSheets'))
  const names = sheetNames(sheets.map(s => s.name))
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const entries = [
    { name: '[Content_Types].xml', xml: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', xml: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', xml: X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', xml: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', xml: X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s.rows) }))
  ]
  return zipBuffer(entries.map(e => ({ name: e.name, data: Buffer.from(e.xml, 'utf8') })))
}
