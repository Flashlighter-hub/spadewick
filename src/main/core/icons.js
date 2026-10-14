/**
 * The project's icon library (PRD §16.4): pictures that are dropped into rich text by name. The picture is an asset, so it
 * travels in snapshots and cloud folders like any other; an icon adds the name, aliases and what text needs to know
 * (size, vertical position, spacing, colour mode).
 *
 * Everything here is covered by undo and redo; renaming an icon together with the references it updates is one step.
 */
import { randomUUID } from 'crypto'
import { join, basename, extname } from 'path'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { dbOf, dirOf } from './context.js'
import { importAssetFile } from './assets.js'
import { recordChange, rowOf, changesFor, stashAssetFile } from './history.js'
import { extractZip } from '../zip.js'
import { normalizeIconSvg } from '../../shared/iconSvg.js'
import { iconKey, parseMarkup, renameIconInMarkup } from '../../shared/richText.js'
import { starterIconNames } from '../../shared/starterIcons.js'
import { tr } from '../../shared/i18n.js'

const RESERVED = new Set(['icon', 'color', 'size', 'font', 'style', 'nbsp', 'shy'])
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/
const ALLOWED = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const ZIP_LIMITS = { maxEntries: 500, maxTotalBytes: 100 * 1024 * 1024 }
const MAX_RASTER_BYTES = 8 * 1024 * 1024
const MAX_RASTER_PX = 512

const json = (text, fallback) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : fallback } catch { return fallback } }
const assetsDir = ctx => join(dirOf(ctx), 'assets')

/** `Fire Ball.svg` -> `fire-ball`: lower case, spaces and anything odd turned into hyphens. */
export function nameFromFile(file) {
  const stem = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40)
  return stem || 'icon'
}

/** The name checked, or why it cannot be used. */
function checkName(d, name, exceptId) {
  const key = iconKey(name)
  if (!NAME.test(key)) throw new Error(tr('errors.iconNameInvalid'))
  if (RESERVED.has(key)) throw new Error(tr('errors.iconNameReserved', { name: key }))
  const other = d.prepare('SELECT id FROM icons WHERE name = ?').get(key)
  if (other && other.id !== exceptId) throw new Error(tr('errors.iconNameTaken', { name: key }))
  return key
}

const uniqueName = (d, base) => {
  let name = base, n = 2
  while (d.prepare('SELECT 1 FROM icons WHERE name = ?').get(name) || RESERVED.has(name)) name = `${base.slice(0, 36)}-${n++}`
  return name
}

function present(d, dir, row) {
  const asset = d.prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(row.asset_id)
  const out = {
    id: row.id, name: row.name, aliases: json(row.aliases, []), tags: json(row.tags, []), notes: row.notes,
    size: row.size, vOffset: row.v_offset, spacing: row.spacing, colorMode: row.color_mode, single: !!row.single_color, aspect: row.aspect,
    assetId: row.asset_id, mime: asset?.mime_type ?? null, createdAt: row.created_at
  }
  const file = asset && join(dir, 'assets', asset.filename)
  if (file && existsSync(file)) {
    if (asset.mime_type === 'image/svg+xml') out.svg = readFileSync(file, 'utf8')
    else out.uri = `data:${asset.mime_type};base64,${readFileSync(file).toString('base64')}`
  } else out.missing = true
  return out
}

// ---------------------------------------------------------------------------
// Where icons are used
// ---------------------------------------------------------------------------

/** The icon that each name or alias stands for, and the aliases that stand for more than one icon. */
export function iconLookup(rows) {
  const byKey = new Map(), ambiguous = new Map()
  for (const row of rows) for (const key of [row.name, ...json(row.aliases, []).map(iconKey)]) {
    if (byKey.has(key) && byKey.get(key) !== row.id) ambiguous.set(key, [...(ambiguous.get(key) ?? [byKey.get(key)]), row.id])
    else byKey.set(key, row.id)
  }
  return { byKey, ambiguous }
}

