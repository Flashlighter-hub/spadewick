import { randomUUID } from 'crypto'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'fs'
import { recordChange, rowOf, changesFor } from './history.js'
import { dbOf, dirOf } from './context.js'
import { listZip, extractZip, writeZip } from '../zip.js'
import { newSetCode } from '../cardIds.js'
import * as lib from '../templateLibrary.js'
import { starterTemplates } from '../templateStarters.js'
import { sizeColumns } from '../cardSize.js'
import { tr } from '../../shared/i18n.js'

const EXTENSION = 'spadewick-template'

function project(ctx) {
  return { dir: dirOf(ctx), db: dbOf(ctx) }
}

const parseOrigin = text => { try { return text ? JSON.parse(text) : null } catch { return null } }
const b64 = buf => (buf ? Buffer.from(buf).toString('base64') : null)

/** Summary of an opened item for the lists (never the files themselves). */
function describeItem(kind, id, dir, manifest, thumbnail) {
  return {
    kind, id, name: manifest.name, description: manifest.description ?? '', author: manifest.author ?? '', license: manifest.license ?? '',
    purpose: manifest.purpose === 'back' ? 'back' : 'card', version: manifest.version, cardSize: manifest.cardSize ?? null, hasParent: manifest.templates.length > 1,
    fieldCount: manifest.fields.length, fontCount: manifest.fonts.length, assetCount: manifest.assets.length,
    mockupCount: manifest.mockup.cards ? (lib.readMockupCards(dir, manifest).length) : 0,
    thumbnail: b64(thumbnail)
  }
}

const thumbCache = new Map()   // starter id -> base64 PNG (starters never change while the app runs)

const libraryRoot = ctx => {
  const root = ctx.settings.get('library_dir')
  if (!root) throw new Error(tr('library.noLibraryFolder'))
  mkdirSync(root, { recursive: true })
  return root
}

const withItem = async (ctx, ref, fn) => {
  const item = lib.openItem(libraryRoot(ctx), ref)
  try { return await fn(item) } finally { item.cleanup() }
}

export function list(ctx) {
  const starters = starterTemplates().map(s => {
    const { dir, manifest, cleanup } = lib.openItem(libraryRoot(ctx), { kind: 'starter', id: s.manifest.id })
    try {
      if (!thumbCache.has(s.manifest.id)) thumbCache.set(s.manifest.id, lib.itemThumbnail(dir, manifest))
      const meta = describeItem('starter', s.manifest.id, dir, manifest, thumbCache.get(s.manifest.id))
      return meta
    } finally { cleanup() }
  })
  const mine = lib.listMine(libraryRoot(ctx)).map(m => describeItem('mine', m.id, m.dir, m.manifest, lib.itemThumbnail(m.dir, m.manifest)))
  return { starters, mine }
}

