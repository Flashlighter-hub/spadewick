<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * The component library (PRD §7.10): the reusable parts of templates kept for every project. Put one into the template that is open,
   * give it another name, share it as a file, or take it out of the library (templates that already use it keep their copy).
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'
  import { askText, askConfirm } from '../stores/prompt.js'

  export let fieldSlugs = []             // the fields of the open set, to say which fields a component needs that the set does not have
  const dispatch = createEventDispatcher()

  let items = []
  let loaded = false
  let filter = ''

  async function refresh() {
    try { items = await window.spadewick.components.list() } catch (err) { toast(err.message, 'error', 5000) }
    loaded = true
  }
  onMount(refresh)

  $: shown = items.filter(c => !filter.trim() || `${c.name} ${c.description}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const missing = c => c.fields.filter(f => f !== 'display_name' && !fieldSlugs.includes(f))

  async function rename(c) {
    const name = await askText(tr('componentLibrary.renamePrompt'), c.name)
    if (!name?.trim() || name.trim() === c.name) return
    try { await window.spadewick.components.rename({ id: c.id, name: name.trim() }); await refresh() } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function remove(c) {
    if (!await askConfirm(tr('componentLibrary.confirmDelete', { name: c.name }))) return
    try { await window.spadewick.components.delete(c.id); await refresh() } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function share(c) {
    try {
      const r = await window.spadewick.components.export({ id: c.id })
      if (!r.canceled) toast(tr('componentLibrary.exported', { name: c.name }), 'info', 3000)
    } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function add() {
    try {
      const r = await window.spadewick.components.import()
      if (!r.canceled) { toast(tr('componentLibrary.imported', { name: r.name }), 'info', 3000); await refresh() }
    } catch (err) { toast(err.message, 'error', 5000) }
  }
</script>

<Modal title="{tr('componentLibrary.title')}" width={760} on:close>
  <div class="top">
    <label class="find">{tr('componentLibrary.find')} <input class="field" bind:value={filter} /></label>
    <button on:click={add}>{tr('componentLibrary.import')}</button>
  </div>
  <p class="how">{tr('componentLibrary.how')}</p>
  {#if shown.length}
    <ul class="grid" aria-label="{tr('componentLibrary.list')}">
      {#each shown as c (c.id)}
        <li class="tile">
          <div class="pic">{#if c.thumbnail}<img src="data:image/png;base64,{c.thumbnail}" alt="" />{/if}</div>
          <h3>{c.name} <span class="dim">{c.builtIn ? tr('componentLibrary.builtInTag') : `v${c.version}`}</span></h3>
          {#if c.description}<p class="desc">{c.description}</p>{/if}
          {#if missing(c).length}<p class="warn" role="note">{tr('componentLibrary.needsFields', { fields: missing(c).join(', ') })}</p>{/if}
          <div class="actions">
            <button class="primary" on:click={() => dispatch('insert', { id: c.id })} aria-label="{tr('componentLibrary.insertNamed', { name: c.name })}">{tr('componentLibrary.insert')}</button>
            <button on:click={() => rename(c)} disabled={c.builtIn} aria-label="{tr('componentLibrary.renameNamed', { name: c.name })}">{tr('componentLibrary.rename')}</button>
            <button on:click={() => share(c)} aria-label="{tr('componentLibrary.shareNamed', { name: c.name })}">{tr('componentLibrary.share')}</button>
            <button class="danger" on:click={() => remove(c)} disabled={c.builtIn} aria-label="{tr('componentLibrary.deleteNamed', { name: c.name })}">{tr('componentLibrary.delete')}</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="none">{loaded ? (items.length ? tr('componentLibrary.noMatch') : tr('componentLibrary.empty')) : tr('componentLibrary.loading')}</p>
  {/if}
  <div class="foot"><span class="spacer" /><button on:click={() => dispatch('close')}>{tr('common.close')}</button></div>
</Modal>

<style>
  .top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .find { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .find input { flex: 1; }
  .how { margin: 0 0 10px; font-size: 12px; color: var(--color-text-dim); }
  .grid { list-style: none; margin: 0 0 10px; padding: 4px; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; max-height: 56vh; overflow: auto; }
  .tile { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--color-control-border); border-radius: var(--radius); background: var(--color-surface); }
  .pic { height: 120px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius); background: repeating-conic-gradient(#e6e6ec 0% 25%, #f7f7fa 0% 50%) 50% / 16px 16px; }
  .pic img { max-width: 100%; max-height: 100%; object-fit: contain; }
  h3 { margin: 0; font-size: 13px; }
  .dim { color: var(--color-text-dim); font-weight: 400; font-size: 11px; }
  .desc { margin: 0; font-size: 11px; color: var(--color-text-dim); }
  .warn { margin: 0; font-size: 11px; color: var(--color-danger-text); }
  .actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: auto; }
  .actions button { font-size: 11px; padding: 2px 8px; }
  .none { color: var(--color-text-dim); font-style: italic; text-align: center; padding: 30px 0; }
  .foot { display: flex; }
  .spacer { flex: 1; }
</style>
