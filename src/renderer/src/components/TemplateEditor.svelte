<script>
  import { canvasChange } from '../../../shared/templateCanvas.js'
  import { tr } from '../../../shared/i18n.js'
  import { askText, askConfirm } from '../stores/prompt.js'
  import { onMount, onDestroy } from 'svelte'
  import { templates, activeSetId, project, loadSet, refreshProject, refreshTemplates } from '../stores/project.js'
  import { toast, openDialog, libraryRequest, showMeRequest, sendCanvasCommand } from '../stores/ui.js'
  import { layout, setLayout, LIMITS } from '../stores/layout.js'
  import CanvasEditor from './CanvasEditor.svelte'
  import Modal from './Modal.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import MenuButton from './MenuButton.svelte'
  import NewTemplateDialog from './NewTemplateDialog.svelte'
  import SvgImportDialog from './SvgImportDialog.svelte'
  import TemplateBleedDialog from './TemplateBleedDialog.svelte'
  import { highlightSvg } from '../lib/svgHighlight.js'

  let selectedTemplate = null
  let svgSource = ''
  let dirty = false
  let hlEl, sourceEl
  $: highlighted = highlightSvg(svgSource) + '\n'   // trailing newline keeps the last line's height identical in both layers
  const syncScroll = () => { if (hlEl && sourceEl) { hlEl.scrollTop = sourceEl.scrollTop; hlEl.scrollLeft = sourceEl.scrollLeft } }

  // The source is shown on demand, in a dialog (PRD §8.7.1)
  let sourceOpen = false
  let sourceAtOpen = ''
  let selectedElementId = null   // reported by the canvas editor, so the dialog can open at that element

  /** null when the source parses as XML, else { line, error } read from the browser's parser message. */
  function checkSvg(src) {
    const doc = new DOMParser().parseFromString(src ?? '', 'image/svg+xml')
    const bad = doc.querySelector('parsererror')
    if (!bad) return null
    const text = bad.textContent.replace(/\s+/g, ' ')
    const m = /error on line (\d+) at column \d+:\s*(.*?)(?:\s*Below is a rendering.*)?$/.exec(text)
    return m ? { line: Number(m[1]), error: m[2].trim() } : { line: null, error: text.trim().slice(0, 160) }
  }
  $: sourceProblem = sourceOpen ? checkSvg(svgSource) : null
  // the canvas is the card's size, fixed when the template was made: the source can put things past it but not change it
  $: canvasProblem = sourceOpen && selectedTemplate && !sourceProblem ? canvasChange(savedCanvas, svgSource) : null
  $: savedCanvas = selectedTemplate?.svg_source ?? ''

  function openSource() {
    sourceAtOpen = svgSource
    sourceOpen = true
  }
  function closeSource() {
    recordEdit()
    sourceOpen = false
  }
  /** Put the source back as it was when the dialog opened: one undo step, or none if nothing was recorded. */
  function revertSource() {
    svgSource = sourceAtOpen
    recordEdit()
    dirty = svgSource !== savedSource
  }

  const LINE_HEIGHT = 18   // 12px font × 1.5, as in the stylesheet below
  const escapeRegExp = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  /** On opening, put the caret at the start of the selected element's tag and scroll it into view (PRD §8.7.1). */
  function placeCaret(node) {
    sourceEl = node
    if (!selectedElementId) return {}
    const at = svgSource.search(new RegExp(`data-(?:spadewick|cardexy)-id\\s*=\\s*["']${escapeRegExp(selectedElementId)}["']`))
    if (at < 0) return {}
    const tagStart = svgSource.lastIndexOf('<', at)
    node.setSelectionRange(tagStart, tagStart)
    node.scrollTop = Math.max(0, svgSource.slice(0, tagStart).split('\n').length * LINE_HEIGHT - 120)
    syncScroll()
    return {}
  }

  // The templates listed are those of the active set's card size (PRD §10.6): the store is filled when a set is chosen
  let setSize = null   // { id, mmW, mmH } of the active set
  $: loadSetSize($activeSetId)
  async function loadSetSize(id) { setSize = id ? await window.spadewick.cardSize.get(id) : null }
  const sizeLabel = d => (d ? (d.id && d.id !== 'custom' ? tr(`cardSizes.${d.id}`) : `${d.mmW} × ${d.mmH} ${tr('common.mm')}`) : '')

  // A template that is no longer in the list (another set was chosen, it was deleted) cannot stay open
  $: if (selectedTemplate && !$templates.some(t => t.id === selectedTemplate.id)) { selectedTemplate = null; dirty = false; svgSource = ''; selectedElementId = null }

  onMount(async () => {
    await refreshTemplates()
  })

  /** The library, a package or a menu action changed the templates: reload the list, and open the new one. */
  async function onTemplatesChanged(e) {
    await refreshTemplates()
    const id = e.detail?.selectId
    if (id && $templates.some(t => t.id === id)) { dirty = false; await selectTemplate($templates.find(t => t.id === id)) }
    else if (selectedTemplate && !dirty) { const t = $templates.find(x => x.id === selectedTemplate.id); if (t) await selectTemplate(t) }
  }

  // Local undo/redo for the template being edited (canvas moves, property changes, typing).
  // Undo in this tab steps through these edits first, so it never reaches into unrelated project data.
  let undoStack = []
  let redoStack = []
  let committed = ''      // last state recorded on the stack
  let savedSource = ''    // what is stored in the project database
  let typingTimer = null
  const HISTORY_LIMIT = 200

  function resetHistory(source) {
    undoStack = []; redoStack = []; committed = source; savedSource = source
    clearTimeout(typingTimer)
  }

  /** Record the edit that just happened (called right away for canvas edits, debounced for typing). */
  function recordEdit() {
    clearTimeout(typingTimer)
    if (svgSource === committed) return
    undoStack = [...undoStack, committed].slice(-HISTORY_LIMIT)
    redoStack = []
    committed = svgSource
    dirty = svgSource !== savedSource
  }

  function onTyping() {
    dirty = true
    clearTimeout(typingTimer)
    typingTimer = setTimeout(recordEdit, 500)
  }

  function stepHistory(direction) {
    recordEdit()
    const from = direction === 'undo' ? undoStack : redoStack
    if (!from.length) return false
    const to = direction === 'undo' ? redoStack : undoStack
    const next = from[from.length - 1]
    if (direction === 'undo') { undoStack = undoStack.slice(0, -1); redoStack = [...to, svgSource] }
    else { redoStack = redoStack.slice(0, -1); undoStack = [...to, svgSource] }
    svgSource = next
    committed = next
    dirty = svgSource !== savedSource
    return true
  }

  // App-level Edit → Undo/Redo asks the visible editor first; preventDefault means "handled here".
  function onAppHistory(e) {
    if (!selectedTemplate) return
    if (stepHistory(e.type === 'spadewick:undo' ? 'undo' : 'redo')) e.preventDefault()
  }

  // A project-level undo/redo may have changed the stored template; refresh the editor if it has no pending edits
  async function onProjectHistory() {
    if (!selectedTemplate || dirty) return
    const full = await window.spadewick.templates.get(selectedTemplate.id)
    if (!full) return
    selectedTemplate = full
    svgSource = full.svg_source
    resetHistory(svgSource)
  }

  onMount(() => {
    window.addEventListener('spadewick:templates-changed', onTemplatesChanged)
    window.addEventListener('spadewick:history-applied', onProjectHistory)
    window.addEventListener('spadewick:undo', onAppHistory)
    window.addEventListener('spadewick:redo', onAppHistory)
  })
  onDestroy(() => {
    window.removeEventListener('spadewick:templates-changed', onTemplatesChanged)
    window.removeEventListener('spadewick:history-applied', onProjectHistory)
    window.removeEventListener('spadewick:undo', onAppHistory)
    window.removeEventListener('spadewick:redo', onAppHistory)
    clearTimeout(typingTimer)
  })

  async function selectTemplate(t) {
    if (dirty && !await askConfirm(tr('templateEditor.confirmDiscard'))) return
    const full = await window.spadewick.templates.get(t.id)
    selectedTemplate = full
    svgSource = full.svg_source
    dirty = false
    selectedElementId = null
    resetHistory(svgSource)
  }

  async function saveTemplate() {
    if (!selectedTemplate) return
    recordEdit()
    try { await window.spadewick.templates.update({ id: selectedTemplate.id, svgSource }) } catch (err) { toast(err.message, 'error', 6000); return }
    savedSource = svgSource
    dirty = false
    window.dispatchEvent(new Event('spadewick:rerender'))
  }

  // ---- New template: its card size is chosen here and then locked (PRD §10.6) -------------------------------

  let newOpen = false
  const openNew = () => { if (!$activeSetId) { toast(tr('toasts.selectASetFirst'), 'info', 2500); return } newOpen = true }

  async function createTemplate({ detail }) {
    newOpen = false
    const px = await window.spadewick.cardSize.resolve(detail)
    const t = await window.spadewick.templates.create({ name: detail.name, svgSource: defaultSvg(px), cardSize: detail.cardSize, cardMmW: detail.cardMmW, cardMmH: detail.cardMmH })
    // The first template of the right size becomes the active set's default, so previews and exports work straight away
    const set = $project?.sets?.find(x => x.id === $activeSetId)
    const fits = !!set && Math.abs(px.mmW - setSize.mmW) < 0.05 && Math.abs(px.mmH - setSize.mmH) < 0.05
    if (fits && !set.default_template_id) {
      const updated = await window.spadewick.sets.update({ id: set.id, defaultTemplateId: t.id })
      project.update(p => ({ ...p, sets: p.sets.map(x => x.id === updated.id ? updated : x) }))
    }
    await refreshTemplates()
    if (fits) await selectTemplate(t)
    else toast(tr('templateEditor.madeForOtherSize', { name: t.name, size: sizeLabel(px) }), 'info', 6000)
  }

  function openLibrary(intent, templateId = null) {
    libraryRequest.set({ intent, templateId })
    openDialog.set('template-library')
  }

  // ---- Show me, from the print preflight (PRD §17.7): this template, this element, a card that shows the problem ----
  let focus = null
  let handledShowMe = 0
  async function handleShowMe(req) {
    if (!req || req.n === handledShowMe) return
    handledShowMe = req.n
    showMeRequest.set(null)                    // handled once: coming back to this tab later does not repeat it
    await refreshTemplates()
    const t = $templates.find(x => x.id === req.templateId)
    if (!t) { toast(tr('templateEditor.showMeNotListed'), 'info', 5000); return }
    if (selectedTemplate?.id !== t.id) await selectTemplate(t)
    if (selectedTemplate?.id === t.id) focus = { id: req.elementId, cardId: req.cardId, n: req.n }
  }
  $: handleShowMe($showMeRequest)

  // ---- The bleed of the open template (PRD §17.4) ----
  let bleedOpen = false
  async function bleedSaved() {
    bleedOpen = false
    const full = await window.spadewick.templates.get(selectedTemplate.id)
    selectedTemplate = full
    if (!dirty) { svgSource = full.svg_source; resetHistory(svgSource) }
    await refreshTemplates()
    window.dispatchEvent(new Event('spadewick:rerender'))
  }
  const templateSize = () => (selectedTemplate?.card_size ? { mmW: selectedTemplate.card_mm_w ?? setSize?.mmW, mmH: selectedTemplate.card_mm_h ?? setSize?.mmH } : setSize)

  // ---- Import SVG and Re-import design (PRD §19) ----
  let svgImport = null   // { paths, templateId } while the dialog is open
  async function pickDesigns(templateId) {
    if (!$activeSetId) { toast(tr('toasts.selectASetFirst'), 'info', 2500); return }
    const r = await window.spadewick.svgImport.pick()
    if (!r.paths.length) return
    svgImport = { paths: templateId ? r.paths.slice(0, 1) : r.paths, templateId }
  }
  async function svgDone(e) {
    const results = e.detail.results
    svgImport = null
    await refreshProject()
    if ($activeSetId) await loadSet($activeSetId)
    dirty = false
    window.dispatchEvent(new CustomEvent('spadewick:templates-changed', { detail: { selectId: results[results.length - 1]?.template.id } }))
    window.dispatchEvent(new Event('spadewick:history-applied'))
    toast(tr('svgImport.done', { n: results.length, fields: results.reduce((n, r) => n + r.newFields.length, 0) }), 'success', 5000)
  }

  async function renameTemplate() {
    const t = selectedTemplate
    const name = await askText(tr('templateEditor.promptRename'), t.name)
    if (!name?.trim() || name.trim() === t.name) return
    await window.spadewick.templates.update({ id: t.id, name: name.trim() })
    selectedTemplate = { ...selectedTemplate, name: name.trim() }
    await refreshTemplates()
  }
  async function duplicateTemplate() {
    const copy = await window.spadewick.templateLibrary.duplicate(selectedTemplate.id)
    await refreshTemplates()
    await selectTemplate($templates.find(x => x.id === copy.id) ?? copy)
  }
  async function deleteTemplate() {
    const t = selectedTemplate
    const info = (await window.spadewick.templateLibrary.projectTemplates()).find(x => x.id === t.id)
    if (!await askConfirm(tr('templateEditor.confirmDelete', { name: t.name, cards: info?.usedByCards ?? 0 }))) return
    await window.spadewick.templates.delete(t.id)
    dirty = false; selectedTemplate = null; svgSource = ''
    await refreshProject()
    if ($activeSetId) await loadSet($activeSetId)
    window.dispatchEvent(new Event('spadewick:history-applied'))
  }

  let origin = null   // where the open template was copied from, for Update and Reset
  $: origin = (() => { try { return selectedTemplate?.origin ? JSON.parse(selectedTemplate.origin) : null } catch { return null } })()
  $: menuItems = selectedTemplate ? [
    { id: 'rename', label: tr('templateEditor.menuRename') },
    { id: 'duplicate', label: tr('templateEditor.menuDuplicate') },
    { id: 'save', label: tr('templateEditor.menuSaveToLibrary') },
    { id: 'export', label: tr('templateEditor.menuExport') },
    { id: 'bleed', label: tr('templateEditor.menuBleed') },
    { id: 'layers', label: tr('templateEditor.menuLayers') },
    ...(origin?.source === 'svg-import' ? [{ id: 'reimport', label: tr('templateEditor.menuReimport') }] : []),
    ...(origin?.source === 'library' && origin.role !== 'parent' ? [
      { id: 'update', label: tr('templateEditor.menuUpdate') },
      { id: 'reset', label: tr('templateEditor.menuReset') }
    ] : []),
    { id: 'delete', label: tr('templateEditor.menuDelete'), danger: true }
  ] : []

  async function onMenu(e) {
    const id = e.detail
    if (dirty && ['save', 'export', 'update', 'reset', 'duplicate', 'reimport'].includes(id)) await saveTemplate()   // these use what is stored
    if (id === 'rename') await renameTemplate()
    else if (id === 'duplicate') await duplicateTemplate()
    else if (id === 'delete') await deleteTemplate()
    else if (id === 'reimport') await pickDesigns(selectedTemplate.id)
    else if (id === 'bleed') bleedOpen = true
    else if (id === 'layers') sendCanvasCommand('layerize')
    else openLibrary(id, selectedTemplate.id)
  }

  // The list as a tree: a shared frame (a parent) with the templates that fill its slots (its children) under it, so the link between
  // two entries is visible. A child whose parent is not in the list stands on its own.
  $: tree = (() => {
    const byParent = new Map()
    const ids = new Set($templates.map(t => t.id))
    for (const t of $templates) if (t.parent_id && ids.has(t.parent_id)) byParent.set(t.parent_id, [...(byParent.get(t.parent_id) ?? []), t])
    const out = []
    for (const t of $templates.filter(t => !t.parent_id || !ids.has(t.parent_id))) {
      const kids = byParent.get(t.id) ?? []
      out.push({ t, depth: 0, children: kids.length })
      kids.forEach((k, i) => out.push({ t: k, depth: 1, last: i === kids.length - 1 }))
    }
    return out
  })()

  function defaultSvg({ widthPx: w, heightPx: h }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="12" fill="#1a1a2e" />
  <text x="${w / 2}" y="60" text-anchor="middle" fill="white" font-size="28" font-weight="bold">{{name}}</text>
  <text x="${w / 2}" y="${h - 50}" text-anchor="middle" fill="#aaa" font-size="16">{{type}}</text>
</svg>`
  }
</script>

<div class="template-editor">
  {#if $layout.templateListOpen}
    <div class="template-list" style="width:{$layout.templateList}px">
      <div class="list-header">
        <button class="fold" aria-expanded="true" aria-label="{tr('templateEditor.hideList')}" title="{tr('templateEditor.hideList')}" on:click={() => setLayout('templateListOpen', false)}>«</button>
        <span class="list-title">{tr('templateEditor.templates')}</span>
        <button on:click={openNew} title="{tr('templateEditor.newTemplate')}" aria-label="{tr('templateEditor.newTemplate')}">+</button>
      </div>
      {#if setSize}<p class="list-size">{tr('templateEditor.listFor', { size: sizeLabel(setSize) })}</p>{/if}
      <ul aria-label="{tr('templateEditor.templates')}">
        {#each tree as node (node.t.id)}
          <li class:child={node.depth > 0} class:last={node.last}>
            <button class="tpl" class:active={selectedTemplate?.id === node.t.id} aria-current={selectedTemplate?.id === node.t.id ? 'true' : undefined} on:click={() => selectTemplate(node.t)}>
              {node.t.name}
              {#if node.depth > 0}<span class="child-badge" title="{tr('templateEditor.childTemplate2')}" aria-label="{tr('templateEditor.childTemplate')}">{tr('templateEditor.childTag')}</span>
              {:else if node.children}<span class="child-badge frame" title="{tr('templateEditor.frameTitle')}" aria-label="{tr('templateEditor.frameLabel', { n: node.children })}">{tr('templateEditor.frameTag')}</span>{/if}
              {#if node.t.back_of_sets > 0 || node.t.back_of_cards > 0}<span class="child-badge back" title="{tr('templateEditor.backTitle')}" aria-label="{tr('templateEditor.backLabel')}">{tr('templateEditor.backTag')}</span>{/if}
            </button>
          </li>
        {/each}
        {#if !$templates.length}<li class="empty">{$activeSetId ? tr('templateEditor.noneOfThisSize') : tr('templateEditor.pickASet')}</li>{/if}
      </ul>
      <div class="list-foot">
        <button on:click={() => openLibrary('browse')} disabled={!$activeSetId}>{tr('templateEditor.library')}</button>
        <button on:click={() => openLibrary('import')} disabled={!$activeSetId}>{tr('templateEditor.importPackage')}</button>
        <button on:click={() => pickDesigns(null)} disabled={!$activeSetId}>{tr('templateEditor.importSvg')}</button>
      </div>
    </div>
    <ResizeHandle axis="x" grow={1} min={LIMITS.templateList.min} max={LIMITS.templateList.max} reset={LIMITS.templateList.reset}
      value={$layout.templateList} label="{tr('resize.templateList')}" on:change={e => setLayout('templateList', e.detail)} />
  {:else}
    <div class="template-rail">
      <button class="fold" aria-expanded="false" aria-label="{tr('templateEditor.showList')}" title="{tr('templateEditor.showList')}" on:click={() => setLayout('templateListOpen', true)}>»</button>
    </div>
  {/if}

  <div class="editor-area">
    {#if selectedTemplate}
      <div class="editor-toolbar">
        <strong>{selectedTemplate.name}</strong>
        <span class="size-badge" title="{tr('templateEditor.sizeLocked')}">{sizeLabel(selectedTemplate.card_size ? { id: selectedTemplate.card_size, mmW: selectedTemplate.card_mm_w, mmH: selectedTemplate.card_mm_h } : setSize)} 🔒</span>
        {#if dirty}<span class="unsaved" role="status">{tr('templateEditor.unsavedChanges')}</span>{/if}
        <span class="spacer" />
        <button on:click={() => stepHistory('undo')} disabled={!undoStack.length && svgSource === committed} title="{tr('templateEditor.undoThisTemplate')}" aria-label="{tr('templateEditor.undo')}">↶</button>
        <button on:click={() => stepHistory('redo')} disabled={!redoStack.length} title="{tr('templateEditor.redoThisTemplate')}" aria-label="{tr('templateEditor.redo')}">↷</button>
        <button class="view-source" on:click={openSource} title="{tr('templateEditor.viewSourceTitle')}"><span aria-hidden="true">&lt;/&gt;</span> {tr('templateEditor.viewSource')}</button>
        <MenuButton label="{tr('templateEditor.templateMenu')}" items={menuItems} on:select={onMenu} />
        <button on:click={saveTemplate} disabled={!dirty || !!canvasProblem} class:dirty>{tr('templateEditor.save')}</button>
      </div>
      <div class="svg-source-pane">
        <CanvasEditor bind:svgSource templateId={selectedTemplate.id} {focus} bleedMm={selectedTemplate.bleed_mm ?? 0} bleedMode={selectedTemplate.bleed_mode ?? 'extend'} on:change={recordEdit} on:select={e => (selectedElementId = e.detail.id)} />
      </div>
    {:else}
      <div class="hint-center">{tr('templateEditor.selectATemplateToEdit')}</div>
    {/if}
  </div>
</div>

{#if newOpen}
  <NewTemplateDialog initial={{ cardSize: setSize?.id ?? 'poker', cardMmW: setSize?.mmW ?? 63.5, cardMmH: setSize?.mmH ?? 88.9 }}
    on:create={createTemplate} on:close={() => (newOpen = false)} on:library={() => { newOpen = false; openLibrary('browse') }} />
{/if}

{#if bleedOpen && selectedTemplate}
  <TemplateBleedDialog template={selectedTemplate} cardSize={templateSize()} {dirty} on:saved={bleedSaved} on:close={() => (bleedOpen = false)} />
{/if}

{#if svgImport}
  <SvgImportDialog paths={svgImport.paths} templateId={svgImport.templateId} setId={$activeSetId} setName={$project?.sets?.find(x => x.id === $activeSetId)?.name ?? ''} {setSize}
    on:done={svgDone} on:close={() => (svgImport = null)} />
{/if}

{#if sourceOpen}
  <Modal title="{tr('templateEditor.sourceDialogTitle', { name: selectedTemplate?.name ?? '' })}" width={920} on:close={closeSource}>
    {#if canvasProblem}
      <div class="source-error" role="alert">{tr('errors.templateCanvasLocked', canvasProblem)}</div>
    {/if}
    {#if sourceProblem}
      <div class="source-error" role="alert">{sourceProblem.line ? tr('templateEditor.sourceInvalidLine', { line: sourceProblem.line, error: sourceProblem.error }) : tr('templateEditor.sourceInvalid', { error: sourceProblem.error })}</div>
    {/if}
    <div class="code-editor">
      <pre class="hl" aria-hidden="true" bind:this={hlEl}>{@html highlighted}</pre>
      <textarea
        bind:value={svgSource}
        use:placeCaret
        on:input={onTyping}
        on:scroll={syncScroll}
        spellcheck="false"
        wrap="off"
        class="svg-source"
        aria-label="{tr('templateEditor.svgSource2')}"
        placeholder="{tr('templateEditor.svgSource')}"
      />
    </div>
    <div slot="footer" class="source-foot">
      <button on:click={revertSource} title="{tr('templateEditor.revertTitle')}">{tr('templateEditor.revert')}</button>
      <button class="primary" on:click={closeSource}>{tr('common.done')}</button>
    </div>
  </Modal>
{/if}

<style>
  .template-editor {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .template-list {
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    min-width: 0;
  }

  .template-rail { flex: none; width: 32px; display: flex; flex-direction: column; align-items: center; padding-top: 6px; background: var(--color-surface); border-right: 1px solid var(--color-border); }
  .fold { padding: 1px 6px; }
  .list-title { flex: 1; }
  .list-size { padding: 4px 10px; font-size: 11px; color: var(--color-text-dim); border-bottom: 1px solid var(--color-border); }
  .list-foot { display: flex; flex-direction: column; gap: 4px; padding: 6px; border-top: 1px solid var(--color-border); }
  .empty { padding: 8px 10px; font-size: 12px; font-style: italic; color: var(--color-text-dim); }
  .size-badge { font-size: 11px; color: var(--color-text-dim); border: 1px solid var(--color-border); border-radius: 3px; padding: 0 6px; }

  .list-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
    font-weight: 600;
    font-size: 12px;
  }

  ul { list-style: none; flex: 1; overflow-y: auto; }
  .tpl {
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    border-radius: 0;
    color: inherit;
  }
  .tpl:hover { background: var(--color-surface-2); }
  .tpl.active { background: color-mix(in srgb, var(--color-accent) 20%, transparent); font-weight: 700; box-shadow: inset 4px 0 0 var(--color-accent-text); }
  .child-badge { font-size: 10px; color: var(--color-text-dim); margin-left: auto; border: 1px solid var(--color-border); border-radius: 999px; padding: 0 6px; }
  .child-badge.frame { color: var(--color-accent-text); }
  .child-badge + .child-badge { margin-left: 4px; }
  .child-badge.back { color: var(--color-accent-text); }
  /* the children hang off their frame on a line */
  li.child { position: relative; padding-left: 14px; }
  li.child::before { content: ''; position: absolute; left: 16px; top: 0; bottom: 0; width: 1px; background: var(--color-control-border); }
  li.child.last::before { bottom: 50%; }
  li.child::after { content: ''; position: absolute; left: 16px; top: 50%; width: 10px; height: 1px; background: var(--color-control-border); }
  li.child .tpl { padding-left: 28px; }

  .editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    font-size: 12px;
    gap: 8px;
  }

  .spacer { flex: 1; }
  .unsaved { font-size: 11px; color: var(--color-accent-text); font-weight: 700; }

  /* button.dirty gets the main-action look from the global styles */

  .svg-source-pane {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* The textarea is transparent and sits exactly over a highlighted copy of its text */
  .code-editor { position: relative; height: min(60vh, 560px); min-height: 240px; border: 1px solid var(--color-border); background: var(--color-bg); }
  .source-error { padding: 4px 8px; font-size: 11px; background: color-mix(in srgb, var(--color-danger) 25%, transparent); }
  .source-foot { display: flex; gap: 8px; margin-left: auto; }
  .hl, .svg-source {
    position: absolute; inset: 0; margin: 0; padding: 10px;
    font-family: var(--font-mono); font-size: 12px; line-height: 1.5; tab-size: 2;
    white-space: pre; overflow: auto; border: none; border-radius: 0; box-sizing: border-box;
  }
  .hl { color: var(--color-text); pointer-events: none; }
  .svg-source { resize: none; background: transparent; color: transparent; caret-color: var(--color-text); outline: none; }
  .svg-source::placeholder { color: var(--color-text-dim); }
  .svg-source:focus-visible { outline: 2px solid var(--color-accent-text); outline-offset: -2px; }
  .hl :global(.hl-tag) { color: var(--syn-tag); }
  .hl :global(.hl-attr) { color: var(--syn-attr); }
  .hl :global(.hl-string) { color: var(--syn-string); }
  .hl :global(.hl-comment) { color: var(--syn-comment); font-style: italic; }
  .hl :global(.hl-token) { color: var(--syn-token); font-weight: 700; }
  .hl :global(.hl-punct) { color: var(--color-text-dim); }
  /* In forced-colours mode the system palette wins: show the plain textarea text */
  @media (forced-colors: active) { .hl { display: none; } .svg-source { color: CanvasText; } }

  .hint-center {
    color: var(--color-text-dim);
    font-style: italic;
    font-size: 12px;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
