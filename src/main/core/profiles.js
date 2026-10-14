/**
 * Output (CMYK) profiles for production PDFs (PRD §17.5, §17.8). One profile ships with the application; the others are imported
 * by the person from the file a manufacturer provides (some cannot be bundled for licence reasons). An imported profile is an asset
 * (tagged `icc-profile`) with a row that names it; importing and removing are one undo step.
 */
import { randomUUID } from 'crypto'
import { join, basename, extname } from 'path'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { dbOf, dirOf } from './context.js'
import { importAssetFile } from './assets.js'
import { recordChange, rowOf, changesFor, stashAssetFile } from './history.js'
import { bundledProfilesDir } from '../fontFiles.js'
import { profileHeader, createConverter } from '../colour/lcms.js'
import { tr } from '../../shared/i18n.js'

// the name is the profile's own; its description and licence note are shown to the person, so they are in the strings file
export const BUNDLED = [
  { id: 'bundled:crpc1', name: 'CGATS21_CRPC1 (US sheet-fed)', file: 'CGATS21_CRPC1.icc', get description() { return tr('profiles.crpc1Description') }, get licenceNote() { return tr('profiles.crpc1Licence') } }
]
export const DEFAULT_PROFILE = 'bundled:crpc1'

const present = (row, bundled = false) => ({ id: row.id, name: row.name, bundled, description: row.description ?? '', licenceNote: row.licenceNote ?? row.licence_note ?? '', colourSpace: 'CMYK' })

export function list(ctx) {
  const d = dbOf(ctx)
  const imported = d.prepare('SELECT * FROM icc_profiles ORDER BY name').all().map(r => present(r))
  return { bundled: BUNDLED.map(b => present(b, true)), imported, defaultId: DEFAULT_PROFILE }
}

/** The bytes of a profile by id (bundled or imported), or an error when it is gone. */
export function profileBytes(ctx, id) {
  const bundled = BUNDLED.find(b => b.id === id)
  if (bundled) {
    const path = join(bundledProfilesDir(), bundled.file)
    if (!existsSync(path)) throw new Error(tr('errors.profileMissing', { name: bundled.name }))
    return { bytes: readFileSync(path), name: bundled.name }
  }
  const d = dbOf(ctx)
  const row = d.prepare('SELECT * FROM icc_profiles WHERE id = ?').get(id)
  const asset = row && d.prepare('SELECT filename FROM assets WHERE id = ?').get(row.asset_id)
  const path = asset && join(dirOf(ctx), 'assets', asset.filename)
  if (!path || !existsSync(path)) throw new Error(tr('errors.profileMissing', { name: row?.name ?? id }))
  return { bytes: readFileSync(path), name: row.name }
}

/** Name from the profile's own description, or the file name. */
async function describe(bytes, fallback) {
  const c = await createConverter(bytes)
  try { return (c.description || fallback).trim().slice(0, 80) || fallback } finally { c.close() }
}

/**
 * Import profiles from files (asks the person unless `opts.paths` is given). Each must be a CMYK output profile.
 * @returns {{ imported: object[], skipped: { file: string, reason: string }[] }}
 */
export async function importFiles(ctx, opts) {
  opts ??= {}
  const d = dbOf(ctx), dir = join(dirOf(ctx), 'assets')
  let paths = opts.paths
  if (!paths) {
    const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.importProfile'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('dialogs.profileFiles'), extensions: ['icc', 'icm'] }] })
    if (r.canceled || !r.filePaths.length) return { imported: [], skipped: [] }
    paths = r.filePaths
  }
  mkdirSync(dir, { recursive: true })
  const result = { imported: [], skipped: [] }
  for (const file of paths) {
    const label = basename(file)
    let bytes
    try { bytes = readFileSync(file) } catch { result.skipped.push({ file: label, reason: 'unreadable' }); continue }
    if (bytes.length > 12 * 1024 * 1024) { result.skipped.push({ file: label, reason: 'tooLarge' }); continue }
    const header = profileHeader(bytes)
    if (!header) { result.skipped.push({ file: label, reason: 'notProfile' }); continue }
    if (header.space !== 'CMYK' || header.deviceClass !== 'prtr') { result.skipped.push({ file: label, reason: 'notCmykOutput' }); continue }
    let name
    try { name = await describe(bytes, basename(file, extname(file))) } catch { result.skipped.push({ file: label, reason: 'notProfile' }); continue }
    if (d.prepare('SELECT 1 FROM icc_profiles WHERE name = ?').get(name) || BUNDLED.some(b => b.name === name)) {
      let n = 2
      while (d.prepare('SELECT 1 FROM icc_profiles WHERE name = ?').get(`${name} (${n})`)) n++
      name = `${name} (${n})`
    }
    const asset = await importAssetFile(d, dir, file, { record: false, originalName: label })
    if (!asset) { result.skipped.push({ file: label, reason: 'notProfile' }); continue }
    d.prepare('UPDATE assets SET tags = ? WHERE id = ?').run('["icc-profile"]', asset.id)
    const id = randomUUID()
    d.prepare('INSERT INTO icc_profiles (id, name, asset_id, colour_space, description, licence_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, asset.id, 'CMYK', '', String(opts.licenceNote ?? ''), Date.now())
    recordChange(d, 'IMPORT_PROFILE', [{ table: 'assets', before: null, after: rowOf(d, 'assets', asset.id) }, { table: 'icc_profiles', before: null, after: rowOf(d, 'icc_profiles', id) }], [{ name: asset.filename, presentAfter: true }])
    result.imported.push(present(rowOf(d, 'icc_profiles', id)))
  }
  return result
}

export function update(ctx, { id, name, licenceNote }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'icc_profiles', id)
  if (!before) throw new Error(tr('errors.profileNotFound'))
  if (name !== undefined) {
    const clean = String(name).trim()
    if (!clean || clean.length > 80) throw new Error(tr('errors.profileName'))
    if (d.prepare('SELECT 1 FROM icc_profiles WHERE name = ? AND id != ?').get(clean, id) || BUNDLED.some(b => b.name === clean)) throw new Error(tr('errors.profileNameTaken', { name: clean }))
    d.prepare('UPDATE icc_profiles SET name = ? WHERE id = ?').run(clean, id)
  }
  if (licenceNote !== undefined) d.prepare('UPDATE icc_profiles SET licence_note = ? WHERE id = ?').run(String(licenceNote).slice(0, 500), id)
  recordChange(d, 'UPDATE_PROFILE', changesFor(d, 'icc_profiles', [before]))
  return present(rowOf(d, 'icc_profiles', id))
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'icc_profiles', id)
  if (!before) return
  const asset = rowOf(d, 'assets', before.asset_id)
  d.transaction(() => {
    d.prepare('DELETE FROM icc_profiles WHERE id = ?').run(id)
    const files = []
    if (asset) { d.prepare('DELETE FROM assets WHERE id = ?').run(asset.id); if (stashAssetFile(d, asset.filename)) files.push({ name: asset.filename, presentAfter: false }) }
    recordChange(d, 'DELETE_PROFILE', [{ table: 'icc_profiles', before, after: null }, ...(asset ? [{ table: 'assets', before: asset, after: null }] : [])], files)
  })()
}
