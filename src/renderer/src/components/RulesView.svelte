<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * The Rules (PRD §7.11): the rules of the game as pages of Markdown in a tree. A list of pages, a text to write in, and the page as it
   * reads; basic formatting from the toolbar or the keys; pictures of the project, cards and other pages by reference; import from and
   * export to Markdown files, and to one web page.
   *
   * What is written is saved a moment after the typing stops, and when another page is opened or the tab is left.
   */
  import { onMount, onDestroy, afterUpdate, tick } from 'svelte'
  import { activeTab, toast, focusCard } from '../stores/ui.js'
  import { askText, askConfirm } from '../stores/prompt.js'
  import { renderMarkdown } from '../../../shared/markdown.js'
  import { flatten, moveTargets, neighbourAfterRemoval, pageByTitle, childrenOf } from '../lib/rulesTree.js'
  import MenuButton from './MenuButton.svelte'
  import AssetPicker from './AssetPicker.svelte'
  import InsertRefDialog from './InsertRefDialog.svelte'

  const SAVE_DELAY = 600

  let pages = []                     // the list: { id, parent_id, title, sort_order, size }
  let selectedId = null
  let current = null                 // the open page, in full
  let draft = ''                     // what is in the text box
  let title = ''
  let saveState = 'saved'            // 'saved' | 'saving' | 'error'
  let saveTimer = null
  let collapsed = new Set()
  let mode = 'split'                 // 'write' | 'split' | 'read'
  let cards = []                     // the cards of the project, for references
  let assetByName = new Map()        // lower-case file name -> image of the library
  let ta, preview
  let pickingImage = false, referring = false

  try { const m = localStorage.getItem('spadewick.rulesMode'); if (['write', 'split', 'read'].includes(m)) mode = m } catch { /* the default is fine */ }
  const setMode = m => { mode = m; try { localStorage.setItem('spadewick.rulesMode', m) } catch { /* not kept */ } }

  $: rows = flatten(pages, collapsed)
  $: rendered = renderMarkdown(draft)
  $: targets = selectedId ? moveTargets(pages, selectedId) : { up: null, down: null, indent: null, outdent: null }
  $: selectedRow = pages.find(p => p.id === selectedId) ?? null

  // ---- loading ---------------------------------------------------------------------------------------------------------

  async function loadPages() { pages = await window.spadewick.rules.list() }
  async function loadLibrary() {
    try { cards = await window.spadewick.rules.cards() } catch { cards = [] }
    try { assetByName = new Map((await window.spadewick.assets.list({})).map(a => [a.original_name.toLowerCase(), a])) } catch { assetByName = new Map() }
  }

  async function open(id) {
    await flush()
    if (!id) { selectedId = null; current = null; draft = ''; title = ''; return }
    try {
      const page = await window.spadewick.rules.get(id)
      if (!page) { selectedId = null; current = null; return }
      selectedId = id; current = page; draft = page.body; title = page.title; saveState = 'saved'
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  /** Save what was written, now. */
  async function flush() {
    clearTimeout(saveTimer); saveTimer = null
    if (!current || draft === current.body) return
    const page = current, body = draft
    saveState = 'saving'
    try {
      await window.spadewick.rules.update({ id: page.id, body })
      page.body = body
      if (current === page) saveState = 'saved'
      const row = pages.find(p => p.id === page.id); if (row) { row.size = body.length; pages = pages }
    } catch (err) { saveState = 'error'; toast(err.message, 'error', 5000) }
  }

  function typed() {
    saveState = 'saving'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, SAVE_DELAY)
  }

  async function rename() {
    if (!current) return
    const next = title.trim()
    if (!next || next === current.title) { title = current.title; return }
    try {
      const updated = await window.spadewick.rules.update({ id: current.id, title: next })
      current = { ...current, title: updated.title }; title = updated.title
      await loadPages()
    } catch (err) { toast(err.message, 'error', 5000); title = current.title }
  }

  // ---- pages -----------------------------------------------------------------------------------------------------------

  async function addPage(parentId = null) {
    await flush()
    try {
      const page = await window.spadewick.rules.create({ parentId, title: tr('rulesView.newPageTitle') })
      if (parentId) { collapsed.delete(parentId); collapsed = collapsed }
      await loadPages()
      await open(page.id)
      await tick()
      document.getElementById('rules-title')?.focus()
      document.getElementById('rules-title')?.select()
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  async function removePage() {
    const row = selectedRow; if (!row) return
    const below = pages.filter(p => p.parent_id === row.id).length
    if (!await askConfirm(below ? tr('rulesView.confirmDeleteBelow', { title: row.title, n: below }) : tr('rulesView.confirmDelete', { title: row.title }))) return
    const next = neighbourAfterRemoval(pages, row.id)
    clearTimeout(saveTimer); saveTimer = null; current = null
    try { await window.spadewick.rules.delete(row.id); await loadPages(); await open(next && pages.some(p => p.id === next) ? next : null) } catch (err) { toast(err.message, 'error', 5000) }
  }

  async function step(kind) {
    const t = targets[kind]; if (!t || !selectedId) return
    await flush()
    try {
      await window.spadewick.rules.move({ id: selectedId, parentId: t.parentId, index: t.index })
      if (t.parentId) { collapsed.delete(t.parentId); collapsed = collapsed }
      await loadPages()
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  function toggle(id) { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); collapsed = collapsed }

  function onTreeKey(e, row) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = rows.findIndex(r => r.page.id === row.page.id)
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) document.querySelector(`[data-page="${next.page.id}"]`)?.focus()
    } else if (e.key === 'ArrowRight' && row.hasChildren && !row.expanded) { e.preventDefault(); toggle(row.page.id) }
    else if (e.key === 'ArrowLeft' && row.hasChildren && row.expanded) { e.preventDefault(); toggle(row.page.id) }
    else if (e.key === 'ArrowLeft' && row.page.parent_id) { e.preventDefault(); document.querySelector(`[data-page="${row.page.parent_id}"]`)?.focus() }
  }

  // ---- import and export -----------------------------------------------------------------------------------------------

  const fileMenu = [
    { id: 'importFiles', label: tr('rulesView.importFiles') },
    { id: 'importFilesUnder', label: tr('rulesView.importFilesUnder') },
    { id: 'importFolder', label: tr('rulesView.importFolder') },
    { id: 'importFolderUnder', label: tr('rulesView.importFolderUnder') },
    { id: 'exportPage', label: tr('rulesView.exportPage') },
    { id: 'exportAll', label: tr('rulesView.exportAll') },
    { id: 'exportHtml', label: tr('rulesView.exportHtml') }
  ]
  $: fileItems = fileMenu.map(i => ({ ...i, disabled: (['importFilesUnder', 'importFolderUnder', 'exportPage'].includes(i.id) && !selectedId) || (['exportAll', 'exportHtml'].includes(i.id) && !pages.length) }))

  async function onFile({ detail: id }) {
    await flush()
    const api = window.spadewick.rules
    try {
      let r
      if (id === 'importFiles' || id === 'importFilesUnder') r = await api.importFiles({ parentId: id === 'importFilesUnder' ? selectedId : null })
      else if (id === 'importFolder' || id === 'importFolderUnder') r = await api.importFolder({ parentId: id === 'importFolderUnder' ? selectedId : null })
      else if (id === 'exportPage') r = await api.exportPage({ id: selectedId })
      else if (id === 'exportAll') r = await api.exportAll()
      else if (id === 'exportHtml') r = await api.exportHtml()
      if (!r || r.canceled) return
      if (id.startsWith('import')) {
        await loadPages(); await loadLibrary()
        if (selectedId) { collapsed.delete(selectedId); collapsed = collapsed }
        toast(tr('rulesView.imported', { n: r.pages }), 'info', 3500)
        if (r.ids?.[0]) await open(r.ids[0])
      } else toast(tr('rulesView.exported', { path: r.path }), 'info', 5000)
    } catch (err) { toast(err.message, 'error', 6000) }
  }

  // ---- formatting ------------------------------------------------------------------------------------------------------

  async function edit(next, from, to) {
    draft = next
    typed()
    await tick()
    ta?.focus()
    ta?.setSelectionRange(from, to)
  }
  function selection() { return { from: ta.selectionStart, to: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) } }

  /** Put marks round the selection (or round a word of the placeholder, selected so it can be typed over). */
  function wrap(before, after = before, placeholder = '') {
    if (!ta) return
    const { from, to, text } = selection()
    const inner = text || placeholder
    const next = ta.value.slice(0, from) + before + inner + after + ta.value.slice(to)
    edit(next, from + before.length, from + before.length + inner.length)
  }

  /** Begin every line of the selection with a mark; a line that has it already loses it. */
  function prefixLines(mark, numbered = false) {
    if (!ta) return
    const { from, to } = selection()
    const start = ta.value.lastIndexOf('\n', from - 1) + 1
    let end = ta.value.indexOf('\n', to); if (end < 0) end = ta.value.length
    const lines = ta.value.slice(start, end).split('\n')
    const marked = new RegExp(`^${numbered ? '\\d+\\. ' : mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    const all = lines.every(l => marked.test(l))
    const out = lines.map((l, i) => all ? l.replace(marked, '') : `${numbered ? `${i + 1}. ` : mark}${l.replace(/^#{1,6} /, mark.startsWith('#') ? '' : '$&')}`).join('\n')
    edit(ta.value.slice(0, start) + out + ta.value.slice(end), start, start + out.length)
  }

  function insertBlock(text) {
    if (!ta) return
    const { from, to } = selection()
    const lead = from > 0 && ta.value[from - 1] !== '\n' ? '\n\n' : ''
    const next = ta.value.slice(0, from) + lead + text + ta.value.slice(to)
    edit(next, from + lead.length + text.length, from + lead.length + text.length)
  }

  /** [words](https://): the address is selected, to be typed over */
  function link() {
    if (!ta) return
    const { from, to, text } = selection()
    const label = text || tr('rulesView.linkText')
    const start = from + label.length + 3
    edit(ta.value.slice(0, from) + `[${label}](https://)` + ta.value.slice(to), start, start + 8)
  }
  const table = () => insertBlock(`| ${tr('rulesView.tableName')} | ${tr('rulesView.tableValue')} |\n|---|---|\n|  |  |\n`)
  const code = () => insertBlock('```\n\n```\n')

  function onTextKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); wrap('**', '**', tr('rulesView.bold')) }
    else if (k === 'i') { e.preventDefault(); wrap('*', '*', tr('rulesView.italic')) }
    else if (k === 'k') { e.preventDefault(); link() }
  }

  async function imagePicked({ detail: id }) {
    pickingImage = false
    if (!id) return
    try {
      await loadLibrary()
      const asset = [...assetByName.values()].find(a => a.id === id)
      if (asset) insertBlock(`![${asset.original_name.replace(/\.[^.]+$/, '')}](asset:${asset.original_name})\n`)
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  function refPicked(kind, detail) {
    referring = false
    if (!ta) return
    const { text } = selection()
    if (kind === 'page') wrap('[', `](page:${detail.title})`, text || detail.title)
    else { const mark = detail.embed ? `![[${detail.name}]]` : `[[${detail.name}]]`; const { from, to } = selection(); edit(ta.value.slice(0, from) + mark + ta.value.slice(to), from + mark.length, from + mark.length) }
  }

  // ---- what the page reads like ------------------------------------------------------------------------------------------

  const pictures = new Map()           // key -> address of a picture, kept while the tab is open
  const lookUp = name => cards.find(c => c.name.toLowerCase() === name.toLowerCase() || (c.code && c.code.toLowerCase() === name.toLowerCase()))

  async function pictureOf(key, make) {
    if (!pictures.has(key)) pictures.set(key, make().catch(() => null))
    return pictures.get(key)
  }

  /** The parts of the page the Markdown only names are filled in: the project's pictures, cards, and pages that are not there are marked. */
  async function fill() {
    if (!preview) return
    for (const img of preview.querySelectorAll('img[data-rules-asset]:not([data-done])')) {
      img.dataset.done = '1'
      const asset = assetByName.get(img.dataset.rulesAsset.toLowerCase())
      if (!asset) { img.replaceWith(Object.assign(document.createElement('span'), { className: 'missing', textContent: img.alt || img.dataset.rulesAsset })); continue }
      pictureOf(`a:${asset.id}`, async () => { const p = await window.spadewick.assets.getPreview(asset.id); return URL.createObjectURL(new Blob([p.bytes], { type: p.mime })) })
        .then(url => { if (url) img.src = url; else img.replaceWith(Object.assign(document.createElement('span'), { className: 'missing', textContent: img.alt })) })
    }
    for (const fig of preview.querySelectorAll('figure[data-rules-card-embed]:not([data-done])')) {
      fig.dataset.done = '1'
      const card = lookUp(fig.dataset.rulesCardEmbed)
      if (!card) { fig.classList.add('missing'); continue }
      fig.tabIndex = 0; fig.setAttribute('role', 'button'); fig.dataset.cardId = card.id; fig.dataset.setId = card.setId
      pictureOf(`c:${card.id}`, async () => `data:image/png;base64,${await window.spadewick.templates.render({ cardId: card.id, width: 300 })}`)
        .then(url => { if (url) { const img = document.createElement('img'); img.src = url; img.alt = card.name; fig.prepend(img) } else fig.classList.add('missing') })
    }
    for (const a of preview.querySelectorAll('a[data-rules-card]:not([data-done])')) {
      a.dataset.done = '1'
      const card = lookUp(a.dataset.rulesCard)
      if (card) { a.dataset.cardId = card.id; a.dataset.setId = card.setId } else { a.classList.add('missing'); a.title = tr('rulesView.noSuchCard') }
    }
    for (const a of preview.querySelectorAll('a[data-rules-page]:not([data-done])')) {
      a.dataset.done = '1'
      if (!pageByTitle(pages, a.dataset.rulesPage)) { a.classList.add('missing'); a.title = tr('rulesView.noSuchPage') }
    }
  }
  afterUpdate(fill)

  async function onPreviewActivate(e) {
    const target = e.target.closest?.('[data-rules-link], [data-rules-page], [data-rules-anchor], [data-card-id]')
    if (!target) return
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (target.dataset.rulesLink) { try { await window.spadewick.rules.openLink(target.dataset.rulesLink) } catch (err) { toast(err.message, 'error', 4000) } }
    else if (target.dataset.rulesPage) { const p = pageByTitle(pages, target.dataset.rulesPage); if (p) await open(p.id); else toast(tr('rulesView.noSuchPage'), 'info', 3000) }
    else if (target.dataset.rulesAnchor) preview.querySelector(`#${CSS.escape(target.dataset.rulesAnchor)}`)?.scrollIntoView({ block: 'start' })
    else if (target.dataset.cardId) { await flush(); focusCard(target.dataset.setId, target.dataset.cardId); activeTab.set('cards') }
  }

  // ---- the application's own undo and redo --------------------------------------------------------------------------------

  const onUndo = e => { if (document.activeElement === ta) { e.preventDefault(); document.execCommand('undo') } }
  const onRedo = e => { if (document.activeElement === ta) { e.preventDefault(); document.execCommand('redo') } }
  async function onHistory() {
    await loadPages()
    if (selectedId && !pages.some(p => p.id === selectedId)) await open(null)
    else if (selectedId) { clearTimeout(saveTimer); saveTimer = null; const page = await window.spadewick.rules.get(selectedId); if (page) { current = page; draft = page.body; title = page.title } }
  }

  onMount(async () => {
    window.addEventListener('spadewick:undo', onUndo); window.addEventListener('spadewick:redo', onRedo)
    window.addEventListener('spadewick:history-applied', onHistory)
    await Promise.all([loadPages(), loadLibrary()])
    if (pages.length) await open(flatten(pages)[0].page.id)
  })
  onDestroy(() => {
    window.removeEventListener('spadewick:undo', onUndo); window.removeEventListener('spadewick:redo', onRedo)
    window.removeEventListener('spadewick:history-applied', onHistory)
    flush()
    for (const p of pictures.values()) p.then(url => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url) })
  })
