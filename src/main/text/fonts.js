/**
 * Choosing the font for a piece of text (PRD §7.6, §16.2): the project's own fonts first, then the bundled ones.
 *
 * A text asks for a list of families (CSS `font-family`), a weight and an italic flag. The answer is a CHAIN of
 * faces: the first face that matches each requested family, then the bundled defaults, so that a character the
 * requested font lacks is drawn from the next face that has it instead of as a missing-glyph box.
 */
import { join } from 'path'
import { existsSync } from 'fs'
import { openFace } from './hb.js'
import { BUNDLED_FACES, bundledFontsDir, DEFAULT_FAMILIES, genericFamily } from '../fontFiles.js'
import { tr } from '../../shared/i18n.js'

const WEIGHT_WORDS = [
  [/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/light/i, 300], [/semi\s*bold|demi\s*bold|demi/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700], [/medium/i, 500]
]

/** The weight a style name such as "Bold Italic" stands for (400 when it names none). */
export function weightOfStyle(style) {
  for (const [re, w] of WEIGHT_WORDS) if (re.test(style)) return w
  return 400
}

export const isItalicStyle = style => /italic|oblique/i.test(style)

/** CSS font-weight value -> number (keywords and numbers; "bolder" and "lighter" count as bold and normal). */
export function parseWeight(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === '' || v === 'normal' || v === 'lighter') return 400
  if (v === 'bold' || v === 'bolder') return 700
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 400
}

/** Split a CSS font-family list into its names, without quotes. */
export function parseFamilyList(value) {
  return (String(value ?? '').match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map(s => s.trim().replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
}

/**
 * The fonts available to one render: bundled faces plus the project's imported ones.
 * Opening a face is cached across renders (hb.js), so building this is cheap.
 */
export function createFontSet(hb, { projectDir = null, db = null, bundledDir = null } = {}) {
  const entries = []
  const dir = bundledDir ?? bundledFontsDir()
  if (projectDir && db) {
    for (const row of db.prepare('SELECT family_name, style, filename FROM fonts').all()) {
      const file = join(projectDir, 'fonts', row.filename)
      if (existsSync(file)) entries.push({ family: row.family_name, key: row.family_name.toLowerCase(), style: row.style, file })
    }
  }
  for (const b of BUNDLED_FACES) {
    const file = join(dir, b.file)
    if (existsSync(file)) entries.push({ family: b.family, key: b.family.toLowerCase(), style: b.style, file })
  }
  for (const e of entries) { e.weight = weightOfStyle(e.style); e.italic = isItalicStyle(e.style) }

  /** The face of one family closest to the wanted weight and slant, or null when the family is unknown. */
  function pick(familyName, want) {
    // a weight that is not a number would make every face look equally far away, and none would be picked
    if (!Number.isFinite(want.weight)) want = { ...want, weight: 400 }
    const generic = genericFamily(familyName)
    const key = (generic ?? familyName).toLowerCase()
    const candidates = entries.filter(e => e.key === key)
    if (!candidates.length) return null
    let best = null, bestScore = Infinity
    for (const c of candidates) {
      const score = (c.italic === want.italic ? 0 : 1000) + Math.abs(c.weight - want.weight) + (c.weight > want.weight ? 0.1 : 0)
      if (score < bestScore) { best = c; bestScore = score }
    }
    return best
  }

  const byFamily = (name, style = 'Regular') => pick(name, { weight: weightOfStyle(style), italic: isItalicStyle(style) })

  /** The faces for a text, and whether the first of them lacks the bold or the slant that was asked for. */
  function chainInfo(families, want) {
    const picked = []
    for (const name of families) { const e = pick(name, want); if (e) picked.push(e) }
    // Defaults, in the order they are tried for a character the requested fonts lack
    const sans = pick(DEFAULT_FAMILIES.sans, want)
    const primary = picked[0] ?? sans
    for (const e of [sans, byFamily('Noto Sans Arabic'), byFamily('Noto Sans Hebrew')]) if (e) picked.push(e)
    // Text must always have a face to be drawn in: when the usual ones are not there, any face that is will do; when none is, say so
    if (!picked.length) {
      if (!entries.length) throw new Error(tr('errors.noFonts', { dir }))
      picked.push(entries[0])
    }
    const seen = new Set()
    const faces = picked.filter(e => !seen.has(e.file) && seen.add(e.file)).map(e => openFace(hb, e.file))
    // A face that has no bold (or no italic) cannot show it: the layout then synthesizes it (a heavier or slanted copy of the outlines)
    return { faces, synthBold: !!primary && want.weight >= 600 && primary.weight < 600, synthItalic: !!primary && want.italic && !primary.italic }
  }

  return {
    /**
     * Faces to try, in order, for text with these requested families.
     * @param {string[]} families CSS family names, first choice first
     * @param {{ weight: number, italic: boolean }} want
     */
    chain: (families, want) => chainInfo(families, want).faces,
    chainInfo,
    /** True when a requested family is known (a project font or a bundled one). */
    hasFamily: name => entries.some(e => e.key === (genericFamily(name) ?? name).toLowerCase())
  }
}
