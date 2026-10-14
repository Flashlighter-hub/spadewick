import { ipcMain } from 'electron'
import * as svc from '../core/export.js'
import { exportPreview } from '../core/exportPreview.js'

export function registerExportHandlers(session) {
  // A folder chooser for the export dialog: purely a question to the person, so it lives here and not in the core
  ipcMain.handle('app:pick-directory', async (_e, defaultPath) => {
    const result = await session.ui.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('export:tts', (_e, ...a) => svc.exportTts(session, ...a))
  ipcMain.handle('export:tts-cloud-files', (_e, ...a) => svc.ttsCloudFiles(session, ...a))
  ipcMain.handle('export:tts-cloud-links', (_e, ...a) => svc.ttsCloudLinks(session, ...a))
  ipcMain.handle('export:preview', (_e, ...a) => exportPreview(session, ...a))
  ipcMain.handle('export:pdf', (_e, ...a) => svc.exportPdf(session, ...a))
  ipcMain.handle('export:png-sheet', (_e, ...a) => svc.exportPngSheet(session, ...a))
}