export function renameItem(ctx, { id, name }) {
  const item = lib.openItem(libraryRoot(ctx), { kind: 'mine', id })
  const clean = String(name ?? '').trim().slice(0, lib.LIMITS.maxNameLength)
  if (!clean) throw new Error(tr('library.reasonName'))
  const manifest = { ...item.manifest, name: clean }
  writeFileSync(join(item.dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

export function deleteItem(ctx, id) { lib.removeMine(libraryRoot(ctx), id) }

export function plan(ctx, { kind, id, setId, newSet }) {
  const { dir: projectDir, db } = project(ctx)
  return withItem(ctx, { kind, id }, ({ dir, manifest }) => ({
    ...lib.planClone(db, projectDir, dir, manifest, setId ?? null, { newSet: !!newSet }),
    name: manifest.name, license: manifest.license ?? '', fieldCount: manifest.fields.length, mockupCount: lib.readMockupCards(dir, manifest).length
  }))
}

export async function useItem(ctx, { kind, id, setId, newSetName, resolutions, includeSampleCards, makeDefault, asBack }) {
  const { dir: projectDir, db } = project(ctx)
  return withItem(ctx, { kind, id }, async ({ dir, manifest }) => {
    let target = setId ?? null, isNewSet = false
    if (newSetName?.trim()) {
      target = randomUUID(); isNewSet = true
      const now = Date.now()
      const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sets').get().m + 1
      db.prepare('INSERT INTO sets (id, name, description, sort_order, created_at, updated_at, code, card_size, card_mm_w, card_mm_h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(target, newSetName.trim(), '', order, now, now, newSetCode(db, newSetName.trim()), ...sizeColumns(lib.sizeOfManifest(manifest)))
    }
    try {
      const out = await lib.applyClone(db, projectDir, dir, manifest, {
        setId: target, resolutions, source: 'library', item: { kind, id }, includeSampleCards: !!includeSampleCards, makeDefault: !asBack && (isNewSet || !!makeDefault), asBack: !!asBack && !isNewSet
      })
      return { ...out, setId: target, newSet: isNewSet ? db.prepare('SELECT * FROM sets WHERE id = ?').get(target) : null }
    } catch (err) {
      if (isNewSet) db.prepare('DELETE FROM sets WHERE id = ?').run(target)   // nothing half-made is left behind
      throw err
    }
  })
}

export function projectTemplates(ctx) {
  const { db } = project(ctx)
  return db.prepare('SELECT id, name, parent_id, origin, svg_source, updated_at FROM templates ORDER BY name').all().map(t => {
    const origin = parseOrigin(t.origin)
    const cards = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted = 0 AND template_id = ?').get(t.id).n
    const defaultOf = db.prepare('SELECT COUNT(*) AS n FROM sets WHERE default_template_id = ?').get(t.id).n
    let modified = false
    if (origin?.svgHash) modified = origin.svgHash !== lib.svgHashOf(t.svg_source)
    return { id: t.id, name: t.name, parentId: t.parent_id, origin, modified, usedByCards: cards, defaultOfSets: defaultOf, updatedAt: t.updated_at }
  })
}

export async function projectThumbnail(ctx, templateId) {
  const { dir, db } = project(ctx)
  return b64(await lib.projectTemplateThumbnail(db, dir, templateId))
}

export function originStatus(ctx, templateId) {
  const { db } = project(ctx)
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  if (!row) throw new Error(tr('errors.templateNotFound'))
  const origin = parseOrigin(row.origin)
  if (!origin || origin.source !== 'library' || !origin.kind) return { hasOrigin: !!origin, origin, itemAvailable: false, updateAvailable: false }
  try {
    return withItemSync(ctx, { kind: origin.kind, id: origin.itemId }, ({ dir, manifest }) => {
      const [main] = lib.readTemplates(dir, manifest)
      return {
        hasOrigin: true, origin, itemAvailable: true, itemName: manifest.name, itemVersion: manifest.version,
        updateAvailable: manifest.version > (origin.version ?? 0),
        changes: lib.diffSummary(row.svg_source, main.svg)
      }
    })
  } catch { return { hasOrigin: true, origin, itemAvailable: false, updateAvailable: false } }
}

function withItemSync(ctx, ref, fn) {
  const item = lib.openItem(libraryRoot(ctx), ref)
  try { return fn(item) } finally { item.cleanup() }
}

async function refreshFromLibrary(ctx, templateId, mode, setId) {
  const { dir: projectDir, db } = project(ctx)
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  if (!row) throw new Error(tr('errors.templateNotFound'))
  const origin = parseOrigin(row.origin)
  if (!origin || origin.source !== 'library' || !origin.kind) throw new Error(tr('library.noOrigin'))
  if (origin.role === 'parent') throw new Error(tr('library.isParent'))   // a shared frame follows the template that uses it
  return withItem(ctx, { kind: origin.kind, id: origin.itemId }, ({ dir, manifest }) =>
    lib.applyClone(db, projectDir, dir, manifest, {
      setId: setId ?? null, resolutions: 'keep-mine', source: 'library', item: { kind: origin.kind, id: origin.itemId },
      replaceMainId: mode === 'keep-both' ? null : templateId
    }))
}

export function update(ctx, { templateId, mode, setId }) {
  return refreshFromLibrary(ctx, templateId, mode === 'keep-both' ? 'keep-both' : 'replace', setId)
}

export function reset(ctx, { templateId, setId }) {
  return refreshFromLibrary(ctx, templateId, 'replace', setId)
}

export function duplicateTemplate(ctx, id) {
  const { db } = project(ctx)
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
  if (!row) throw new Error(tr('errors.templateNotFound'))
  const newId = randomUUID(), now = Date.now()
  let name = `${row.name} copy`, n = 2
  while (db.prepare('SELECT 1 FROM templates WHERE name = ?').get(name)) name = `${row.name} copy ${n++}`
  db.prepare('INSERT INTO templates (id, name, parent_id, svg_source, origin, card_size, card_mm_w, card_mm_h, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(newId, name, row.parent_id, row.svg_source, row.origin, row.card_size, row.card_mm_w, row.card_mm_h, now, now)
  recordChange(db, 'CREATE_TEMPLATE', [{ table: 'templates', before: null, after: rowOf(db, 'templates', newId) }])
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(newId)
}

export function inspectPackage(ctx, { templateId, setId }) {
  const { dir, db } = project(ctx)
  const b = lib.describeBundle(db, dir, templateId, setId ?? null)
  return {
    name: b.main.name, hasParent: !!b.parent,
    fonts: b.fonts, assets: b.assets.map(a => ({ id: a.id, name: a.original_name })),
    fields: b.fields.map(f => f.slug)
  }
}

async function bundleTo(ctx, outDir, { templateId, setId, meta, fontIds, mockupCardIds }) {
  const { dir, db } = project(ctx)
  return lib.buildItemFolder(db, dir, outDir, { templateId, setId: setId ?? null, meta, fontIds, mockupCardIds })
}

export async function save(ctx, { templateId, setId, name, description, author, license, itemId, fontIds, mockupCardIds }) {
  const root = libraryRoot(ctx)
  const tmp = mkdtempSync(join(tmpdir(), 'spadewick-save-'))
  try {
    let id = itemId ?? randomUUID(), version = 1
    if (itemId) { try { version = lib.openItem(root, { kind: 'mine', id: itemId }).manifest.version + 1 } catch { id = randomUUID() } }
    const { manifest, skippedFonts } = await bundleTo(ctx, join(tmp, 'item'), { templateId, setId, meta: { id, version, name: String(name ?? '').trim() || undefined, description, author, license }, fontIds, mockupCardIds })
    const stored = lib.storeMine(root, id, join(tmp, 'item'))
    return { id, name: stored.name, version: stored.version, skippedFonts: skippedFonts.map(f => `${f.family} ${f.style}`), manifest }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

export async function exportPackage(ctx, { templateId, kind, id, setId, name, description, author, license, fontIds, mockupCardIds, confirmRights, path }) {
  const tmp = mkdtempSync(join(tmpdir(), 'spadewick-export-'))
  try {
    let folder, label
    if (templateId) {
      const { manifest, includedFonts } = await bundleTo(ctx, join(tmp, 'item'), { templateId, setId, meta: { name: String(name ?? '').trim() || undefined, description, author, license }, fontIds, mockupCardIds })
      folder = join(tmp, 'item'); label = manifest.name
      if ((includedFonts.length || manifest.assets.length) && !confirmRights) throw new Error(tr('library.confirmRights'))
    } else {
      const item = lib.openItem(libraryRoot(ctx), { kind, id })
      if ((item.manifest.fonts.length || item.manifest.assets.length) && !confirmRights) { item.cleanup(); throw new Error(tr('library.confirmRights')) }
      folder = item.dir; label = item.manifest.name
      try { return await writePackage(ctx, folder, label, path) } finally { item.cleanup() }
    }
    return await writePackage(ctx, folder, label, path)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function writePackage(ctx, folder, label, presetPath) {
  let target = presetPath
  if (!target) {
    const result = await ctx.ui.showSaveDialog({
      title: tr('dialogs.exportTemplatePackage'),
      defaultPath: `${label.replace(/[^A-Za-z0-9._ -]+/g, '_')}.${EXTENSION}`,
      filters: [{ name: tr('dialogs.templatePackage'), extensions: [EXTENSION] }]
    })
    if (result.canceled) return null
    target = result.filePath
  }
  writeZip(target, lib.folderEntries(folder))
  return { path: target, name: label, bytes: statSync(target).size }
}

// Packages that were opened and not yet applied or closed, by token: they belong to the context that opened them
const stagedOf = ctx => (ctx.stagedPackages ??= new Map())

export async function openPackage(ctx, { path } = {}) {
  let file = path
  if (!file) {
    const result = await ctx.ui.showOpenDialog({
      title: tr('dialogs.importTemplatePackage'), properties: ['openFile'],
      filters: [{ name: tr('dialogs.templatePackage'), extensions: [EXTENSION] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    file = result.filePaths[0]
  }
  if (statSync(file).size > lib.LIMITS.maxBytes) throw new Error(tr('library.packageTooBig'))
  const entries = listZip(file).filter(e => !e.name.endsWith('/'))
  if (entries.length > lib.LIMITS.maxEntries) throw new Error(tr('errors.zipTooManyFiles', { max: lib.LIMITS.maxEntries }))
  for (const e of entries) if (!lib.ENTRY_PATTERN.test(e.name)) throw new Error(tr('library.invalidPackage', { reason: tr('library.reasonPath', { file: e.name.slice(0, 80) }) }))
  const folder = mkdtempSync(join(tmpdir(), 'spadewick-pkg-'))
  try {
    extractZip(file, folder, { maxEntries: lib.LIMITS.maxEntries, maxTotalBytes: lib.LIMITS.maxBytes })
    const manifest = lib.readManifest(folder)
    lib.sanitizeFolder(folder, manifest)
    const token = randomUUID()
    stagedOf(ctx).set(token, folder)
    return { token, fileName: basename(file), ...describeItem('package', manifest.id ?? token, folder, manifest, lib.itemThumbnail(folder, manifest)) }
  } catch (err) {
    rmSync(folder, { recursive: true, force: true })
    throw err
  }
}

const stagedFolder = (ctx, token) => {
  const folder = stagedOf(ctx).get(token)
  if (!folder || !existsSync(folder)) throw new Error(tr('library.packageClosed'))
  return folder
}

export function planPackage(ctx, { token, setId }) {
  const { dir: projectDir, db } = project(ctx)
  const folder = stagedFolder(ctx, token)
  const manifest = lib.readManifest(folder)
  return { ...lib.planClone(db, projectDir, folder, manifest, setId ?? null), name: manifest.name, license: manifest.license ?? '', mockupCount: lib.readMockupCards(folder, manifest).length }
}

export async function applyPackage(ctx, { token, target, setId, resolutions, includeSampleCards, makeDefault, asBack }) {
  const { dir: projectDir, db } = project(ctx)
  const folder = stagedFolder(ctx, token)
  const manifest = lib.readManifest(folder)
  const out = { library: null, project: null }
  let item = { id: manifest.id }
  if (target === 'library' || target === 'both') {
    const root = libraryRoot(ctx)
    let id = /^[A-Za-z0-9-]{1,64}$/.test(String(manifest.id)) ? manifest.id : randomUUID()
    const existing = lib.listMine(root).find(m => m.id === id)
    let stored = { ...manifest }
    if (existing && existing.manifest.version >= manifest.version) id = randomUUID()
    const copy = mkdtempSync(join(tmpdir(), 'spadewick-lib-'))
    try {
      for (const e of lib.folderEntries(folder)) { mkdirSync(join(copy, e.name, '..'), { recursive: true }); writeFileSync(join(copy, e.name), readFileSync(e.file)) }
      stored = lib.storeMine(root, id, copy)
    } finally { rmSync(copy, { recursive: true, force: true }) }
    out.library = { id, name: stored.name, version: stored.version }
    item = { kind: 'mine', id }
  }
  if (target === 'project' || target === 'both') {
    out.project = await lib.applyClone(db, projectDir, folder, manifest, {
      setId: setId ?? null, resolutions, source: item.kind ? 'library' : 'package', item,
      includeSampleCards: !!includeSampleCards, makeDefault: !asBack && !!makeDefault, asBack: !!asBack
    })
  }
  rmSync(folder, { recursive: true, force: true }); stagedOf(ctx).delete(token)
  return out
}

export function closePackage(ctx, token) {
  const folder = stagedOf(ctx).get(token)
  if (folder) rmSync(folder, { recursive: true, force: true })
  stagedOf(ctx).delete(token)
}

