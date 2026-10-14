import { join, relative, sep } from 'path'
import { existsSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { writeZip } from './zip.js'

// PRD §11.1: a snapshot is a zip of project.db plus the project's file folders.
export const SNAPSHOT_FOLDERS = ['assets', 'templates', 'fonts']
export const DB_FILES = ['project.db', 'project.db-wal', 'project.db-shm']

export function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push({ name: relative(base, full).split(sep).join('/'), file: full })
  }
  return out
}

/**
 * Write a snapshot zip + metadata file for a project and return the metadata. Takes the open
 * database explicitly so it can run while the database is still being opened (before an upgrade).
 */
export function writeSnapshot(projectDir, db, { id, name, description }) {
  const dir = join(projectDir, 'snapshots')
  mkdirSync(dir, { recursive: true })

  // Fold the write-ahead log into project.db so the copy contains every committed change
  db.pragma('wal_checkpoint(TRUNCATE)')

  const entries = [{ name: 'project.db', file: join(projectDir, 'project.db') }]
  for (const folder of SNAPSHOT_FOLDERS) {
    for (const e of walk(join(projectDir, folder))) entries.push({ name: `${folder}/${e.name}`, file: e.file })
  }

  const zipPath = join(dir, `${id}.zip`)
  try {
    writeZip(zipPath, entries)
  } catch (err) {
    rmSync(zipPath, { force: true })
    throw err
  }
  const meta = { id, name, description: description ?? '', created_at: Date.now(), size_bytes: statSync(zipPath).size }
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta, null, 2))
  return meta
}
