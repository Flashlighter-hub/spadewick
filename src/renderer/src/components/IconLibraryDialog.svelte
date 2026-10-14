<script>
  import { askConfirm } from '../stores/prompt.js'
  /**
   * The icon library (PRD §16.4): the project's icons with a preview at several text sizes, usage counts, an "unused"
   * filter and a search; import from files, a folder or a ZIP; and the settings of each icon.
   */
  import { createEventDispatcher } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import RichText from './RichText.svelte'
  import { iconLibrary, loadTextLibrary } from '../stores/textLibrary.js'
  import { starterIcon, iconPathData, starterIconNames } from '../../../shared/starterIcons.js'
  import { toast } from '../stores/ui.js'
  import { onMount } from 'svelte'

  onMount(loadTextLibrary) // the library may have changed since it was loaded (an undo, another dialog)

  const dispatch = createEventDispatcher()
  let query = '', filter = 'all', selectedId = null, busy = false
  let aliasText = '', tagText = '', renameText = ''

  $: lib = $iconLibrary
  const total = i => i.usage.cards + i.usage.templates + i.usage.rules + i.usage.styles
  $: shown = lib.icons.filter(i => {
    const q = query.trim().toLowerCase()
    if (q && !(i.name.includes(q) || i.aliases.some(a => a.includes(q)) || i.tags.some(t => t.toLowerCase().includes(q)))) return false
    if (filter === 'unused') return total(i) === 0
    if (filter === 'single') return i.single
    if (filter === 'multi') return !i.single
    return true
  })
  $: selected = lib.icons.find(i => i.id === selectedId) ?? null
  // The text boxes are filled when another icon is chosen, and again after their own save, but never from a reload that a
  // different setting caused: that would throw away what is being typed.
  let syncedId = null
  $: if (selected && selected.id !== syncedId) { syncedId = selected.id; aliasText = selected.aliases.join(', '); tagText = selected.tags.join(', '); renameText = selected.name }
  $: if (!selected) syncedId = null
  const fresh = () => lib.icons.find(i => i.id === syncedId)

  async function changed() {
    await loadTextLibrary()
    window.dispatchEvent(new Event('spadewick:rerender'))
  }

  async function run(fn) {
    busy = true
    try { return await fn() } catch (err) { toast(err.message, 'error', 6000) } finally { busy = false }
  }

  /** Import, and ask what to do about names that are taken: replace the icon (its uses stay valid), or leave it. */
  async function importWith(call) {
    await run(async () => {
      const res = await call({})
      const clashes = res.skipped.filter(s => s.reason === 'exists')
      let replaced = res.replaced.length
      let done = res.imported.length
      if (clashes.length && res.paths.length && await askConfirm(tr('iconLibrary.confirmReplace', { n: clashes.length, names: clashes.map(c => c.exists).join(', ') }))) {
        const again = await call({ paths: res.paths, conflict: 'replace', only: clashes.map(c => c.exists) })
        replaced += again.replaced.length
      }
      const problems = res.skipped.filter(s => s.reason !== 'exists')
      await changed()
      if (done || replaced) toast(tr('iconLibrary.imported', { n: done, replaced }), 'info', 4000)
      for (const p of problems.slice(0, 3)) toast(tr('iconLibrary.skipped', { file: p.file, reason: p.reason }), 'error', 7000)
      if (problems.length > 3) toast(tr('iconLibrary.skippedMore', { n: problems.length - 3 }), 'error', 7000)
      if (res.imported[0]) selectedId = res.imported[0].id
    })
  }
  const importFiles = () => importWith(opts => window.spadewick.icons.importFiles(opts))
  const importFolder = () => importWith(opts => window.spadewick.icons.importFolder(opts))

  const update = patch => run(async () => { await window.spadewick.icons.update({ id: selected.id, ...patch }); await changed() })

  const saveAliases = async () => { await update({ aliases: aliasText.split(',').map(s => s.trim()).filter(Boolean) }); if (fresh()) aliasText = fresh().aliases.join(', ') }
  const saveTags = async () => { await update({ tags: tagText.split(',').map(s => s.trim()).filter(Boolean) }); if (fresh()) tagText = fresh().tags.join(', ') }

  async function rename() {
    const name = renameText.trim()
    if (!selected || !name || name === selected.name) { renameText = selected?.name ?? ''; return }
    const uses = total(selected)
    if (uses && !await askConfirm(tr('iconLibrary.confirmRename', { from: selected.name, to: name, cards: selected.usage.cards, rules: selected.usage.rules, templates: selected.usage.templates }))) { renameText = selected.name; return }
    await run(async () => {
      const res = await window.spadewick.icons.rename({ id: selected.id, name })
      await changed()
      toast(tr('iconLibrary.renamed', { cards: res.updated.cards, rules: res.updated.rules, templates: res.updated.templates }), 'info', 4000)
    })
    if (fresh()) renameText = fresh().name
  }

  const replacePicture = () => run(async () => { const r = await window.spadewick.icons.replacePicture({ id: selected.id }); if (r) await changed() })

  async function remove() {
    if (!selected) return
    const usage = await window.spadewick.icons.usage(selected.id)
    const uses = usage.cards.length + usage.templates.length + usage.rules.length
    const where = [usage.cards.length && tr('iconLibrary.usedCards', { n: usage.cards.length }), usage.templates.length && tr('iconLibrary.usedTemplates', { n: usage.templates.length }), usage.rules.length && tr('iconLibrary.usedRules', { n: usage.rules.length })].filter(Boolean).join(', ')
    if (!await askConfirm(uses ? tr('iconLibrary.confirmDeleteUsed', { name: selected.name, where }) : tr('iconLibrary.confirmDelete', { name: selected.name }))) return
    const id = selected.id
    selectedId = null
    await run(async () => { await window.spadewick.icons.remove(id); await changed() })
  }

  const builtIn = starterIconNames()
