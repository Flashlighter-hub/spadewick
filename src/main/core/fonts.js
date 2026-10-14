import { randomUUID } from 'crypto'
import { join, basename, extname } from 'path'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { readFontInfo, toSfnt, isSfnt, bundledFamilies } from '../fontFiles.js'
import { tr } from '../../shared/i18n.js'
import { dbOf, dirOf } from './context.js'
import { announce } from './changes.js'

const ALLOWED_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2'])

function fontsDir(ctx) {
  return join(dirOf(ctx), 'fonts')
}

/** Add one font file to the project's fonts (WOFF/WOFF2 are converted). Returns the font row, the existing row for a duplicate, or null for an unsupported type. */
export async function importFontFile(d, dir, src) {
  const ext = extname(src).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) return null

  // The renderer only reads sfnt (TTF/OTF) files, so WOFF/WOFF2 are converted on import
  let data
  try {
    data = await toSfnt(readFileSync(src), ext)
  } catch (err) {
    throw new Error(tr('errors.couldNotReadFont', { file: basename(src), reason: err.message }))
  }
  if (!isSfnt(data)) throw new Error(tr('errors.notValidFont', { file: basename(src) }))

  // Templates refer to the font's internal family name, not its file name
  const stem = basename(src, ext)
  const info = readFontInfo(data) ?? { family: stem.replace(/[-_]/g, ' ').replace(/\b(bold|italic|regular)\b/gi, '').trim() || stem, style: 'Regular' }
  const duplicate = d.prepare('SELECT * FROM fonts WHERE family_name = ? AND style = ?').get(info.family, info.style)
  if (duplicate) return duplicate

  const id = randomUUID()
  const filename = `${id}${data.toString('latin1', 0, 4) === 'OTTO' ? '.otf' : data.toString('latin1', 0, 4) === 'ttcf' ? '.ttc' : '.ttf'}`
  writeFileSync(join(dir, filename), data)

  d.prepare(
    'INSERT INTO fonts (id, family_name, style, filename, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, info.family, info.style, filename, Date.now())

  return d.prepare('SELECT * FROM fonts WHERE id = ?').get(id)
}

/** The font families that come with the application (open licences; each family's licence file is in resources/fonts/extra). */
export const bundled = () => bundledFamilies()

export function list(ctx) {
  return dbOf(ctx).prepare('SELECT * FROM fonts ORDER BY family_name, style').all()
}

export async function importFiles(ctx, filePaths) {
  let paths = filePaths
  if (!paths) {
    const result = await ctx.ui.showOpenDialog({
      title: tr('dialogs.importFonts'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: tr('dialogs.fonts'), extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    })
    if (result.canceled) return []
    paths = result.filePaths
  }

  const d = dbOf(ctx)
  const dir = fontsDir(ctx)
  mkdirSync(dir, { recursive: true })

  const imported = []
  for (const src of paths) {
    const row = await importFontFile(d, dir, src)
    if (row) imported.push(row)
  }

  if (imported.length) announce({ all: true })   // text set in this font is drawn differently
  return imported
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const row = d.prepare('SELECT filename FROM fonts WHERE id = ?').get(id)
  if (!row) return
  const filePath = join(fontsDir(ctx), row.filename)
  if (existsSync(filePath)) unlinkSync(filePath)
  d.prepare('DELETE FROM fonts WHERE id = ?').run(id)
  announce({ all: true })
}

