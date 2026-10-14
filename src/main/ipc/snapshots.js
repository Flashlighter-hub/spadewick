import { ipcMain } from 'electron'
import * as svc from '../core/snapshots.js'
import * as cmp from '../core/snapshotCompare.js'

export function registerSnapshotsHandlers(session) {
  ipcMain.handle('snapshots:list', (_e, ...a) => svc.list(session, ...a))
  ipcMain.handle('snapshots:create', (_e, ...a) => svc.create(session, ...a))
  ipcMain.handle('snapshots:restore', (_e, ...a) => svc.restore(session, ...a))
  ipcMain.handle('snapshots:delete', (_e, ...a) => svc.remove(session, ...a))
  ipcMain.handle('snapshots:export', (_e, ...a) => svc.exportSnapshot(session, ...a))
  ipcMain.handle('snapshots:compare-open', (_e, ...a) => cmp.open(session, ...a))
  ipcMain.handle('snapshots:compare-close', (_e, ...a) => cmp.close(session, ...a))
  ipcMain.handle('snapshots:compare-refresh', (_e, ...a) => cmp.refresh(session, ...a))
  ipcMain.handle('snapshots:compare-render', (_e, ...a) => cmp.renderSide(session, ...a))
  ipcMain.handle('snapshots:compare-restore', (_e, ...a) => cmp.restore(session, ...a))
  ipcMain.handle('snapshots:compare-render-template', (_e, ...a) => cmp.renderTemplate(session, ...a))
  ipcMain.handle('snapshots:compare-template-source', (_e, ...a) => cmp.templateSource(session, ...a))
  ipcMain.handle('snapshots:compare-export', (_e, ...a) => cmp.exportChanges(session, ...a))
}
