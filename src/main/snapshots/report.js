/**
 * The change list of snapshot compare as a file or a text (PRD §20.4): Markdown, CSV, HTML, or plain text for a terminal.
 * The headline is the same plain-language sentence the screen shows.
 */
import { tr } from '../../shared/i18n.js'

export const FORMATS = ['text', 'markdown', 'csv', 'html']

const MARK = { added: '+', removed: '−', changed: '~' }
const show = v => (v === '' || v === null || v === undefined ? '(empty)' : String(v))

function sayChange(ch) {
  if (ch.kind === 'field') return `${ch.label}: ${show(ch.from)} → ${show(ch.to)}`
  const name = { name: 'Name', template: 'Template', back: 'Card back', quantity: 'Copies', code: 'Card ID' }[ch.kind]
  return `${name}: ${show(ch.from)} → ${show(ch.to)}`
}

const sayField = f => (f.what ? f.what.map(w => `${w.aspect} ${show(w.from)} → ${show(w.to)}`).join(' · ') : f.type ?? '')

function sayOther(o) {
  if (o.what) return o.what.map(w => `${w.aspect} ${show(w.from)} → ${show(w.to)}`).join(' · ')
  if (o.area === 'template' && o.kind === 'changed') return [o.design && 'design edited', o.size && 'card size changed', o.bleed && 'bleed changed'].filter(Boolean).join(', ')
  if (o.area === 'rules' && o.kind === 'changed') return [o.title && 'title changed', o.words && 'text changed'].filter(Boolean).join(', ')
  return ''
}

/** The headline of a comparison (`from`, `to`: snapshot metadata; `to` is null for "now"). */
export function headline(summary, from, to) {
  const s = summary
  const none = !s.cardsChanged && !s.cardsAdded && !s.cardsRemoved && !s.fields && !s.other
  if (none) return tr(to ? 'compare.nothingBetween' : 'compare.nothing')
  return to
    ? tr('compare.headlineBetween', { a: from.name, b: to.name, changed: s.cardsChanged, added: s.cardsAdded, removed: s.cardsRemoved, fields: s.fields, templates: s.templates })
    : tr('compare.headlineNow', { name: from.name, when: new Date(from.created_at).toLocaleString('en-GB'), changed: s.cardsChanged, added: s.cardsAdded, removed: s.cardsRemoved, fields: s.fields, templates: s.templates })
}

const csvCell = v => {
  const t = String(v ?? '')
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function changeList(result, from, to, format = 'text') {
  if (!FORMATS.includes(format)) throw new Error(tr('errors.compareFormat'))
  const head = headline(result.summary, from, to)

  if (format === 'csv') {
    const rows = [['area', 'change', 'set', 'name', 'card_id', 'what', 'from', 'to']]
    for (const c of result.cards) {
      if (c.kind === 'changed') for (const ch of c.changes) rows.push(['card', 'changed', c.setName, c.name, c.code ?? '', ch.kind === 'field' ? ch.label : ch.kind, ch.from ?? '', ch.to ?? ''])
      else rows.push(['card', c.kind, c.setName, c.name, c.code ?? '', '', '', ''])
    }
    for (const f of result.fields) rows.push(['field', f.kind, f.setName, f.name, '', sayField(f), '', ''])
    for (const o of result.other) rows.push([o.area, o.kind, '', o.name, '', sayOther(o), '', ''])
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  }

  if (format === 'html') {
    const li = text => `<li>${esc(text)}</li>`
    const cards = result.cards.map(c => li(`${MARK[c.kind]} ${c.name || '(unnamed card)'}${c.code ? ` (${c.code})` : ''} [${c.setName}]${c.changes.length ? ': ' + c.changes.map(sayChange).join(' · ') : ''}`))
    const fields = result.fields.map(f => li(`${MARK[f.kind]} ${f.name} [${f.setName}]${sayField(f) ? ': ' + sayField(f) : ''}`))
    const other = result.other.map(o => li(`${MARK[o.kind]} ${o.area}: ${o.name}${sayOther(o) ? ' (' + sayOther(o) + ')' : ''}`))
    const part = (title, items) => (items.length ? `<h2>${title}</h2>\n<ul>\n${items.join('\n')}\n</ul>\n` : '')
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(head)}</title></head>\n<body>\n<h1>${esc(head)}</h1>\n${part('Cards', cards)}${part('Fields', fields)}${part('Templates, images, fonts and sets', other)}</body></html>\n`
  }

  const md = format === 'markdown'
  const lines = [md ? `# ${head}` : head]
  const bullet = md ? '- ' : '  '
  const section = (title, items) => { if (items.length) lines.push('', md ? `## ${title}` : `${title}:`, ...items.map(i => bullet + i)) }
  section('Cards', result.cards.map(c => `${MARK[c.kind]} ${c.name || '(unnamed card)'}${c.code ? ` (${c.code})` : ''} [${c.setName}]${c.changes.length ? ': ' + c.changes.map(sayChange).join(' · ') : ''}`))
  section('Fields', result.fields.map(f => `${MARK[f.kind]} ${f.name} [${f.setName}]${sayField(f) ? ': ' + sayField(f) : ''}`))
  section('Templates, images, fonts and sets', result.other.map(o => `${MARK[o.kind]} ${o.area}: ${o.name}${sayOther(o) ? ' (' + sayOther(o) + ')' : ''}`))
  return lines.join('\n')
}
