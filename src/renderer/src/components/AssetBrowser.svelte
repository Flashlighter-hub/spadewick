<script>
  import { askConfirm } from '../stores/prompt.js'
  import { tr } from '../../../shared/i18n.js'
  /**
   * Asset library — PRD §9: thumbnails, search, tag chips, unused filter, sorting, and a detail
   * panel with tags, notes, usage (with "Go to card"), replace, export and delete.
   */
  import { onMount, onDestroy } from 'svelte'
  import { thumbUrl, forgetThumb } from '../lib/thumbs.js'
  import { activeSetId, project, loadSet } from '../stores/project.js'
  import { activeTab, toast, focusCard } from '../stores/ui.js'

  let assets = []
  let allTags = []
  let search = ''
  let activeTags = []
  let unusedOnly = false
  let sortBy = 'date'          // 'name' | 'date' | 'size'
  let thumbSize = 'medium'
  let urls = {}
  let selectedId = null
  let usage = []
  let templateUsage = []     // templates that place this image as a fixed element
  let newTag = ''
  let debounce

  const thumbPx = { small: 64, medium: 96, large: 140 }
  $: selected = assets.find(a => a.id === selectedId) ?? null
  $: sorted = [...assets].sort((a, b) =>
    sortBy === 'name' ? a.original_name.localeCompare(b.original_name)
    : sortBy === 'size' ? b.file_size_bytes - a.file_size_bytes
    : b.created_at - a.created_at)
  $: tagSuggestions = allTags.filter(t => !selected?.tags.includes(t))

  async function load() {
    const [list, tags] = await Promise.all([
      window.spadewick.assets.list({ search: search || undefined, tags: activeTags.length ? activeTags : undefined, unusedOnly: unusedOnly || undefined }),
      window.spadewick.assets.allTags()
    ])
    assets = list
    allTags = tags
    activeTags = activeTags.filter(t => tags.includes(t))
    for (const a of list) thumbUrl(a.id).then(u => { if (u && urls[a.id] !== u) { urls[a.id] = u; urls = urls } })
    if (selectedId && !list.some(a => a.id === selectedId)) selectedId = null
  }

  $: selectedId, loadUsage()
  async function loadUsage() {
    usage = selectedId ? await window.spadewick.assets.getUsage(selectedId) : []
    templateUsage = selectedId ? await window.spadewick.assets.getTemplateUsage(selectedId) : []
  }

  onMount(() => { load(); window.addEventListener('spadewick:history-applied', load) })
  onDestroy(() => { clearTimeout(debounce); window.removeEventListener('spadewick:history-applied', load) })

  const onSearch = () => { clearTimeout(debounce); debounce = setTimeout(load, 150) }
  const toggleTag = t => { activeTags = activeTags.includes(t) ? activeTags.filter(x => x !== t) : [...activeTags, t]; load() }

  async function importAssets() {
    const imported = await window.spadewick.assets.import(null)
    if (imported.length) { await load(); selectedId = imported[0].id }
  }

  // Tags are applied to the list immediately and saved in order, so quick successive edits never overwrite each other
  let saving = Promise.resolve()
  function saveTags(tags) {
    const clean = [...new Set(tags.map(t => t.trim()).filter(Boolean))]
    const id = selectedId
    assets = assets.map(a => a.id === id ? { ...a, tags: clean } : a)
    saving = saving.then(() => window.spadewick.assets.update({ id, tags: clean })).then(load)
    return saving
  }
  const addTag = async () => { if (newTag.trim()) { const t = newTag; newTag = ''; await saveTags([...selected.tags, t]) } }

  async function saveNotes(e) {
    if (e.target.value === selected.notes) return
    await window.spadewick.assets.update({ id: selectedId, notes: e.target.value })
    await load()
  }

  async function replaceAsset() {
    const res = await window.spadewick.assets.replace({ id: selectedId })
    if (!res) return
    forgetThumb(selectedId); delete urls[selectedId]
    await load()
    toast(tr('assetBrowser.replacedToast', { n: usage.length }), 'info', 3000)
  }

  async function exportAsset() {
    const res = await window.spadewick.assets.export(selectedId)
    if (res) toast(tr('assetBrowser.exportedToast', { path: res.path }), 'info', 3500)
  }

  async function deleteAsset() {
    const names = usage.map(u => u.displayName || tr('assetBrowser.unnamedCard'))
    const list = names.slice(0, 8).join(', ') + (names.length > 8 ? tr('assetBrowser.andMore', { n: names.length - 8 }) : '')
    const warning = usage.length
      ? tr('assetBrowser.confirmDeleteUsed', { name: selected.original_name, n: usage.length, list })
      : tr('assetBrowser.confirmDelete', { name: selected.original_name })
    const templateNote = templateUsage.length ? '\n\n' + tr('assetBrowser.alsoInTemplates', { n: templateUsage.length, list: templateUsage.map(t => t.name).join(', ') }) : ''
    if (!await askConfirm(warning + templateNote)) return
    forgetThumb(selectedId)
    await window.spadewick.assets.delete(selectedId)
    selectedId = null
    await load()
  }

  async function goToCard(u) {
    activeTab.set('cards')
    if ($activeSetId !== u.setId) { activeSetId.set(u.setId) }
    focusCard(u.setId, u.cardId)
  }

  const fmtSize = b => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
  const setName = id => $project?.sets?.find(s => s.id === id)?.name ?? ''
