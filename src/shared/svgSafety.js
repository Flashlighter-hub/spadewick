/**
 * Make an SVG from an untrusted source safe to keep and preview (PRD §14.7, §7.7.4): no scripts,
 * no embedded HTML, no event handlers and no reference to anything outside the file. `data:` URIs,
 * in-document `#` references and `{{tokens}}` are kept, because templates need them.
 */
export function sanitizeSvg(svg) {
  let out = String(svg ?? '')
  out = out.replace(/<\s*(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  out = out.replace(/<\s*(script|foreignObject|iframe|object|embed)\b[^>]*>/gi, '')
  // event handlers, inside tags only (so ordinary text such as "once = 5" is untouched); the handler may follow a slash or a quote
  out = out.replace(/<[a-zA-Z][^>]*>/g, tag => tag.replace(/(?:\s+|(?<=[/"']))on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''))
  out = out.replace(/\b((?:xlink:)?href|src)\s*=\s*(["'])\s*(?!data:|#|\{\{)[^"']*\2/gi, '$1=$2$2')
  out = out.replace(/javascript:/gi, '')
  out = out.replace(/@import[^;"'<]*;?/gi, '')
  out = out.replace(/url\(\s*(['"]?)\s*(?:https?:|file:|ftp:|\/\/)[^)]*\)/gi, 'none')
  return out
}
