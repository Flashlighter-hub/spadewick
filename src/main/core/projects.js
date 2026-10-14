import { join, basename, dirname } from 'path'
import { existsSync, mkdirSync, cpSync, statSync } from 'fs'
import { openProjectDb, closeProjectDb, checkIntegrity, ensureProjectDirs, takeUpgradeInfo } from '../db.js'
import { projectHandle, dbOf, dirOf } from './context.js'
import { upgradeTextEngine, setTextEngine } from './textEngine.js'
import { tr } from '../../shared/i18n.js'
import { acquire, release, LOCK_FILE } from './lock.js'

// The open project is `ctx.project` (a handle, see context.js); opening, creating and closing are the only places that set it.

export function listRecent(ctx) {
  return ctx.settings.get('recent_projects', [])
}

export async function create(ctx, { name, parentDir }) {
  const dir = parentDir ?? ctx.settings.get('projects_root')
  const projectDir = join(dir, sanitizeName(name))

  if (existsSync(projectDir)) {
    throw new Error(tr('errors.projectExists', { name }))
  }

  mkdirSync(projectDir, { recursive: true })
  ensureProjectDirs(projectDir)

  const db = openProjectDb(projectDir)
  const now = Date.now()
  db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('name', name)
  db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('created_at', String(now))
  // Card size belongs to each set; a project only records the raster width cards are drawn at
  db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('card_width_px', '500')
  db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('export_dpi', String(ctx.settings.get('default_export_dpi')))
  // New projects draw text with the text engine (PRD §16.2); projects made before it keep the old estimate until they are opened (see upgradeTextEngine)
  db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('text_engine', 'outlines')

  ctx.project = projectHandle(projectDir)
  acquire(projectDir, 'app')
  addRecent(ctx.settings, projectDir)

  return { path: projectDir, name }
}

/** Open a project folder, or a path to its project.db file (PRD §12.2), and make it the context's project. */
export async function openProject(ctx, projectPath) {
  let projectDir = projectPath
  if (existsSync(projectDir) && statSync(projectDir).isFile()) {
    if (basename(projectDir).toLowerCase() !== 'project.db') {
      throw new Error(tr('errors.chooseProject'))
    }
    projectDir = dirname(projectDir)
  }

  if (!existsSync(join(projectDir, 'project.db'))) {
    throw new Error(tr('errors.notAProject'))
  }

  // The new project is opened before the current one is let go, so a project that cannot be opened
  // (for example one made by a newer version, PRD §24.2) leaves the current project as it was.
  const previous = ctx.project?.dir ?? null
  // PRD §14.2: verify the database on open so the user can be offered a snapshot restore
  let db = null, failure = null
  try {
    db = openProjectDb(projectDir)
    if (!checkIntegrity(db)) failure = 'The database failed its integrity check.'
  } catch (err) {
    closeProjectDb(projectDir)
    // A project from a newer version is not damaged: say so plainly and offer no recovery
    if (err.code === 'SCHEMA_TOO_NEW') {
      ctx.settings.set('recent_projects', ctx.settings.get('recent_projects', []).filter(p => p !== projectDir))
      throw err
    }
    failure = `The database could not be opened (${err.message}).`
  }
  if (previous && previous !== projectDir) { release(previous); closeProjectDb(previous) }
  ensureProjectDirs(projectDir)
  ctx.project = projectHandle(projectDir)
  acquire(projectDir, 'app')
  addRecent(ctx.settings, projectDir)

  if (failure) {
    return { path: projectDir, corrupt: true, error: failure, meta: { name: basename(projectDir) }, sets: db ? buildProjectState(db, projectDir).sets : [] }
  }
  const textEngine = await upgradeTextEngine(ctx) // a project made before the text engine moves to it (PRD §16.2)
  return { ...buildProjectState(db, projectDir), upgrade: takeUpgradeInfo(projectDir), ...(textEngine ? { textEngine } : {}) }
}

export async function open(ctx, projectDirArg) {
  let projectDir = projectDirArg
  if (!projectDir) {
    const result = await ctx.ui.showOpenDialog({ title: tr('dialogs.openProject'), properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    projectDir = result.filePaths[0]
  }
  return openProject(ctx, projectDir)
}

export async function openFile(ctx) {
  const result = await ctx.ui.showOpenDialog({
    title: tr('dialogs.openProjectFile'),
    properties: ['openFile'],
    filters: [{ name: tr('dialogs.spadewickProject'), extensions: ['db'] }]
  })
  if (result.canceled || !result.filePaths.length) return null
  return openProject(ctx, result.filePaths[0])
}

export function close(ctx) {
  if (ctx.project) {
    release(ctx.project.dir)
    closeProjectDb(ctx.project.dir)
    ctx.project = null
  }
}

export function getMeta(ctx) {
  if (!ctx.project) return null
  return buildProjectState(dbOf(ctx), ctx.project.dir)
}

export async function duplicate(ctx, { targetDir, newName }) {
  const sourceDir = dirOf(ctx)

  const destDir = join(targetDir, sanitizeName(newName))
  if (existsSync(destDir)) throw new Error(tr('errors.destinationExists', { path: destDir }))

  cpSync(sourceDir, destDir, { recursive: true, filter: src => basename(src) !== LOCK_FILE })

  // Update project name in the duplicated db
  const db = openProjectDb(destDir)
  db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('name', newName)

  return { path: destDir, name: newName }
}

export function reveal(ctx) {
  if (ctx.project) ctx.ui.openPath(ctx.project.dir)
}

// Secondary safety net (PRD §12.4): every edit is already committed, so this flushes the WAL
export function autosave(ctx) {
  if (!ctx.project) return null
  dbOf(ctx).pragma('wal_checkpoint(PASSIVE)')
  return Date.now()
}

export function checkProjectIntegrity(ctx) {
  if (!ctx.project) return null
  return checkIntegrity(dbOf(ctx))
}

export { setTextEngine }

export const settingsGet = (ctx, key) => ctx.settings.get(key)
export const settingsSet = (ctx, key, value) => ctx.settings.set(key, value)
export const settingsGetAll = ctx => ctx.settings.store

function buildProjectState(db, projectDir) {
  const meta = {}
  for (const row of db.prepare('SELECT key, value FROM project_meta').all()) {
    meta[row.key] = row.value
  }
  const sets = db.prepare('SELECT * FROM sets ORDER BY sort_order').all()
  return { path: projectDir, meta, sets }
}

function addRecent(settings, projectDir) {
  const recents = settings.get('recent_projects', []).filter(p => p !== projectDir)
  recents.unshift(projectDir)
  settings.set('recent_projects', recents.slice(0, 10))
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'project'
}
