<script>
  import { tr } from '../../../shared/i18n.js'
  import { askText, askConfirm } from '../stores/prompt.js'
  /**
   * The template library (PRD §7.7.5): starter templates and "My templates", and the flows around them: use one
   * in the project, save a template to the library, export or import a package, update a copy from its library
   * item. It opens from the Template Editor, or from "New set from template". Using a library template copies it
   * into the project; the copy is an ordinary template that never changes when the library does. Only templates
   * of the active set's card size are shown for it (PRD §10.6).
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { project, activeSetId, loadSet, refreshProject } from '../stores/project.js'
  import { toast } from '../stores/ui.js'

  /** { intent: 'browse' | 'new-set' | 'save' | 'export' | 'update' | 'reset' | 'import', templateId? } */
  export let request = { intent: 'browse' }

  const dispatch = createEventDispatcher()
  const api = window.spadewick.templateLibrary

  let library = { starters: [], mine: [] }
  let setId = $activeSetId ?? ''      // the set that receives fields and sample cards
  let flow = null                     // the panel that replaces the list while a task is open
  let busy = false
  let loaded = false
  let startedFromNewSet = request.intent === 'new-set'
  let filterSize = null               // the active set's size: only items of this size are shown (not when making a set)
  const direct = !['browse', 'new-set'].includes(request.intent)   // opened for one task: closes when it is done

  $: sets = $project?.sets ?? []
  const png = b64 => (b64 ? `data:image/png;base64,${b64}` : null)
  const sameSize = (a, b) => !!a && !!b && Math.abs(a.mmW - b.mmW) < 0.05 && Math.abs(a.mmH - b.mmH) < 0.05
  const sizeLabel = s => (s?.mmW ? (s.id && s.id !== 'custom' ? `${tr(`cardSizes.${s.id}`)} · ${s.mmW} × ${s.mmH} mm` : `${s.mmW} × ${s.mmH} mm`) : '')
  $: shown = {
    starters: library.starters.filter(i => !filterSize || sameSize(i.cardSize, filterSize)),
    mine: library.mine.filter(i => !filterSize || sameSize(i.cardSize, filterSize))
  }

  async function loadAll() {
    library = await api.list()
    loaded = true
  }

  onMount(async () => {
    await loadAll()
    if (request.intent === 'browse' && $activeSetId) filterSize = await window.spadewick.cardSize.get($activeSetId)
    const t = request.templateId ? await window.spadewick.templates.get(request.templateId) : null
    try {
      if (request.intent === 'save' && t) await openSave(t, 'save')
      else if (request.intent === 'export' && t) await openSave(t, 'export')
      else if (request.intent === 'update' && t) await openUpdate(t)
      else if (request.intent === 'reset' && t) await reset(t)
      else if (request.intent === 'import') await openImport()
    } catch (err) { fail(err) }
    // an intent that ended without a flow (a cancelled file chooser, a missing library item) has nothing left to show
    if (direct && !flow) dispatch('close')
  })

  /** Tell the editor that the templates changed; it reloads its list and can select the new one. */
  async function refreshWorkspace(selectId = null) {
    await refreshProject()
    if ($activeSetId) await loadSet($activeSetId)
    window.dispatchEvent(new Event('spadewick:history-applied'))
    window.dispatchEvent(new CustomEvent('spadewick:templates-changed', { detail: { selectId } }))
    await loadAll()
  }

  /** A task is finished: back to the list, or away entirely when the dialog was opened for just that task. */
  function done() { flow = null; busy = false; if (direct) dispatch('close') }

  const fail = err => { toast(err.message, 'error', 6000); busy = false }

  // ---- Reset / update a copy -------------------------------------------------

  async function reset(t) {
    if (!await askConfirm(tr('templateLibrary.confirmReset', { name: t.name }))) return
    try { await api.reset({ templateId: t.id, setId: setId || null }); toast(tr('templateLibrary.resetDone', { name: t.name }), 'info', 3000); await refreshWorkspace(t.id) } catch (err) { fail(err) }
  }

  async function openUpdate(t) {
    try {
      const s = await api.originStatus(t.id)
      if (!s.itemAvailable) { toast(tr('library.itemMissing'), 'error', 5000); return }
      flow = { type: 'update', t, status: s }
    } catch (err) { fail(err) }
  }
  async function doUpdate(mode) {
    busy = true
    try {
      const out = await api.update({ templateId: flow.t.id, mode, setId: setId || null })
      toast(tr('templateLibrary.updated', { name: flow.t.name }), 'info', 3000)
      done()
      await refreshWorkspace(out?.templateId ?? flow?.t?.id ?? null)
    } catch (err) { fail(err) }
  }

  // ---- Using a library item -------------------------------------------------

  async function openUse(item) {
    flow = { type: 'use', item, target: (startedFromNewSet && item.purpose !== 'back') || !sets.length ? 'new' : 'existing', newSetName: item.name, samples: item.mockupCount > 0, makeDefault: false, asBack: item.purpose === 'back', plan: null, resolutions: { fields: {} } }
    await replan()
  }
  async function replan() {
    if (!flow) return
    const f = flow
    try {
      const target = f.target === 'existing' ? (setId || null) : null
      const plan = f.type === 'import' ? await api.planPackage({ token: f.pkg.token, setId: f.target === 'project' || f.target === 'both' ? (setId || null) : null })
        : await api.plan({ kind: f.item.kind, id: f.item.id, setId: target, newSet: f.target === 'new' })
      if (flow === f) flow = { ...f, plan, resolutions: { fields: {} } }
    } catch (err) { fail(err) }
  }
  $: unresolved = flow?.plan ? flow.plan.clashes.filter(c => !flow.resolutions.fields[c.key]) : []
  function resolve(c, value) {
    flow = { ...flow, resolutions: { fields: { ...flow.resolutions.fields, [c.key]: value } } }
  }
  async function doUse() {
    busy = true
    try {
      const f = flow
      const out = await api.use({
        kind: f.item.kind, id: f.item.id, setId: f.target === 'existing' ? (setId || null) : null,
        newSetName: f.target === 'new' ? f.newSetName : undefined, resolutions: f.resolutions, includeSampleCards: f.samples, makeDefault: f.makeDefault, asBack: f.asBack
      })
      if (out.newSet) { activeSetId.set(out.newSet.id) }
      toast(tr('templateLibrary.used', { name: f.item.name }), 'info', 3500)
      for (const n of out.notes ?? []) toast(n, 'info', 7000)
      flow = null; busy = false
      await refreshWorkspace(out.templateId)
      dispatch('close')   // the new template is ready in the editor
    } catch (err) { fail(err) }
  }

  // ---- Save to library / export -------------------------------------------------

  async function openSave(t, mode, item = null) {
    try {
      let inspect = null, setCards = []
      if (t) {
        inspect = await api.inspect({ templateId: t.id, setId: setId || null })
        setCards = setId ? await window.spadewick.cards.list(setId) : []
      }
      flow = {
        type: mode, t, item, inspect, setCards,
        name: t ? t.name : item.name, description: item?.description ?? '', author: item?.author ?? '', license: item?.license ?? '',
        mockup: new Set(setCards.slice(0, 6).map(c => c.id)),
        fonts: new Set((inspect?.fonts ?? []).filter(f => !f.restricted && !f.missing).map(f => f.id)),
        confirm: false
      }
    } catch (err) { fail(err) }
  }
  /** A different set was chosen for the fields and sample cards: look again, but keep what was typed. */
  async function changeSet() {
    const f = flow
    try {
      const inspect = await api.inspect({ templateId: f.t.id, setId: setId || null })
      const setCards = setId ? await window.spadewick.cards.list(setId) : []
      flow = { ...f, inspect, setCards, mockup: new Set(setCards.slice(0, 6).map(c => c.id)), fonts: new Set(inspect.fonts.filter(x => !x.restricted && !x.missing).map(x => x.id)) }
    } catch (err) { fail(err) }
  }
  function toggle(setName, id) {
    const next = new Set(flow[setName]); next.has(id) ? next.delete(id) : next.add(id)
    if (setName === 'mockup' && next.size > 12) return
    flow = { ...flow, [setName]: next }
  }
  $: needsConfirm = flow?.type === 'export' && (flow.t ? (flow.fonts.size > 0 || (flow.inspect?.assets.length ?? 0) > 0) : ((flow.item?.fontCount ?? 0) + (flow.item?.assetCount ?? 0) > 0))
  async function doSave() {
    busy = true
    try {
      const f = flow
      const res = await api.save({ templateId: f.t.id, setId: setId || null, name: f.name, description: f.description, author: f.author, license: f.license, fontIds: [...f.fonts], mockupCardIds: [...f.mockup] })
      toast(tr('templateLibrary.saved', { name: res.name }), 'info', 3500)
      if (res.skippedFonts.length) toast(tr('templateLibrary.fontsLeftOut', { fonts: res.skippedFonts.join(', ') }), 'info', 7000)
      await loadAll()
      done()
    } catch (err) { fail(err) }
  }
  async function doExport() {
    busy = true
    try {
      const f = flow
      const res = await api.exportPackage(f.t
        ? { templateId: f.t.id, setId: setId || null, name: f.name, description: f.description, author: f.author, license: f.license, fontIds: [...f.fonts], mockupCardIds: [...f.mockup], confirmRights: f.confirm }
        : { kind: f.item.kind, id: f.item.id, confirmRights: f.confirm })
      busy = false
      if (res) { toast(tr('templateLibrary.exported', { path: res.path }), 'info', 5000); done() }
    } catch (err) { fail(err) }
  }

  // ---- Library items -----------------------------------------------------------

  async function renameItem(item) {
    const name = await askText(tr('templateLibrary.promptRename'), item.name)
    if (!name?.trim() || name.trim() === item.name) return
    try { await api.renameItem({ id: item.id, name: name.trim() }); await loadAll() } catch (err) { fail(err) }
  }
  async function deleteItem(item) {
    if (!await askConfirm(tr('templateLibrary.confirmDeleteItem', { name: item.name }))) return
    try { await api.deleteItem(item.id); await loadAll() } catch (err) { fail(err) }
  }

  // ---- Importing a package -----------------------------------------------------------

  async function openImport() {
    busy = true
    try {
      const pkg = await api.openPackage({})
      busy = false
      if (!pkg) return
      flow = { type: 'import', pkg, target: 'both', samples: pkg.mockupCount > 0, makeDefault: false, plan: null, resolutions: { fields: {} } }
      await replan()
    } catch (err) { fail(err) }
  }
  async function doImport() {
    busy = true
    try {
      const f = flow
      const out = await api.applyPackage({ token: f.pkg.token, target: f.target, setId: setId || null, resolutions: f.resolutions, includeSampleCards: f.samples, makeDefault: f.makeDefault, asBack: f.asBack })
      toast(tr('templateLibrary.imported', { name: f.pkg.name }), 'info', 3500)
      for (const n of out.project?.notes ?? []) toast(n, 'info', 7000)
      flow = null; busy = false
      await refreshWorkspace(out.project?.templateId ?? null)
      if (direct) dispatch('close')
    } catch (err) { fail(err) }
  }
  async function cancelFlow() {
    if (flow?.type === 'import') await api.closePackage(flow.pkg.token).catch(() => {})
    done()
  }
  function onClose() { if (flow?.type === 'import') api.closePackage(flow.pkg.token).catch(() => {}); dispatch('close') }
