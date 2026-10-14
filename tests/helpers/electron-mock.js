// Stand-in for the `electron` module so the real main-process IPC handlers run under plain Node.
const handlers = new Map()
const queues = { open: [], save: [] }

export const ipcMain = {
  handle: (channel, fn) => handlers.set(channel, fn),
  on: () => {}
}

export const dialog = {
  showOpenDialog: async () => {
    const next = queues.open.shift()
    return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] }
  },
  showSaveDialog: async () => {
    const next = queues.save.shift()
    return next ? { canceled: false, filePath: next } : { canceled: true }
  }
}

export const app = { getPath: () => '/tmp', isPackaged: false }
/** What the application asked the system to open, for the tests to read. */
export const opened = []
export const shell = { openPath: async () => '', openExternal: async url => { opened.push(url) } }
export const Menu = { setApplicationMenu() {}, buildFromTemplate: x => x }
export const BrowserWindow = class {}

/** Call a registered handler exactly like ipcRenderer.invoke does. */
export async function invoke(channel, ...args) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`No IPC handler registered for "${channel}"`)
  return fn({}, ...args)
}

export const mockDialog = {
  /** The next showOpenDialog resolves with these paths. */
  open: (...paths) => queues.open.push(paths),
  save: path => queues.save.push(path),
  reset: () => { queues.open.length = 0; queues.save.length = 0 }
}

export const registeredChannels = () => [...handlers.keys()]
