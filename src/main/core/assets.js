import { randomUUID } from 'crypto'
import { join, basename, extname } from 'path'
import { copyFileSync, statSync, existsSync, readFileSync } from 'fs'
import sharp from 'sharp'
import { recordChange, rowOf, stashAssetFile } from './history.js'
import { tr } from '../../shared/i18n.js'
import { dbOf, dirOf } from './context.js'

const ALLOWED_MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.icc':  'application/vnd.iccprofile',
  '.icm':  'application/vnd.iccprofile'
}

function assetsDir(ctx) {
  return join(dirOf(ctx), 'assets')
}

/** Copy one image into the project's asset library and record it (and its undo entry). Returns the asset row, or null for an unsupported type. */
export async function importAssetFile(d, dir, src, { record = true, originalName = basename(src) } = {}) {
  const ext = extname(src).toLowerCase()
  const mime = ALLOWED_MIME[ext]
  if (!mime) return null

  const id = randomUUID()
  const dest = join(dir, `${id}${ext}`)
  copyFileSync(src, dest)

  let width = null, height = null, thumbnail = null
  if (mime !== 'image/svg+xml') {
    try {
      const meta = await sharp(dest).metadata()
      width = meta.width
      height = meta.height
      thumbnail = await sharp(dest)
        .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
    } catch { /* non-fatal */ }
  }

  const stat = statSync(dest)
  d.prepare(
    `INSERT INTO assets (id, filename, original_name, mime_type, width_px, height_px, file_size_bytes, tags, notes, thumbnail_jpeg, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '', ?, ?)`
  ).run(id, `${id}${ext}`, originalName, mime, width, height, stat.size, thumbnail, Date.now())

  if (record) recordChange(d, 'IMPORT_ASSET', [{ table: 'assets', before: null, after: rowOf(d, 'assets', id) }], [{ name: `${id}${ext}`, presentAfter: true }])
  return d.prepare('SELECT id, filename, original_name, mime_type, width_px, height_px, file_size_bytes, tags, notes, created_at FROM assets WHERE id = ?').get(id)
}

export function list(ctx, { tags, search, unusedOnly } = {}) {
  const d = dbOf(ctx)
  // Output profiles (PRD §17.5) are stored as assets but are not pictures: they never appear in the library or its pickers
  let rows = d.prepare('SELECT id, filename, original_name, mime_type, width_px, height_px, file_size_bytes, tags, notes, created_at FROM assets').all().filter(r => r.mime_type !== 'application/vnd.iccprofile')

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(r =>
      r.original_name.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q) ||
      JSON.parse(r.tags).some(t => t.toLowerCase().includes(q))
    )
  }

  if (tags?.length) {
    rows = rows.filter(r => {
      const t = JSON.parse(r.tags)
      return tags.every(tag => t.includes(tag))
    })
  }

  if (unusedOnly) {
    const usedIds = new Set()
    // a fixed image placed in a template counts as used (PRD §7.1)
    for (const { svg_source: svg } of d.prepare('SELECT svg_source FROM templates').all())
      for (const m of svg.matchAll(/\{\{\s*@asset\.([^}\s]+)\s*\}\}/g)) usedIds.add(m[1])
    for (const card of d.prepare('SELECT fields_json FROM cards WHERE deleted = 0').all()) {
      const fields = JSON.parse(card.fields_json)
      for (const v of Object.values(fields)) {
        if (typeof v === 'string' && v.startsWith('asset:')) usedIds.add(v.slice(6))
      }
    }
    rows = rows.filter(r => !usedIds.has(r.id))
  }

  return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }))
}

export function getThumbnail(ctx, id) {
  const row = dbOf(ctx).prepare('SELECT thumbnail_jpeg FROM assets WHERE id = ?').get(id)
  return row?.thumbnail_jpeg ?? null
}

export async function getPreview(ctx, id) {
  const row = dbOf(ctx).prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(id)
  if (!row) return null
  const file = join(assetsDir(ctx), row.filename)
  if (!existsSync(file)) return null
  if (row.mime_type === 'image/svg+xml') return { mime: row.mime_type, bytes: readFileSync(file) }
  const bytes = await sharp(file).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  return { mime: 'image/webp', bytes }
}

