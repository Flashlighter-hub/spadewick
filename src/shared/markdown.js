/**
 * Markdown for the Rules pages (PRD §7.11): a small, safe reader for the part of Markdown a rulebook uses, turning it into HTML.
 *
 * Nothing from the text reaches the page unescaped: raw HTML is shown as text, and links and pictures are written as data attributes the
 * page fills in (a link to the web is opened by the application, a picture is one of the project's images, a card is one of its cards).
 *
 *   # Headings (1 to 6)        **strong**  *emphasis*  ~~struck~~  `code`
 *   - lists  1. numbered  - [ ] tasks, nested by indenting    > quotes    ---   a rule
 *   | tables | with | :alignment: |        ``` fenced code ```
 *   [a link](https://…)   [a page](page:Turn order)   [a heading](#heading-id)
 *   ![a picture](asset:Name.png)        [[A card]]  a link to a card         ![[A card]]  the picture of a card
 */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attr = s => esc(s).replace(/'/g, '&#39;')
/** Text that is already escaped, as it was; and made safe for an attribute written in single quotes too. */
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
const inAttr = s => String(s).replace(/'/g, '&#39;')
export const slugOf = text => String(text).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section'

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/** A link target made safe: the web, a mail address, a page of the rules, a heading, a picture of the project; anything else is no link. */
export function linkKind(url) {
  const u = String(url ?? '').trim()
  if (/^https?:\/\/\S+$/i.test(u)) return { kind: 'web', url: u }
  if (/^mailto:\S+$/i.test(u)) return { kind: 'web', url: u }
  if (/^page:/i.test(u) && u.length > 5) return { kind: 'page', url: u.slice(5).trim() }
  if (/^#\S+$/.test(u)) return { kind: 'anchor', url: u.slice(1) }
  return null
}

const PLACE = '\u0000'

/** Strong, emphasis and strike-through in text that is already safe. */
function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
}

/**
 * @param {string} text one paragraph of Markdown
 * @param {{ refs?: object }} [state] collects what the text points to
 */
function inline(text, state) {
  const held = []
  const hold = html => { held.push(html); return `${PLACE}${held.length - 1}${PLACE}` }
  let s = String(text)

  // code spans first: nothing inside them is read
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => hold(`<code>${esc(code.trim())}</code>`))
  // a backslash keeps the next mark as a letter
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_, c) => hold(esc(c)))
  s = esc(s)

  // a card: the picture of it, or a link to it
  s = s.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (_, bang, raw) => {
    const name = raw.trim()
    state.refs.cards.add(unesc(name))
    return hold(bang
      ? `<figure class="card-embed" data-rules-card-embed="${inAttr(name)}"><figcaption>${name}</figcaption></figure>`
      : `<a class="card-ref" data-rules-card="${inAttr(name)}" role="button" tabindex="0">${name}</a>`)
  })

  // a picture of the project (the address may hold one level of brackets)
  s = s.replace(/!\[([^\]]*)\]\(\s*asset:((?:[^()\n]|\([^()\n]*\))+?)\s*\)/g, (_, alt, name) => {
    state.refs.assets.add(unesc(name.trim()))
    return hold(`<img class="rules-img" data-rules-asset="${inAttr(name.trim())}" alt="${inAttr(alt)}" />`)
  })
  // a picture from elsewhere cannot be shown: its words are
  s = s.replace(/!\[([^\]]*)\]\(\s*(?:[^()\n]|\([^()\n]*\))*\)/g, (_, alt) => hold(`<span class="img-alt">${alt}</span>`))

  // links, the words of which are read on in their turn
  s = s.replace(/\[([^\]\n]+)\]\(\s*((?:[^()\n]|\([^()\n]*\))*?)\s*\)/g, (_, label, url) => {
    const kind = linkKind(unesc(url))
    const words = emphasis(label)
    if (!kind) return hold(`<span class="dead-link">${words}</span>`)
    if (kind.kind === 'page') state.refs.pages.add(kind.url)
    const data = kind.kind === 'web' ? `data-rules-link="${attr(kind.url)}"` : kind.kind === 'page' ? `data-rules-page="${attr(kind.url)}"` : `data-rules-anchor="${attr(kind.url)}"`
    return hold(`<a class="${kind.kind === 'web' ? 'ext' : 'int'}" ${data} role="link" tabindex="0">${words}</a>`)
  })
  // a bare address
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, lead, url) => `${lead}${hold(`<a class="ext" data-rules-link="${attr(unesc(url))}" role="link" tabindex="0">${url}</a>`)}`)

  // emphasis
  s = emphasis(s)
  // a hard break: two spaces, or a backslash, at the end of a line
  s = s.replace(/( {2,}|\\)\n/g, '<br />\n')

  // `held` may hold held things (a link's words): put back until none is left
  for (let guard = 0; guard < 8 && s.includes(PLACE); guard++) s = s.replace(new RegExp(`${PLACE}(\\d+)${PLACE}`, 'g'), (_, i) => held[Number(i)] ?? '')
  return s
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const RE = {
  heading: /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/,
  rule: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  fence: /^ {0,3}(```+|~~~+)[ \t]*([\w+-]*)[^`]*$/,
  quote: /^ {0,3}>[ \t]?(.*)$/,
  item: /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/,
  tableSep: /^ *\|? *:?-{1,}:? *(?:\| *:?-{1,}:? *)*\|? *$/
}
const isBlank = l => !l.trim()
const cells = line => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const out = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++ } else if (t[i] === '|') { out.push(cur.trim()); cur = '' } else cur += t[i]
  }
  out.push(cur.trim())
  return out
}

