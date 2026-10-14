import { ipcMain } from 'electron'
import * as svc from '../core/templatelib.js'

export function registerTemplatelibHandlers(session) {
  ipcMain.handle('templatelib:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('templatelib:rename-item', (_e, ...a) => svc.renameItem(session, ...a))
  ipcMain.handle('templatelib:delete-item', (_e, ...a) => svc.deleteItem(session, ...a))
  ipcMain.handle('templatelib:plan', (_e, ...a) => svc.plan(session, ...a))
  ipcMain.handle('templatelib:use', (_e, ...a) => svc.useItem(session, ...a))
  ipcMain.handle('templatelib:project-templates', (_e, ...a) => svc.projectTemplates(session, ...a))
  ipcMain.handle('templatelib:project-thumbnail', (_e, ...a) => svc.projectThumbnail(session, ...a))
  ipcMain.handle('templatelib:origin-status', (_e, ...a) => svc.originStatus(session, ...a))
  ipcMain.handle('templatelib:update', (_e, ...a) => svc.update(session, ...a))
  ipcMain.handle('templatelib:reset', (_e, ...a) => svc.reset(session, ...a))
  ipcMain.handle('templates:duplicate', (_e, ...a) => svc.duplicateTemplate(session, ...a))
  ipcMain.handle('templatepkg:inspect', (_e, ...a) => svc.inspectPackage(session, ...a))
  ipcMain.handle('templatelib:save', (_e, ...a) => svc.save(session, ...a))
  ipcMain.handle('templatepkg:export', (_e, ...a) => svc.exportPackage(session, ...a))
  ipcMain.handle('templatepkg:open', (_e, ...a) => svc.openPackage(session, ...a))
  ipcMain.handle('templatepkg:plan', (_e, ...a) => svc.planPackage(session, ...a))
  ipcMain.handle('templatepkg:apply', (_e, ...a) => svc.applyPackage(session, ...a))
  ipcMain.handle('templatepkg:close', (_e, ...a) => svc.closePackage(session, ...a))
}
