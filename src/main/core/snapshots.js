import { join } from 'path'
import { existsSync, readdirSync, copyFileSync, rmSync, readFileSync, renameSync } from 'fs'
import { openProjectDb, closeProjectDb, ensureProjectDirs } from '../db.js'
import { SNAPSHOT_FOLDERS, DB_FILES, walk, writeSnapshot as writeSnapshotFile } from '../snapshotCore.js'
import { writeZip, listZip, extractZip } from '../zip.js'
import { tr } from '../../shared/i18n.js'
import { dirOf } from './context.js'
import { announce } from './changes.js'

function snapshotsDir(ctx) {
  return join(dirOf(ctx), 'snapshots')
}

/** Snapshot of the open project (the database is already open, so it is looked up here). */
function writeSnapshot(projectDir, meta) {
  return writeSnapshotFile(projectDir, openProjectDb(projectDir), meta)
}

/** Replace the project's database and folders with the contents of a snapshot zip. */
function applySnapshot(projectDir, zipPath) {
  const staging = join(projectDir, '.restore_tmp')
  rmSync(staging, { recursive: true, force: true })
  try {
    extractZip(zipPath, staging)
    if (!existsSync(join(staging, 'project.db'))) throw new Error(tr('errors.snapshotNoDatabase'))

    closeProjectDb(projectDir)
    for (const f of DB_FILES) rmSync(join(projectDir, f), { force: true }) // stale WAL files would corrupt the restored db
    for (const folder of SNAPSHOT_FOLDERS) rmSync(join(projectDir, folder), { recursive: true, force: true })
    for (const entry of readdirSync(staging)) renameSync(join(staging, entry), join(projectDir, entry))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  ensureProjectDirs(projectDir)
  openProjectDb(projectDir)
}

/**
 * Snapshots made before the zip format were folders (<id>/project.db + assets). Convert any that are
 * found into zips the first time the list is read, so they keep working and remain restorable.
 */
function migrateLegacySnapshots(dir) {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const id = file.slice(0, -5)
    const folder = join(dir, id)
    if (existsSync(join(dir, `${id}.zip`)) || !existsSync(join(folder, 'project.db'))) continue
    try {
      const entries = [{ name: 'project.db', file: join(folder, 'project.db') }]
      for (const e of walk(join(folder, 'assets'))) entries.push({ name: `assets/${e.name}`, file: e.file })
      writeZip(join(dir, `${id}.zip`), entries)
      rmSync(folder, { recursive: true, force: true })
    } catch {
      rmSync(join(dir, `${id}.zip`), { force: true }) // leave the folder untouched if conversion fails
    }
  }
}

export function list(ctx) {
  const dir = snapshotsDir(ctx)
  if (!existsSync(dir)) return []
  migrateLegacySnapshots(dir)

  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const meta = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        return existsSync(join(dir, `${meta.id}.zip`)) ? meta : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.created_at - a.created_at)
}

export function create(ctx, { name, description }) {
  const projectDir = dirOf(ctx)
  const id = `${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
  return writeSnapshot(projectDir, { id, name, description })
}

export function restore(ctx, snapshotId) {
  const projectDir = dirOf(ctx)
  const zipPath = join(snapshotsDir(ctx), `${snapshotId}.zip`)
  if (!existsSync(zipPath)) throw new Error(tr('errors.snapshotNotFound'))
  listZip(zipPath) // fail early on a damaged archive, before anything is changed

  // The current state is kept as an automatic snapshot so a restore can itself be reversed.
  // A database too damaged to open cannot be snapshotted; keep the damaged file aside instead.
  let autoMeta = null
  try {
    autoMeta = writeSnapshot(projectDir, {
      id: `auto_${Date.now()}`,
      name: tr('snapshots.autoName'),
      description: tr('snapshots.autoDescription', { id: snapshotId })
    })
  } catch {
    closeProjectDb(projectDir)
    if (existsSync(join(projectDir, 'project.db'))) copyFileSync(join(projectDir, 'project.db'), join(projectDir, `project.corrupt-${Date.now()}.db`))
  }

  try {
    applySnapshot(projectDir, zipPath)
  } catch (err) {
    // Roll back to the state we just saved so the project is never left half-restored
    if (autoMeta) { try { applySnapshot(projectDir, join(snapshotsDir(ctx), `${autoMeta.id}.zip`)) } catch { /* surfaced below */ } }
    throw new Error(tr('errors.restoreRolledBack', { reason: err.message }))
  }
  announce({ all: true })
  return { restored: snapshotId, autoSnapshot: autoMeta }
}

export function remove(ctx, snapshotId) {
  const dir = snapshotsDir(ctx)
  rmSync(join(dir, `${snapshotId}.zip`), { force: true })
  rmSync(join(dir, `${snapshotId}.json`), { force: true })
}

export async function exportSnapshot(ctx, snapshotId) {
  const zipPath = join(snapshotsDir(ctx), `${snapshotId}.zip`)
  if (!existsSync(zipPath)) throw new Error(tr('errors.snapshotNotFound'))
  const result = await ctx.ui.showSaveDialog({
    title: tr('dialogs.exportSnapshot'),
    defaultPath: `${snapshotId}.zip`,
    filters: [{ name: tr('dialogs.zipArchive'), extensions: ['zip'] }]
  })
  if (result.canceled) return null
  copyFileSync(zipPath, result.filePath)
  return { path: result.filePath }
}

