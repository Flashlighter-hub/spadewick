import { ipcMain } from 'electron'
import * as svc from '../core/templates.js'

export function registerTemplatesHandlers(session) {
  ipcMain.handle('templates:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('templates:get', (_e, ...a) => svc.get(session, ...a))
  ipcMain.handle('templates:add-bleed', (_e, ...a) => svc.addBleedToCanvas(session, ...a))
  ipcMain.handle('templates:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('templates:create-back', (_e, ...a) => svc.createBack(session, ...a))
  ipcMain.handle('templates:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('templates:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('templates:text-report', (_e, ...a) => svc.textReport(session, ...a))
  ipcMain.handle('templates:render', (_e, ...a) => svc.render(session, ...a))
}
