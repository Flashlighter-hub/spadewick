import { ipcMain } from 'electron'
import * as svc from '../core/sets.js'

export function registerSetsHandlers(session) {
  ipcMain.handle('cardsize:get', (_e, ...a) => svc.cardsizeGet(session, ...a))
  ipcMain.handle('cardsize:resolve', (_e, ...a) => svc.cardsizeResolve(session, ...a))
  ipcMain.handle('sets:size-impact', (_e, ...a) => svc.sizeImpact(session, ...a))
  ipcMain.handle('sets:rule-preview', (_e, ...a) => svc.rulePreview(session, ...a))
  ipcMain.handle('sets:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('sets:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('sets:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('sets:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('sets:reorder', (_e, ...a) => svc.reorder(session, ...a))
}
