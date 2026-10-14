import { ipcMain } from 'electron'
import * as svc from '../core/textCheck.js'

export function registerTextCheckHandlers(session) {
  ipcMain.handle('textcheck:run', (_e, ...a) => svc.run(session, ...a))
}
