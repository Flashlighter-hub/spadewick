import { ipcMain } from 'electron'
import * as svc from '../core/stats.js'

export function registerStatsHandlers(session) {
  ipcMain.handle('stats:balance', (_e, ...a) => svc.balance(session, ...a))
}
