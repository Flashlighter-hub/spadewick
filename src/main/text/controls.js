/**
 * The text controls of a text element (PRD §16.6), kept in the SVG as attributes so templates stay plain files:
 *
 *   data-spadewick-text-step         auto-fit step, 0.25 to 1 (default 1)
 *   data-spadewick-tighten           tighten the letter spacing down to this many per cent of an em before the size is reduced (0 to 10)
 *   data-spadewick-icon-scale        "fixed": icons keep their size while the text shrinks
 *   data-spadewick-text-max-lines    a limit on the number of lines, alone or with the box height
 *   data-spadewick-line-height       a multiple (1.2), or an exact height with a unit (18pt, 24px)
 *   data-spadewick-paragraph-spacing em: a blank line becomes this gap between paragraphs
 *   data-spadewick-text-align        "justify" (otherwise text-anchor aligns)
 *   data-spadewick-valign            top (default), middle, bottom: where the text sits in a box
 *   data-spadewick-indent            first-line indent, em (or with a unit)
 *   data-spadewick-bullets           "true": lines that start with "- " become bullets with a hanging indent;
 *   data-spadewick-bullet            a character (default •) or icon:name
 *   data-spadewick-text-transform    uppercase, lowercase, title, small-caps
 *   data-spadewick-balance           "true": even out the length of the lines
 *   data-spadewick-avoid-orphans     "true": no last line of a single word
 *   data-spadewick-outline           "width colour": an outline drawn behind the text
 *   data-spadewick-shadow            "dx dy colour": a hard shadow
 *   word-spacing, letter-spacing     the SVG properties (letter-spacing in em is tracking)
 */
import { lengthPx } from './cssLength.js'
import { starterIcon } from '../../shared/starterIcons.js'
import { iconKey, isHexColor } from '../../shared/richText.js'

export const BULLET_MARK = '' // stands for "a bullet starts this paragraph" in the text until the spans are made

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const hex = c => (typeof c === 'string' && isHexColor(c.trim()) ? c.trim() : null)

/** The controls an element asks for, as numbers in pixels or ratios; anything it does not set is left out. */
export function readControls(attrs, frame) {
  const size = frame.size ?? 12
  const get = k => attrs.get(`data-spadewick-${k}`)
  const ctl = { wordSpacing: frame.wordSpacing ?? 0 }

  const lh = get('line-height')
  if (lh != null && lh.trim() !== '') {
    if (/^\s*\d*\.?\d+\s*$/.test(lh)) { const n = Number(lh); if (n > 0) ctl.lineHeight = clamp(n, 0.5, 4) }
    else { const px = lengthPx(lh, size); if (px > 0) ctl.lineExact = px }
  }
  const ps = Number(get('paragraph-spacing')); if (ps > 0) ctl.paragraphSpacing = clamp(ps, 0, 3)
  const ind = get('indent')
  if (ind != null && ind.trim() !== '') { const px = /^\s*-?\d*\.?\d+\s*$/.test(ind) ? Number(ind) * size : lengthPx(ind, size); if (px > 0) ctl.indent = clamp(px, 0, 400) }
  const tg = Number(get('tighten')); if (tg > 0) ctl.tighten = clamp(tg, 0, 10) / 100
  const st = Number(get('text-step')); if (st > 0) ctl.step = clamp(st, 0.25, 1)
  const ml = parseInt(get('text-max-lines'), 10); if (ml >= 1) ctl.maxLines = ml
  ctl.justify = get('text-align') === 'justify'
  const va = get('valign'); if (va === 'middle' || va === 'bottom') ctl.valign = va
  ctl.bullets = get('bullets') === 'true'
  const bullet = (get('bullet') ?? '').trim()
  if (/^icon:[A-Za-z0-9_-]+$/.test(bullet)) ctl.bulletIcon = iconKey(bullet.slice(5))
  else if (bullet && [...bullet].length <= 3) ctl.bulletChar = bullet
  const tr = get('text-transform'); if (['uppercase', 'lowercase', 'title', 'small-caps'].includes(tr)) ctl.transform = tr
  ctl.balance = get('balance') === 'true'
  ctl.avoidOrphans = get('avoid-orphans') === 'true'
  ctl.iconsFixed = get('icon-scale') === 'fixed'

  const ol = get('outline')?.trim().split(/\s+/)
  if (ol?.length === 2) { const w = lengthPx(ol[0], size), c = hex(ol[1]); if (w > 0 && c) ctl.outline = { width: clamp(w, 0, size), color: c } }
  const sh = get('shadow')?.trim().split(/\s+/)
  if (sh?.length === 3) { const dx = lengthPx(sh[0], size), dy = lengthPx(sh[1], size), c = hex(sh[2]); if (dx !== null && dy !== null && c) ctl.shadow = { dx: clamp(dx, -size, size), dy: clamp(dy, -size, size), color: c } }
  return ctl
}

