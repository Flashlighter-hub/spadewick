import { ipcMain } from 'electron'
import * as svc from '../core/views.js'

export function registerViewsHandlers(session) {
  ipcMain.handle('views:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('views:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('views:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('views:delete', (_e, ...a) => svc.remove(session, ...a))
}
