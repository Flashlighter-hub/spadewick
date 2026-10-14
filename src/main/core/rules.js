/**
 * The Rules (PRD §7.11): the rules of the game as pages of Markdown in a tree, kept in the project (so a snapshot has them), with import
 * from and export to Markdown files, and export as one HTML file.
 *
 * What a page can say, and how it is read, is in shared/markdown.js. A picture is written `![alt](asset:Name.png)` (an image of the
 * project's library), a card `[[Card name]]`, the picture of a card `![[Card name]]`, another page `[text](page:Title)`.
 */
import { join, dirname, basename, extname, resolve, relative, sep } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'fs'
import { tr } from '../../shared/i18n.js'
import { renderMarkdown, splitTitle } from '../../shared/markdown.js'
import { recordChange, rowOf, rowsOf, changesFor } from './history.js'
import { renderCard } from '../render.js'
import * as assets from './assets.js'
import { dbOf, dirOf } from './context.js'

const MAX_BODY = 1_000_000
const MAX_TITLE = 120
const MAX_PAGES = 1000
const MAX_IMPORT_FILES = 500
const MAX_DEPTH = 8
const MARKDOWN = new Set(['.md', '.markdown', '.txt'])
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

const COLUMNS = 'id, parent_id, title, body, sort_order, created_at, updated_at'
const page = (d, id) => d.prepare(`SELECT ${COLUMNS} FROM rules_pages WHERE id = ?`).get(id)
const siblings = (d, parentId) => d.prepare(`SELECT ${COLUMNS} FROM rules_pages WHERE parent_id IS ? ORDER BY sort_order, created_at, id`).all(parentId ?? null)
const cleanTitle = t => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)

/** Every page below one (children, their children…), in no particular order. */
function below(d, id) {
  const out = []
  const walk = pid => { for (const c of d.prepare('SELECT id FROM rules_pages WHERE parent_id = ?').all(pid)) { out.push(c.id); walk(c.id) } }
  walk(id)
  return out
}

/** The pages as a list for the tree: without their text, but with how long it is. */
export function list(ctx) {
  return dbOf(ctx).prepare('SELECT id, parent_id, title, sort_order, updated_at, length(body) AS size FROM rules_pages ORDER BY sort_order, created_at, id').all()
}

export function get(ctx, id) {
  return page(dbOf(ctx), id) ?? null
}