function scanUsage(d) {
  const rows = d.prepare('SELECT * FROM icons').all()
  const { byKey } = iconLookup(rows)
  const usage = new Map(rows.map(r => [r.id, { cards: [], templates: [], rules: [], styles: [] }]))
  const mark = (list, key, what) => { const id = byKey.get(iconKey(key)); if (id && !usage.get(id)[list].some(x => x.id === what.id)) usage.get(id)[list].push(what) }

  const richBySet = new Map()
  for (const f of d.prepare("SELECT set_id, slug FROM fields WHERE type = 'rich_text'").all()) richBySet.set(f.set_id, [...(richBySet.get(f.set_id) ?? []), f.slug])
  const setNames = new Map(d.prepare('SELECT id, name FROM sets').all().map(s => [s.id, s.name]))
  for (const card of d.prepare('SELECT id, set_id, display_name, fields_json FROM cards WHERE deleted = 0').all()) {
    const slugs = richBySet.get(card.set_id)
    if (!slugs) continue
    const values = JSON.parse(card.fields_json)
    for (const slug of slugs) for (const run of parseMarkup(values[slug] ?? '').runs) if (run.icon) mark('cards', run.icon, { id: card.id, name: card.display_name, set: setNames.get(card.set_id) })
  }
  for (const t of d.prepare('SELECT id, name, svg_source FROM templates').all()) {
    const text = [...t.svg_source.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]).join('\n')
    for (const run of parseMarkup(text).runs) if (run.icon) mark('templates', run.icon, { id: t.id, name: t.name })
  }
  for (const r of d.prepare('SELECT id, match, mode, action FROM keyword_rules').all()) {
    const action = JSON.parse(r.action || '{}')
    if ((r.mode === 'icon' || r.mode === 'icon_text') && action.icon) mark('rules', action.icon, { id: r.id, name: r.match })
  }
  return usage
}

/** The icons of the project with what each is used by. */
export function list(ctx) {
  const d = dbOf(ctx), dir = dirOf(ctx)
  const usage = scanUsage(d)
  const rows = d.prepare('SELECT * FROM icons ORDER BY name').all()
  const { ambiguous } = iconLookup(rows)
  return {
    icons: rows.map(r => ({ ...present(d, dir, r), usage: Object.fromEntries(Object.entries(usage.get(r.id)).map(([k, v]) => [k, v.length])) })),
    builtIn: starterIconNames(),
    ambiguous: [...ambiguous].map(([alias, ids]) => ({ alias, icons: ids.map(id => rows.find(r => r.id === id)?.name) }))
  }
}

/** Where one icon is used, by name (for the warning before it is deleted, and the usage view). */
export function usage(ctx, id) {
  const d = dbOf(ctx)
  const u = scanUsage(d).get(id)
  if (!u) throw new Error(tr('errors.iconNotFound'))
  return u
}

// ---------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------

/** Make the file ready to store: a normalised SVG, or a raster picture no larger than MAX_RASTER_PX as PNG. */
async function prepare(file, tmp) {
  const ext = extname(file).toLowerCase()
  if (!ALLOWED.has(ext)) return { error: tr('library.reasonIconType') }
  const size = statSync(file).size
  if (ext === '.svg') {
    const r = normalizeIconSvg(readFileSync(file, 'utf8'))
    if (r.error) return { error: r.error === 'tooBig' ? tr('library.reasonIconTooBig') : r.error === 'noSize' ? tr('library.reasonIconNoSize') : tr('library.reasonIconNotSvg') }
    const out = join(tmp, `${randomUUID()}.svg`)
    writeFileSync(out, r.svg)
    return { file: out, aspect: r.aspect, single: r.single }
  }
  if (size > MAX_RASTER_BYTES) return { error: tr('library.reasonIconTooBig') }
  try {
    const out = join(tmp, `${randomUUID()}.png`)
    const info = await sharp(file).resize(MAX_RASTER_PX, MAX_RASTER_PX, { fit: 'inside', withoutEnlargement: true }).png().toFile(out)
    return { file: out, aspect: info.width / info.height, single: false }
  } catch { return { error: tr('library.reasonIconUnreadable') } }
}

/** Files to import from a list of paths: a ZIP is opened (under the safety limits of §14.7), a folder is not entered. */
function expand(paths, tmp, skipped) {
  const files = []
  for (const p of paths) {
    if (extname(p).toLowerCase() === '.zip') {
      const folder = mkdtempSync(join(tmp, 'zip-'))
      try { extractZip(p, folder, ZIP_LIMITS) } catch (err) { skipped.push({ file: basename(p), reason: err.message }); continue }
      const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) walk(f); else files.push(f) } }
      walk(folder)
    } else files.push(p)
  }
  return files
}

