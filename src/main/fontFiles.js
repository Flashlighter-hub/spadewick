/**
 * Font handling for the renderer (PRD §7.6).
 *
 * resvg-js cannot read CSS @font-face rules and only loads TTF/OTF/TTC files, so:
 *  - project fonts are handed to it as file paths (`fontFiles`);
 *  - WOFF / WOFF2 imports are converted to TTF/OTF when they are imported;
 *  - the real family and style are read from the font's own `name` table (templates refer to the
 *    internal family name, which often differs from the file name);
 *  - a default font family is bundled so text is always visible, even when a template names no font.
 */
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { inflateSync } from 'zlib'
import { tr } from '../shared/i18n.js'

export const DEFAULT_FAMILIES = { sans: 'Liberation Sans', serif: 'Liberation Serif', mono: 'Liberation Mono' }

// Liberation covers Latin, Greek and Cyrillic; the two Noto faces are the bundled fallback for Arabic and Hebrew text (PRD §16.2)
const DEFAULT_FILES = [
  'LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf',
  'LiberationSerif-Regular.ttf', 'LiberationSerif-Bold.ttf', 'LiberationSerif-Italic.ttf', 'LiberationMono-Regular.ttf',
  'NotoSansArabic-Regular.ttf', 'NotoSansHebrew-Regular.ttf'
]

/** The core bundled faces: family and style as the fonts themselves name them, and the file in the fonts folder. */
const CORE_FACES = [
  { family: 'Liberation Sans', style: 'Regular', file: 'LiberationSans-Regular.ttf' },
  { family: 'Liberation Sans', style: 'Bold', file: 'LiberationSans-Bold.ttf' },
  { family: 'Liberation Sans', style: 'Italic', file: 'LiberationSans-Italic.ttf' },
  { family: 'Liberation Sans', style: 'Bold Italic', file: 'LiberationSans-BoldItalic.ttf' },
  { family: 'Liberation Serif', style: 'Regular', file: 'LiberationSerif-Regular.ttf' },
  { family: 'Liberation Serif', style: 'Bold', file: 'LiberationSerif-Bold.ttf' },
  { family: 'Liberation Serif', style: 'Italic', file: 'LiberationSerif-Italic.ttf' },
  { family: 'Liberation Mono', style: 'Regular', file: 'LiberationMono-Regular.ttf' },
  { family: 'Noto Sans Arabic', style: 'Regular', file: 'NotoSansArabic-Regular.ttf' },
  { family: 'Noto Sans Hebrew', style: 'Regular', file: 'NotoSansHebrew-Regular.ttf' }
]

/**
 * The extra open-licence families that come with the application (resources/fonts/extra/, each with its licence file next to it):
 * [{ family, style, file }] from the folder's manifest.json, written by scripts/fetch-fonts.mjs. None when the folder is absent.
 */
function extraFaces() {
  try { return JSON.parse(readFileSync(join(bundledFontsDir(), 'extra', 'manifest.json'), 'utf8')) } catch { return [] }
}

/** Every bundled face: the core fonts and the extra families. */
export const BUNDLED_FACES = [...CORE_FACES, ...extraFaces()]

/**
 * A folder of bundled resources. Packaged builds ship them as an extra resource (resvg reads fonts by path, which asar cannot serve);
 * in a checkout they sit in `resources/` two levels above this file, or three above it once the build has put shared code in a
 * chunk (out/main/chunks/, which is what the command line's second entry causes).
 */
function resourceDir(name, probe) {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.resourcesPath && join(process.resourcesPath, name),
    join(here, '../../resources', name),
    join(here, '../../../resources', name)
  ].filter(Boolean)
  return candidates.find(dir => existsSync(probe ? join(dir, probe) : dir)) ?? candidates[candidates.length > 1 ? 1 : 0]
}

export function bundledFontsDir() {
  return resourceDir('fonts', DEFAULT_FILES[0])
}

/** The folder of the bundled output (CMYK) profiles, found the same way as the fonts (PRD §17.5). */
export function bundledProfilesDir() {
  return resourceDir('profiles')
}

