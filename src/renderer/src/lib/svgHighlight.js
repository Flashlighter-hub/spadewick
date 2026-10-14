/**
 * Light-weight syntax highlighting for the SVG source editor (PRD §8.6). No editor dependency:
 * the text is escaped and wrapped in <span class="hl-…"> for comments, tags, attributes, strings
 * and {{tokens}}. The visible characters are exactly the input, so it can sit under a textarea.
 */

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const span = (cls, text) => `<span class="hl-${cls}">${esc(text)}</span>`

/** Wrap {{tokens}} inside already-matched text. */
function withTokens(text, cls) {
  return text.split(/(\{\{[^}]*\}\})/).map(part => (/^\{\{[^}]*\}\}$/.test(part) ? span('token', part) : part ? span(cls, part) : '')).join('')
}

function highlightTag(tag) {
  // <tagname attr="value" attr2='v' /> — or a closing tag
  const m = /^(<\/?)([^\s/>]+)([\s\S]*?)(\/?>)$/.exec(tag)
  if (!m) return esc(tag)
  const [, open, name, attrs, close] = m
  const attrHtml = attrs.replace(/([^\s=]+)(\s*=\s*)("[^"]*"|'[^']*')?|(\s+)|([^\s=]+)/g, (all, an, eq, val, ws, bare) => {
    if (ws) return ws
    if (bare) return esc(bare)
    return span('attr', an) + esc(eq ?? '') + (val ? withTokens(val, 'string') : '')
  })
  return span('punct', open) + span('tag', name) + attrHtml + span('punct', close)
}

export function highlightSvg(source) {
  let out = ''
  let last = 0
  // Order matters: comments and CDATA first, then tags; everything else is text
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z][^<>]*>/g
  let m
  while ((m = re.exec(source))) {
    if (m.index > last) out += withTokens(source.slice(last, m.index), 'text')
    out += m[0].startsWith('<!--') || m[0].startsWith('<![') || m[0].startsWith('<?') ? span('comment', m[0]) : highlightTag(m[0])
    last = m.index + m[0].length
  }
  if (last < source.length) out += withTokens(source.slice(last), 'text')
  return out
}