const startsBlock = line => RE.heading.test(line) || RE.rule.test(line) || RE.fence.test(line) || RE.quote.test(line) || RE.item.test(line)

function parseBlocks(lines, state, depth = 0) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }

    let m
    if ((m = RE.fence.exec(line))) {
      const fence = m[1], body = []
      i++
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && lines[i].trim().replace(new RegExp(`^${fence[0]}+`), '') === '')) body.push(lines[i++])
      i++
      out.push(`<pre><code${m[2] ? ` class="lang-${attr(m[2])}"` : ''}>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    if ((m = RE.heading.exec(line))) {
      const level = m[1].length
      const text = m[2]
      let id = slugOf(text.replace(/[*_`~[\]]/g, ''))
      const n = state.ids.get(id) ?? 0
      state.ids.set(id, n + 1)
      if (n) id = `${id}-${n}`
      state.headings.push({ level, text: text.replace(/[*_`~]|\[\[|\]\]/g, '').trim(), id })
      out.push(`<h${level} id="${attr(id)}">${inline(text, state)}</h${level}>`)
      i++
      continue
    }
    if (RE.rule.test(line)) { out.push('<hr />'); i++; continue }

    if (RE.quote.test(line)) {
      const inner = []
      while (i < lines.length && (RE.quote.test(lines[i]) || (!isBlank(lines[i]) && inner.length && !startsBlock(lines[i])))) { inner.push((RE.quote.exec(lines[i]) ?? [0, lines[i]])[1]); i++ }
      out.push(`<blockquote>${parseBlocks(inner, state, depth + 1).join('\n')}</blockquote>`)
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-') && (lines[i + 1].includes('|') || cells(line).length > 1)) {
      const head = cells(line), seps = cells(lines[i + 1])
      if (head.length === seps.length) {
        const align = seps.map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''))
        const cell = (tag, c, k) => `<${tag}${align[k] ? ` class="al-${align[k]}"` : ''}>${inline(c, state)}</${tag}>`
        const rows = []
        i += 2
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
          const r = cells(lines[i]); while (r.length < head.length) r.push('')
          rows.push(`<tr>${r.slice(0, head.length).map((c, k) => cell('td', c, k)).join('')}</tr>`)
          i++
        }
        out.push(`<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
        continue
      }
    }

    if (RE.item.test(line) && depth < 8) {
      const [html, next] = parseList(lines, i, state, depth)
      out.push(html); i = next
      continue
    }

    // a paragraph runs until a blank line or another kind of block
    const para = [line]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-'))) para.push(lines[i++])
    out.push(`<p>${inline(para.join('\n'), state)}</p>`)
  }
  return out
}