/**
 * Absolute paths of the bundled default fonts that exist on disk. Given the SVG about to be drawn, also the extra bundled families it
 * names (handing the drawing engine a hundred fonts it does not use would make every drawing slow).
 */
export function defaultFontFiles(svg) {
  const dir = bundledFontsDir()
  const files = DEFAULT_FILES.map(f => join(dir, f)).filter(existsSync)
  if (svg) {
    const haystack = String(svg).toLowerCase()
    for (const face of BUNDLED_FACES) {
      if (CORE_FACES.includes(face) || !haystack.includes(face.family.toLowerCase())) continue
      const path = join(dir, face.file)
      if (existsSync(path)) files.push(path)
    }
  }
  return files
}

/** The names of the families that come with the application, for the font lists. */
export const bundledFamilies = () => [...new Set(BUNDLED_FACES.map(f => f.family))].sort((a, b) => a.localeCompare(b))

// ---------------------------------------------------------------------------
// Reading the family / style from an sfnt (TTF/OTF/TTC) file
// ---------------------------------------------------------------------------

function decodeName(buf, platformId, start, length) {
  const raw = buf.subarray(start, start + length)
  if (platformId === 0 || platformId === 3) {
    const swapped = Buffer.from(raw); swapped.swap16()
    return swapped.toString('utf16le')
  }
  return raw.toString('latin1') // Macintosh Roman: identical to Latin-1 for the ASCII names we need
}

/** @returns {{ family: string, style: string } | null} */
export function readFontInfo(buf) {
  try {
    let base = 0
    if (buf.toString('latin1', 0, 4) === 'ttcf') base = buf.readUInt32BE(12) // first font in a collection
    const numTables = buf.readUInt16BE(base + 4)
    let nameOffset = -1
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16
      if (buf.toString('latin1', rec, rec + 4) === 'name') { nameOffset = buf.readUInt32BE(rec + 8); break }
    }
    if (nameOffset < 0) return null

    const count = buf.readUInt16BE(nameOffset + 2)
    const stringBase = nameOffset + buf.readUInt16BE(nameOffset + 4)
    const names = {}
    for (let i = 0; i < count; i++) {
      const r = nameOffset + 6 + i * 12
      const platformId = buf.readUInt16BE(r), nameId = buf.readUInt16BE(r + 6)
      const length = buf.readUInt16BE(r + 8), offset = buf.readUInt16BE(r + 10)
      if (![1, 2, 16, 17].includes(nameId)) continue
      const preferred = platformId === 3 || platformId === 0
      if (names[nameId] && !preferred) continue // keep a Unicode entry over a Mac one
      names[nameId] = decodeName(buf, platformId, stringBase + offset, length)
    }
    const family = (names[16] || names[1] || '').trim()
    const style = (names[17] || names[2] || 'Regular').trim()
    return family ? { family, style } : null
  } catch {
    return null
  }
}

/**
 * The font's embedding permissions (OS/2 `fsType`), or null when the table is missing. The font's maker
 * uses it to say whether the font may be passed on inside another file (PRD §7.7.4).
 */
