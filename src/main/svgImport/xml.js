/**
 * A small, forgiving XML reader and writer for the SVG import (PRD §19). SVG from design tools is well-formed, so this
 * does not try to be a general XML parser: it builds a tree of elements, attributes and text, drops comments, processing
 * instructions and the DOCTYPE (so no entity can ever be expanded) and keeps what is left as written.
 *
 * Element: { tag, attrs: { name: decodedValue }, children: [Element | { text }] }. Text is kept as written (entities
 * still escaped); a CDATA section is turned into escaped text, except in <style>, where it stays raw CSS.
 */

const MAX_NODES = 400000
const MAX_DEPTH = 256

export class SvgParseError extends Error {}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Attribute values: the five named entities and numeric references (nothing else is ever expanded). */
export function decodeEntities(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (m, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()]
    const cp = dec ? Number(dec) : parseInt(hex, 16)
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
  })
}

export const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const escapeText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const NAME = /[^\s=/>"'<]+/y
const ATTR = /\s*([^\s=/>"'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/y

/**
 * @returns {{ root: object, comments: string[] }} the root <svg> element and the text of the comments before it
 *   (a generator such as "Adobe Illustrator" announces itself there)
 */
export function parseXml(source) {
  const src = String(source ?? '').replace(/^﻿/, '')
  const comments = []
  const stack = []
  let root = null, nodes = 0, i = 0
  const len = src.length

  const add = child => {
    if (++nodes > MAX_NODES) throw new SvgParseError('too many elements')
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(child)
    else if (child.tag) { if (root) throw new SvgParseError('more than one root element'); root = child }
  }

  while (i < len) {
    const lt = src.indexOf('<', i)
    if (lt === -1) { if (stack.length && src.slice(i).trim()) add({ text: src.slice(i) }); break }
    if (lt > i && stack.length) {
      const text = src.slice(i, lt)
      if (text) add({ text })
    }
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end === -1) throw new SvgParseError('unterminated comment')
      if (!root && comments.length < 20) comments.push(src.slice(i + 4, end).slice(0, 400))
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i)
      if (end === -1) throw new SvgParseError('unterminated CDATA')
      const raw = src.slice(i + 9, end)
      const parent = stack[stack.length - 1]
      if (parent) add(parent.tag === 'style' ? { text: raw, raw: true } : { text: escapeText(raw) })
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i)
      if (end === -1) throw new SvgParseError('unterminated instruction')
      i = end + 2
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE (with or without an internal subset): skipped whole, so no entity declared in it is ever used
      let depth = 0, j = i + 2
      for (; j < len; j++) {
        const c = src[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      i = j + 1
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i)
      if (end === -1) throw new SvgParseError('unterminated tag')
      const tag = src.slice(i + 2, end).trim()
      const top = stack.pop()
      if (!top || top.tag !== tag) throw new SvgParseError(`unexpected </${tag}>`)
      i = end + 1
    } else {
      NAME.lastIndex = i + 1
      const nm = NAME.exec(src)
      if (!nm) throw new SvgParseError('bad tag')
      const el = { tag: nm[0], attrs: {}, children: [] }
      let j = NAME.lastIndex
      for (;;) {
        ATTR.lastIndex = j
        const m = ATTR.exec(src)
        if (!m) break
        j = ATTR.lastIndex
        if (el.attrs[m[1]] === undefined) el.attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
      }
      while (j < len && /\s/.test(src[j])) j++
      let selfClose = false
      if (src[j] === '/') { selfClose = true; j++ }
      if (src[j] !== '>') throw new SvgParseError('bad tag')
      i = j + 1
      add(el)
      if (!selfClose) {
        if (stack.length >= MAX_DEPTH) throw new SvgParseError('nested too deeply')
        stack.push(el)
      }
    }
  }
  if (stack.length) throw new SvgParseError(`<${stack[stack.length - 1].tag}> is not closed`)
  if (!root || root.tag !== 'svg') throw new SvgParseError('not an SVG file')
  return { root, comments }
}

export function serialize(node) {
  if (node.text !== undefined) return node.raw ? `<![CDATA[${node.text}]]>` : node.text
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')
  if (!node.children.length) return `<${node.tag}${attrs}/>`
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`
}

/** Elements only. */
export const elementsOf = node => node.children.filter(c => c.tag)

/** Visit every element, depth first, with its ancestors (nearest last). The callback returns false to skip the subtree. */
export function walk(node, fn, ancestors = []) {
  if (fn(node, ancestors) === false) return
  ancestors.push(node)
  for (const c of node.children) if (c.tag) walk(c, fn, ancestors)
  ancestors.pop()
}

/** The text content of an element, entities decoded. */
export function textOf(node) {
  if (node.text !== undefined) return decodeEntities(node.text)
  return node.children.map(textOf).join('')
}
