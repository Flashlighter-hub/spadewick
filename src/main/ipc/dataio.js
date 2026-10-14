import { ipcMain } from 'electron'
import * as svc from '../core/dataio.js'

export function registerDataioHandlers(session) {
  ipcMain.handle('dataio:read-file', (_e, ...a) => svc.readFile(session, ...a))
  ipcMain.handle('dataio:import', (_e, ...a) => svc.importRows(session, ...a))
  ipcMain.handle('dataio:export', (_e, ...a) => svc.exportData(session, ...a))
}
