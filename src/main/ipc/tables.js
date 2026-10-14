import { ipcMain } from 'electron'
import * as svc from '../core/tables.js'

export function registerTablesHandlers(session) {
  ipcMain.handle('table:cards', (_e, ...a) => svc.cards(session, ...a))
  ipcMain.handle('table:card-info', (_e, ...a) => svc.cardInfo(session, ...a))
  ipcMain.handle('table:asset-picture', (_e, ...a) => svc.assetPicture(session, ...a))
  ipcMain.handle('table:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('table:save', (_e, ...a) => svc.save(session, ...a))
  ipcMain.handle('table:load', (_e, ...a) => svc.load(session, ...a))
  ipcMain.handle('table:delete', (_e, ...a) => svc.remove(session, ...a))
}
