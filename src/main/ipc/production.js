import { ipcMain } from 'electron'
import * as production from '../core/production.js'
import * as profiles from '../core/profiles.js'
import * as printColors from '../core/printColors.js'
import * as exportProfiles from '../core/exportProfiles.js'
import * as preflight from '../core/preflight.js'
import * as presets from '../core/presets.js'

export function registerProductionHandlers(session) {
  ipcMain.handle('production:run', (_e, ...a) => production.run(session, ...a))
  ipcMain.handle('production:run-images', (_e, ...a) => production.runImagesService(session, ...a))
  ipcMain.handle('presets:list', (_e, ...a) => presets.list(session, ...a))
  ipcMain.handle('presets:get', (_e, ...a) => presets.get(session, ...a))
  ipcMain.handle('presets:apply', (_e, ...a) => presets.apply(session, ...a))
  ipcMain.handle('presets:duplicate', (_e, ...a) => presets.duplicate(session, ...a))
  ipcMain.handle('presets:save', (_e, ...a) => presets.save(session, ...a))
  ipcMain.handle('presets:remove', (_e, ...a) => presets.remove(session, ...a))
  ipcMain.handle('presets:import', (_e, ...a) => presets.importFile(session, ...a))
  ipcMain.handle('presets:export', (_e, ...a) => presets.exportFile(session, ...a))
  ipcMain.handle('production:proof', (_e, ...a) => production.proof(session, ...a))
  ipcMain.handle('preflight:run', (_e, ...a) => preflight.run(session, ...a))
  ipcMain.handle('preflight:get-minimums', () => preflight.getMinimums(session))
  ipcMain.handle('preflight:set-minimums', (_e, ...a) => preflight.setMinimums(session, ...a))
  ipcMain.handle('preflight:default-minimums', () => preflight.defaultMinimums())
  ipcMain.handle('production:status', () => production.status())
  ipcMain.handle('production:cancel', () => production.cancel())
  ipcMain.handle('profiles:list', (_e, ...a) => profiles.list(session, ...a))
  ipcMain.handle('profiles:import', (_e, ...a) => profiles.importFiles(session, ...a))
  ipcMain.handle('profiles:update', (_e, ...a) => profiles.update(session, ...a))
  ipcMain.handle('profiles:remove', (_e, ...a) => profiles.remove(session, ...a))
  ipcMain.handle('printcolors:list', (_e, ...a) => printColors.list(session, ...a))
  ipcMain.handle('printcolors:create', (_e, ...a) => printColors.create(session, ...a))
  ipcMain.handle('printcolors:update', (_e, ...a) => printColors.update(session, ...a))
  ipcMain.handle('printcolors:remove', (_e, ...a) => printColors.remove(session, ...a))
  ipcMain.handle('exportprofiles:list', (_e, ...a) => exportProfiles.list(session, ...a))
  ipcMain.handle('exportprofiles:save', (_e, ...a) => exportProfiles.save(session, ...a))
  ipcMain.handle('exportprofiles:remove', (_e, ...a) => exportProfiles.remove(session, ...a))
}
