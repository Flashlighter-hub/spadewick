/**
 * The context every service function receives (PRD §24.2, phase 0.3: headless core).
 *
 *   ctx = {
 *     project,   // handle of the open project: { dir }, or null when none is open
 *     settings,  // { get(key, fallback), set(key, value), store }: electron-store's shape; see createMemorySettings
 *     ui         // { showOpenDialog(opts), showSaveDialog(opts), openPath(path) }: what the services may ask of a person
 *   }
 *
 * Services never reach for the window system, a global "active project" or a settings file: everything comes in
 * through ctx. The application's IPC layer supplies Electron-backed settings and dialogs; the command line, a
 * test or a server supplies its own. A `ctx` is a plain object, so one call can also be made with a hand-built one.
 */
import { dirname } from 'path'
import { openProjectDb } from '../db.js'
import { tr } from '../../shared/i18n.js'

/** A handle to a project folder. */
export const projectHandle = dir => Object.freeze({ dir })

/** The open project's folder, or an error when no project is open. */
export function dirOf(ctx) {
  if (!ctx?.project) throw new Error(tr('errors.noProjectOpen'))
  return ctx.project.dir
}

/** The open project's database, or an error when no project is open. */
export function dbOf(ctx) {
  return openProjectDb(dirOf(ctx))
}

/** The folder of the project a database belongs to (the database file, `project.db`, sits directly in it). */
export const projectDirOfDb = d => dirname(d.name)
