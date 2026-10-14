import { ipcMain } from 'electron'
import * as svc from '../core/rules.js'

export function registerRulesHandlers(session) {
  ipcMain.handle('rules:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('rules:get', (_e, ...a) => svc.get(session, ...a))
  ipcMain.handle('rules:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('rules:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('rules:move', (_e, ...a) => svc.move(session, ...a))
  ipcMain.handle('rules:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('rules:cards', (_e, ...a) => svc.cards(session, ...a))
  ipcMain.handle('rules:open-link', (_e, ...a) => svc.openLink(session, ...a))
  ipcMain.handle('rules:export-page', (_e, ...a) => svc.exportPage(session, ...a))
  ipcMain.handle('rules:export-all', (_e, ...a) => svc.exportAll(session, ...a))
  ipcMain.handle('rules:export-html', (_e, ...a) => svc.exportHtml(session, ...a))
  ipcMain.handle('rules:import-files', (_e, ...a) => svc.importFiles(session, ...a))
  ipcMain.handle('rules:import-folder', (_e, ...a) => svc.importFolder(session, ...a))
}
