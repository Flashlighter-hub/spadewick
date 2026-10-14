import { ipcMain } from 'electron'
import * as svc from '../core/svgImport.js'

export function registerSvgImportHandlers(session) {
  ipcMain.handle('svgimport:pick', (_e, ...a) => svc.pick(session, ...a))
  ipcMain.handle('svgimport:pick-image', (_e, ...a) => svc.pickImage(session, ...a))
  ipcMain.handle('svgimport:analyze', (_e, ...a) => svc.analyze(session, ...a))
  ipcMain.handle('svgimport:apply', (_e, ...a) => svc.apply(session, ...a))
}