/** A page, at the end of its parent's pages. */
export function create(ctx, { parentId = null, title, body = '' } = {}) {
  const d = dbOf(ctx)
  if (parentId && !page(d, parentId)) throw new Error(tr('rules.notFound'))
  if (d.prepare('SELECT COUNT(*) AS n FROM rules_pages').get().n >= MAX_PAGES) throw new Error(tr('rules.tooMany'))
  const text = String(body ?? '')
  if (text.length > MAX_BODY) throw new Error(tr('rules.tooLong'))
  const id = randomUUID(), now = Date.now()
  const order = (d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM rules_pages WHERE parent_id IS ?').get(parentId ?? null).m) + 1
  d.prepare('INSERT INTO rules_pages (id, parent_id, title, body, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, parentId ?? null, cleanTitle(title) || tr('rules.untitled'), text, order, now, now)
  recordChange(d, 'CREATE_RULES_PAGE', [{ table: 'rules_pages', before: null, after: rowOf(d, 'rules_pages', id) }])
  return page(d, id)
}

/** Change the title or the text of a page. Only a new title is a step of undo: the text has the undo of its editor, and the snapshots. */
export function update(ctx, { id, title, body }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'rules_pages', id)
  if (!before) throw new Error(tr('rules.notFound'))
  const sets = [], values = []
  let renamed = false
  if (title !== undefined) {
    const t = cleanTitle(title)
    if (!t) throw new Error(tr('rules.titleEmpty'))
    if (t !== before.title) { sets.push('title = ?'); values.push(t); renamed = true }
  }
  if (body !== undefined) {
    const text = String(body)
    if (text.length > MAX_BODY) throw new Error(tr('rules.tooLong'))
    if (text !== before.body) { sets.push('body = ?'); values.push(text) }
  }
  if (sets.length) {
    d.prepare(`UPDATE rules_pages SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id)
    if (renamed) recordChange(d, 'RENAME_RULES_PAGE', changesFor(d, 'rules_pages', [before]))
  }
  return page(d, id)
}

/** Put a page under another (or at the top) at a place among its pages. A page cannot go into itself or into what is below it. */
export function move(ctx, { id, parentId = null, index }) {
  const d = dbOf(ctx)
  const moving = page(d, id)
  if (!moving) throw new Error(tr('rules.notFound'))
  if (parentId && (!page(d, parentId) || parentId === id || below(d, id).includes(parentId))) throw new Error(tr('rules.cannotMoveInto'))
  const oldParent = moving.parent_id ?? null
  const newParent = parentId ?? null
  const target = siblings(d, newParent).filter(p => p.id !== id)
  const at = Math.max(0, Math.min(target.length, Number.isFinite(Number(index)) ? Math.round(Number(index)) : target.length))
  target.splice(at, 0, moving)
  const touched = new Set(target.map(p => p.id))
  const old = oldParent === newParent ? [] : siblings(d, oldParent).filter(p => p.id !== id)
  for (const p of old) touched.add(p.id)
  const befores = rowsOf(d, 'rules_pages', [...touched])
  d.transaction(() => {
    target.forEach((p, i) => d.prepare('UPDATE rules_pages SET sort_order = ?, parent_id = ? WHERE id = ?').run(i, newParent, p.id))
    old.forEach((p, i) => d.prepare('UPDATE rules_pages SET sort_order = ? WHERE id = ?').run(i, p.id))
  })()
  recordChange(d, 'MOVE_RULES_PAGE', changesFor(d, 'rules_pages', befores))
}

/** Delete a page and the pages below it. One step of undo brings them all back. */
export function remove(ctx, id) {
  const d = dbOf(ctx)
  if (!page(d, id)) return
  const ids = [id, ...below(d, id)]
  const befores = rowsOf(d, 'rules_pages', ids)
  const parent = page(d, id).parent_id ?? null
  const kept = siblings(d, parent).filter(p => p.id !== id).map(p => p.id)           // the pages beside it are numbered again, which undo puts back too
  const keptBefores = rowsOf(d, 'rules_pages', kept)
  d.transaction(() => {
    for (const i of ids) d.prepare('DELETE FROM rules_pages WHERE id = ?').run(i)
    kept.forEach((pid, i) => d.prepare('UPDATE rules_pages SET sort_order = ? WHERE id = ?').run(i, pid))
  })()
  recordChange(d, 'DELETE_RULES_PAGES', [...changesFor(d, 'rules_pages', befores, ids.map(() => null)), ...changesFor(d, 'rules_pages', keptBefores)])
}

/** The cards of the project, so a page can point to them by name: { id, name, code, set, setId }. */
export function cards(ctx) {
  const d = dbOf(ctx)
  return d.prepare(`SELECT c.id, c.display_name AS name, c.card_code AS code, s.name AS set_name, c.set_id FROM cards c JOIN sets s ON s.id = c.set_id
    WHERE c.deleted = 0 ORDER BY s.sort_order, c.sort_order`).all().map(c => ({ id: c.id, name: c.name || c.code || '', code: c.code ?? '', set: c.set_name, setId: c.set_id }))
}

/** A link of a page opened by the application: only the web and a mail address. */
export async function openLink(ctx, url) {
  const u = String(url ?? '')
  if (!/^(https?:\/\/|mailto:)\S+$/i.test(u)) throw new Error(tr('rules.badLink'))
  await ctx.ui.openExternal?.(u)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const slug = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'page'
const ASSET_IMG = /!\[([^\]]*)\]\(\s*asset:((?:[^()\n]|\([^()\n]*\))+?)\s*\)/g

/** The pages as a tree: [{ ...row, children: [] }]. */
function tree(d) {
  const rows = d.prepare(`SELECT ${COLUMNS} FROM rules_pages ORDER BY sort_order, created_at, id`).all()
  const by = new Map(rows.map(r => [r.id, { ...r, children: [] }]))
  const roots = []
  for (const r of by.values()) (r.parent_id && by.has(r.parent_id) ? by.get(r.parent_id).children : roots).push(r)
  return roots
}

/** The picture files of the project's library by their names (the first of a name). */
function assetsByName(d) {
  const out = new Map()
  for (const a of d.prepare('SELECT id, filename, original_name, mime_type FROM assets ORDER BY created_at').all()) if (!out.has(a.original_name.toLowerCase())) out.set(a.original_name.toLowerCase(), a)
  return out
}

/** The text of a page for a file: its title, and its pictures written as files next to it (`images/Name.png`) */
function fileText(projectDir, row, imagesDir, relImages, byName) {
  let used = 0
  const body = row.body.replace(ASSET_IMG, (whole, alt, name) => {
    const a = byName.get(name.trim().toLowerCase())
    const src = a && join(projectDir, 'assets', a.filename)
    if (!a || !existsSync(src)) return whole
    mkdirSync(imagesDir, { recursive: true })
    const file = a.original_name.replace(/[\\/:*?"<>|]+/g, '_')
    if (!existsSync(join(imagesDir, file))) copyFileSync(src, join(imagesDir, file))
    used++
    return `![${alt}](${relImages}/${encodeURI(file).replace(/\(/g, '%28').replace(/\)/g, '%29')})`
  })
  return { text: `# ${row.title}\n\n${body}${body.endsWith('\n') ? '' : '\n'}`, used }
}

/** One page as a Markdown file (with its pictures beside it, in `images`). */
export async function exportPage(ctx, { id }) {
  const d = dbOf(ctx)
  const row = page(d, id)
  if (!row) throw new Error(tr('rules.notFound'))
  const picked = await ctx.ui.showSaveDialog({ title: tr('rules.exportPageTitle'), defaultPath: `${slug(row.title)}.md`, filters: [{ name: tr('rules.markdownFiles'), extensions: ['md'] }] })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  const { text } = fileText(dirOf(ctx), row, join(dirname(picked.filePath), 'images'), 'images', assetsByName(d))
  writeFileSync(picked.filePath, text)
  return { canceled: false, path: picked.filePath }
}

/** Every page as Markdown files in a folder of the person's choosing: a page's pages in a folder of their own, in order (`01-title.md`). */
export async function exportAll(ctx) {
  const d = dbOf(ctx)
  const picked = await ctx.ui.showOpenDialog({ title: tr('rules.exportFolderTitle'), properties: ['openDirectory', 'createDirectory'] })
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true }
  const root = join(picked.filePaths[0], 'rules')
  const projectDir = dirOf(ctx)
  const byName = assetsByName(d)
  let files = 0
  const write = (nodes, dir, depth) => {
    mkdirSync(dir, { recursive: true })
    nodes.forEach((node, i) => {
      const base = `${String(i + 1).padStart(2, '0')}-${slug(node.title)}`
      const imagesDir = join(root, 'images')
      const rel = `${'../'.repeat(depth)}images`
      writeFileSync(join(dir, `${base}.md`), fileText(projectDir, node, imagesDir, rel, byName).text)
      files++
      if (node.children.length) write(node.children, join(dir, base), depth + 1)
    })
  }
  const roots = tree(d)
  if (!roots.length) throw new Error(tr('rules.nothingToExport'))
  write(roots, root, 0)
  return { canceled: false, path: root, files }
}

const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** All the pages as one HTML file that needs nothing else: pictures and cards are in it, the pages link to each other. */
export async function exportHtml(ctx) {
  const d = dbOf(ctx)
  const roots = tree(d)
  if (!roots.length) throw new Error(tr('rules.nothingToExport'))
  const name = d.prepare("SELECT value FROM project_meta WHERE key = 'name'").get()?.value ?? 'Rules'
  const picked = await ctx.ui.showSaveDialog({ title: tr('rules.exportHtmlTitle'), defaultPath: `${slug(name)}-rules.html`, filters: [{ name: tr('rules.htmlFiles'), extensions: ['html'] }] })
  if (picked.canceled || !picked.filePath) return { canceled: true }

  const all = []
  const flat = (nodes, depth) => nodes.forEach(n => { all.push({ ...n, depth }); flat(n.children, depth + 1) })
  flat(roots, 0)
  const byTitle = new Map(all.map(p => [p.title.toLowerCase(), p]))
  const byName = assetsByName(d)
  const cardsByName = new Map()
  for (const c of cards(ctx)) { for (const k of [c.name, c.code]) if (k && !cardsByName.has(k.toLowerCase())) cardsByName.set(k.toLowerCase(), c) }
  const projectDir = dirOf(ctx)
  const cache = new Map()
  const dataUri = async key => {
    if (cache.has(key)) return cache.get(key)
    let uri = ''
    try {
      if (key.startsWith('asset:')) { const a = byName.get(key.slice(6).toLowerCase()); const p = a && (await assets.getPreview(ctx, a.id)); if (p) uri = `data:${p.mime};base64,${Buffer.from(p.bytes).toString('base64')}` }
      else { const c = cardsByName.get(key.slice(5).toLowerCase()); if (c) uri = `data:image/png;base64,${(await renderCard(projectDir, c.id, { width: 320 })).toString('base64')}` }
    } catch { /* a picture that cannot be made is left out */ }
    cache.set(key, uri)
    return uri
  }

  const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  const sections = []
  for (const p of all) {
    let { html } = renderMarkdown(p.body)
    const pid = `p${all.indexOf(p)}`
    html = html.replace(/ id="([^"]+)"/g, (_, id) => ` id="${pid}-${id}"`)
    html = html.replace(/<a class="int" data-rules-anchor="([^"]*)" role="link" tabindex="0">/g, (_, id) => `<a href="#${pid}-${id}">`)
    html = html.replace(/<a class="int" data-rules-page="([^"]*)" role="link" tabindex="0">/g, (_, t) => { const target = byTitle.get(unesc(t).toLowerCase()); return target ? `<a href="#page-${all.indexOf(target)}">` : '<a class="dead">' })
    html = html.replace(/<a class="ext" data-rules-link="([^"]*)" role="link" tabindex="0">/g, (_, u) => `<a href="${u}" rel="noopener noreferrer">`)
    html = html.replace(/<a class="card-ref" data-rules-card="([^"]*)" role="button" tabindex="0">/g, '<span class="card-ref">').replace(/(<span class="card-ref">[^<]*)<\/a>/g, '$1</span>')
    for (const m of [...html.matchAll(/<img class="rules-img" data-rules-asset="([^"]*)" alt="([^"]*)" \/>/g)]) {
      const uri = await dataUri(`asset:${unesc(m[1])}`)
      html = html.replace(m[0], uri ? `<img src="${uri}" alt="${m[2]}" />` : `<span class="missing">${m[2] || m[1]}</span>`)
    }
    for (const m of [...html.matchAll(/<figure class="card-embed" data-rules-card-embed="([^"]*)"><figcaption>([^<]*)<\/figcaption><\/figure>/g)]) {
      const uri = await dataUri(`card:${unesc(m[1])}`)
      html = html.replace(m[0], uri ? `<figure class="card-embed"><img src="${uri}" alt="${m[2]}" /><figcaption>${m[2]}</figcaption></figure>` : `<span class="missing">${m[2]}</span>`)
    }
    sections.push(`<section id="page-${all.indexOf(p)}"><h${Math.min(6, p.depth + 1)} class="page-title">${escHtml(p.title)}</h${Math.min(6, p.depth + 1)}>\n${html}</section>`)
  }
  const toc = all.map((p, i) => `<li style="margin-left:${p.depth * 1.2}em"><a href="#page-${i}">${escHtml(p.title)}</a></li>`).join('')
  const doc = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escHtml(name)} – rules</title>