</script>

<div class="asset-browser">
  <div class="toolbar">
    <button on:click={importAssets}>{tr('assetBrowser.import')}</button>
    <input type="search" bind:value={search} on:input={onSearch} placeholder="{tr('assetBrowser.searchNameTagsNotes')}" class="search-input" aria-label="{tr('assetBrowser.searchAssets')}" />
    <label class="check"><input type="checkbox" bind:checked={unusedOnly} on:change={load} /> {tr('assetBrowser.unusedOnly')}</label>
    <span class="spacer" />
    <label class="size-label">{tr('assetBrowser.sort')}
      <select bind:value={sortBy} aria-label="{tr('assetBrowser.sortAssets')}">
        <option value="date">{tr('assetBrowser.dateAdded')}</option><option value="name">{tr('common.name')}</option><option value="size">{tr('assetBrowser.fileSize')}</option>
      </select>
    </label>
    <label class="size-label">{tr('common.size')}
      <select bind:value={thumbSize} aria-label="{tr('assetBrowser.thumbnailSize')}">
        <option value="small">{tr('common.small')}</option><option value="medium">{tr('common.medium')}</option><option value="large">{tr('common.large')}</option>
      </select>
    </label>
  </div>

  {#if allTags.length}
    <div class="chips" role="group" aria-label="{tr('assetBrowser.filterByTag')}">
      {#each allTags as t}
        <button class="chip" class:on={activeTags.includes(t)} aria-pressed={activeTags.includes(t)} on:click={() => toggleTag(t)}>{t}</button>
      {/each}
    </div>
  {/if}

  <div class="content">
    {#if sorted.length === 0}
      <div class="empty">
        {#if search || activeTags.length || unusedOnly}{tr('assetBrowser.noAssetsMatchTheseFilters')}{:else}{tr('assetBrowser.noAssetsYetClickImport')}{/if}
      </div>
    {:else}
      <div class="grid" style="--thumb-size: {thumbPx[thumbSize]}px" role="listbox" aria-label="{tr('common.assets')}">
        {#each sorted as asset (asset.id)}
          <button class="asset-card" class:selected={asset.id === selectedId} role="option" aria-selected={asset.id === selectedId}
            title={asset.original_name} on:click={() => selectedId = asset.id}>
            <div class="thumb">
              {#if urls[asset.id]}<img src={urls[asset.id]} alt="" />
              {:else if asset.mime_type === 'image/svg+xml'}<span class="svg-badge">{tr('assetBrowser.svg')}</span>
              {:else}<span class="loading">…</span>{/if}
            </div>
            <div class="asset-name">{asset.original_name}</div>
            {#if asset.tags.length}<div class="asset-tags">{#each asset.tags as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if selected}
      <aside class="details" aria-label="{tr('assetBrowser.assetDetails')}">
        <div class="big">{#if urls[selected.id]}<img src={urls[selected.id]} alt="{tr('common.preview')}" />{:else}<span class="svg-badge">{selected.mime_type === 'image/svg+xml' ? 'SVG' : '…'}</span>{/if}</div>
        <h2 class="details-title">{selected.original_name}</h2>
        <p class="meta">{selected.mime_type.replace('image/', '').toUpperCase()}{#if selected.width_px} · {selected.width_px}×{selected.height_px}{/if} · {fmtSize(selected.file_size_bytes)}</p>

        <section>
          <h3>{tr('assetBrowser.tags')}</h3>
          <div class="chips tight">
            {#each selected.tags as t}
              <span class="chip on removable">{t}<button aria-label="{tr('assetBrowser.removeTag', { tag: t })}" on:click={() => saveTags(selected.tags.filter(x => x !== t))}>×</button></span>
            {/each}
          </div>
          <input list="tag-suggestions" bind:value={newTag} placeholder="{tr('assetBrowser.addATag2')}" aria-label="{tr('assetBrowser.addATag')}" on:keydown={e => e.key === 'Enter' && addTag()} on:change={addTag} />
          <datalist id="tag-suggestions">{#each tagSuggestions as t}<option value={t} />{/each}</datalist>
        </section>

        <section>
          <h3>{tr('assetBrowser.notes')}</h3>
          <textarea rows="3" value={selected.notes} on:blur={saveNotes} aria-label="{tr('assetBrowser.notes')}" />
        </section>

        <section>
          <h3>{tr('assetBrowser.usedByCard', { n: usage.length })}</h3>
          <ul class="usage">
            {#each usage as u (u.cardId)}
              <li><span>{u.displayName || tr('cardDataEditor.unnamedCard')} <small>{setName(u.setId)}</small></span><button on:click={() => goToCard(u)} aria-label="{tr('assetBrowser.goTo', { name: u.displayName || tr('cardDataEditor.unnamedCard') })}">{tr('assetBrowser.goToCard')}</button></li>
            {:else}<li class="none">{tr('assetBrowser.notUsedByAnyCard')}</li>{/each}
          </ul>
        </section>

        {#if templateUsage.length}
          <section>
            <h3>{tr('assetBrowser.usedByTemplate', { n: templateUsage.length })}</h3>
            <ul class="usage">{#each templateUsage as t (t.templateId)}<li><span>{t.name}</span></li>{/each}</ul>
          </section>
        {/if}

        <div class="actions">
          <button on:click={replaceAsset} title="{tr('assetBrowser.swapTheImageFileEvery')}">{tr('assetBrowser.replace')}</button>
          <button on:click={exportAsset}>{tr('common.export')}</button>
          <button class="danger" on:click={deleteAsset}>{tr('common.delete')}</button>
        </div>
      </aside>
    {/if}
  </div>
</div>

<style>
  .asset-browser { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
  .search-input { flex: 1; max-width: 260px; }
  .spacer { flex: 1; }
  .size-label, .check { font-size: 12px; color: var(--color-text-dim); display: flex; align-items: center; gap: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--color-border); }
  .chips.tight { padding: 0 0 6px; border: none; }
  .chip { font-size: 11px; padding: 2px 8px; border-radius: var(--radius); background: var(--color-surface-2); border: 1px solid var(--color-border); }
  .chip.on { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
  .chip.removable { display: inline-flex; align-items: center; gap: 4px; }
  .chip.removable button { background: none; border: none; color: inherit; padding: 0 2px; }

  .content { flex: 1; display: flex; min-height: 0; }
  .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--color-text-dim); font-style: italic; font-size: 13px; }
  .grid { flex: 1; overflow-y: auto; padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--thumb-size) + 16px), 1fr)); gap: 12px; align-content: start; }
  .asset-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; background: var(--color-surface); border: 2px solid var(--color-border); border-radius: var(--radius); }
  .asset-card.selected { border-color: var(--color-accent); }
  .thumb { width: var(--thumb-size); height: var(--thumb-size); display: flex; align-items: center; justify-content: center; background: var(--color-surface-2); border-radius: 3px; overflow: hidden; }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .svg-badge, .loading { color: var(--color-text-dim); font-size: 11px; }
  .asset-name { font-size: 11px; max-width: var(--thumb-size); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .asset-tags { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; }
  .tag { font-size: 10px; padding: 1px 5px; border-radius: var(--radius); background: var(--color-surface-2); color: var(--color-text-dim); }

  .details { width: 280px; min-width: 280px; border-left: 1px solid var(--color-border); background: var(--color-surface); overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .big { display: flex; justify-content: center; background: var(--color-surface-2); padding: 8px; border-radius: var(--radius); min-height: 80px; align-items: center; }
  .big img { max-width: 100%; max-height: 180px; object-fit: contain; }
  .details-title { font-size: 13px; word-break: break-all; } h3 { font-size: 11px; color: var(--color-text-dim); text-transform: uppercase; margin-bottom: 4px; }
  .meta { color: var(--color-text-dim); font-size: 11px; }
  section input, section textarea { width: 100%; }
  .usage { list-style: none; display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; }
  .usage li { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .usage small { color: var(--color-text-dim); } .usage .none { color: var(--color-text-dim); font-style: italic; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .danger { background: var(--color-danger); border-color: var(--color-danger); color: var(--color-on-accent); margin-left: auto; }
</style>
