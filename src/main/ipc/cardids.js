import { ipcMain } from 'electron'
import * as svc from '../core/cardids.js'

export function registerCardidsHandlers(session) {
  ipcMain.handle('cardids:get', (_e, ...a) => svc.get(session, ...a))
  ipcMain.handle('cardids:save', (_e, ...a) => svc.save(session, ...a))
}