export async function importFiles(ctx, filePaths) {
  let paths = filePaths
  if (!paths) {
    const result = await ctx.ui.showOpenDialog({
      title: tr('dialogs.importAssets'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: tr('dialogs.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
    })
    if (result.canceled) return []
    paths = result.filePaths
  }

  const d = dbOf(ctx)
  const dir = assetsDir(ctx)
  const imported = []

  for (const src of paths) {
    const row = await importAssetFile(d, dir, src)
    if (row) imported.push(row)
  }

  return imported
}

export function update(ctx, { id, tags, notes }) {
  const d = dbOf(ctx)
  if (tags !== undefined) d.prepare('UPDATE assets SET tags = ? WHERE id = ?').run(JSON.stringify(tags), id)
  if (notes !== undefined) d.prepare('UPDATE assets SET notes = ? WHERE id = ?').run(notes, id)
  return d.prepare('SELECT id, filename, original_name, mime_type, width_px, height_px, file_size_bytes, tags, notes, created_at FROM assets WHERE id = ?').get(id)
}

export async function replace(ctx, { id, newFilePath }) {
  const d = dbOf(ctx)
  if (!newFilePath) {
    const result = await ctx.ui.showOpenDialog({
      title: tr('dialogs.replaceAsset'),
      properties: ['openFile'],
      filters: [{ name: tr('dialogs.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    newFilePath = result.filePaths[0]
  }
  const existing = d.prepare('SELECT * FROM assets WHERE id = ?').get(id)
  if (!existing) throw new Error(tr('errors.assetNotFound'))

  const dir = assetsDir(ctx)
  const dest = join(dir, existing.filename)
  copyFileSync(newFilePath, dest)

  let width = null, height = null, thumbnail = null
  if (existing.mime_type !== 'image/svg+xml') {
    const meta = await sharp(dest).metadata()
    width = meta.width
    height = meta.height
    thumbnail = await sharp(dest)
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
  }

  const stat = statSync(dest)
  d.prepare(
    'UPDATE assets SET width_px = ?, height_px = ?, file_size_bytes = ?, thumbnail_jpeg = ? WHERE id = ?'
  ).run(width, height, stat.size, thumbnail, id)

  return d.prepare('SELECT id, filename, original_name, mime_type, width_px, height_px, file_size_bytes, tags, notes, created_at FROM assets WHERE id = ?').get(id)
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'assets', id)
  if (!before) return
  // The file moves to the undo cache so the deletion can be reversed (PRD §11.2)
  stashAssetFile(d, before.filename)
  d.prepare('DELETE FROM assets WHERE id = ?').run(id)
  recordChange(d, 'DELETE_ASSET', [{ table: 'assets', before, after: null }], [{ name: before.filename, presentAfter: false }])
}

export function allTags(ctx) {
  const tags = new Set()
  for (const r of dbOf(ctx).prepare('SELECT tags FROM assets').all()) for (const t of JSON.parse(r.tags)) tags.add(t)
  return [...tags].sort((a, b) => a.localeCompare(b))
}

export async function exportAsset(ctx, id) {
  const row = dbOf(ctx).prepare('SELECT filename, original_name FROM assets WHERE id = ?').get(id)
  if (!row) throw new Error(tr('errors.assetNotFound'))
  const result = await ctx.ui.showOpenDialog({ title: tr('dialogs.exportAssetTo'), properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || !result.filePaths.length) return null
  const ext = extname(row.original_name)
  const stem = basename(row.original_name, ext)
  let dest = join(result.filePaths[0], row.original_name)
  for (let n = 2; existsSync(dest); n++) dest = join(result.filePaths[0], `${stem} (${n})${ext}`) // never overwrite
  copyFileSync(join(assetsDir(ctx), row.filename), dest)
  return { path: dest }
}

export function getTemplateUsage(ctx, id) {
  return dbOf(ctx).prepare('SELECT id, name, svg_source FROM templates').all()
    .filter(t => new RegExp(`\\{\\{\\s*@asset\\.${id.replace(/[^\w-]/g, '')}\\s*\\}\\}`).test(t.svg_source))
    .map(t => ({ templateId: t.id, name: t.name }))
}

export function getUsage(ctx, id) {
  const d = dbOf(ctx)
  const cards = d.prepare('SELECT id, display_name, set_id, fields_json FROM cards WHERE deleted = 0').all()
  return cards
    .filter(c => Object.values(JSON.parse(c.fields_json)).some(v => v === `asset:${id}`))
    .map(c => ({ cardId: c.id, displayName: c.display_name, setId: c.set_id }))
}