</script>

<div class="rules">
  <nav class="pages" aria-label="{tr('rulesView.pagesLabel')}">
    <div class="bar">
      <button on:click={() => addPage(null)}>{tr('rulesView.newPage')}</button>
      <button on:click={() => addPage(selectedId)} disabled={!selectedId}>{tr('rulesView.newSubpage')}</button>
      <MenuButton label="{tr('rulesView.fileMenu')}" items={fileItems} on:select={onFile} />
    </div>
    {#if rows.length}
      <ul role="tree" aria-label="{tr('rulesView.pagesLabel')}">
        {#each rows as row (row.page.id)}
          <li role="none" style="padding-left:{row.depth * 16}px">
            <div class="row" class:active={row.page.id === selectedId}>
              {#if row.hasChildren}
                <button class="fold" aria-label="{row.expanded ? tr('rulesView.collapse', { title: row.page.title }) : tr('rulesView.expand', { title: row.page.title })}" aria-expanded={row.expanded} on:click={() => toggle(row.page.id)}>{row.expanded ? '▾' : '▸'}</button>
              {:else}<span class="fold gap" aria-hidden="true"></span>{/if}
              <button class="title" role="treeitem" aria-selected={row.page.id === selectedId} aria-level={row.depth + 1} aria-expanded={row.hasChildren ? row.expanded : undefined}
                data-page={row.page.id} on:click={() => open(row.page.id)} on:keydown={e => onTreeKey(e, row)}>{row.page.title}</button>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">{tr('rulesView.noPages')}</p>
    {/if}
  </nav>

  <section class="work" aria-label="{tr('rulesView.workLabel')}">
    {#if current}
      <header class="head">
        <label class="title-field">{tr('rulesView.titleLabel')}
          <input id="rules-title" class="field" bind:value={title} on:change={rename} on:keydown={e => e.key === 'Enter' && e.currentTarget.blur()} maxlength="120" />
        </label>
        <div class="steps" role="group" aria-label="{tr('rulesView.moveGroup')}">
          <button on:click={() => step('up')} disabled={!targets.up} aria-label="{tr('rulesView.moveUp')}" title="{tr('rulesView.moveUp')}">↑</button>
          <button on:click={() => step('down')} disabled={!targets.down} aria-label="{tr('rulesView.moveDown')}" title="{tr('rulesView.moveDown')}">↓</button>
          <button on:click={() => step('indent')} disabled={!targets.indent} aria-label="{tr('rulesView.indent')}" title="{tr('rulesView.indent')}">→</button>
          <button on:click={() => step('outdent')} disabled={!targets.outdent} aria-label="{tr('rulesView.outdent')}" title="{tr('rulesView.outdent')}">←</button>
          <button class="danger" on:click={removePage}>{tr('rulesView.delete')}</button>
        </div>
        <div class="modes" role="group" aria-label="{tr('rulesView.modeGroup')}">
          {#each ['write', 'split', 'read'] as m}
            <button class:on={mode === m} aria-pressed={mode === m} on:click={() => setMode(m)}>{tr(`rulesView.modes.${m}`)}</button>
          {/each}
        </div>
        <span class="status" role="status">{tr(`rulesView.saves.${saveState}`)}</span>
      </header>

      {#if mode !== 'read'}
        <div class="format" role="toolbar" aria-label="{tr('rulesView.formatLabel')}">
          <button on:click={() => wrap('**', '**', tr('rulesView.bold'))} title="{tr('rulesView.boldHint')}" aria-label="{tr('rulesView.bold')}"><b>B</b></button>
          <button on:click={() => wrap('*', '*', tr('rulesView.italic'))} title="{tr('rulesView.italicHint')}" aria-label="{tr('rulesView.italic')}"><i>I</i></button>
          <button on:click={() => wrap('~~', '~~', tr('rulesView.strike'))} aria-label="{tr('rulesView.strike')}"><s>S</s></button>
          <span class="sep"></span>
          <button on:click={() => prefixLines('# ')} aria-label="{tr('rulesView.heading1')}">H1</button>
          <button on:click={() => prefixLines('## ')} aria-label="{tr('rulesView.heading2')}">H2</button>
          <button on:click={() => prefixLines('### ')} aria-label="{tr('rulesView.heading3')}">H3</button>
          <span class="sep"></span>
          <button on:click={() => prefixLines('- ')} aria-label="{tr('rulesView.bullets')}">• {tr('rulesView.listShort')}</button>
          <button on:click={() => prefixLines('', true)} aria-label="{tr('rulesView.numbers')}">1. {tr('rulesView.listShort')}</button>
          <button on:click={() => prefixLines('> ')} aria-label="{tr('rulesView.quote')}">❝</button>
          <button on:click={table} aria-label="{tr('rulesView.table')}">{tr('rulesView.tableShort')}</button>
          <button on:click={code} aria-label="{tr('rulesView.codeBlock')}">&lt;/&gt;</button>
          <button on:click={() => insertBlock('---\n')} aria-label="{tr('rulesView.rule')}">―</button>
          <span class="sep"></span>
          <button on:click={link} title="{tr('rulesView.linkHint')}">{tr('rulesView.link')}</button>
          <button on:click={() => (pickingImage = true)}>{tr('rulesView.image')}</button>
          <button on:click={() => (referring = true)}>{tr('rulesView.reference')}</button>
        </div>
      {/if}

      <div class="panes" class:single={mode !== 'split'}>
        {#if mode !== 'read'}
          <textarea bind:this={ta} class="text" bind:value={draft} on:input={typed} on:keydown={onTextKey} on:blur={flush} spellcheck="true"
            aria-label="{tr('rulesView.textLabel', { title: current.title })}" placeholder="{tr('rulesView.placeholder')}"></textarea>
        {/if}
        {#if mode !== 'write'}
          <!-- the page as it reads: made by our own reader, which escapes all it is given -->
          <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
          <article class="md" bind:this={preview} on:click={onPreviewActivate} on:keydown={onPreviewActivate} aria-label="{tr('rulesView.previewLabel')}" tabindex="0">
            {#if draft.trim()}{@html rendered.html}{:else}<p class="none">{tr('rulesView.emptyPage')}</p>{/if}
          </article>
        {/if}
      </div>
    {:else}
      <div class="empty">
        <p>{pages.length ? tr('rulesView.pickPage') : tr('rulesView.emptyHint')}</p>
        {#if !pages.length}<button class="primary" on:click={() => addPage(null)}>{tr('rulesView.newPage')}</button>{/if}
      </div>
    {/if}
  </section>
</div>

{#if pickingImage}<AssetPicker current={null} on:pick={imagePicked} on:close={() => (pickingImage = false)} />{/if}
{#if referring}
  <InsertRefDialog {pages} {cards} hide={selectedId} on:page={e => refPicked('page', e.detail)} on:card={e => refPicked('card', e.detail)} on:close={() => (referring = false)} />
{/if}

<style>
  .rules { flex: 1; display: flex; min-height: 0; background: var(--color-bg); }
  .pages { width: 250px; flex: none; display: flex; flex-direction: column; border-right: 1px solid var(--color-border); background: var(--color-surface); min-height: 0; }
  .pages .bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border-bottom: 1px solid var(--color-border); }
  .pages .bar button { font-size: 11px; padding: 3px 8px; }
  .pages ul { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1; }
  .row { display: flex; align-items: center; border-radius: var(--radius-sm); }
  .row.active { background: color-mix(in srgb, var(--color-accent) 18%, transparent); }
  .fold { width: 22px; flex: none; background: none; border: 0; padding: 0; color: var(--color-text-dim); cursor: pointer; }
  .fold.gap { display: inline-block; height: 1px; }
  .title { flex: 1; text-align: left; background: none; border: 0; padding: 5px 6px; font-size: 13px; cursor: pointer; border-radius: var(--radius-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.active .title { font-weight: 700; }
  .none { color: var(--color-text-dim); font-style: italic; font-size: 12px; padding: 10px; margin: 0; }

  .work { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 16px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
  .title-field { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--color-text-dim); flex: 1 1 220px; }
  .title-field input { font-size: 15px; font-weight: 600; }
  .steps, .modes { display: flex; gap: 4px; }
  .modes button.on { background: var(--color-accent-text); color: var(--color-bg, #fff); }
  .status { font-size: 11px; color: var(--color-text-dim); min-width: 70px; text-align: right; }
  button:disabled { opacity: .45; }
  .format { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-2); }
  .format button { font-size: 12px; padding: 3px 9px; min-width: 30px; }
  .format .sep { width: 1px; background: var(--color-border); margin: 0 4px; }

  .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
  .panes.single { grid-template-columns: 1fr; }
  .text { border: 0; border-right: 1px solid var(--color-border); border-radius: 0; resize: none; padding: 14px 16px; font: 13px/1.6 ui-monospace, Consolas, monospace; background: var(--color-bg); color: var(--color-text); min-height: 0; outline-offset: -2px; }
  .panes.single .text { border-right: 0; }
  .md { overflow: auto; padding: 14px 24px 40px; min-height: 0; line-height: 1.6; font-size: 14px; }
  .md :global(h1) { font-size: 26px; margin: 1.2em 0 .5em; } .md :global(h2) { font-size: 21px; margin: 1.2em 0 .5em; } .md :global(h3) { font-size: 17px; margin: 1.1em 0 .4em; }
  .md :global(h4), .md :global(h5), .md :global(h6) { margin: 1em 0 .4em; font-size: 14px; }
  .md :global(p) { margin: .6em 0; } .md :global(ul), .md :global(ol) { padding-left: 1.6em; margin: .5em 0; }
  .md :global(li.task) { list-style: none; margin-left: -1.2em; }
  .md :global(blockquote) { margin: .8em 0; padding: .2em 1em; border-left: 4px solid var(--color-control-border); color: var(--color-text-dim); }
  .md :global(code) { background: var(--color-surface-2); padding: 0 .3em; border-radius: 4px; font-size: .92em; }
  .md :global(pre) { background: var(--color-surface-2); padding: 10px 12px; border-radius: var(--radius); overflow: auto; } .md :global(pre code) { background: none; padding: 0; }
  .md :global(table) { border-collapse: collapse; margin: .8em 0; } .md :global(th), .md :global(td) { border: 1px solid var(--color-control-border); padding: 4px 10px; } .md :global(th) { background: var(--color-surface-2); }
  .md :global(.al-center) { text-align: center; } .md :global(.al-right) { text-align: right; }
  .md :global(hr) { border: 0; border-top: 1px solid var(--color-border); margin: 1.4em 0; }
  .md :global(a.ext), .md :global(a.int) { color: var(--color-accent-text); text-decoration: underline; cursor: pointer; }
  .md :global(a.card-ref) { font-weight: 600; background: color-mix(in srgb, var(--color-accent) 16%, transparent); padding: 0 .35em; border-radius: var(--radius-sm); cursor: pointer; text-decoration: none; color: inherit; }
  .md :global(.missing) { color: var(--color-danger-text); text-decoration: line-through dotted; }
  .md :global(.rules-img) { max-width: 100%; border-radius: var(--radius-sm); }
  .md :global(figure.card-embed) { display: inline-block; margin: .4em 1em .4em 0; text-align: center; cursor: pointer; } .md :global(figure.card-embed img) { width: 190px; border-radius: var(--radius); display: block; }
  .md :global(figcaption) { font-size: 11px; color: var(--color-text-dim); }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--color-text-dim); }
  .empty p { max-width: 420px; text-align: center; margin: 0; }
</style>
