import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readXlsx, writeXlsx, sheetNames, MAX_ROWS } from '../../src/main/xlsx.js'
import { zipBuffer, readZipEntries } from '../../src/main/zip.js'

/** UPDATES U27: Excel workbooks read and written without a library. */

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'spadewick-xlsx-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const save = (name, buffer) => { const p = join(dir, name); writeFileSync(p, buffer); return p }
const part = (name, text) => ({ name, data: Buffer.from(text, 'utf8') })

/** A workbook made by hand, the way Excel lays it out: shared strings, styles with a date format, a sheet with gaps. */
function excelLike(sheetXml, { shared = [], styles = '', sheets = [['Cards', 'sheet1']] } = {}) {
  const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map(s => `<si>${s}</si>`).join('')}</sst>`
  const entries = [
    part('[Content_Types].xml', '<Types/>'),
    part('xl/workbook.xml', `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n, f], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    part('xl/_rels/workbook.xml.rels', `<Relationships>${sheets.map(([, f], i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/${f}.xml"/>`).join('')}</Relationships>`),
    part('xl/sharedStrings.xml', sst),
    part('xl/styles.xml', styles || '<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>'),
    ...sheets.map(([, f]) => part(`xl/worksheets/${f}.xml`, sheetXml))
  ]
  return zipBuffer(entries)
}

describe('writing and reading a workbook', () => {
  it('gives back what it was given: text, numbers, booleans, blanks', () => {
    const rows = [['card_id', 'name', 'cost', 'flying'], ['A-1', 'Ember', 3, true], ['A-2', 'Gale', 0.5, false], ['A-3', '', '', '']]
    const sheets = readXlsx(save('a.xlsx', writeXlsx([{ name: 'Base', rows }])))
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('Base')
    expect(sheets[0].rows).toEqual([['card_id', 'name', 'cost', 'flying'], ['A-1', 'Ember', '3', 'true'], ['A-2', 'Gale', '0.5', 'false'], ['A-3']])
  })

  it('keeps text exactly: markup characters, quotes, newlines, leading zeros, and a text that looks like a formula', () => {
    const tricky = ['<b>"Fire" & ice</b>', 'line one\nline two', '  padded  ', '007', '=1+1', '=HYPERLINK("http://x")', 'ünïcode ☃ 🔥']
    const out = readXlsx(save('t.xlsx', writeXlsx([{ name: 'S', rows: [['v'], ...tricky.map(t => [t])] }])))[0].rows
    expect(out.slice(1).map(r => r[0])).toEqual(tricky)
  })

  it('writes a text starting with = as text, never as a formula', () => {
    const path = save('f.xlsx', writeXlsx([{ name: 'S', rows: [['v'], ['=1+1']] }]))
    const xml = readZipEntries(path, n => n === 'xl/worksheets/sheet1.xml').get('xl/worksheets/sheet1.xml').toString('utf8')
    expect(xml).not.toContain('<f>')
    expect(xml).toContain('t="inlineStr"')
  })

  it('writes one sheet for each set, with names Excel accepts and no two the same', () => {
    expect(sheetNames(['Base Set', 'base set', 'A/B:C?', '', 'x'.repeat(40)])).toEqual(['Base Set', 'base set 2', 'A B C', 'Sheet4', 'x'.repeat(31)])
    const sheets = readXlsx(save('m.xlsx', writeXlsx([{ name: 'One', rows: [['a'], ['1']] }, { name: 'Two', rows: [['b'], ['2']] }])))
    expect(sheets.map(s => s.name)).toEqual(['One', 'Two'])
    expect(sheets[1].rows[1]).toEqual(['2'])
  })

  it('refuses to write a workbook with no sheet', () => {
    expect(() => writeXlsx([])).toThrow()
  })
})

describe('reading what Excel writes', () => {
  it('reads shared strings (also rich ones, with phonetic hints left out), numbers, booleans and cached formula results', () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
      <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>12</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="str"><f>A2&amp;"!"</f><v>Orc!</v></c></row>
    </sheetData></worksheet>`
    const book = excelLike(sheet, { shared: ['<t>name</t>', '<t>cost</t>', '<t>flying</t>', '<t>shout</t>', '<r><t>Or</t></r><r><rPr><b/></rPr><t xml:space="preserve">c </t></r><rPh sb="0" eb="1"><t>ignored</t></rPh>'] })
    expect(readXlsx(save('e.xlsx', book))[0].rows).toEqual([['name', 'cost', 'flying', 'shout'], ['Orc ', '12', 'true', 'Orc!']])
  })

  it('fills the gaps of a sparse sheet: missing cells and missing rows', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'
    expect(readXlsx(save('s.xlsx', excelLike(sheet)))[0].rows).toEqual([['a', '', 'c'], [], ['', 'x']])
  })

  it('shows a date as a date, and a time with its time, from the format of the cell', () => {
    const styles = '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>46305</v></c><c r="B1" s="2"><v>46305.5625</v></c><c r="C1" s="0"><v>46305</v></c></row></sheetData></worksheet>'
    expect(readXlsx(save('d.xlsx', excelLike(sheet, { styles })))[0].rows).toEqual([['2026-10-10', '2026-10-10 13:30', '46305']])
  })

  it('reads the entities of the XML and Excel\'s escapes of control characters', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a &lt; b &amp; &quot;c&quot; &#233; _x000D_</t></is></c></row></sheetData></worksheet>'
    expect(readXlsx(save('x.xlsx', excelLike(sheet)))[0].rows).toEqual([['a < b & "c" é \r']])
  })

  it('reads an error cell as blank and trims blank rows at the end', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="e"><v>#DIV/0!</v></c><c r="B1" t="inlineStr"><is><t>k</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t></t></is></c></row></sheetData></worksheet>'
    expect(readXlsx(save('z.xlsx', excelLike(sheet)))[0].rows).toEqual([['', 'k']])
  })

  it('reads every sheet of the workbook, in order', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'
    const names = readXlsx(save('w.xlsx', excelLike(sheet, { sheets: [['Heroes', 'sheet1'], ['Skills', 'sheet2']] }))).map(s => s.name)
    expect(names).toEqual(['Heroes', 'Skills'])
  })
})

describe('what is not a workbook', () => {
  it('says so for a file that is not a zip, and for a zip without a workbook', () => {
    expect(() => readXlsx(save('n.xlsx', 'just some text'))).toThrow(/not an Excel workbook/i)
    expect(() => readXlsx(save('o.xlsx', zipBuffer([part('readme.txt', 'hi')])))).toThrow(/not an Excel workbook/i)
  })

  it('refuses a sheet with more rows than allowed', () => {
    const sheet = `<worksheet><sheetData><row r="${MAX_ROWS + 5}"><c r="A${MAX_ROWS + 5}" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`
    expect(() => readXlsx(save('big.xlsx', excelLike(sheet)))).toThrow(/more than/i)
  })
})
