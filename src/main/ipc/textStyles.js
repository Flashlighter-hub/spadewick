import { ipcMain } from 'electron'
import * as svc from '../core/textStyles.js'

export function registerTextStylesHandlers(session) {
  ipcMain.handle('textstyles:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('textstyles:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('textstyles:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('textstyles:rename', (_e, ...a) => svc.rename(session, ...a))
  ipcMain.handle('textstyles:remove', (_e, ...a) => svc.remove(session, ...a))
}