export function readEmbeddingFlags(buf) {
  try {
    let base = 0
    if (buf.toString('latin1', 0, 4) === 'ttcf') base = buf.readUInt32BE(12)
    const numTables = buf.readUInt16BE(base + 4)
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16
      if (buf.toString('latin1', rec, rec + 4) === 'OS/2') {
        const fsType = buf.readUInt16BE(buf.readUInt32BE(rec + 8) + 8)
        return { fsType, restricted: (fsType & 0x0002) !== 0, noEmbedding: (fsType & 0x0002) !== 0, previewOnly: (fsType & 0x0004) !== 0 && (fsType & 0x0008) === 0 }
      }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// WOFF / WOFF2 -> sfnt
// ---------------------------------------------------------------------------

/** WOFF 1.0 is zlib-compressed sfnt tables in a different wrapper; rebuild the plain sfnt. */
export function woffToSfnt(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error(tr('errors.notWoff'))
  const flavor = buf.readUInt32BE(4)
  const numTables = buf.readUInt16BE(12)
  const tables = []
  for (let i = 0; i < numTables; i++) {
    const r = 44 + i * 20
    const offset = buf.readUInt32BE(r + 4), compLength = buf.readUInt32BE(r + 8), origLength = buf.readUInt32BE(r + 12)
    const raw = buf.subarray(offset, offset + compLength)
    const data = compLength < origLength ? inflateSync(raw) : raw
    if (data.length !== origLength) throw new Error(tr('errors.woffTable'))
    tables.push({ tag: buf.subarray(r, r + 4), checksum: buf.readUInt32BE(r + 16), data })
  }
  let offset = 12 + numTables * 16
  const parts = []
  const header = Buffer.alloc(12 + numTables * 16)
  header.writeUInt32BE(flavor, 0)
  header.writeUInt16BE(numTables, 4)
  const pow = 2 ** Math.floor(Math.log2(numTables))
  header.writeUInt16BE(pow * 16, 6)
  header.writeUInt16BE(Math.log2(pow), 8)
  header.writeUInt16BE(numTables * 16 - pow * 16, 10)
  tables.forEach((t, i) => {
    const r = 12 + i * 16
    t.tag.copy(header, r)
    header.writeUInt32BE(t.checksum, r + 4)
    header.writeUInt32BE(offset, r + 8)
    header.writeUInt32BE(t.data.length, r + 12)
    const padded = Buffer.alloc(Math.ceil(t.data.length / 4) * 4)
    t.data.copy(padded)
    parts.push(padded)
    offset += padded.length
  })
  return Buffer.concat([header, ...parts])
}

/** Convert any supported font file to a TTF/OTF buffer that resvg can load. */
export async function toSfnt(buf, ext) {
  if (ext === '.woff') return woffToSfnt(buf)
  if (ext === '.woff2') {
    const { default: wawoff2 } = await import('wawoff2')
    return Buffer.from(await wawoff2.decompress(buf))
  }
  return buf
}

/** True when the data really is an sfnt font (guards against renamed or corrupt files). */
export function isSfnt(buf) {
  const sig = buf.toString('latin1', 0, 4)
  return sig === '\x00\x01\x00\x00' || sig === 'OTTO' || sig === 'true' || sig === 'ttcf'
}

// ---------------------------------------------------------------------------
// Generic family names
// ---------------------------------------------------------------------------

/** The bundled family a CSS generic name (serif, monospace…) stands for, or null. */
export const genericFamily = name => GENERIC[String(name).replace(/^['"]|['"]$/g, '').trim().toLowerCase()] ?? null

const GENERIC = {
  'serif': DEFAULT_FAMILIES.serif,
  'sans-serif': DEFAULT_FAMILIES.sans, 'system-ui': DEFAULT_FAMILIES.sans, 'ui-sans-serif': DEFAULT_FAMILIES.sans,
  'cursive': DEFAULT_FAMILIES.sans, 'fantasy': DEFAULT_FAMILIES.sans,
  'monospace': DEFAULT_FAMILIES.mono, 'ui-monospace': DEFAULT_FAMILIES.mono
}

function mapFamilyList(list) {
  return list.split(',').map(part => {
    const name = part.trim()
    const bare = name.replace(/^['"]|['"]$/g, '').toLowerCase()
    return GENERIC[bare] ? `'${GENERIC[bare]}'` : name
  }).join(', ')
}

/**
 * resvg-js does not resolve CSS generic families (serif, monospace…) unless system fonts are
 * loaded, so rewrite them to the bundled families. Unknown names are left for resvg's fallback.
 */
export function mapGenericFonts(svg) {
  return svg
    .replace(/font-family="([^"]*)"/g, (_, list) => `font-family="${mapFamilyList(list)}"`)
    .replace(/(font-family\s*:\s*)([^;}"]*)/g, (_, prefix, list) => `${prefix}${mapFamilyList(list)}`)
}
