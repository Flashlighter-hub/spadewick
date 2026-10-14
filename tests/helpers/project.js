import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { registerIpcHandlers } from '../../src/main/ipc/index.js'
import { invoke, mockDialog, registeredChannels } from './electron-mock.js'

let registered = false
let sharedStore = null

/** In-memory electron-store replacement with the app's defaults. */
export function makeStore(root) {
  const data = {
    projects_root: root, library_dir: join(root, 'library'), recent_projects: [], undo_limit: 1000, autosave_interval_seconds: 30,
    default_card_size: 'poker', preview_size: 'medium', theme: 'system',
    default_card_width_px: 500, default_card_height_px: 700, default_export_dpi: 300, canvas_smart_guides: true, tts_image_links: 'local'
  }
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v },
    get store() { return data },
    onDidChange() {}
  }
}

/** Create a throwaway project through the real `projects:create` handler. */
export async function createTestProject(name = 'Test Game') {
  const root = mkdtempSync(join(tmpdir(), 'spadewick-test-'))
  const store = makeStore(root)
  if (!registered) { registerIpcHandlers(store); registered = true; sharedStore = store }
  else if (!registeredChannels().length) { registerIpcHandlers(store); sharedStore = store }
  else { sharedStore.set('library_dir', join(root, 'library')); sharedStore.set('projects_root', root) }   // handlers keep the first store; point it at this test's folders
  const created = await invoke('projects:create', { name, parentDir: root })
  return {
    root, dir: created.path, name,
    cleanup: async () => { await invoke('projects:close').catch(() => {}); rmSync(root, { recursive: true, force: true }) }
  }
}

/** A set with fields and cards, as a typical user would build one. */
export async function seedSet({ name = 'Base Set', fields = [], cards = [], template, cardSize, cardMmW, cardMmH } = {}) {
  const set = await invoke('sets:create', { name, cardSize, cardMmW, cardMmH })
  const defs = []
  for (const f of fields) defs.push(await invoke('fields:create', { setId: set.id, ...f }))
  let templateRow = null
  if (template) templateRow = await invoke('templates:create', { name: template.name ?? 'Base', svgSource: template.svg, cardSize, cardMmW, cardMmH })
  // a card's name is the value of the set's display field: the names given here go into a field of their own, which is the display field
  if (cards.some(c => c.name) || defs.some(f => f.slug === 'card_name')) {
    if (!defs.some(f => f.slug === 'card_name')) await invoke('fields:create', { setId: set.id, name: 'Card name', slug: 'card_name', type: 'text' })
    await invoke('sets:update', { id: set.id, displayField: 'card_name' })
  }
  const rows = []
  for (const c of cards) {
    rows.push(await invoke('cards:create', {
      setId: set.id, displayName: c.name ?? '', fields: c.fields ?? {}, templateId: templateRow?.id ?? null
    }))
  }
  return { set, fields: defs, cards: rows, template: templateRow }
}

export async function makePng(path, w = 40, h = 60, color = '#ff0000') {
  await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(path)
  return path
}

export { invoke, mockDialog }
export const writeText = (path, text) => writeFileSync(path, text, 'utf8')
