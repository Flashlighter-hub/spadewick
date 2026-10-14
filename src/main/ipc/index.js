import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { onProjectChange } from '../core/changes.js'
import { logError } from '../log.js'
import { createContext } from '../core/session.js'
import { registerProjectsHandlers } from './projects.js'
import { registerSetsHandlers } from './sets.js'
import { registerCardsHandlers } from './cards.js'
import { registerFieldsHandlers } from './fields.js'
import { registerTemplatesHandlers } from './templates.js'
import { registerAssetsHandlers } from './assets.js'
import { registerExportHandlers } from './export.js'
import { registerSnapshotsHandlers } from './snapshots.js'
import { registerHistoryHandlers } from './history.js'
import { registerFontsHandlers } from './fonts.js'
import { registerDataioHandlers } from './dataio.js'
import { registerCardidsHandlers } from './cardids.js'
import { registerTemplatelibHandlers } from './templatelib.js'
import { registerIconsHandlers } from './icons.js'
import { registerTextStylesHandlers } from './textStyles.js'
import { registerKeywordRulesHandlers } from './keywordRules.js'
import { registerTextCheckHandlers } from './textCheck.js'
import { registerSvgImportHandlers } from './svgImport.js'
import { registerProductionHandlers } from './production.js'
import { registerTablesHandlers } from './tables.js'
import { registerComponentsHandlers } from './components.js'
import { registerRulesHandlers } from './rules.js'
import { registerViewsHandlers } from './views.js'
import { registerStatsHandlers } from './stats.js'
import { registerInstancesHandlers } from './instances.js'

/** Every handler's failures are written to the log file before they reach the UI. */
function withErrorLogging() {
  if (ipcMain.__logged) return
  const original = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, fn) => original(channel, async (event, ...args) => {
    try { return await fn(event, ...args) } catch (err) { logError(channel, err); throw err }
  })
  ipcMain.__logged = true
}

/**
 * The window side of the application: Electron's dialogs and shell are handed to the core as its `ui`, the
 * electron-store as its `settings`, and each IPC channel is a one-line call into a service (src/main/core/).
 * Nothing in the core knows about Electron, so the same services run without a window.
 */
export function registerIpcHandlers(store) {
  withErrorLogging()
  const session = createContext({
    settings: store,
    ui: {
      showOpenDialog: opts => dialog.showOpenDialog(opts),
      showSaveDialog: opts => dialog.showSaveDialog(opts),
      openPath: path => shell.openPath(path),
      openExternal: url => shell.openExternal(url)
    }
  })
  // what changed in the project is told to every window, which looks again at exactly that (UPDATES U6)
  onProjectChange(change => { for (const w of BrowserWindow.getAllWindows?.() ?? []) { if (!w.isDestroyed()) w.webContents.send('project:changed', change) } })
  registerProjectsHandlers(session)
  registerSetsHandlers(session)
  registerCardsHandlers(session)
  registerFieldsHandlers(session)
  registerTemplatesHandlers(session)
  registerAssetsHandlers(session)
  registerExportHandlers(session)
  registerSnapshotsHandlers(session)
  registerHistoryHandlers(session)
  registerFontsHandlers(session)
  registerDataioHandlers(session)
  registerCardidsHandlers(session)
  registerTemplatelibHandlers(session)
  registerIconsHandlers(session)
  registerTextStylesHandlers(session)
  registerKeywordRulesHandlers(session)
  registerTextCheckHandlers(session)
  registerSvgImportHandlers(session)
  registerProductionHandlers(session)
  registerTablesHandlers(session)
  registerComponentsHandlers(session)
  registerRulesHandlers(session)
  registerViewsHandlers(session)
  registerStatsHandlers(session)
  registerInstancesHandlers(session)
}