</script>

<Modal title="{tr('templateLibrary.title')}" width={900} on:close={onClose}>
  {#if flow}
    <section class="flow" aria-label="{tr('templateLibrary.taskPanel')}">
      {#if flow.type === 'use' || flow.type === 'import'}
        {@const item = flow.type === 'use' ? flow.item : flow.pkg}
        <h3>{flow.type === 'use' ? tr('templateLibrary.useTitle', { name: item.name }) : tr('templateLibrary.importTitle', { name: item.name })}</h3>
        {#if item.license}<p class="dim"><strong>{tr('templateLibrary.licence')}</strong> {item.license}</p>{/if}

        {#if flow.type === 'import'}
          <fieldset>
            <legend>{tr('templateLibrary.putItWhere')}</legend>
            <label><input type="radio" bind:group={flow.target} value="both" on:change={replan} /> {tr('templateLibrary.targetBoth')}</label>
            <label><input type="radio" bind:group={flow.target} value="project" on:change={replan} /> {tr('templateLibrary.targetProject')}</label>
            <label><input type="radio" bind:group={flow.target} value="library" on:change={replan} /> {tr('templateLibrary.targetLibrary')}</label>
          </fieldset>
        {:else}
          <fieldset>
            <legend>{tr('templateLibrary.whichSet')}</legend>
            <label><input type="radio" bind:group={flow.target} value="new" on:change={replan} /> {tr('templateLibrary.newSet')}
              <input class="inline" bind:value={flow.newSetName} disabled={flow.target !== 'new'} aria-label="{tr('templateLibrary.newSetName')}" /></label>
            <label><input type="radio" bind:group={flow.target} value="existing" on:change={replan} disabled={!sets.length} /> {tr('templateLibrary.existingSet')}
              <select bind:value={setId} on:change={replan} disabled={flow.target !== 'existing'} aria-label="{tr('templateLibrary.existingSet')}">
                <option value="">{tr('templateLibrary.noSet')}</option>
                {#each sets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
              </select></label>
          </fieldset>
        {/if}

        {#if flow.type === 'import' && flow.target !== 'library'}
          <label class="stack">{tr('templateLibrary.fieldsGoTo')}
            <select bind:value={setId} on:change={replan}>
              <option value="">{tr('templateLibrary.noSet')}</option>
              {#each sets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
          </label>
        {/if}

        {#if item.mockupCount > 0 && !(flow.type === 'import' && flow.target === 'library')}
          <label><input type="checkbox" bind:checked={flow.samples} /> {tr('templateLibrary.addSamples', { n: item.mockupCount })}</label>
        {/if}
        {#if !(flow.type === 'import' && flow.target === 'library') && !(flow.type === 'use' && flow.target === 'new')}
          <label><input type="checkbox" bind:checked={flow.asBack} /> {tr('templateLibrary.useAsBack')}</label>
          <label><input type="checkbox" bind:checked={flow.makeDefault} disabled={flow.asBack} /> {tr('templateLibrary.makeDefault')}</label>
        {/if}

        {#if flow.plan}
          {#each flow.plan.notes as note}<p class="note">{note}</p>{/each}
          {#if flow.plan.clashes.length}
            <h4>{tr('templateLibrary.clashesTitle')}</h4>
            <ul class="clashes">
              {#each flow.plan.clashes as c (c.kind + c.key)}
                <li>
                  <span>{tr('templateLibrary.clashField', { slug: c.key, mine: c.mine.type, theirs: c.theirs.type })}</span>
                  <select aria-label="{tr('templateLibrary.decisionFor', { name: c.key })}" value={flow.resolutions.fields[c.key] ?? ''} on:change={e => resolve(c, e.target.value)}>
                    <option value="" disabled>{tr('templateLibrary.choose')}</option>
                    {#each c.options as o}<option value={o}>{tr(`templateLibrary.options.${o}`)}</option>{/each}
                  </select>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
        <div class="actions">
          <button on:click={cancelFlow}>{tr('common.cancel')}</button>
          <button class="primary" disabled={busy || !flow.plan || flow.plan.sizeMismatch || unresolved.length > 0 || (flow.type === 'use' && flow.target === 'new' && !flow.newSetName?.trim())}
            on:click={flow.type === 'use' ? doUse : doImport}>{flow.type === 'use' ? tr('templateLibrary.useButton') : tr('templateLibrary.importButton')}</button>
        </div>

      {:else if flow.type === 'save' || flow.type === 'export'}
        <h3>{flow.type === 'save' ? tr('templateLibrary.saveTitle', { name: flow.name }) : tr('templateLibrary.exportTitle', { name: flow.name })}</h3>
        {#if flow.t}
          <label class="stack">{tr('templateLibrary.name')}<input bind:value={flow.name} /></label>
          <label class="stack">{tr('templateLibrary.description')}<input bind:value={flow.description} /></label>
          <div class="pair">
            <label class="stack">{tr('templateLibrary.author')}<input bind:value={flow.author} /></label>
            <label class="stack">{tr('templateLibrary.licence')}<input bind:value={flow.license} /></label>
          </div>
          <label class="stack">{tr('templateLibrary.fieldsFromSet')}
            <select bind:value={setId} on:change={changeSet}>
              <option value="">{tr('templateLibrary.noSet')}</option>
              {#each sets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
          </label>
          <p class="dim">{tr('templateLibrary.bundles', { fields: flow.inspect.fields.length, images: flow.inspect.assets.length, fonts: flow.inspect.fonts.length })}</p>
          {#if flow.inspect.fonts.length}
            <fieldset>
              <legend>{tr('templateLibrary.fontsIncluded')}</legend>
              {#each flow.inspect.fonts as f (f.id)}
                <label>
                  <input type="checkbox" checked={flow.fonts.has(f.id)} disabled={f.restricted || f.missing} on:change={() => toggle('fonts', f.id)} />
                  {f.family} {f.style}
                  {#if f.restricted}<em class="warn">— {tr('templateLibrary.fontRestricted')}</em>{:else if f.missing}<em class="warn">— {tr('templateLibrary.fontMissing')}</em>{:else if f.previewOnly}<em class="warn">— {tr('templateLibrary.fontPreviewOnly')}</em>{/if}
                </label>
              {/each}
            </fieldset>
          {/if}
          {#if flow.setCards.length}
            <fieldset>
              <legend>{tr('templateLibrary.mockupCards', { n: flow.mockup.size })}</legend>
              <div class="cards-pick">
                {#each flow.setCards as c (c.id)}
                  <label><input type="checkbox" checked={flow.mockup.has(c.id)} disabled={!flow.mockup.has(c.id) && flow.mockup.size >= 12} on:change={() => toggle('mockup', c.id)} /> {c.display_name || c.card_code}</label>
                {/each}
              </div>
            </fieldset>
          {/if}
        {:else}
          <p class="dim">{flow.item.name} · {sizeLabel(flow.item.cardSize)}</p>
        {/if}
        {#if flow.type === 'export' && needsConfirm}
          <label class="confirm"><input type="checkbox" bind:checked={flow.confirm} /> {tr('templateLibrary.confirmRights')}</label>
        {/if}
        <div class="actions">
          <button on:click={cancelFlow}>{tr('common.cancel')}</button>
          {#if flow.type === 'save'}
            <button class="primary" disabled={busy || !flow.name.trim()} on:click={doSave}>{tr('templateLibrary.saveButton')}</button>
          {:else}
            <button class="primary" disabled={busy || (needsConfirm && !flow.confirm)} on:click={doExport}>{tr('templateLibrary.exportButton')}</button>
          {/if}
        </div>

      {:else if flow.type === 'update'}
        <h3>{tr('templateLibrary.updateTitle', { name: flow.t.name })}</h3>
        {#if flow.status.updateAvailable}
          <p>{tr('templateLibrary.updateAvailable', { name: flow.status.itemName, version: flow.status.itemVersion })}</p>
        {:else}
          <p>{tr('templateLibrary.noUpdate', { name: flow.status.itemName })}</p>
        {/if}
        <p class="dim">{tr('templateLibrary.updateChanges', { added: flow.status.changes.added, removed: flow.status.changes.removed })}</p>
        <div class="actions">
          <button on:click={cancelFlow}>{tr('common.cancel')}</button>
          <button disabled={busy} on:click={() => doUpdate('keep-both')}>{tr('templateLibrary.keepBoth')}</button>
          <button class="primary" disabled={busy} on:click={() => doUpdate('replace')}>{tr('templateLibrary.replaceMine')}</button>
        </div>
      {/if}
    </section>
  {:else}
    <div class="toolbar">
      <p class="dim grow">{filterSize ? tr('templateLibrary.showingSize', { size: sizeLabel(filterSize) }) : tr('templateLibrary.showingAll')}</p>
      <label class="setpick">{tr('templateLibrary.setForFields')}
        <select bind:value={setId}>
          <option value="">{tr('templateLibrary.noSet')}</option>
          {#each sets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <button on:click={openImport} disabled={busy}>{tr('templateLibrary.importPackage')}</button>
    </div>

    {#each [['starters', tr('templateLibrary.sectionStarters')], ['mine', tr('templateLibrary.sectionMine')]] as [key, label]}
      <h3 class="section">{label}</h3>
      {#if loaded && !shown[key].length}<p class="dim">{filterSize ? tr('templateLibrary.noneOfThisSize') : tr('templateLibrary.noneSaved')}</p>{/if}
      <ul class="entries grid">
        {#each shown[key] as item (item.kind + item.id)}
          <li class="entry tile">
            <div class="thumb">{#if item.thumbnail}<img src={png(item.thumbnail)} alt="" />{/if}</div>
            <div class="info">
              <h4>{item.name}</h4>
              <p class="dim">{sizeLabel(item.cardSize)}{item.mockupCount ? ` · ${tr('templateLibrary.samples', { n: item.mockupCount })}` : ''}</p>
              {#if item.description}<p class="desc">{item.description}</p>{/if}
              {#if item.license}<details><summary>{tr('templateLibrary.licence')}</summary><p class="dim">{item.license}</p></details>{/if}
              <div class="buttons">
                <button class="primary" on:click={() => openUse(item)} aria-label="{tr('templateLibrary.useNamed', { name: item.name })}">{tr('templateLibrary.useInProject')}</button>
                <button on:click={() => openSave(null, 'export', item)} aria-label="{tr('templateLibrary.exportNamed', { name: item.name })}">{tr('templateLibrary.exportPackage')}</button>
                {#if item.kind === 'mine'}
                  <button on:click={() => renameItem(item)} aria-label="{tr('templateLibrary.renameNamed', { name: item.name })}">{tr('templateLibrary.rename')}</button>
                  <button class="danger" on:click={() => deleteItem(item)} aria-label="{tr('templateLibrary.deleteNamed', { name: item.name })}">{tr('common.delete')}</button>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
  <svelte:fragment slot="footer"><button on:click={onClose}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .setpick { display: flex; align-items: center; gap: 6px; color: var(--color-text-dim); }
  .entries { list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .entries.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); }
  .entry { display: flex; gap: 12px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface-2); }
  .thumb { width: 96px; min-width: 96px; min-height: 120px; display: flex; align-items: flex-start; justify-content: center; }
  .thumb img { max-width: 96px; max-height: 150px; border: 1px solid var(--color-border); background: #fff; }
  .info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
  h3, h4 { font-size: 13px; }
  h3.section { margin-top: 12px; }
  .buttons { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .dim { color: var(--color-text-dim); }
  .desc { font-size: 12px; }
  .note { color: var(--color-accent-text); }
  .warn { color: var(--color-danger-text); font-style: normal; }
  .flow { display: flex; flex-direction: column; gap: 10px; }
  .flow fieldset { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .flow legend { padding: 0 4px; font-weight: 700; }
  .stack { display: flex; flex-direction: column; gap: 3px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .inline { margin-left: 6px; }
  .cards-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px; max-height: 160px; overflow: auto; }
  .clashes { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .clashes li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 6px; border: 1px solid var(--color-border); border-radius: var(--radius); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .primary { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); }
  .primary:disabled { opacity: .55; cursor: default; }
  .danger { color: var(--color-danger-text); }
  .confirm { padding: 6px; border: 1px solid var(--color-border); border-radius: var(--radius); }
</style>
