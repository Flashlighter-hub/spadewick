import { contextBridge, ipcRenderer } from 'electron'

// All channels the renderer may invoke
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('spadewick', {
  // Settings
  settings: {
    get:    (key)        => invoke('settings:get', key),
    set:    (key, value) => invoke('settings:set', key, value),
    getAll: ()           => invoke('settings:get-all')
  },

  // Projects
  projects: {
    listRecent:    ()              => invoke('projects:list-recent'),
    create:        (opts)          => invoke('projects:create', opts),
    open:          (path)          => invoke('projects:open', path),
    openFile:      ()              => invoke('projects:open-file'),
    close:         ()              => invoke('projects:close'),
    getMeta:       ()              => invoke('projects:get-meta'),
    duplicate:     (opts)          => invoke('projects:duplicate', opts),
    reveal:        ()              => invoke('projects:reveal'),
    checkIntegrity: ()             => invoke('projects:check-integrity'),
    setTextEngine:  (engine)       => invoke('projects:set-text-engine', engine),
    autosave:       ()             => invoke('projects:autosave')
  },

  // Sets
  sets: {
    list:    ()              => invoke('sets:list'),
    create:  (opts)          => invoke('sets:create', opts),
    update:  (opts)          => invoke('sets:update', opts),
    delete:  (id)            => invoke('sets:delete', id),
    reorder: (orderedIds)    => invoke('sets:reorder', orderedIds),
    sizeImpact: (opts)       => invoke('sets:size-impact', opts),
    rulePreview: (opts)      => invoke('sets:rule-preview', opts)
  },

  // Cards
  cards: {
    list:        (setId)   => invoke('cards:list', setId),
    create:      (opts)    => invoke('cards:create', opts),
    update:      (opts)    => invoke('cards:update', opts),
    batchUpdate: (opts)    => invoke('cards:batch-update', opts),
    delete:      (ids)     => invoke('cards:delete', ids),
    reorder:     (opts)    => invoke('cards:reorder', opts),
    duplicate:   (ids)     => invoke('cards:duplicate', ids),
    propagatePreview: (opts) => invoke('cards:propagate-preview', opts),
    matching:    (opts)    => invoke('cards:matching', opts),
    findReplace: (opts)    => invoke('cards:find-replace', opts)
  },

  // Fields
  fields: {
    list:            (setId)     => invoke('fields:list', setId),
    create:          (opts)      => invoke('fields:create', opts),
    update:          (opts)      => invoke('fields:update', opts),
    delete:          (id)        => invoke('fields:delete', id),
    reorder:         (opts)      => invoke('fields:reorder', opts),
    setWidth:        (opts)      => invoke('fields:set-width', opts),
    evaluateFormula: (opts)      => invoke('fields:evaluate-formula', opts),
    convertImpact:   (opts)      => invoke('fields:convert-impact', opts),
    distinctValues:  (opts)      => invoke('fields:distinct-values', opts),
    checkCircular:   (fieldDefs) => invoke('fields:check-circular', fieldDefs)
  },

  // Saved views of the card table (UPDATES U25) and the balance view (UPDATES U22)
  views: {
    list:   (setId) => invoke('views:list', setId),
    create: (opts)  => invoke('views:create', opts),
    update: (opts)  => invoke('views:update', opts),
    delete: (id)    => invoke('views:delete', id)
  },
  stats: {
    balance: (opts) => invoke('stats:balance', opts)
  },
  // A card's own version of its template (UPDATES U29)
  instances: {
    get:   (opts) => invoke('instances:get', opts),
    save:  (opts) => invoke('instances:save', opts),
    reset: (opts) => invoke('instances:reset', opts),
    list:  (opts) => invoke('instances:list', opts)
  },

  // Icon library, text styles and keyword rules (PRD §16.4, §16.5)
  icons: {
    list:         ()      => invoke('icons:list'),
    usage:        (id)    => invoke('icons:usage', id),
    importFiles:  (opts)  => invoke('icons:import-files', opts),
    importFolder: (opts)  => invoke('icons:import-folder', opts),
    replacePicture: (opts) => invoke('icons:replace-picture', opts),
    update:       (opts)  => invoke('icons:update', opts),
    rename:       (opts)  => invoke('icons:rename', opts),
    remove:       (id)    => invoke('icons:remove', id)
  },
  textStyles: {
    list:   ()     => invoke('textstyles:list'),
    create: (opts) => invoke('textstyles:create', opts),
    update: (opts) => invoke('textstyles:update', opts),
    rename: (opts) => invoke('textstyles:rename', opts),
    remove: (id)   => invoke('textstyles:remove', id)
  },
  keywords: {
    list:    ()           => invoke('keywords:list'),
    create:  (opts)       => invoke('keywords:create', opts),
    update:  (opts)       => invoke('keywords:update', opts),
    remove:  (id)         => invoke('keywords:remove', id),
    reorder: (orderedIds) => invoke('keywords:reorder', orderedIds)
  },

  textCheck: { run: (opts) => invoke('textcheck:run', opts) },

  // Production PDF (PRD §17)
  production: {
    run:    (opts) => invoke('production:run', opts),
    runImages: (opts) => invoke('production:run-images', opts),
    proof:  (opts) => invoke('production:proof', opts),
    status: ()     => invoke('production:status'),
    cancel: ()     => invoke('production:cancel')
  },
  presets: {
    list:      (opts) => invoke('presets:list', opts),
    get:       (id)   => invoke('presets:get', id),
    apply:     (opts) => invoke('presets:apply', opts),
    duplicate: (opts) => invoke('presets:duplicate', opts),
    save:      (p)    => invoke('presets:save', p),
    remove:    (id)   => invoke('presets:remove', id),
    import:    (opts) => invoke('presets:import', opts),
    export:    (opts) => invoke('presets:export', opts)
  },
  preflight: {
    run:             (opts)  => invoke('preflight:run', opts),
    getMinimums:     ()      => invoke('preflight:get-minimums'),
    setMinimums:     (input) => invoke('preflight:set-minimums', input),
    defaultMinimums: ()      => invoke('preflight:default-minimums')
  },
  profiles: {
    list:   ()     => invoke('profiles:list'),
    import: (opts) => invoke('profiles:import', opts),
    update: (opts) => invoke('profiles:update', opts),
    remove: (id)   => invoke('profiles:remove', id)
  },
  printColors: {
    list:   ()     => invoke('printcolors:list'),
    create: (opts) => invoke('printcolors:create', opts),
    update: (opts) => invoke('printcolors:update', opts),
    remove: (id)   => invoke('printcolors:remove', id)
  },
  exportProfiles: {
    list:   (opts) => invoke('exportprofiles:list', opts),
    save:   (opts) => invoke('exportprofiles:save', opts),
    remove: (id)   => invoke('exportprofiles:remove', id)
  },

  // SVG import and automatic binding (PRD §19)
  svgImport: {
    pick:      ()     => invoke('svgimport:pick'),
    pickImage: ()     => invoke('svgimport:pick-image'),
    analyze:   (opts) => invoke('svgimport:analyze', opts),
    apply:     (opts) => invoke('svgimport:apply', opts)
  },

  // Templates
  templates: {
    list:   (opts)  => invoke('templates:list', opts),
    get:    (id)    => invoke('templates:get', id),
    create: (opts)  => invoke('templates:create', opts),
    createBack: (opts) => invoke('templates:create-back', opts),
    update: (opts)  => invoke('templates:update', opts),
    delete: (id)    => invoke('templates:delete', id),
    addBleed: (opts) => invoke('templates:add-bleed', opts),
    render: (opts)  => invoke('templates:render', opts),
    textReport: (opts) => invoke('templates:text-report', opts)
  },

  // Assets
  assets: {
    list:         (opts)   => invoke('assets:list', opts),
    getThumbnail: (id)     => invoke('assets:get-thumbnail', id),
    getPreview:   (id)     => invoke('assets:get-preview', id),
    import:       (paths)  => invoke('assets:import', paths),
    update:       (opts)   => invoke('assets:update', opts),
    replace:      (opts)   => invoke('assets:replace', opts),
    delete:       (id)     => invoke('assets:delete', id),
    getUsage:     (id)     => invoke('assets:get-usage', id),
    getTemplateUsage: (id) => invoke('assets:get-template-usage', id),
    export:       (id)     => invoke('assets:export', id),
    allTags:      ()       => invoke('assets:all-tags')
  },

  // Fonts
  fonts: {
    list:   ()      => invoke('fonts:list'),
    bundled: ()     => invoke('fonts:bundled'),
    import: (paths) => invoke('fonts:import', paths),
    delete: (id)    => invoke('fonts:delete', id)
  },

  // App utilities
  app: {
    pickDirectory: (defaultPath) => invoke('app:pick-directory', defaultPath)
  },

  // Card sizes (PRD §10.6)
  cardSize: {
    get:     (setId) => invoke('cardsize:get', setId),
    resolve: (size)  => invoke('cardsize:resolve', size)
  },

  // CSV / JSON data import & export
  dataio: {
    readFile: (opts) => invoke('dataio:read-file', opts),
    import:   (opts) => invoke('dataio:import', opts),
    export:   (opts) => invoke('dataio:export', opts)
  },

  // Template library and packages (PRD §7.7)
  templateLibrary: {
    list:              ()     => invoke('templatelib:list'),
    renameItem:        (opts) => invoke('templatelib:rename-item', opts),
    deleteItem:        (id)   => invoke('templatelib:delete-item', id),
    plan:              (opts) => invoke('templatelib:plan', opts),
    use:               (opts) => invoke('templatelib:use', opts),
    projectTemplates:  ()     => invoke('templatelib:project-templates'),
    projectThumbnail:  (id)   => invoke('templatelib:project-thumbnail', id),
    originStatus:      (id)   => invoke('templatelib:origin-status', id),
    update:            (opts) => invoke('templatelib:update', opts),
    reset:             (opts) => invoke('templatelib:reset', opts),
    save:              (opts) => invoke('templatelib:save', opts),
    duplicate:         (id)   => invoke('templates:duplicate', id),
    inspect:           (opts) => invoke('templatepkg:inspect', opts),
    exportPackage:     (opts) => invoke('templatepkg:export', opts),
    openPackage:       (opts) => invoke('templatepkg:open', opts),
    planPackage:       (opts) => invoke('templatepkg:plan', opts),
    applyPackage:      (opts) => invoke('templatepkg:apply', opts),
    closePackage:      (token) => invoke('templatepkg:close', token)
  },

  // Card IDs (PRD §5.8)
  cardIds: {
    get:  ()     => invoke('cardids:get'),
    save: (opts) => invoke('cardids:save', opts)
  },

  // Export
  export: {
    tts:      (opts) => invoke('export:tts', opts),
    preview:  (request) => invoke('export:preview', request),
    ttsCloudFiles: (opts) => invoke('export:tts-cloud-files', opts),
    ttsCloudLinks: (opts) => invoke('export:tts-cloud-links', opts),
    pdf:      (opts) => invoke('export:pdf', opts),
    pngSheet: (opts) => invoke('export:png-sheet', opts)
  },

  // The rules of the game (PRD §7.11)
  rules: {
    list:         ()     => invoke('rules:list'),
    get:          (id)   => invoke('rules:get', id),
    create:       (opts) => invoke('rules:create', opts),
    update:       (opts) => invoke('rules:update', opts),
    move:         (opts) => invoke('rules:move', opts),
    delete:       (id)   => invoke('rules:delete', id),
    cards:        ()     => invoke('rules:cards'),
    openLink:     (url)  => invoke('rules:open-link', url),
    exportPage:   (opts) => invoke('rules:export-page', opts),
    exportAll:    ()     => invoke('rules:export-all'),
    exportHtml:   ()     => invoke('rules:export-html'),
    importFiles:  (opts) => invoke('rules:import-files', opts),
    importFolder: (opts) => invoke('rules:import-folder', opts)
  },

  // The component library (PRD §7.10)
  components: {
    list:   ()     => invoke('components:list'),
    get:    (id)   => invoke('components:get', id),
    save:   (opts) => invoke('components:save', opts),
    rename: (opts) => invoke('components:rename', opts),
    delete: (id)   => invoke('components:delete', id),
    export: (opts) => invoke('components:export', opts),
    import: ()     => invoke('components:import')
  },

  // The virtual table (PRD §7.9)
  table: {
    cards:  (opts) => invoke('table:cards', opts),
    cardInfo: (opts) => invoke('table:card-info', opts),
    assetPicture: (opts) => invoke('table:asset-picture', opts),
    list:   ()     => invoke('table:list'),
    save:   (opts) => invoke('table:save', opts),
    load:   (id)   => invoke('table:load', id),
    delete: (id)   => invoke('table:delete', id)
  },

  // Snapshots
  snapshots: {
    list:    ()           => invoke('snapshots:list'),
    create:  (opts)       => invoke('snapshots:create', opts),
    restore: (id)         => invoke('snapshots:restore', id),
    delete:  (id)         => invoke('snapshots:delete', id),
    export:  (id)         => invoke('snapshots:export', id),
    compareOpen:    (opts) => invoke('snapshots:compare-open', opts),
    compareClose:   (h)    => invoke('snapshots:compare-close', h),
    compareRefresh: (h)    => invoke('snapshots:compare-refresh', h),
    compareRender:  (opts) => invoke('snapshots:compare-render', opts),
    compareRestore: (opts) => invoke('snapshots:compare-restore', opts),
    compareRenderTemplate: (opts) => invoke('snapshots:compare-render-template', opts),
    compareTemplateSource: (opts) => invoke('snapshots:compare-template-source', opts),
    compareExport:  (opts) => invoke('snapshots:compare-export', opts)
  },

  // Undo / Redo
  history: {
    undo:     () => invoke('history:undo'),
    redo:     () => invoke('history:redo'),
    getStack: () => invoke('history:get-stack')
  },

  // What changed in the project (cards, templates, fonts…), told by the main process whoever changed it (UPDATES U6)
  onProjectChanged: cb => {
    const handler = (_e, change) => cb(change)
    ipcRenderer.on('project:changed', handler)
    return () => ipcRenderer.off('project:changed', handler)
  },

  // Menu event bridge (main → renderer)
  onMenu: (channel, cb) => {
    const handler = (_e, ...args) => cb(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  }
})
