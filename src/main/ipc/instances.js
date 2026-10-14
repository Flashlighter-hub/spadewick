import { ipcMain } from 'electron'
import * as svc from '../core/instances.js'

export function registerInstancesHandlers(session) {
  ipcMain.handle('instances:get', (_e, ...a) => svc.get(session, ...a))
  ipcMain.handle('instances:save', (_e, ...a) => svc.save(session, ...a))
  ipcMain.handle('instances:reset', (_e, ...a) => svc.reset(session, ...a))
  ipcMain.handle('instances:list', (_e, ...a) => svc.list(session, ...a))
}
