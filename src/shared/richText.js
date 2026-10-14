/**
 * Rich text markup (PRD §16.3). Pure and shared: the main process draws it, the card table and the cell editor show it.
 *
 *   **bold**  *italic*  ***both***  __underline__  ~~strike~~
 *   {icon:fire}  {fire}  {icon:fire x1.4}  {icon:fire color=#cc3333}
 *   {color:#cc3333}…{/color}  {size:120%}…{/size}  {font:Name}…{/font}  {style:keyword}…{/style}
 *   {nbsp}  {shy}  \*  \{  \\
 *
 * Markup that does not pair up (`**oops`) is kept as the characters it was written with, never hidden, and is listed
 * as a problem for the text check (§16.9).
 */

const RESERVED = new Set(['icon', 'color', 'size', 'font', 'style', 'nbsp', 'shy'])
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SAFE_FONT = /^[^<>"'&{}\\\n]{1,60}$/
const ESCAPABLE = '\\*_~{}'
export const isHexColor = value => HEX.test(String(value))
const isSpace = ch => ch === undefined || /\s/u.test(ch)
const isWordChar = ch => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)

export const MIN_SIZE_PERCENT = 10
export const MAX_SIZE_PERCENT = 500

/** Name of an icon as typed: lower case, spaces and underscores read as hyphens. */
export const iconKey = name => String(name).trim().toLowerCase().replace(/[\s_]+/g, '-')

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const MARK_KIND = { '***': 'bi', '**': 'b', '*': 'i', '__': 'u', '~~': 's' }

function parseIconParams(raw, problems, whole) {
  let scale = 1, color
  for (const p of raw.trim().split(/\s+/).filter(Boolean)) {
    let m
    if ((m = /^x(\d+(?:\.\d+)?)$/i.exec(p)) && Number(m[1]) > 0 && Number(m[1]) <= 10) scale = Number(m[1])
    else if ((m = /^color=(#[0-9a-f]+)$/i.exec(p)) && HEX.test(m[1])) color = m[1]
    else problems.push({ type: 'badIconParam', text: p, in: whole })
  }
  return { scale, color }
}

function tokenize(text, problems) {
  const tokens = []
  let buf = ''
  const flush = () => { if (buf) { tokens.push({ t: 'text', s: buf }); buf = '' } }
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (c === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) { buf += text[i + 1]; i += 2; continue }

    if (c === '*' || c === '_' || c === '~') {
      let n = 1
      while (text[i + n] === c) n++
      const raw = c.repeat(n), kind = MARK_KIND[raw]
      if (!kind) { buf += raw; i += n; continue } // a single _ or ~, or a longer run: plain characters
      const prev = text[i - 1], next = text[i + n]
      let canOpen = !isSpace(next), canClose = !isSpace(prev)
      if (c === '_') { canOpen &&= !isWordChar(prev); canClose &&= !isWordChar(next) } // snake__case stays as written
      flush(); tokens.push({ t: 'mark', kind, raw, canOpen, canClose, at: i }); i += n; continue
    }

    if (c === '{') {
      const rest = text.slice(i)
      let m
      if ((m = /^\{icon:([A-Za-z0-9_-]+)((?:\s+[^{}\s]+)*)\}/.exec(rest))) {
        flush(); const { scale, color } = parseIconParams(m[2], problems, m[0])
        tokens.push({ t: 'icon', name: iconKey(m[1]), scale, color, raw: m[0], at: i }); i += m[0].length; continue
      }
      if ((m = /^\{(\/)?(color|size|font|style)(?::([^{}\n]*))?\}/.exec(rest)) && (!m[1] === (m[3] !== undefined) || (m[1] && m[3] === undefined))) {
        flush(); tokens.push({ t: 'tag', name: m[2], close: !!m[1], arg: m[3]?.trim(), raw: m[0], at: i }); i += m[0].length; continue
      }
      if ((m = /^\{(nbsp|shy)\}/.exec(rest))) { flush(); tokens.push({ t: m[1], raw: m[0], at: i }); i += m[0].length; continue }
      if ((m = /^\{([A-Za-z0-9_-]+)\}/.exec(rest)) && !RESERVED.has(m[1].toLowerCase())) {
        flush(); tokens.push({ t: 'icon', name: iconKey(m[1]), scale: 1, raw: m[0], at: i }); i += m[0].length; continue
      }
    }
    buf += c; i++
  }
  flush()
  return tokens
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

const lastIndexWhere = (arr, f) => { for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i])) return i; return -1 }

