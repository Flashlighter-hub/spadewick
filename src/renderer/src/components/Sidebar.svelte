<script>
  import { askConfirm } from '../stores/prompt.js'
  import { tr } from '../../../shared/i18n.js'
  import { project, activeSetId, loadSet, templates, cards, refreshTemplates, refreshProject } from '../stores/project.js'
  import { reorderIds } from '../lib/grid.js'
  import { activeTab, toast, openDialog, libraryRequest, showMe } from '../stores/ui.js'
  import { layout, setLayout, LIMITS } from '../stores/layout.js'
  import ResizeHandle from './ResizeHandle.svelte'
  import CardSizePicker from './CardSizePicker.svelte'
  import NewSetDialog from './NewSetDialog.svelte'
  import NewBackDialog from './NewBackDialog.svelte'
  import { onMount, onDestroy, tick } from 'svelte'
  import { PROJECT_CHANGED } from '../stores/projectChanges.js'

  // The order of the sets: drag a set to a new place, or press Alt+Up or Alt+Down on it. The order is kept with the project (sets:reorder).
  let dragSetId = null      // the set being dragged
  let dropAt = null         // the index a dragged set would be put at: the line shown between two sets
  let announce = ''         // said to a screen reader after a move

  async function putSets(nextIds) {
    const byId = new Map($project.sets.map(s => [s.id, s]))
    const before = $project.sets.map(s => s.id)
    if (nextIds.every((id, i) => id === before[i])) return false
    project.update(p => ({ ...p, sets: nextIds.map(id => byId.get(id)) }))   // at once; the service follows
    try { await window.spadewick.sets.reorder(nextIds) } catch (err) { await refreshProject(); toast(tr('sidebar.reorderFailed', { reason: err.message }), 'error', 4000) }
    return true
  }
  function setDragStart(e, id) {
    dragSetId = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  function setDragOver(e, index) {
    if (!dragSetId) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    dropAt = e.clientY < rect.top + rect.height / 2 ? index : index + 1
  }
  async function setDrop(e) {
    e.preventDefault()
    const id = dragSetId, at = dropAt
    dragSetId = null; dropAt = null
    if (!id || at == null) return
    await putSets(reorderIds($project.sets.map(s => s.id), [id], at))
  }
  const setDragEnd = () => { dragSetId = null; dropAt = null }

  async function setKeydown(e, set, index) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const to = index + (e.key === 'ArrowUp' ? -1 : 1)
    const ids = $project.sets.map(s => s.id)
    if (to < 0 || to >= ids.length) return
    ids.splice(index, 1); ids.splice(to, 0, set.id)
    if (await putSets(ids)) {
      announce = tr('sidebar.setMoved', { name: set.name, pos: to + 1, total: ids.length })
      await tick()
      document.getElementById(`set-item-${set.id}`)?.focus()
    }
  }

  // Every set has its own card size (PRD §10.6). Changing it asks first when something would be undone.
  let sizeKey = 0   // bumped to put the picker back to the set's size when the change is declined
  const sizeName = d => (d.cardSize === 'custom' ? `${d.cardMmW} × ${d.cardMmH} ${tr('common.mm')}` : tr(`cardSizes.${d.cardSize}`))

  async function setSetSize({ detail }) {
    const set = activeSetObj
    if (!set) return
    const impact = await window.spadewick.sets.sizeImpact({ id: set.id, ...detail })
    if (impact.same) return
    const lines = []
    if (impact.defaultTemplate) lines.push(tr('sidebar.sizeImpactDefault', { name: impact.defaultTemplate }))
    if (impact.cards > 0) lines.push(tr('sidebar.sizeImpactCards', { n: impact.cards }))
    if (impact.matchingTemplates === 0) lines.push(tr('sidebar.sizeImpactNoTemplate'))
    if ((impact.defaultTemplate || impact.cards > 0 || $cards.length) && !await askConfirm(tr('sidebar.confirmSizeChange', { name: set.name, size: sizeName(detail), details: lines.length ? lines.join('\n') : tr('sidebar.sizeImpactNone') }))) { sizeKey++; return }
    const updated = await window.spadewick.sets.update({ id: set.id, ...detail })
    project.update(p => ({ ...p, sets: p.sets.map(s => s.id === updated.id ? updated : s) }))
    await loadSet(set.id)   // the cards' templates and the list of templates that fit
  }

  // The lists of templates are kept right as the project changes (a template made, deleted or saved at another size, a set's size changed),
  // not by looking again each time the list is focused: replacing the options of a list while it is open can close it (UPDATES U12).
  const onProjectChanged = e => { if (e.detail?.all) refreshTemplates() }
  onMount(() => window.addEventListener(PROJECT_CHANGED, onProjectChanged))
  onDestroy(() => window.removeEventListener(PROJECT_CHANGED, onProjectChanged))

  async function setDefaultTemplate(e) {
    const id = e.target.value || null
    const updated = await window.spadewick.sets.update({ id: $activeSetId, defaultTemplateId: id })
    project.update(p => ({ ...p, sets: p.sets.map(s => s.id === updated.id ? updated : s) }))
  }

  // The card back of the set (PRD §7.8): a template drawn on the back of every card, unless a card has a back of its own
  async function setCardBack(e) {
    const id = e.target.value || null
    const updated = await window.spadewick.sets.update({ id: $activeSetId, defaultBackTemplateId: id })
    project.update(p => ({ ...p, sets: p.sets.map(s => s.id === updated.id ? updated : s) }))
  }

  let newBackOpen = false
  async function createBack({ detail }) {
    newBackOpen = false
    try {
      const { template, set } = await window.spadewick.templates.createBack({ setId: $activeSetId, name: detail.name, design: detail.design, primary: detail.primary, accent: detail.accent })
      project.update(p => ({ ...p, sets: p.sets.map(s => s.id === set.id ? set : s) }))
      await refreshTemplates()
      toast(tr('sidebar.backCreated', { name: template.name }), 'info', 3500)
      if (detail.open) showMe({ templateId: template.id })
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  /** The Template Editor, on the template of one of the set's two slots */
  const editTemplate = id => { if (id) showMe({ templateId: id }) }

  // The short code that starts this set's card IDs (PRD §5.8); existing IDs keep the code they were made with
  async function setCode(e) {
    try {
      const updated = await window.spadewick.sets.update({ id: $activeSetId, code: e.target.value })
      project.update(p => ({ ...p, sets: p.sets.map(s => s.id === updated.id ? updated : s) }))
    } catch (err) {
      toast(err.message, 'error', 5000)
      e.target.value = activeSetObj?.code ?? ''
    }
  }

  $: activeSetObj = $project?.sets?.find(s => s.id === $activeSetId) ?? null
  $: setSizeName = activeSetObj ? sizeName({ cardSize: activeSetObj.card_size ?? 'poker', cardMmW: activeSetObj.card_mm_w, cardMmH: activeSetObj.card_mm_h }) : ''

  async function selectSet(id) {
    activeSetId.set(id)
    await loadSet(id)
    activeTab.set('cards')
  }

  let newSetOpen = false
  async function createSet({ detail }) {
    newSetOpen = false
    if (!$project) return
    const s = await window.spadewick.sets.create({ name: detail.name, description: '', cardSize: detail.cardSize, cardMmW: detail.cardMmW, cardMmH: detail.cardMmH, nameField: true })
    project.update(p => ({ ...p, sets: [...(p.sets ?? []), s] }))
    await selectSet(s.id)
  }

  async function deleteSet(id, event) {
    event.stopPropagation()
    if (!await askConfirm(tr('sidebar.confirmDeleteSet'))) return
    await window.spadewick.sets.delete(id)
    project.update(p => ({ ...p, sets: (p.sets ?? []).filter(s => s.id !== id) }))
    if ($activeSetId === id) { activeSetId.set(null); await loadSet(null) }
  }
</script>

<nav class="sidebar" style="width:{$layout.sidebar}px" aria-label="{tr('sidebar.projectNavigation')}">
  <h2 class="section-header">{tr('sidebar.project')}</h2>

  {#if $project}
    <div class="project-name" title={$project.path}>{$project.meta?.name ?? tr('sidebar.unnamed')}</div>
  {:else}
    <div class="no-project">{tr('sidebar.noProjectOpen')}</div>
  {/if}

  <h2 class="section-header">{tr('sidebar.sets')}</h2>

  <ul class="set-list" aria-label="{tr('sidebar.sets')}">
    {#if $project?.sets?.length}
      {#each $project.sets as set, index (set.id)}
        <li class="set-row" class:active={$activeSetId === set.id} class:dragging={dragSetId === set.id}
          class:drop-before={dropAt === index && dragSetId && dragSetId !== set.id} class:drop-after={dropAt === index + 1 && index === $project.sets.length - 1 && dragSetId && dragSetId !== set.id}
          draggable="true" on:dragstart={e => setDragStart(e, set.id)} on:dragover={e => setDragOver(e, index)} on:drop={setDrop} on:dragend={setDragEnd}>
          <button class="set-item" id="set-item-{set.id}" aria-current={$activeSetId === set.id ? 'true' : undefined} title="{tr('sidebar.dragToReorderSets')}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            on:click={() => selectSet(set.id)} on:keydown={e => setKeydown(e, set, index)}>
            <span class="set-name">{set.name}</span>
          </button>
          <button class="icon-btn del-btn" title="{tr('sidebar.deleteSet2')}"
            on:click={(e) => deleteSet(set.id, e)}
            aria-label="{tr('sidebar.deleteSet', { name: set.name })}">×</button>
        </li>
      {/each}
    {:else}
      <li class="empty-hint">{tr('sidebar.noSetsYet')}</li>
    {/if}
  </ul>
  <div class="sr-only" role="status" aria-live="polite">{announce}</div>
  {#if $project}
    <button class="add-btn" on:click={() => (newSetOpen = true)}>{tr('sidebar.newSet')}</button>
    <button class="add-btn" on:click={() => { libraryRequest.set({ intent: 'new-set' }); openDialog.set('template-library') }}>{tr('sidebar.newSetFromTemplate')}</button>
  {/if}
  <div class="spacer"></div>
  {#if activeSetObj}
    <h2 class="section-header settings-header">{tr('sidebar.setSettings')}</h2>
    {#key `${activeSetObj.id}-${sizeKey}`}
      <CardSizePicker
        label="{tr('sidebar.setCardSize')}"
        value={activeSetObj.card_size ?? 'poker'}
        mmW={activeSetObj.card_mm_w ?? 63.5}
        mmH={activeSetObj.card_mm_h ?? 88.9}
        on:change={setSetSize}
      />
    {/key}
  {/if}

  {#if activeSetObj}
    <div class="slot template-picker">
      <label>
        <span>{tr('sidebar.defaultTemplate')}</span>
        <select value={activeSetObj.default_template_id ?? ''} on:change={setDefaultTemplate}>
          <!-- selected on the options too: the list of templates arrives after the set is shown, and a select does not pick its value again then -->
          <option value="" selected={!activeSetObj.default_template_id}>{tr('common.none')}</option>
          {#each $templates as t (t.id)}<option value={t.id} selected={t.id === activeSetObj.default_template_id}>{t.name}</option>{/each}
        </select>
      </label>
      <button class="slot-btn" disabled={!activeSetObj.default_template_id} on:click={() => editTemplate(activeSetObj.default_template_id)}>{tr('sidebar.editSlot')}</button>
      <button class="slot-btn" title="{tr('sidebar.rulesHint')}" on:click={() => openDialog.set('template-rules')}>{activeSetObj.template_rules ? tr('sidebar.rulesCount', { n: JSON.parse(activeSetObj.template_rules).length }) : tr('sidebar.rules')}</button>
    </div>
    {#if !$templates.length}
      <!-- the lists only offer templates of exactly the card size of the set; with none, say why the lists are empty and where to find one -->
      <p class="no-templates" role="status">{tr('sidebar.noTemplateOfSize', { size: setSizeName })}</p>
      <button class="slot-btn library-btn" on:click={() => { libraryRequest.set({ intent: 'browse' }); openDialog.set('template-library') }}>{tr('sidebar.openLibrary')}</button>
    {/if}
    <div class="slot back-picker">
      <label>
        <span>{tr('sidebar.cardBack')}</span>
        <select value={activeSetObj.default_back_template_id ?? ''} on:change={setCardBack}>
          <!-- selected on the options too: the list of templates arrives after the set is shown, and a select does not pick its value again then -->
          <option value="" selected={!activeSetObj.default_back_template_id}>{tr('common.none')}</option>
          {#each $templates as t (t.id)}<option value={t.id} selected={t.id === activeSetObj.default_back_template_id}>{t.name}</option>{/each}
        </select>
      </label>
      <button class="slot-btn" disabled={!activeSetObj.default_back_template_id} on:click={() => editTemplate(activeSetObj.default_back_template_id)}>{tr('sidebar.editSlot')}</button>
      <button class="slot-btn" on:click={() => (newBackOpen = true)}>{tr('sidebar.newBack')}</button>
    </div>
    {#if newBackOpen}
      <NewBackDialog set={activeSetObj} size={{ mmW: (activeSetObj.card_mm_w ?? 63.5), mmH: (activeSetObj.card_mm_h ?? 88.9) }} on:create={createBack} on:close={() => (newBackOpen = false)} />
    {/if}
  {/if}

  {#if activeSetObj}
    <label class="template-picker">
      <span>{tr('sidebar.setCode')}</span>
      <input class="code-input" maxlength="6" value={activeSetObj.code ?? ''} on:change={setCode} />
    </label>
  {/if}

  <!-- the divider sits on the panel's right edge, inside the navigation landmark -->
  <div class="edge">
    <ResizeHandle axis="x" grow={1} min={LIMITS.sidebar.min} max={LIMITS.sidebar.max} reset={LIMITS.sidebar.reset}
      value={$layout.sidebar} label={tr('resize.sidebar')} on:change={e => setLayout('sidebar', e.detail)} />
  </div>
</nav>

{#if newSetOpen}<NewSetDialog on:create={createSet} on:close={() => (newSetOpen = false)} />{/if}

<style>
  .template-picker, .back-picker { display: flex; flex-direction: column; gap: 2px; padding: 4px 10px; font-size: 11px; color: var(--color-text-dim); }
  .template-picker select, .template-picker input, .back-picker select { width: 100%; }
  .slot label { display: flex; flex-direction: column; gap: 2px; }
  .slot { flex-direction: row; flex-wrap: wrap; align-items: flex-end; gap: 4px; }
  .slot label { flex: 1 1 100%; }
  .slot-btn { font-size: 11px; padding: 2px 8px; }
  .no-templates { margin: 4px 10px 0; font-size: 11px; color: var(--color-text-dim); line-height: 1.4; }
  .library-btn { margin: 2px 10px 4px; }
  .code-input { font-family: var(--font-mono); text-transform: uppercase; }

  .edge { position: absolute; top: 0; bottom: 0; right: 0; width: 5px; display: flex; }

  .sidebar {
    position: relative;
    flex: none;
    background: linear-gradient(180deg, var(--color-surface) 0%, color-mix(in srgb, var(--color-surface) 90%, var(--color-accent)) 100%);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .section-header {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-dim);
    padding: 14px 16px 4px;
  }

  .project-name {
    padding: 4px 16px 10px;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-project {
    padding: 4px 12px 8px;
    color: var(--color-text-dim);
    font-style: italic;
    font-size: 12px;
  }

  .set-list {
    list-style: none;
  }
  .spacer { flex: 1; min-height: 8px; }
  .settings-header { border-top: 1px solid var(--color-border); margin-top: 6px; padding-top: 12px; }

  .set-row { display: flex; align-items: center; margin: 1px 8px; border-radius: var(--radius); overflow: hidden; transition: background-color .12s ease; }
  .set-row .set-item { flex: 1; min-width: 0; }
  .set-row { position: relative; }
  .set-row.dragging { opacity: .45; }
  /* where a dragged set will land: a line, not only a colour */
  .set-row.drop-before::before, .set-row.drop-after::after { content: ''; position: absolute; left: 0; right: 0; height: 3px; background: var(--color-accent); border-radius: 2px; }
  .set-row.drop-before::before { top: 0; }
  .set-row.drop-after::after { bottom: 0; }

  .set-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    border-radius: 0;
    font-size: 13px;
    gap: 4px;
  }

  .set-item:hover { background: var(--color-surface-2); }
  .set-row.active .set-item:hover { background: none; }

  /* the current item is marked by more than colour: a bar on the left edge and bold text */
  .set-row.active { background: var(--gradient-accent); color: var(--color-on-accent); font-weight: 700; box-shadow: inset 4px 0 0 rgba(255, 255, 255, .85), var(--glow); }
  .set-row.active .set-item { background: none; color: inherit; }

  .set-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    background: none;
    border: none;
    padding: 1px 4px;
    font-size: 14px;
    line-height: 1;
    color: var(--color-text-dim);
    opacity: 0.55;
    transition: opacity 0.1s;
    border-radius: 2px;
  }

  .set-row:hover .icon-btn, .set-row:focus-within .icon-btn { opacity: 1; }

  .del-btn:hover {
    background: var(--color-danger);
    color: #fff;
  }

  .empty-hint {
    padding: 4px 12px;
    color: var(--color-text-dim);
    font-size: 12px;
    font-style: italic;
  }

  .add-btn {
    margin: 6px 12px 0;
    border: 1px dashed var(--color-control-border);
    background: none;
    color: var(--color-text-dim);
    font-size: 12px;
    padding: 4px 8px;
    text-align: left;
  }

  .add-btn:hover {
    color: var(--color-text);
    border-color: var(--color-accent-text);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
</style>