/**
 * Import pictures as icons.
 * @param {{ paths?: string[], conflict?: 'number'|'replace', only?: string[] }} [opts] `only` limits the import to files whose icon name is in the list (to import just the ones that clashed). Without paths, a file chooser asks. When a name is taken, `conflict` says
 *   what to do: 'number' adds -2, 'replace' puts the new picture into the existing icon (references stay valid); without it the file is
 *   reported as skipped with reason 'exists' so the caller can ask.
 * @returns {{ imported: object[], replaced: object[], skipped: { file: string, reason: string, exists?: string }[], paths: string[] }} `paths`: what was imported from
 */
export async function importFiles(ctx, opts) {
  opts ??= {}
  const d = dbOf(ctx), dir = assetsDir(ctx)
  let paths = opts.paths
  if (!paths) {
    const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.importIcons'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('dialogs.iconFiles'), extensions: ['svg', 'png', 'jpg', 'jpeg', 'webp', 'zip'] }] })
    if (r.canceled || !r.filePaths.length) return { imported: [], replaced: [], skipped: [], paths: [] }
    paths = r.filePaths
  }
  mkdirSync(dir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'spadewick-icons-'))
  const result = { imported: [], replaced: [], skipped: [], paths }
  const only = opts.only ? new Set(opts.only.map(iconKey)) : null
  try {
    for (const file of expand(paths, tmp, result.skipped)) {
      const label = basename(file)
      const base = nameFromFile(file)
      if (only && !only.has(base)) continue
      const existing = d.prepare('SELECT * FROM icons WHERE name = ?').get(base)
      if (existing && !opts.conflict) { result.skipped.push({ file: label, reason: 'exists', exists: base }); continue }
      const ready = await prepare(file, tmp)
      if (ready.error) { result.skipped.push({ file: label, reason: ready.error }); continue }
      if (existing && opts.conflict === 'replace') {
        result.replaced.push(await swapPicture(ctx, existing, ready, label))
        continue
      }
      const asset = await importAssetFile(d, dir, ready.file, { record: false, originalName: label })
      d.prepare('UPDATE assets SET tags = ? WHERE id = ?').run('["icon"]', asset.id)
      const now = Date.now()
      const name = existing ? uniqueName(d, base) : (RESERVED.has(base) ? uniqueName(d, base) : base)
      const id = randomUUID()
      d.prepare('INSERT INTO icons (id, name, asset_id, single_color, aspect, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, asset.id, ready.single ? 1 : 0, ready.aspect, now)
      recordChange(d, 'IMPORT_ICON', [
        { table: 'assets', before: null, after: rowOf(d, 'assets', asset.id) },
        { table: 'icons', before: null, after: rowOf(d, 'icons', id) }
      ], [{ name: asset.filename, presentAfter: true }])
      result.imported.push(present(d, dirOf(ctx), d.prepare('SELECT * FROM icons WHERE id = ?').get(id)))
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  return result
}

/** Put a new picture into an existing icon: its id, name, settings and every use of it stay. One undo step. */
async function swapPicture(ctx, existing, ready, label) {
  const d = dbOf(ctx), dir = assetsDir(ctx)
  const asset = await importAssetFile(d, dir, ready.file, { record: false, originalName: label })
  d.prepare('UPDATE assets SET tags = ? WHERE id = ?').run('["icon"]', asset.id)
  const oldAsset = rowOf(d, 'assets', existing.asset_id)
  const before = rowOf(d, 'icons', existing.id)
  d.prepare('UPDATE icons SET asset_id = ?, aspect = ?, single_color = ? WHERE id = ?').run(asset.id, ready.aspect, ready.single ? 1 : 0, existing.id)
  const files = [{ name: asset.filename, presentAfter: true }]
  if (oldAsset) { d.prepare('DELETE FROM assets WHERE id = ?').run(oldAsset.id); if (stashAssetFile(d, oldAsset.filename)) files.push({ name: oldAsset.filename, presentAfter: false }) }
  recordChange(d, 'REPLACE_ICON', [
    { table: 'assets', before: null, after: rowOf(d, 'assets', asset.id) },
    ...(oldAsset ? [{ table: 'assets', before: oldAsset, after: null }] : []),
    ...changesFor(d, 'icons', [before])
  ], files)
  return present(d, dirOf(ctx), d.prepare('SELECT * FROM icons WHERE id = ?').get(existing.id))
}

/**
 * Replace the picture of one icon (the "Replace picture" button): without `path`, a file chooser asks.
 * @returns {Promise<object | null>} the icon, or null when cancelled
 */
export async function replacePicture(ctx, { id, path }) {
  const d = dbOf(ctx)
  const existing = d.prepare('SELECT * FROM icons WHERE id = ?').get(id)
  if (!existing) throw new Error(tr('errors.iconNotFound'))
  let file = path
  if (!file) {
    const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.replaceIconPicture'), properties: ['openFile'], filters: [{ name: tr('dialogs.iconFiles'), extensions: ['svg', 'png', 'jpg', 'jpeg', 'webp'] }] })
    if (r.canceled || !r.filePaths.length) return null
    file = r.filePaths[0]
  }
  const tmp = mkdtempSync(join(tmpdir(), 'spadewick-icons-'))
  try {
    const ready = await prepare(file, tmp)
    if (ready.error) throw new Error(tr('errors.iconFileInvalid', { file: basename(file), reason: ready.error }))
    return await swapPicture(ctx, existing, ready, basename(file))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

/** Import every picture in a folder (and the ZIP files in it). */
export async function importFolder(ctx, opts) {
  opts ??= {}
  let folder = opts.path
  if (!folder) {
    const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.importIconFolder'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths.length) return { imported: [], replaced: [], skipped: [], paths: [] }
    folder = r.filePaths[0]
  }
  const paths = []
  const walk = (dir, depth) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name)
      if (e.isDirectory()) { if (depth < 3) walk(f, depth + 1) } else if ([...ALLOWED, '.zip'].includes(extname(e.name).toLowerCase())) paths.push(f)
      if (paths.length >= ZIP_LIMITS.maxEntries) return
    }
  }
  walk(folder, 0)
  return importFiles(ctx, { paths, conflict: opts.conflict, only: opts.only })
}

// ---------------------------------------------------------------------------
// Changing and removing
// ---------------------------------------------------------------------------

const clamp = (v, min, max, label) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error(tr('errors.iconSetting', { setting: label })); return n }