<style>
body { font: 16px/1.55 system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #212529; }
nav ul { list-style: none; padding: 0; } nav a { text-decoration: none; }
section { margin: 2.5rem 0; padding-top: 1rem; border-top: 1px solid #dee2e6; }
img { max-width: 100%; } figure.card-embed { display: inline-block; margin: .5rem 1rem .5rem 0; text-align: center; } figure.card-embed img { width: 220px; border-radius: 8px; }
table { border-collapse: collapse; } th, td { border: 1px solid #ced4da; padding: .3rem .6rem; } th { background: #f1f3f5; }
.al-center { text-align: center } .al-right { text-align: right } blockquote { margin-left: 0; padding-left: 1rem; border-left: 4px solid #ced4da; color: #495057; }
code { background: #f1f3f5; padding: 0 .25em; border-radius: 4px; } pre { background: #f1f3f5; padding: .75rem; overflow: auto; border-radius: 6px; }
.card-ref { font-weight: 600; } .missing, .dead { color: #c92a2a; }
@media print { section { break-before: page; } nav { break-after: page; } }
</style></head><body>
<h1>${escHtml(name)}</h1>
<nav aria-label="Contents"><ul>${toc}</ul></nav>
${sections.join('\n')}
</body></html>`
  writeFileSync(picked.filePath, doc)
  return { canceled: false, path: picked.filePath, pages: all.length }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const titleFromFile = file => basename(file, extname(file)).replace(/^\d+[-_. ]+/, '').replace(/[-_]+/g, ' ').trim() || tr('rules.untitled')

/**
 * Read a Markdown file as a page: the title is its first level-one heading (or its file name), and the pictures it points to (files
 * beside it) are put into the project's image library and pointed to from there.
 */
async function readPage(ctx, file, importedPictures) {
  if (statSync(file).size > MAX_BODY * 2) throw new Error(tr('rules.fileTooBig', { name: basename(file) }))
  const source = readFileSync(file, 'utf8')
  const { title, body } = splitTitle(source)
  const dir = dirname(file)
  const found = []
  body.replace(/!\[([^\]]*)\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\s*\)/g, (whole, alt, path) => { found.push({ whole, alt, path }); return whole })
  let text = body
  for (const f of found) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(f.path)) continue                          // the web, or one of our own
    let abs
    try { abs = resolve(dir, decodeURI(f.path)) } catch { continue }
    if (!IMAGES.has(extname(abs).toLowerCase()) || !existsSync(abs) || !statSync(abs).isFile()) continue
    let name = importedPictures.get(abs)
    if (!name) {
      const [row] = await assets.importFiles(ctx, [abs])
      if (!row) continue
      name = row.original_name
      importedPictures.set(abs, name)
    }
    text = text.split(f.whole).join(`![${f.alt}](asset:${name})`)
  }
  return { title: cleanTitle(title ?? titleFromFile(file)), body: text.slice(0, MAX_BODY) }
}

function addPages(ctx, list, parentId) {
  const d = dbOf(ctx)
  const changes = []
  const count = d.prepare('SELECT COUNT(*) AS n FROM rules_pages').get().n
  if (count + list.length > MAX_PAGES) throw new Error(tr('rules.tooMany'))
  const now = Date.now()
  const ids = []
  d.transaction(() => {
    const order = { v: d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM rules_pages WHERE parent_id IS ?').get(parentId ?? null).m + 1 }
    const insert = (item, parent) => {
      const id = randomUUID()
      const sort = parent === (parentId ?? null) ? order.v++ : (item.__order ?? 0)
      d.prepare('INSERT INTO rules_pages (id, parent_id, title, body, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, parent, item.title || tr('rules.untitled'), item.body ?? '', sort, now, now)
      changes.push({ table: 'rules_pages', before: null, after: rowOf(d, 'rules_pages', id) })
      ids.push(id)
      ;(item.children ?? []).forEach((c, i) => insert({ ...c, __order: i }, id))
    }
    list.forEach(item => insert(item, parentId ?? null))
  })()
  recordChange(d, 'IMPORT_RULES', changes)
  return ids
}

/** Markdown files (one or several) as pages, under a page or at the top. */
export async function importFiles(ctx, { parentId = null } = {}) {
  const d = dbOf(ctx)
  if (parentId && !page(d, parentId)) throw new Error(tr('rules.notFound'))
  const picked = await ctx.ui.showOpenDialog({ title: tr('rules.importFilesTitle'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('rules.markdownFiles'), extensions: ['md', 'markdown', 'txt'] }] })
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true }
  const pictures = new Map()
  const list = []
  for (const file of picked.filePaths.slice(0, MAX_IMPORT_FILES)) {
    if (!MARKDOWN.has(extname(file).toLowerCase())) continue
    list.push(await readPage(ctx, file, pictures))
  }
  if (!list.length) throw new Error(tr('rules.noMarkdown'))
  const ids = addPages(ctx, list, parentId)
  return { canceled: false, pages: ids.length, ids, pictures: pictures.size }
}

/**
 * A folder of Markdown files as pages: files in order of their names, and a folder next to a file of the same name (`02-turns.md`,
 * `02-turns/`) holds the pages below it; a folder with no such file becomes a page with no text.
 */
export async function importFolder(ctx, { parentId = null } = {}) {
  const d = dbOf(ctx)
  if (parentId && !page(d, parentId)) throw new Error(tr('rules.notFound'))
  const picked = await ctx.ui.showOpenDialog({ title: tr('rules.importFolderTitle'), properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true }
  const pictures = new Map()
  let files = 0
  const read = async (dir, depth) => {
    const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const out = []
    for (const name of entries) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isFile() && MARKDOWN.has(extname(name).toLowerCase())) {
        if (++files > MAX_IMPORT_FILES) throw new Error(tr('rules.tooMany'))
        const item = await readPage(ctx, full, pictures)
        const folder = join(dir, basename(name, extname(name)))
        item.children = existsSync(folder) && statSync(folder).isDirectory() && depth < MAX_DEPTH ? await read(folder, depth + 1) : []
        out.push(item)
      } else if (st.isDirectory() && depth < MAX_DEPTH && name.toLowerCase() !== 'images') {
        const hasFile = entries.some(e => MARKDOWN.has(extname(e).toLowerCase()) && basename(e, extname(e)) === name)
        if (hasFile) continue                                                         // read with its file above
        const children = await read(full, depth + 1)
        if (children.length) out.push({ title: cleanTitle(name.replace(/^\d+[-_. ]+/, '').replace(/[-_]+/g, ' ')) || tr('rules.untitled'), body: '', children })
      }
    }
    return out
  }
  const list = await read(picked.filePaths[0], 0)
  if (!list.length) throw new Error(tr('rules.noMarkdown'))
  const ids = addPages(ctx, list, parentId)
  return { canceled: false, pages: ids.length, ids, pictures: pictures.size }
}
