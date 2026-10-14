import { ipcMain } from 'electron'
import * as svc from '../core/projects.js'

export function registerProjectsHandlers(session) {
  ipcMain.handle('projects:list-recent', (_e, ...a) => svc.listRecent(session, ...a))
  ipcMain.handle('projects:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('projects:open', (_e, ...a) => svc.open(session, ...a))
  ipcMain.handle('projects:open-file', (_e, ...a) => svc.openFile(session, ...a))
  ipcMain.handle('projects:close', (_e, ...a) => svc.close(session, ...a))
  ipcMain.handle('projects:get-meta', (_e, ...a) => svc.getMeta(session, ...a))
  ipcMain.handle('projects:duplicate', (_e, ...a) => svc.duplicate(session, ...a))
  ipcMain.handle('projects:reveal', (_e, ...a) => svc.reveal(session, ...a))
  ipcMain.handle('projects:autosave', (_e, ...a) => svc.autosave(session, ...a))
  ipcMain.handle('projects:set-text-engine', (_e, ...a) => svc.setTextEngine(session, ...a))
  ipcMain.handle('projects:check-integrity', (_e, ...a) => svc.checkProjectIntegrity(session, ...a))
  ipcMain.handle('settings:get', (_e, ...a) => svc.settingsGet(session, ...a))
  ipcMain.handle('settings:set', (_e, ...a) => svc.settingsSet(session, ...a))
  ipcMain.handle('settings:get-all', (_e, ...a) => svc.settingsGetAll(session, ...a))
}
