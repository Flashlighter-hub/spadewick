import { ipcMain } from 'electron'
import * as svc from '../core/history.js'

export function registerHistoryHandlers(session) {
  ipcMain.handle('history:get-stack', (_e, ...a) => svc.getStack(session, ...a))
  ipcMain.handle('history:undo', (_e, ...a) => svc.undo(session, ...a))
  ipcMain.handle('history:redo', (_e, ...a) => svc.redo(session, ...a))
}