function parseList(lines, start, state, depth) {
  const first = RE.item.exec(lines[start])
  const base = first[1].length
  const ordered = /\d/.test(first[2])
  const startNumber = ordered ? parseInt(first[2], 10) : 1
  const items = []
  let i = start
  while (i < lines.length) {
    const m = RE.item.exec(lines[i])
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break
    const contentIndent = base + m[2].length + 1
    const body = [m[3]]
    let j = i + 1
    while (j < lines.length) {
      const l = lines[j]
      if (isBlank(l)) {
        let k = j; while (k < lines.length && isBlank(lines[k])) k++
        if (k < lines.length && /^ */.exec(lines[k])[0].length > base && !(RE.item.exec(lines[k]) && RE.item.exec(lines[k])[1].length <= base)) { for (let q = j; q < k; q++) body.push(''); j = k; continue }
        break
      }
      const indent = /^ */.exec(l)[0].length
      const sibling = RE.item.exec(l)
      if (indent > base) { body.push(l.slice(Math.min(indent, contentIndent))); j++; continue }
      if (sibling && indent <= base) break
      if (!startsBlock(l) && body.length && !isBlank(body[body.length - 1])) { body.push(l.trim()); j++; continue }   // a line that carries on the item's words
      break
    }
    let task = null
    const t = /^\[( |x|X)\][ \t]+/.exec(body[0])
    if (t) { task = t[1] !== ' '; body[0] = body[0].slice(t[0].length) }
    const blocks = parseBlocks(body, state, depth + 1)
    const tight = blocks.length && blocks[0].startsWith('<p>') && !body.some(isBlank)
    const inner = tight ? blocks[0].replace(/^<p>|<\/p>$/g, '') + blocks.slice(1).join('') : blocks.join('')
    items.push(`<li${task === null ? '' : ' class="task"'}>${task === null ? '' : `<input type="checkbox" disabled${task ? ' checked' : ''} aria-label="${task ? 'done' : 'not done'}" /> `}${inner}</li>`)
    i = j
  }
  const tag = ordered ? 'ol' : 'ul'
  return [`<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>${items.join('')}</${tag}>`, i]
}

/**
 * Markdown as HTML (safe to put on a page), with the headings, and what the text points to.
 * @returns {{ html: string, headings: { level: number, text: string, id: string }[], refs: { cards: string[], assets: string[], pages: string[] } }}
 */
export function renderMarkdown(source) {
  const state = { headings: [], ids: new Map(), refs: { cards: new Set(), assets: new Set(), pages: new Set() } }
  const text = String(source ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const html = parseBlocks(text.split('\n'), state).join('\n')
  return { html, headings: state.headings, refs: { cards: [...state.refs.cards], assets: [...state.refs.assets], pages: [...state.refs.pages] } }
}

/** The words of a page without its marks, for finding things in it. */
export function plainText(source) {
  return String(source ?? '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/!?\[\[([^\]]+)\]\]/g, '$1').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '').replace(/^ {0,3}>[ \t]?/gm, '').replace(/^ *([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '')
    .replace(/[*_~`|]/g, '').replace(/\s+/g, ' ').trim()
}

/** The title a Markdown file gives itself: its first level-one heading, and the text without that line. */
export function splitTitle(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && isBlank(lines[i])) i++
  const m = i < lines.length ? /^ {0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[i]) : null
  if (!m) return { title: null, body: lines.join('\n') }
  let rest = i + 1
  while (rest < lines.length && isBlank(lines[rest])) rest++
  return { title: m[1].trim(), body: lines.slice(rest).join('\n') }
}
