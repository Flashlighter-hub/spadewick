/**
 * Making a context (see context.js) for an application, a command line run or a test.
 */
import { setAuthorStore } from '../cardIds.js'
import { setUndoLimit } from './history.js'

/** Dialogs for a run with nobody to ask: every dialog counts as cancelled, so callers must pass explicit paths. */
export const headlessUi = {
  async showOpenDialog() { return { canceled: true, filePaths: [] } },
  async showSaveDialog() { return { canceled: true } },
  openPath() {}
}

/** Settings kept in memory, with electron-store's shape (`get`, `set`, `store`). */
export function createMemorySettings(initial = {}) {
  const data = { ...initial }
  return {
    get: (key, fallback) => (key in data ? data[key] : fallback),
    set: (key, value) => { data[key] = value },
    get store() { return data },
    onDidChange() {}
  }
}

/**
 * A context with no project open. Opening or creating a project (core/projects.js) sets `ctx.project`.
 * The installation-wide settings the services need (the card ID author code, the undo limit) are taken from
 * `settings` here, once.
 */
export function createContext({ settings = createMemorySettings(), ui = headlessUi } = {}) {
  setAuthorStore(settings)
  setUndoLimit(settings.get('undo_limit'))
  return { project: null, settings, ui }
}
