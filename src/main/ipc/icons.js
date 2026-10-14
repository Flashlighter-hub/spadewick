import { ipcMain } from 'electron'
import * as svc from '../core/icons.js'

export function registerIconsHandlers(session) {
  ipcMain.handle('icons:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('icons:usage', (_e, ...a) => svc.usage(session, ...a))
  ipcMain.handle('icons:import-files', (_e, ...a) => svc.importFiles(session, ...a))
  ipcMain.handle('icons:import-folder', (_e, ...a) => svc.importFolder(session, ...a))
  ipcMain.handle('icons:replace-picture', (_e, ...a) => svc.replacePicture(session, ...a))
  ipcMain.handle('icons:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('icons:rename', (_e, ...a) => svc.rename(session, ...a))
  ipcMain.handle('icons:remove', (_e, ...a) => svc.remove(session, ...a))
}
