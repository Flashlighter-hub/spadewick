import { ipcMain } from 'electron'
import * as svc from '../core/fields.js'

export function registerFieldsHandlers(session) {
  ipcMain.handle('fields:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('fields:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('fields:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('fields:set-width', (_e, ...a) => svc.setWidth(session, ...a))
  ipcMain.handle('fields:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('fields:reorder', (_e, ...a) => svc.reorder(session, ...a))
  ipcMain.handle('fields:convert-impact', (_e, ...a) => svc.convertImpact(session, ...a))
  ipcMain.handle('fields:distinct-values', (_e, ...a) => svc.distinctValues(session, ...a))
  ipcMain.handle('fields:evaluate-formula', (_e, ...a) => svc.runFormula(session, ...a))
  ipcMain.handle('fields:check-circular', (_e, ...a) => svc.checkCircular(session, ...a))
}
