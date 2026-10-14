import { ipcMain } from 'electron'
import * as svc from '../core/components.js'

export function registerComponentsHandlers(session) {
  ipcMain.handle('components:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('components:get', (_e, ...a) => svc.get(session, ...a))
  ipcMain.handle('components:save', (_e, ...a) => svc.save(session, ...a))
  ipcMain.handle('components:rename', (_e, ...a) => svc.rename(session, ...a))
  ipcMain.handle('components:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('components:export', (_e, ...a) => svc.exportItem(session, ...a))
  ipcMain.handle('components:import', (_e, ...a) => svc.importItem(session, ...a))
}
