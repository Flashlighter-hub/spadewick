import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import Store from 'electron-store'
import { registerIpcHandlers } from './ipc/index.js'
import { portableRoot } from './portable.js'
import { tr } from '../shared/i18n.js'
import { setLogsDir, getLogsDir } from './log.js'

const isDev = !app.isPackaged

// PRD §14.3: a packaged app keeps everything (settings, logs, Chromium's own caches) beside itself
const dataRoot = isDev ? null : join(portableRoot(), 'data')
if (dataRoot) {
  app.setPath('userData', join(dataRoot, 'electron'))
  app.setPath('logs', join(dataRoot, 'logs'))
}
setLogsDir(isDev ? join(app.getPath('userData'), 'logs') : join(dataRoot, 'logs'))

// Store relative to the executable so the whole directory is portable
const store = new Store({
  cwd: isDev
    ? app.getPath('userData')
    : dataRoot,
  defaults: {
    projects_root: isDev
      ? join(app.getPath('userData'), 'projects')
      : join(portableRoot(), 'projects'),
    recent_projects: [],
    // starter templates ship with the app; the templates a user saves live beside the other portable data (PRD §7.7.6)
    library_dir: join(isDev ? app.getPath('userData') : dataRoot, 'library'),
    undo_limit: 1000,
    autosave_interval_seconds: 30,
    preview_size: 'medium',
    theme: 'system',
    default_export_dpi: 300,
    canvas_smart_guides: true,
    tts_image_links: 'local'
  }
})

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: tr('menu.appTitle'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Block navigation to external URLs
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      e.preventDefault()
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu() {
  const send = (channel, ...args) => () => mainWindow?.webContents.send(channel, ...args)
  const recents = store.get('recent_projects', []).slice(0, 10)

  const template = [
    {
      label: tr('menu.file'),
      submenu: [
        { label: tr('menu.newProject'), accelerator: 'CmdOrCtrl+N', click: send('menu:new-project') },
        { label: tr('menu.openProject'), accelerator: 'CmdOrCtrl+O', click: send('menu:open-project') },
        { label: tr('menu.openProjectFileDb'), click: send('menu:open-project-file') },
        {
          label: tr('menu.recentProjects'),
          submenu: recents.length
            ? recents.map(p => ({ label: p, click: send('menu:open-recent', p) }))
            : [{ label: tr('menu.noRecentProjects'), enabled: false }]
        },
        { type: 'separator' },
        { label: tr('menu.closeProject'), click: send('menu:close-project') },
        { label: tr('menu.duplicateProject'), click: send('menu:duplicate-project') },
        { label: tr('menu.revealInExplorer'), click: send('menu:reveal-project') },
        { type: 'separator' },
        {
          label: tr('menu.export'),
          submenu: [
            { label: tr('menu.tabletopSimulator'), click: send('menu:export-tts') },
            { label: tr('menu.printAndPlayPdf'), click: send('menu:export-pdf') },
            { label: tr('menu.pngSheet'), click: send('menu:export-png') }
          ]
        },
        { type: 'separator' },
        { label: tr('menu.preferences'), accelerator: 'CmdOrCtrl+,', click: send('menu:preferences') },
        { role: 'quit' }
      ]
    },
    {
      label: tr('menu.edit'),
      submenu: [
        { label: tr('menu.undo'), accelerator: 'CmdOrCtrl+Z', click: send('menu:undo') },
        { label: tr('menu.redo'), accelerator: 'CmdOrCtrl+Shift+Z', click: send('menu:redo') },
        { type: 'separator' },
        { label: tr('menu.findAndReplace'), accelerator: 'CmdOrCtrl+H', click: send('menu:find-replace') },
        { label: tr('menu.selectAllCards'), accelerator: 'CmdOrCtrl+A', click: send('menu:select-all') }
      ]
    },
    {
      label: tr('menu.view'),
      submenu: [
        { label: tr('menu.toggleSidebar'), accelerator: 'CmdOrCtrl+B', click: send('menu:toggle-sidebar') },
        { type: 'separator' },
        { label: tr('menu.cardPreviewSmall'), click: send('menu:preview-size', 'small') },
        { label: tr('menu.cardPreviewMedium'), click: send('menu:preview-size', 'medium') },
        { label: tr('menu.cardPreviewLarge'), click: send('menu:preview-size', 'large') },
        { type: 'separator' },
        { label: tr('menu.toggleRulers'), click: send('menu:canvas', 'rulers') },
        { label: tr('menu.toggleGrid'),   click: send('menu:canvas', 'grid') },
        { label: tr('menu.toggleSnap'),   click: send('menu:canvas', 'snap') },
        { label: tr('menu.toggleGuides'), click: send('menu:canvas', 'guides') },
        { type: 'separator' },
        { label: tr('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: send('menu:canvas', 'zoom-in') },
        { label: tr('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: send('menu:canvas', 'zoom-out') },
        { label: tr('menu.zoomActual'), accelerator: 'CmdOrCtrl+1', click: send('menu:canvas', 'zoom-reset') },
        { label: tr('menu.zoomFit'), accelerator: 'CmdOrCtrl+0', click: send('menu:canvas', 'zoom-fit') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' }
      ]
    },
    {
      label: tr('menu.project'),
      submenu: [
        { label: tr('menu.manageFields'), click: send('menu:manage-fields') },
        { label: tr('menu.cardIds'), click: send('menu:card-ids') },
        { label: tr('menu.manageFonts'), click: send('menu:manage-fonts') },
        { label: tr('menu.icons'), click: send('menu:icons') },
        { label: tr('menu.textStyles'), click: send('menu:text-styles') },
        { label: tr('menu.checkText'), click: send('menu:check-text') },
        { label: tr('menu.checkPrint'), click: send('menu:check-print') },
        { type: 'separator' },
        { label: tr('menu.createSnapshot'), click: send('menu:create-snapshot') },
        { label: tr('menu.viewSnapshots'), click: send('menu:view-snapshots') },
        { label: tr('menu.whatChanged'), click: send('menu:what-changed') }
      ]
    },
    {
      label: tr('menu.help'),
      submenu: [
        { label: tr('menu.guide'), click: send('menu:guide') },
        { type: 'separator' },
        { label: tr('menu.aboutSpadewick'), click: send('menu:about') },
        {
          label: tr('menu.openLogsFolder'),
          click: () => { mkdirSync(getLogsDir(), { recursive: true }); shell.openPath(getLogsDir()) }
        },
        { label: tr('menu.checkDatabaseIntegrity'), click: send('menu:db-integrity') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  buildMenu()
  store.onDidChange('recent_projects', buildMenu) // keep File → Recent Projects current
  registerIpcHandlers(store)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export { mainWindow }