/** Marks and tags that find their partner are kept as formatting; the rest become the characters they were written with. */
function pair(tokens, problems) {
  const marks = []
  tokens.forEach((tok, idx) => {
    if (tok.t !== 'mark') return
    const j = lastIndexWhere(marks, k => tokens[k].kind === tok.kind)
    if (tok.canClose && j >= 0) { tokens[marks[j]].role = 'open'; tok.role = 'close'; marks.splice(j, 1) }
    else if (tok.canOpen) marks.push(idx)
    else tok.role = 'literal'
  })
  for (const k of marks) tokens[k].role = 'literal'

  const tags = []
  tokens.forEach((tok, idx) => {
    if (tok.t !== 'tag') return
    if (!tok.close) {
      if (tok.arg === undefined || tok.arg === '') { tok.role = 'literal'; return }
      if (tok.name === 'color' && !HEX.test(tok.arg)) { problems.push({ type: 'invalidColor', text: tok.raw, at: tok.at }); tok.role = 'literal'; return }
      if (tok.name === 'size') {
        const m = /^(\d{1,3})%$/.exec(tok.arg), n = m ? Number(m[1]) : 0
        if (!m || n < MIN_SIZE_PERCENT || n > MAX_SIZE_PERCENT) { problems.push({ type: 'invalidSize', text: tok.raw, at: tok.at }); tok.role = 'literal'; return }
      }
      if (tok.name === 'font' && !SAFE_FONT.test(tok.arg)) { problems.push({ type: 'invalidFont', text: tok.raw, at: tok.at }); tok.role = 'literal'; return }
      tags.push(idx)
      return
    }
    const j = lastIndexWhere(tags, k => tokens[k].name === tok.name)
    if (j < 0) { tok.role = 'literal'; return }
    tokens[tags[j]].role = 'open'; tok.role = 'close'; tags.splice(j, 1)
  })
  for (const k of tags) tokens[k].role = 'literal'

  for (const tok of tokens) if ((tok.t === 'mark' || tok.t === 'tag') && tok.role === 'literal') problems.push({ type: 'unmatched', text: tok.raw, at: tok.at })
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Parse markup into styled runs.
 * @returns {{ runs: object[], problems: object[] }}
 *   text run  { text, bold, italic, underline, strike, size (multiple of the surrounding size), color?, font?, styles (names of the {style:…} spans around it, outermost first) }
 *   icon run  { icon: name, scale, color?, bold… }  (the text style around it, so it can follow the text colour)
 *   problems  { type: 'unmatched'|'invalidColor'|'invalidSize'|'invalidFont'|'badIconParam'|'unknownStyle', text, at? }
 */
export function parseMarkup(text, options = {}) {
  const problems = []
  const tokens = tokenize(String(text ?? ''), problems)
  pair(tokens, problems)

  const on = { b: 0, i: 0, u: 0, s: 0 }
  const colors = [], sizes = [], fonts = [], styles = []
  const runs = []
  const style = () => ({ bold: on.b > 0, italic: on.i > 0, underline: on.u > 0, strike: on.s > 0, size: sizes.reduce((a, b) => a * b, 1), color: colors[colors.length - 1], font: fonts[fonts.length - 1], styles: [...styles] })
  const push = (extra) => {
    const run = { ...style(), ...extra }
    const last = runs[runs.length - 1]
    const same = last && !last.icon && !run.icon && ['bold', 'italic', 'underline', 'strike', 'size', 'color', 'font'].every(k => last[k] === run[k]) && last.styles.join('\u0001') === run.styles.join('\u0001')
    if (same) last.text += run.text; else runs.push(run)
  }
  const flags = kind => (kind === 'bi' ? ['b', 'i'] : [kind])

  for (const tok of tokens) {
    if (tok.t === 'text') { push({ text: tok.s }); continue }
    if (tok.t === 'nbsp') { push({ text: ' ' }); continue }
    if (tok.t === 'shy') { push({ text: '­' }); continue }
    if (tok.t === 'icon') { push({ icon: tok.name, scale: tok.scale, iconColor: tok.color, text: undefined }); continue }
    if (tok.t === 'mark') {
      if (tok.role === 'literal') push({ text: tok.raw })
      else for (const f of flags(tok.kind)) on[f] += tok.role === 'open' ? 1 : -1
      continue
    }
    // tag
    if (tok.role === 'literal') { push({ text: tok.raw }); continue }
    if (tok.role === 'open') {
      if (tok.name === 'color') colors.push(tok.arg)
      else if (tok.name === 'size') sizes.push(Number(/\d+/.exec(tok.arg)[0]) / 100)
      else if (tok.name === 'font') fonts.push(tok.arg)
      else { styles.push(iconKey(tok.arg)); if (!options.knownStyles?.has?.(iconKey(tok.arg))) problems.push({ type: 'unknownStyle', text: tok.arg, at: tok.at }) }
    } else if (tok.name === 'color') colors.pop()
    else if (tok.name === 'size') sizes.pop()
    else if (tok.name === 'font') fonts.pop()
    else styles.pop()
  }
  return { runs, problems }
}

/** The text without markup: an icon becomes its name (PRD §16.7, for card names, descriptions, filters and formulas). */
export function stripMarkup(text, { iconText = name => name } = {}) {
  return parseMarkup(text).runs.map(r => (r.icon ? iconText(r.icon) : r.text)).join('')
}

/**
 * The same text with every use of an icon renamed: `{icon:old}` (with its parameters) and `{old}`. Escaped braces and text
 * that is not an icon are untouched (PRD §16.4: renaming an icon updates what uses it).
 */
export function renameIconInMarkup(text, from, to) {
  const source = String(text ?? '')
  const fromKey = iconKey(from)
  let out = '', last = 0
  for (const tok of tokenize(source, [])) {
    if (tok.t !== 'icon' || tok.name !== fromKey) continue
    out += source.slice(last, tok.at)
    out += tok.raw.startsWith('{icon:') ? tok.raw.replace(/^\{icon:[A-Za-z0-9_-]+/, `{icon:${to}`) : `{${to}}`
    last = tok.at + tok.raw.length
  }
  return out + source.slice(last)
}

/** The same text with every `{style:old}` opening tag renamed (closing tags have no name to change). */
export function renameStyleInMarkup(text, from, to) {
  const source = String(text ?? '')
  const fromKey = iconKey(from)
  let out = '', last = 0
  for (const tok of tokenize(source, [])) {
    if (tok.t !== 'tag' || tok.name !== 'style' || tok.close || iconKey(tok.arg ?? '') !== fromKey) continue
    out += source.slice(last, tok.at) + `{style:${to}}`
    last = tok.at + tok.raw.length
  }
  return out + source.slice(last)
}

/** Text with every markup character escaped, so that it is shown exactly as written. */
export const escapeMarkup = text => String(text ?? '').replace(/[\\*_~{}]/g, '\\$&')

/**
 * Whether rich text would draw this text differently from plain text: markup that formats, an icon, or an escape
 * (PRD §16.7: converting a Text field to Rich text, and back, shows the cards for which this is true).
 */
export function readsDifferently(text) {
  const t = String(text ?? '')
  if (!hasMarkupCharacters(t)) return false
  const { runs } = parseMarkup(t)
  return runs.some(r => r.icon || r.bold || r.italic || r.underline || r.strike || r.color || r.font || r.size !== 1) || runs.map(r => r.text ?? '').join('') !== t
}

/** Whether text contains anything that rich text would read differently from plain text (PRD §16.7). */
export const hasMarkupCharacters = text => /[*_~{}\\]/.test(String(text ?? ''))
