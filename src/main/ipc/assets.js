import { ipcMain } from 'electron'
import * as svc from '../core/assets.js'

export function registerAssetsHandlers(session) {
  ipcMain.handle('assets:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('assets:get-thumbnail', (_e, ...a) => svc.getThumbnail(session, ...a))
  ipcMain.handle('assets:get-preview', (_e, ...a) => svc.getPreview(session, ...a))
  ipcMain.handle('assets:import', (_e, ...a) => svc.importFiles(session, ...a))
  ipcMain.handle('assets:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('assets:replace', (_e, ...a) => svc.replace(session, ...a))
  ipcMain.handle('assets:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('assets:all-tags', (_e, ...a) => svc.allTags(session, ...a))
  ipcMain.handle('assets:export', (_e, ...a) => svc.exportAsset(session, ...a))
  ipcMain.handle('assets:get-template-usage', (_e, ...a) => svc.getTemplateUsage(session, ...a))
  ipcMain.handle('assets:get-usage', (_e, ...a) => svc.getUsage(session, ...a))
}
