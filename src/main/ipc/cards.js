import { ipcMain } from 'electron'
import * as svc from '../core/cards.js'

export function registerCardsHandlers(session) {
  ipcMain.handle('cards:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('cards:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('cards:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('cards:batch-update', (_e, ...a) => svc.batchUpdate(session, ...a))
  ipcMain.handle('cards:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('cards:reorder', (_e, ...a) => svc.reorder(session, ...a))
  ipcMain.handle('cards:duplicate', (_e, ...a) => svc.duplicate(session, ...a))
  ipcMain.handle('cards:propagate-preview', (_e, ...a) => svc.propagatePreview(session, ...a))
  ipcMain.handle('cards:matching', (_e, ...a) => svc.matching(session, ...a))
  ipcMain.handle('cards:find-replace', (_e, ...a) => svc.findReplace(session, ...a))
}
