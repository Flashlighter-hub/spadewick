import { ipcMain } from 'electron'
import * as svc from '../core/keywordRules.js'

export function registerKeywordRulesHandlers(session) {
  ipcMain.handle('keywords:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('keywords:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('keywords:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('keywords:remove', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('keywords:reorder', (_e, ...a) => svc.reorder(session, ...a))
}
