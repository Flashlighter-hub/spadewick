import { ipcMain } from 'electron'
import * as svc from '../core/fonts.js'

export function registerFontsHandlers(session) {
  ipcMain.handle('fonts:bundled', (_e, ...a) => svc.bundled(session, ...a))
  ipcMain.handle('fonts:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('fonts:import', (_e, ...a) => svc.importFiles(session, ...a))
  ipcMain.handle('fonts:delete', (_e, ...a) => svc.remove(session, ...a))
}