</script>

<Modal title={tr('iconLibrary.title')} width={900} on:close={() => dispatch('close')}>
  <div class="bar">
    <button on:click={importFiles} disabled={busy}>{tr('iconLibrary.importFiles')}</button>
    <button on:click={importFolder} disabled={busy}>{tr('iconLibrary.importFolder')}</button>
    <input type="search" placeholder={tr('iconLibrary.search')} aria-label={tr('iconLibrary.search')} bind:value={query} />
    <select aria-label={tr('iconLibrary.filter')} bind:value={filter}>
      <option value="all">{tr('iconLibrary.filterAll')}</option>
      <option value="unused">{tr('iconLibrary.filterUnused')}</option>
      <option value="single">{tr('iconLibrary.filterSingle')}</option>
      <option value="multi">{tr('iconLibrary.filterMulti')}</option>
    </select>
  </div>
  <p class="dim">{tr('iconLibrary.licenceNote')}</p>
  {#if lib.ambiguous.length}
    <p class="warn" role="alert">{tr('iconLibrary.ambiguous', { list: lib.ambiguous.map(a => `${a.alias} (${a.icons.join(', ')})`).join('; ') })}</p>
  {/if}

  <div class="body">
    <ul class="grid" aria-label={tr('iconLibrary.icons')}>
      {#each shown as i (i.id)}
        <li><button class="tile" class:sel={i.id === selectedId} aria-pressed={i.id === selectedId} aria-label={tr('iconLibrary.tileLabel', { name: i.name, n: total(i) })} on:click={() => selectedId = i.id}>
          <span class="pic"><RichText text={`{icon:${i.name}}`} inline /></span>
          <span class="name">{i.name}</span>
          <span class="uses">{tr('iconLibrary.uses', { n: total(i) })}</span>
        </button></li>
      {:else}
        <li class="dim">{lib.icons.length ? tr('iconLibrary.noMatch') : tr('iconLibrary.empty')}</li>
      {/each}
    </ul>

    {#if selected}
      <section class="detail" aria-label={tr('iconLibrary.settings', { name: selected.name })}>
        <h3>{selected.name}</h3>
        <div class="previews" aria-label={tr('iconLibrary.previewSizes')}>
          {#each [12, 20, 32] as px}<span style="font-size:{px}px"><RichText text={`Aa {icon:${selected.name}} Aa`} inline /></span>{/each}
        </div>
        <label>{tr('iconLibrary.name')}
          <span class="inline"><input bind:value={renameText} on:keydown={e => e.key === 'Enter' && rename()} /><button on:click={rename} disabled={busy}>{tr('iconLibrary.rename')}</button></span>
        </label>
        <label>{tr('iconLibrary.aliases')} <input bind:value={aliasText} on:change={saveAliases} /></label>
        <label>{tr('iconLibrary.tags')} <input bind:value={tagText} on:change={saveTags} /></label>
        <label>{tr('iconLibrary.notes')} <textarea rows="2" value={selected.notes} on:change={e => update({ notes: e.currentTarget.value })} /></label>
        <div class="grid3">
          <label>{tr('iconLibrary.size')} <input type="number" min="0.2" max="5" step="0.1" value={selected.size} on:change={e => update({ size: Number(e.currentTarget.value) })} /></label>
          <label>{tr('iconLibrary.vOffset')} <input type="number" min="-1" max="1" step="0.05" value={selected.vOffset} on:change={e => update({ vOffset: Number(e.currentTarget.value) })} /></label>
          <label>{tr('iconLibrary.spacing')} <input type="number" min="0" max="2" step="0.05" value={selected.spacing} on:change={e => update({ spacing: Number(e.currentTarget.value) })} /></label>
        </div>
        <label>{tr('iconLibrary.colorMode')}
          <select value={selected.colorMode} disabled={!selected.single} on:change={e => update({ colorMode: e.currentTarget.value })}>
            <option value="follow">{tr('iconLibrary.follow')}</option>
            <option value="keep">{tr('iconLibrary.keep')}</option>
          </select>
        </label>
        {#if !selected.single}<p class="dim">{tr('iconLibrary.several')}</p>{/if}
        <p class="dim">{tr('iconLibrary.usage', { cards: selected.usage.cards, templates: selected.usage.templates, rules: selected.usage.rules })}</p>
        <div class="actions"><button on:click={replacePicture} disabled={busy}>{tr('iconLibrary.replacePicture')}</button><button class="danger" on:click={remove} disabled={busy}>{tr('iconLibrary.delete')}</button></div>
      </section>
    {/if}
  </div>

  <details class="builtin">
    <summary>{tr('iconLibrary.builtIn', { n: builtIn.length })}</summary>
    <p class="dim">{tr('iconLibrary.builtInNote')}</p>
    <div class="chips">
      {#each builtIn as name}<span class="chip" title={name}><svg viewBox="0 0 100 100" aria-hidden="true"><path d={iconPathData(starterIcon(name))} fill="currentColor" /></svg>{name}</span>{/each}
    </div>
  </details>

  <svelte:fragment slot="footer"><span style="flex:1" /><button on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .bar input[type='search'] { flex: 1; min-width: 140px; }
  .dim { color: var(--color-text-dim); font-size: 12px; margin: 4px 0; }
  .warn { color: var(--color-danger-text); font-size: 12px; }
  .body { display: flex; gap: 12px; margin-top: 8px; min-height: 260px; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; align-content: start; max-height: 360px; overflow: auto; list-style: none; margin: 0; padding: 0; }
  .grid li.dim { grid-column: 1 / -1; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px; width: 100%; }
  .tile.sel { outline: 2px solid var(--color-accent, #4a8cff); }
  .pic { font-size: 28px; line-height: 1.2; height: 38px; display: flex; align-items: center; }
  .name { font-size: 11px; word-break: break-all; }
  .uses { font-size: 11px; }
  .detail { width: 290px; display: flex; flex-direction: column; gap: 6px; }
  .detail h3 { margin: 0; font-size: 14px; }
  .detail label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--color-text-dim); }
  .detail input, .detail select, .detail textarea { width: 100%; box-sizing: border-box; }
  .inline { display: flex; gap: 4px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .previews { display: flex; gap: 14px; align-items: baseline; border: 1px solid var(--color-border); border-radius: var(--radius); padding: 6px 8px; }
  .actions { display: flex; gap: 6px; }
  .danger { color: var(--color-danger-text); }
  .builtin { margin-top: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--color-border); border-radius: 12px; padding: 2px 8px 2px 4px; font-size: 11px; }
  .chip svg { width: 16px; height: 16px; }
</style>
