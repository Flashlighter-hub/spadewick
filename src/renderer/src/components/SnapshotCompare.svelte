<script>
  import { tr } from '../../../shared/i18n.js'
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import { activeSetId, loadSet, refreshProject } from '../stores/project.js'
  import { toast } from '../stores/ui.js'
  import ComparePictures from './ComparePictures.svelte'

  export let from            // the earlier snapshot ({ id, name, created_at })
  export let to = null       // a later snapshot, or null for the project as it is now

  const dispatch = createEventDispatcher()
  let diff = null
  let handle = null
  let loadError = ''
  let tab = 'cards'
  let filter = 'all'
  let search = ''
  let view = 'side'           // how two pictures are shown: 'side' | 'overlay' | 'slider'
  let expanded = new Set()
  let picked = new Set()
  let pictures = {}           // card id -> { from, to } base64 PNGs, drawn when a card is opened
  let tplPictures = {}        // template id -> { from, to }
  let tplSource = {}          // template id -> line differences, when asked for
  let exportOpen = false

  const live = () => !to
  const ago = ms => new Date(ms).toLocaleString()

  onMount(async () => {
    try {
      const r = await window.spadewick.snapshots.compareOpen({ from: from.id, to: to?.id ?? null })
      handle = r.handle; diff = r
    } catch (err) { loadError = err.message }
  })
  onDestroy(() => { if (handle) window.spadewick.snapshots.compareClose(handle) })

  $: s = diff?.summary
  $: nothing = diff && !s.cardsChanged && !s.cardsAdded && !s.cardsRemoved && !s.fields && !s.other
  $: headline = !diff ? '' : nothing
    ? tr(live() ? 'compare.nothing' : 'compare.nothingBetween')
    : live()
      ? tr('compare.headlineNow', { name: from.name, when: ago(from.created_at), changed: s.cardsChanged, added: s.cardsAdded, removed: s.cardsRemoved, fields: s.fields, templates: s.templates })
      : tr('compare.headlineBetween', { a: from.name, b: to.name, changed: s.cardsChanged, added: s.cardsAdded, removed: s.cardsRemoved, fields: s.fields, templates: s.templates })

  const shown = (cards, f, q) => {
    const needle = q.trim().toLowerCase()
    return cards.filter(c => (f === 'all' || c.kind === f) &&
      (!needle || (c.name ?? '').toLowerCase().includes(needle) || (c.code ?? '').toLowerCase().includes(needle) ||
        c.changes.some(ch => `${ch.from ?? ''} ${ch.to ?? ''}`.toLowerCase().includes(needle))))
  }
  $: cards = diff ? shown(diff.cards, filter, search) : []

  // "Restore all Cost values": every shown change of one field, as one action
  $: columns = (() => {
    const by = new Map()
    for (const c of cards) if (c.restorable) for (const ch of c.changes) if (ch.kind === 'field') by.set(ch.label, [...(by.get(ch.label) ?? []), ch.key])
    return [...by].filter(([, keys]) => keys.length > 1)
  })()

  const show = v => (v === '' || v === null || v === undefined ? tr('compare.empty') : String(v))
  function describe(ch) {
    if (ch.kind === 'field') return ch.words ? tr('compare.textEdited', { label: ch.label }) : tr('compare.cost', { label: ch.label, from: show(ch.from), to: show(ch.to) })
    const keys = { name: 'nameChange', template: 'templateChange', back: 'backChange', quantity: 'quantityChange', code: 'codeChange' }
    return tr(`compare.${keys[ch.kind]}`, { from: ['template', 'back'].includes(ch.kind) ? (ch.from ?? tr('compare.none')) : show(ch.from), to: ['template', 'back'].includes(ch.kind) ? (ch.to ?? tr('compare.none')) : show(ch.to) })
  }
  const symbol = kind => tr(kind === 'added' ? 'compare.added' : kind === 'removed' ? 'compare.removed' : 'compare.changed')

  async function toggle(c) {
    if (expanded.has(c.id)) expanded.delete(c.id); else expanded.add(c.id)
    expanded = expanded
    if (expanded.has(c.id) && !pictures[c.id]) {
      pictures[c.id] = { from: null, to: null, loading: true }
      const side = which => window.spadewick.snapshots.compareRender({ handle, side: which, cardId: c.id })
      const [a, b] = await Promise.all([side('from'), side('to')])
      pictures = { ...pictures, [c.id]: { from: a, to: b } }
    }
  }

  async function toggleTemplate(o) {
    const id = o.key.split(':')[1]
    if (expanded.has(o.key)) expanded.delete(o.key); else expanded.add(o.key)
    expanded = expanded
    if (expanded.has(o.key) && !tplPictures[id]) {
      tplPictures[id] = { from: null, to: null }
      const side = which => window.spadewick.snapshots.compareRenderTemplate({ handle, side: which, templateId: id })
      const [a, b] = await Promise.all([side('from'), side('to')])
      tplPictures = { ...tplPictures, [id]: { from: a, to: b } }
    }
  }

  async function toggleSource(o) {
    const id = o.key.split(':')[1]
    if (tplSource[id]) { delete tplSource[id]; tplSource = tplSource; return }
    tplSource = { ...tplSource, [id]: await window.spadewick.snapshots.compareTemplateSource({ handle, templateId: id }) }
  }

  function pick(key, on) { if (on) picked.add(key); else picked.delete(key); picked = picked }
  const keysOf = c => c.kind === 'changed' ? c.changes.map(ch => ch.key) : [c.key]
  function pickAllShown() { for (const c of cards.filter(c => c.restorable)) for (const k of keysOf(c)) picked.add(k); picked = picked }

  async function restore(keys) {
    if (!keys.length) return
    try {
      const r = await window.spadewick.snapshots.compareRestore({ handle, keys })
      toast(tr('compare.restoredToast', { n: r.restored, skipped: r.skipped }), 'info', 4000)
      picked = new Set(); pictures = {}; tplPictures = {}; tplSource = {}
      await refreshProject(); await loadSet($activeSetId)
      diff = await window.spadewick.snapshots.compareRefresh(handle)
    } catch (err) { toast(tr('compare.restoreFailed', { reason: err.message }), 'error', 5000) }
  }

  async function exportList(format) {
    exportOpen = false
    try {
      const r = await window.spadewick.snapshots.compareExport({ handle, format })
      if (r) toast(tr('compare.exported', { path: r.path }), 'info', 4000)
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  const fieldText = f => {
    if (f.kind === 'added') return tr('compare.fieldAdded', { name: f.name, type: f.type })
    if (f.kind === 'removed') return tr('compare.fieldRemoved', { name: f.name })
    return f.what.map(w => w.aspect === 'name' ? tr('compare.fieldRenamed', { from: w.from, to: w.to })
      : w.aspect === 'type' ? tr('compare.fieldType', { name: f.name, from: w.from, to: w.to })
      : w.aspect === 'validation' ? tr('compare.fieldValidation', { name: f.name })
      : w.aspect === 'default' ? tr('compare.fieldDefault', { name: f.name }) : tr('compare.fieldFormula', { name: f.name })).join(' · ')
  }
  function otherText(o) {
    if (o.area === 'template' && o.kind === 'changed')
      return `${tr('compare.templateChanged', { name: o.name })} (${[o.design && tr('compare.templateDesign'), o.size && tr('compare.templateSize'), o.bleed && tr('compare.templateBleed')].filter(Boolean).join(', ') || '…'})`
    if (o.area === 'set' && o.kind === 'changed')
      return `${tr('compare.setChanged', { name: o.name })}: ${o.what.map(w => tr(w.aspect === 'name' ? 'compare.setRenamed' : w.aspect === 'code' ? 'compare.setCode' : 'compare.setSize', { from: show(w.from), to: show(w.to) })).join(' · ')}`
    if (o.area === 'rules' && o.kind === 'changed')
      return `${tr('compare.rulesChanged', { name: o.name })} (${[o.title && tr('compare.rulesTitle'), o.words && tr('compare.rulesWords')].filter(Boolean).join(', ')})`
    const key = { template: 'template', asset: 'asset', font: 'font', set: 'set', rules: 'rules' }[o.area]
    return tr(`compare.${key}${o.kind[0].toUpperCase()}${o.kind.slice(1)}`, { name: o.name })
  }
  const otherRestorable = o => live() && ((o.area === 'template' && (o.kind === 'changed' || o.kind === 'removed')) || (o.area === 'asset' && o.kind === 'removed') || (o.area === 'rules' && (o.kind === 'changed' || o.kind === 'removed')))
</script>

<div class="panel">
  <div class="bar">
    <strong>{tr('compare.title')}</strong>
    <span class="spacer" />
    {#if !live()}<span class="dim">{tr('compare.readOnlyBetween')}</span>{/if}
    {#if diff && !nothing}
      <label class="inline">{tr('compare.viewLabel')}
        <select bind:value={view}>
          <option value="side">{tr('compare.viewSideBySide')}</option>
          <option value="overlay">{tr('compare.viewOverlay')}</option>
          <option value="slider">{tr('compare.viewSlider')}</option>
        </select>
      </label>
      <span class="menu">
        <button aria-haspopup="true" aria-expanded={exportOpen} on:click={() => (exportOpen = !exportOpen)}>{tr('compare.exportList')}</button>
        {#if exportOpen}
          <span class="pop" role="menu">
            <button role="menuitem" on:click={() => exportList('markdown')}>{tr('compare.exportMd')}</button>
            <button role="menuitem" on:click={() => exportList('csv')}>{tr('compare.exportCsv')}</button>
            <button role="menuitem" on:click={() => exportList('html')}>{tr('compare.exportHtml')}</button>
          </span>
        {/if}
      </span>
    {/if}
    <button on:click={() => dispatch('close')}>{tr('compare.close')}</button>
  </div>

  {#if loadError}
    <p class="msg" role="alert">{loadError}</p>
  {:else if !diff}
    <p class="msg">{tr('compare.loading')}</p>
  {:else}
    <p class="headline" role="status">{headline}</p>

    {#if !nothing}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'cards'} class:on={tab === 'cards'} on:click={() => (tab = 'cards')}>{tr('compare.tabCards')} ({diff.cards.length})</button>
        <button role="tab" aria-selected={tab === 'fields'} class:on={tab === 'fields'} class:dim={!diff.fields.length} on:click={() => (tab = 'fields')}>{tr('compare.tabFields')} ({diff.fields.length})</button>
        <button role="tab" aria-selected={tab === 'other'} class:on={tab === 'other'} class:dim={!diff.other.length} on:click={() => (tab = 'other')}>{tr('compare.tabSettings')} ({diff.other.length})</button>
      </div>

      {#if tab === 'cards'}
        <div class="tools">
          <select bind:value={filter} aria-label={tr('compare.filterAll')}>
            <option value="all">{tr('compare.filterAll')}</option>
            <option value="changed">{tr('compare.filterChanged')}</option>
            <option value="added">{tr('compare.filterAdded')}</option>
            <option value="removed">{tr('compare.filterRemoved')}</option>
          </select>
          <input type="search" bind:value={search} placeholder={tr('compare.search')} aria-label={tr('compare.search')} />
          <span class="spacer" />
          {#if live()}
            {#each columns as [label, keys] (label)}<button on:click={() => restore(keys)}>{tr('compare.restoreColumn', { label })}</button>{/each}
            <button on:click={pickAllShown}>{tr('compare.selectAll')}</button>
            <button class="primary" disabled={!picked.size} on:click={() => restore([...picked])}>{tr('compare.restoreSelected')} ({picked.size})</button>
          {/if}
        </div>
        <ul>
          {#each cards as c (c.key)}
            <li>
              <div class="row">
                {#if live() && c.restorable}
                  <input type="checkbox" checked={keysOf(c).every(k => picked.has(k))} aria-label={c.name || tr('compare.unnamed')}
                    on:change={e => keysOf(c).forEach(k => pick(k, e.currentTarget.checked))} />
                {/if}
                <button class="open" aria-expanded={expanded.has(c.id)} on:click={() => toggle(c)}>
                  <span class="sym {c.kind}">{symbol(c.kind)}</span>
                  <b>{c.name || tr('compare.unnamed')}</b>
                  {#if c.code}<span class="dim">{c.code}</span>{/if}
                  <span class="dim">{tr('compare.inSet', { set: c.setName })}</span>
                </button>
              </div>
              {#if c.kind === 'changed'}
                <div class="summary">{c.changes.map(describe).join(' · ')}</div>
              {/if}
              {#if expanded.has(c.id)}
                <div class="detail">
                  <ComparePictures before={pictures[c.id]?.from} after={pictures[c.id]?.to} mode={view} afterLabel={tr(live() ? 'compare.after' : 'compare.afterTwo')} />
                  {#each c.changes as ch (ch.key)}
                    <div class="change">
                      <div class="what">
                        {#if ch.words}
                          <b>{ch.label}:</b> {#each ch.words as w}<span class="w {w.op}">{w.text}</span>{/each}
                        {:else}{describe(ch)}{/if}
                      </div>
                      {#if live()}<button on:click={() => restore([ch.key])}>{tr('compare.undoThis')}</button>{/if}
                    </div>
                  {/each}
                  {#if live()}
                    {#if c.kind === 'changed' && c.changes.length > 1}<button on:click={() => restore(keysOf(c))}>{tr('compare.restoreCard')}</button>{/if}
                    {#if c.kind === 'added'}<button on:click={() => restore([c.key])}>{tr('compare.removeCard')}</button>{/if}
                    {#if c.kind === 'removed'}
                      {#if c.restorable}<button on:click={() => restore([c.key])}>{tr('compare.bringBack')}</button>{:else}<span class="dim">{tr('compare.cannotBringBack')}</span>{/if}
                    {/if}
                  {/if}
                </div>
              {/if}
            </li>
          {:else}
            <li class="dim pad">{tr('compare.noCards')}</li>
          {/each}
        </ul>
      {:else if tab === 'fields'}
        <ul>
          {#each diff.fields as f (f.key)}<li class="pad"><span class="sym {f.kind}">{symbol(f.kind)}</span> {fieldText(f)} <span class="dim">{tr('compare.inSet', { set: f.setName })}</span></li>
          {:else}<li class="dim pad">{tr('compare.noFields')}</li>{/each}
        </ul>
      {:else}
        <ul>
          {#each diff.other as o (o.key)}
            <li class="pad">
              <div class="row">
                <span class="sym {o.kind}">{symbol(o.kind)}</span>
                {#if o.area === 'template' && o.kind === 'changed'}
                  <button class="open" aria-expanded={expanded.has(o.key)} on:click={() => toggleTemplate(o)}>{otherText(o)}</button>
                {:else}<span>{otherText(o)}</span>{/if}
                {#if o.area === 'asset' && o.thumb}<img class="thumb" alt="" src="data:image/jpeg;base64,{o.thumb}" />{/if}
                <span class="spacer" />
                {#if otherRestorable(o)}
                  <button on:click={() => restore([o.key])}>{o.area === 'template' ? tr('compare.useOldTemplate') : o.area === 'rules' ? tr('compare.useOldPage') : tr('compare.bringImageBack')}</button>
                {/if}
              </div>
              {#if o.area === 'template' && expanded.has(o.key)}
                <div class="detail">
                  <ComparePictures before={tplPictures[o.key.split(':')[1]]?.from} after={tplPictures[o.key.split(':')[1]]?.to} mode={view} afterLabel={tr(live() ? 'compare.after' : 'compare.afterTwo')} />
                  {#if o.design}
                    <button on:click={() => toggleSource(o)}>{tr(tplSource[o.key.split(':')[1]] ? 'compare.hideSource' : 'compare.templateSource')}</button>
                    {#if tplSource[o.key.split(':')[1]]}
                      <pre class="source">{#each tplSource[o.key.split(':')[1]] as part}<span class="w {part.op}">{part.text}{'\n'}</span>{/each}</pre>
                    {/if}
                  {/if}
                </div>
              {/if}
            </li>
          {:else}<li class="dim pad">{tr('compare.noOther')}</li>{/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .panel { flex: 1; overflow: auto; display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
  .spacer { flex: 1; }
  .inline { display: flex; gap: 4px; align-items: center; font-size: 12px; }
  .menu { position: relative; }
  .pop { position: absolute; right: 0; top: 100%; z-index: 5; display: flex; flex-direction: column; background: var(--color-surface); border: 1px solid var(--color-border); }
  .headline { padding: 12px; font-size: 14px; font-weight: 600; }
  .msg { padding: 12px; }
  .tabs { display: flex; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--color-border); }
  .tabs button { border-radius: 4px 4px 0 0; }
  .tabs button.on { font-weight: 700; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
  .tools { display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-wrap: wrap; }
  ul { list-style: none; }
  li { padding: 6px 12px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
  li.pad { padding: 8px 12px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .open { flex: 1; display: flex; gap: 8px; align-items: baseline; background: none; border: 0; text-align: left; cursor: pointer; color: inherit; }
  .sym { font-weight: 700; font-family: monospace; }
  .summary { color: var(--color-text-dim); padding-left: 28px; }
  .detail { padding: 8px 0 8px 28px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .thumb { width: 36px; height: 36px; object-fit: contain; border: 1px solid var(--color-border); }
  .change { display: flex; align-items: center; gap: 8px; }
  .source { max-height: 260px; overflow: auto; font-size: 11px; white-space: pre-wrap; margin: 0; width: 100%; }
  .w.add { background: #bfe8c4; color: #0b3d12; text-decoration: underline; }
  .w.del { background: #f4c4c4; color: #5c1010; text-decoration: line-through; }
</style>