/** Lines that start with "- " become bullets: the dash is replaced by a mark the spans are split at. */
export const bulletize = text => text.split('\n').map(l => (l.startsWith('- ') ? BULLET_MARK + l.slice(2) : l)).join('\n')

/** Upper, lower or title case (title: the first letter of each word). */
export function transformText(text, mode) {
  if (mode === 'uppercase') return text.toLocaleUpperCase()
  if (mode === 'lowercase') return text.toLocaleLowerCase()
  if (mode === 'title') return text.toLocaleLowerCase().replace(/(^|[\s\-(—"'“])(\p{L})/gu, (_, pre, ch) => pre + ch.toLocaleUpperCase())
  return text
}

const SMALL_CAP_SCALE = 0.8

/**
 * The last touches on the spans of an element: its text transform, small capitals, word spacing, outline and shadow
 * (unless a text style gave its own), and the bullets.
 */
export function finishSpans(spans, ctl, library) {
  let out = spans
  if (ctl.transform && ctl.transform !== 'small-caps') out = out.map(s => (s.icon ? s : { ...s, text: transformText(s.text, ctl.transform) }))

  out = out.flatMap(s => {
    if (s.icon || !(s.smallCaps || ctl.transform === 'small-caps')) return [s]
    // A font with real small capitals shows them; any other gets its lower case letters as capitals at 0.8 of the size
    if (s.chain[0]?.hasFeature?.('smcp')) return [{ ...s, features: [...(s.features ?? []), 'smcp'] }]
    const parts = []
    for (const piece of s.text.split(/(\p{Ll}+)/u)) {
      if (!piece) continue
      parts.push(/^\p{Ll}+$/u.test(piece) ? { ...s, text: piece.toLocaleUpperCase(), size: s.size * SMALL_CAP_SCALE } : { ...s, text: piece })
    }
    return parts
  })

  out = out.map(s => (s.icon ? s : { ...s, wordSpacing: s.wordSpacing || ctl.wordSpacing || 0, outline: s.outline ?? ctl.outline, shadow: s.shadow ?? ctl.shadow }))

  if (ctl.bullets) {
    const next = []
    for (const s of out) {
      if (s.icon || !s.text.includes(BULLET_MARK)) { next.push(s); continue }
      s.text.split(BULLET_MARK).forEach((part, i) => {
        if (i > 0) next.push(markerSpan(s, ctl, library))
        if (part) next.push({ ...s, text: part })
      })
    }
    out = next
  }
  return out
}

/** The bullet that starts a paragraph: a character or an icon, with a gap after it that the following lines hang by. */
function markerSpan(s, ctl, library) {
  const gap = s.size * 0.4
  if (ctl.bulletIcon) {
    const e = library?.entry(ctl.bulletIcon) ?? (starterIcon(ctl.bulletIcon) ? { aspect: 1, size: 1, vOffset: 0, spacing: 0 } : null)
    const info = e ?? { aspect: 1, size: 1, vOffset: 0, spacing: 0 }
    return { icon: ctl.bulletIcon, size: s.size, scale: info.size, aspect: info.aspect, spacing: info.spacing, vOffset: info.vOffset, fill: s.fill, marker: true, afterSpace: gap }
  }
  return { ...s, text: ctl.bulletChar ?? '•', marker: true, afterSpace: gap, underline: false, strike: false, outline: s.outline, shadow: s.shadow }
}
