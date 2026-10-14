/**
 * Pictures the drawing engine cannot read. resvg decodes PNG, JPEG, GIF and SVG, and nothing else: a WebP picture put into a card is
 * drawn as an empty (white) box, although the window, which has a browser's decoder, shows it fine. So a picture of any other type is
 * turned into a PNG once, kept in the project's cache folder, and that copy is what the card is drawn with. The library keeps the
 * person's original file untouched.
 */
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import sharp from 'sharp'

export const NATIVE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'])
const cacheDir = projectDir => join(projectDir, '.cache', 'png')
const cachedFile = (projectDir, filename) => join(cacheDir(projectDir), `${filename}.png`)

/** Make the PNG copy of every library picture the drawing engine cannot read and that has none yet. Run before a card is drawn. */
export async function ensurePngCache(db, projectDir) {
  const rows = db.prepare(`SELECT filename FROM assets WHERE mime_type NOT IN ('image/png', 'image/jpeg', 'image/gif', 'image/svg+xml')`).all()
  for (const { filename } of rows) {
    const source = join(projectDir, 'assets', filename)
    if (existsSync(cachedFile(projectDir, filename)) || !existsSync(source)) continue
    try {
      mkdirSync(cacheDir(projectDir), { recursive: true })
      writeFileSync(cachedFile(projectDir, filename), await sharp(readFileSync(source)).png().toBuffer())
    } catch { /* a picture that cannot be decoded stays an empty box, as before */ }
  }
}

/** The file and type to draw an asset with: its own, or the PNG copy when the drawing engine cannot read its type; null when there is none. */
export function drawable(projectDir, asset) {
  const own = join(projectDir, 'assets', asset.filename)
  if (NATIVE.has(asset.mime_type)) return existsSync(own) ? { file: own, mime: asset.mime_type } : null
  const copy = cachedFile(projectDir, asset.filename)
  return existsSync(copy) ? { file: copy, mime: 'image/png' } : null
}

/** A picture written into a template itself as a data: URI of a type the drawing engine cannot read (an imported design with a WebP) is turned into a PNG. */
export async function pngifyDataUris(svg) {
  if (!/data:image\/(?!png|jpeg|jpg|gif|svg)[a-z0-9.+-]+;base64,/i.test(svg)) return svg
  const found = [...new Set(svg.match(/data:image\/(?!png|jpeg|jpg|gif|svg)[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi) ?? [])]
  for (const uri of found) {
    try {
      const png = await sharp(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')).png().toBuffer()
      svg = svg.split(uri).join(`data:image/png;base64,${png.toString('base64')}`)
    } catch { /* stays as it was */ }
  }
  return svg
}