/** Name and aliases, tags and notes, size, vertical position, spacing and colour mode of an icon. */
export function update(ctx, { id, aliases, tags, notes, size, vOffset, spacing, colorMode }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'icons', id)
  if (!before) throw new Error(tr('errors.iconNotFound'))
  const sets = [], params = []
  const put = (col, value) => { sets.push(`${col} = ?`); params.push(value) }
  if (aliases !== undefined) {
    const keys = [...new Set((aliases ?? []).map(iconKey).filter(Boolean))].filter(k => k !== before.name)
    if (keys.length > 10) throw new Error(tr('errors.iconSetting', { setting: 'aliases' }))
    for (const k of keys) if (!NAME.test(k) || RESERVED.has(k)) throw new Error(tr('errors.iconNameInvalid'))
    put('aliases', JSON.stringify(keys))
  }
  if (tags !== undefined) put('tags', JSON.stringify([...new Set((tags ?? []).map(t => String(t).trim()).filter(Boolean))].slice(0, 20)))
  if (notes !== undefined) put('notes', String(notes ?? '').slice(0, 500))
  if (size !== undefined) put('size', clamp(size, 0.2, 5, 'size'))
  if (vOffset !== undefined) put('v_offset', clamp(vOffset, -1, 1, 'vOffset'))
  if (spacing !== undefined) put('spacing', clamp(spacing, 0, 2, 'spacing'))
  if (colorMode !== undefined) { if (!['follow', 'keep'].includes(colorMode)) throw new Error(tr('errors.iconSetting', { setting: 'colorMode' })); put('color_mode', colorMode) }
  if (!sets.length) return present(d, dirOf(ctx), d.prepare('SELECT * FROM icons WHERE id = ?').get(id))
  d.prepare(`UPDATE icons SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  recordChange(d, 'UPDATE_ICON', changesFor(d, 'icons', [before]))
  return present(d, dirOf(ctx), d.prepare('SELECT * FROM icons WHERE id = ?').get(id))
}

/**
 * Rename an icon. Every use of the old name follows (cards, keyword rules and the text of templates), in one undo step.
 * @returns {{ icon: object, updated: { cards: number, rules: number, templates: number } }}
 */
export function rename(ctx, { id, name }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'icons', id)
  if (!before) throw new Error(tr('errors.iconNotFound'))
  const key = checkName(d, name, id)
  if (key === before.name) return { icon: present(d, dirOf(ctx), d.prepare('SELECT * FROM icons WHERE id = ?').get(id)), updated: { cards: 0, rules: 0, templates: 0 } }
  const names = [before.name, ...json(before.aliases, []).map(iconKey)]
  const rewrite = text => names.reduce((t, n) => renameIconInMarkup(t, n, key), text)
  const changes = []
  const updated = { cards: 0, rules: 0, templates: 0 }
  d.transaction(() => {
    d.prepare('UPDATE icons SET name = ? WHERE id = ?').run(key, id)
    const richBySet = new Map()
    for (const f of d.prepare("SELECT set_id, slug FROM fields WHERE type = 'rich_text'").all()) richBySet.set(f.set_id, [...(richBySet.get(f.set_id) ?? []), f.slug])
    for (const card of d.prepare('SELECT id, set_id, fields_json FROM cards').all()) {
      const slugs = richBySet.get(card.set_id)
      if (!slugs) continue
      const values = JSON.parse(card.fields_json)
      let changed = false
      for (const slug of slugs) if (typeof values[slug] === 'string') { const next = rewrite(values[slug]); if (next !== values[slug]) { values[slug] = next; changed = true } }
      if (!changed) continue
      const old = rowOf(d, 'cards', card.id)
      d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(values), Date.now(), card.id)
      changes.push({ table: 'cards', before: old, after: rowOf(d, 'cards', card.id) }); updated.cards++
    }
    for (const r of d.prepare("SELECT * FROM keyword_rules WHERE mode IN ('icon','icon_text')").all()) {
      const action = JSON.parse(r.action || '{}')
      if (!action.icon || !names.includes(iconKey(action.icon))) continue
      const old = rowOf(d, 'keyword_rules', r.id)
      d.prepare('UPDATE keyword_rules SET action = ? WHERE id = ?').run(JSON.stringify({ ...action, icon: key }), r.id)
      changes.push({ table: 'keyword_rules', before: old, after: rowOf(d, 'keyword_rules', r.id) }); updated.rules++
    }
    for (const t of d.prepare('SELECT id, svg_source FROM templates').all()) {
      const next = t.svg_source.replace(/(<text\b[^>]*>)([\s\S]*?)(<\/text>)/g, (_, open, inner, close) => open + rewrite(inner) + close)
      if (next === t.svg_source) continue
      const old = rowOf(d, 'templates', t.id)
      d.prepare('UPDATE templates SET svg_source = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), t.id)
      changes.push({ table: 'templates', before: old, after: rowOf(d, 'templates', t.id) }); updated.templates++
    }
    recordChange(d, 'RENAME_ICON', [...changesFor(d, 'icons', [before]), ...changes])
  })()
  return { icon: present(d, dirOf(ctx), d.prepare('SELECT * FROM icons WHERE id = ?').get(id)), updated }
}

/** Delete an icon and its picture. Text that uses it then shows a placeholder box (§16.9), so callers warn with `usage` first. */
export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'icons', id)
  if (!before) return
  const asset = rowOf(d, 'assets', before.asset_id)
  d.transaction(() => {
    d.prepare('DELETE FROM icons WHERE id = ?').run(id)
    const files = []
    if (asset) { d.prepare('DELETE FROM assets WHERE id = ?').run(asset.id); if (stashAssetFile(d, asset.filename)) files.push({ name: asset.filename, presentAfter: false }) }
    recordChange(d, 'DELETE_ICON', [{ table: 'icons', before, after: null }, ...(asset ? [{ table: 'assets', before: asset, after: null }] : [])], files)
  })()
}
